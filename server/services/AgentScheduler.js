'use strict';

/**
 * AgentScheduler — platform-level agent scheduling primitive.
 *
 * Enables any agent to run on a cron schedule, be triggered manually,
 * and have its execution history queried. Nothing in this file knows
 * about any specific domain — it is a pure scheduling primitive.
 *
 * Usage:
 *   const { agentScheduler } = require('../services/AgentScheduler');
 *   await agentScheduler.register({ agentId, schedule, handler, scope, config });
 *   const { executionId, result, status } = await agentScheduler.trigger(agentId, context);
 *
 * Or with injected dependencies (tests):
 *   const { AgentScheduler } = require('../services/AgentScheduler');
 *   const scheduler = new AgentScheduler({ logger: mockLogger, pool: mockPool });
 */

const cron           = require('node-cron');
const defaultLogger  = require('../utils/logger');
const { pool: defaultPool } = require('../db');

// ─── AgentSchedulerError ──────────────────────────────────────────────────────

class AgentSchedulerError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   * @param {string|null} [details.agentId]
   * @param {Error}       [details.cause]
   */
  constructor(message, { agentId, cause } = {}) {
    super(message);
    this.name    = 'AgentSchedulerError';
    this.agentId = agentId ?? null;
    if (cause !== undefined) this.cause = cause;
  }
}

// ─── AgentScheduler ───────────────────────────────────────────────────────────

class AgentScheduler {
  /**
   * @param {object} [options]
   * @param {object} [options.logger] - Winston-compatible logger. Defaults to platform logger.
   * @param {object} [options.pool]   - pg Pool instance. Defaults to platform pool.
   */
  constructor({ logger: customLogger, pool: customPool } = {}) {
    this.logger = customLogger ?? defaultLogger;
    this.pool   = customPool   ?? defaultPool;

    this._jobs     = new Map(); // agentId → ScheduledTask (node-cron)
    this._handlers = new Map(); // agentId → async (context) => result

    // Fire-and-forget: restores active cron jobs from DB on startup.
    // _ready resolves when _restoreSchedules() completes (or fails gracefully).
    // Tests must await scheduler._ready before asserting _jobs state.
    this._ready = this._restoreSchedules().catch(err => {
      this.logger.error('AgentScheduler: failed to restore schedules on startup', {
        error: err.message,
      });
    });
  }

  // ── _restoreSchedules (private) ───────────────────────────────────────────

  /**
   * Reload active cron jobs from agent_schedules on startup.
   * Called once from constructor — fire-and-forget via _ready.
   *
   * Cron jobs use lazy handler lookup: trigger() looks up _handlers at fire
   * time, so jobs can be created here before domain modules have re-registered
   * their handlers. If the handler is absent at fire time, trigger() throws
   * AgentSchedulerError, which the cron tick wrapper catches and logs.
   */
  async _restoreSchedules() {
    const result = await this.pool.query(
      `SELECT agent_id, schedule, org_id, tool_slug
       FROM agent_schedules
       WHERE enabled = true AND schedule IS NOT NULL`
    );

    let started = 0;
    for (const row of result.rows) {
      // Defence in depth: skip any row that slipped past the WHERE clause.
      if (row.enabled === false) continue;
      this._startCronJob(row.agent_id, row.schedule, row.org_id, row.tool_slug);
      started++;
    }

    this.logger.info('AgentScheduler: restored scheduled jobs on startup', { count: started });
  }

  // ── register ──────────────────────────────────────────────────────────────

  /**
   * Register an agent for scheduled or manual execution.
   * Upserts to agent_schedules and (re)starts the cron job if schedule is provided.
   * Warns but does not throw if agentId is already registered — overwrites handler
   * and refreshes the DB record.
   *
   * @param {object}      config
   * @param {string}      config.agentId          Unique identifier e.g. 'ads-monitor-daily'
   * @param {string|null} config.schedule          Cron expression or null for manual-only
   * @param {Function}    config.handler           async (context) => result
   * @param {object}      [config.scope]
   * @param {string}      [config.scope.toolSlug]
   * @param {number|null} [config.scope.orgId]     null = runs for all orgs (see trigger orgId guard)
   * @param {object}      [config.config]          Agent-specific config stored in DB
   * @returns {Promise<{ agentId: string }>}
   * @throws {AgentSchedulerError} If agentId or handler missing, or cron expression invalid.
   */
  async register(config) {
    const {
      agentId,
      schedule          = null,
      handler,
      scope             = {},
      config: agentConfig = {},
    } = config ?? {};

    if (!agentId) {
      throw new AgentSchedulerError('agentId is required');
    }
    if (typeof handler !== 'function') {
      throw new AgentSchedulerError('handler must be a function', { agentId });
    }
    if (schedule !== null && !cron.validate(schedule)) {
      throw new AgentSchedulerError(`Invalid cron expression: "${schedule}"`, { agentId });
    }

    if (this._handlers.has(agentId)) {
      this.logger.warn('AgentScheduler: overwriting existing registration', { agentId });
    }

    this._handlers.set(agentId, handler);

    // Upsert schedule record
    await this.pool.query(
      `INSERT INTO agent_schedules (agent_id, tool_slug, org_id, schedule, config)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (agent_id) DO UPDATE SET
         tool_slug  = EXCLUDED.tool_slug,
         org_id     = EXCLUDED.org_id,
         schedule   = EXCLUDED.schedule,
         config     = EXCLUDED.config,
         updated_at = NOW()`,
      [
        agentId,
        scope.toolSlug ?? null,
        scope.orgId    ?? null,
        schedule,
        JSON.stringify(agentConfig),
      ]
    );

    // (Re)start cron job — _startCronJob stops any existing job first
    this._stopCronJob(agentId);
    if (schedule !== null) {
      this._startCronJob(agentId, schedule, scope.orgId ?? null, scope.toolSlug ?? null);
    }

    this.logger.info('AgentScheduler: registered agent', {
      agentId,
      schedule: schedule ?? 'manual-only',
    });
    return { agentId };
  }

  // ── trigger ───────────────────────────────────────────────────────────────

  /**
   * Execute an agent immediately, ignoring its cron schedule.
   *
   * orgId is always sourced from context — never from caller-supplied input.
   * This is the hard isolation guarantee: an agent cannot execute in another
   * org's scope by passing a different orgId through the tool input.
   *
   * Handler errors are caught, logged at error level, and stored in
   * agent_executions. They do not propagate to the caller — a failing handler
   * must never crash the server process.
   *
   * @param {string} agentId
   * @param {{ orgId: number, userId?: number, triggerType?: string, toolSlug?: string }} context
   * @returns {Promise<{ executionId: string, result: *, status: string }>}
   * @throws {AgentSchedulerError} If agent not registered, or orgId is null.
   */
  async trigger(agentId, context) {
    const handler = this._handlers.get(agentId);
    if (!handler) {
      throw new AgentSchedulerError(`Agent not registered: ${agentId}`, { agentId });
    }

    // orgId sourced exclusively from context — security assertion, not documentation.
    const orgId        = context.orgId ?? null;
    const userId       = context.userId ?? null;
    const triggerType  = context.triggerType ?? 'manual';

    // TODO: org_tools table not yet built. Once available, agents registered with
    // scope.orgId = null should query org_tools to determine which orgs to run for,
    // then call trigger() once per org with an explicit orgId.
    if (orgId === null) {
      throw new AgentSchedulerError(
        'Per-org scheduling requires org_tools table — pass explicit orgId or build org_tools first',
        { agentId }
      );
    }

    // Create execution row — status 'running' until handler completes
    const insertResult = await this.pool.query(
      `INSERT INTO agent_executions (agent_id, org_id, trigger_type, triggered_by, status)
       VALUES ($1, $2, $3, $4, 'running')
       RETURNING id`,
      [agentId, orgId, triggerType, userId]
    );
    const executionId = insertResult.rows[0].id;

    let result   = null;
    let status   = 'success';
    let errorMsg = null;

    try {
      result = await handler(context);
    } catch (err) {
      status   = 'error';
      errorMsg = err.message ?? 'Unknown error';
      this.logger.error('AgentScheduler: handler execution error', {
        agentId,
        error: errorMsg,
        orgId,
        triggerType,
      });
      // Do not rethrow — a failing handler must never crash the process.
    }

    // Update execution row with outcome
    await this.pool.query(
      `UPDATE agent_executions
       SET status       = $1,
           result       = $2,
           error        = $3,
           completed_at = NOW()
       WHERE id = $4`,
      [status, result != null ? JSON.stringify(result) : null, errorMsg, executionId]
    );

    // Update schedule metadata
    // next_run_at: populated when cron-parser is added as an explicit dependency
    await this.pool.query(
      `UPDATE agent_schedules
       SET last_run_at     = NOW(),
           last_run_status = $1,
           updated_at      = NOW()
       WHERE agent_id = $2`,
      [status, agentId]
    );

    return { executionId, result, status };
  }

  // ── pause ─────────────────────────────────────────────────────────────────

  /**
   * Stop the cron job and set enabled = false in DB.
   *
   * @param {string} agentId
   * @returns {Promise<{ agentId: string, enabled: false }>}
   * @throws {AgentSchedulerError} If agentId not found in DB.
   */
  async pause(agentId) {
    const schedule = await this.getSchedule(agentId);
    if (!schedule) {
      throw new AgentSchedulerError(`Agent not found: ${agentId}`, { agentId });
    }

    this._stopCronJob(agentId);

    await this.pool.query(
      `UPDATE agent_schedules
       SET enabled = false, updated_at = NOW()
       WHERE agent_id = $1`,
      [agentId]
    );

    this.logger.info('AgentScheduler: paused agent', { agentId });
    return { agentId, enabled: false };
  }

  // ── resume ────────────────────────────────────────────────────────────────

  /**
   * Set enabled = true in DB and restart the cron job if a schedule is defined.
   *
   * @param {string} agentId
   * @returns {Promise<{ agentId: string, enabled: true }>}
   * @throws {AgentSchedulerError} If agentId not found in DB.
   */
  async resume(agentId) {
    const schedule = await this.getSchedule(agentId);
    if (!schedule) {
      throw new AgentSchedulerError(`Agent not found: ${agentId}`, { agentId });
    }

    await this.pool.query(
      `UPDATE agent_schedules
       SET enabled = true, updated_at = NOW()
       WHERE agent_id = $1`,
      [agentId]
    );

    if (schedule.schedule) {
      this._startCronJob(agentId, schedule.schedule, schedule.org_id, schedule.tool_slug);
    }

    this.logger.info('AgentScheduler: resumed agent', { agentId });
    return { agentId, enabled: true };
  }

  // ── getHistory ────────────────────────────────────────────────────────────

  /**
   * Return execution history for an agent, most-recent first.
   * Supports optional filtering by orgId, status, and date range.
   *
   * @param {string} agentId
   * @param {object} [filters]
   * @param {number}                      [filters.limit=20]
   * @param {string}                      [filters.status]
   * @param {[Date|string, Date|string]}  [filters.dateRange]
   * @param {{ orgId?: number }}          [context]
   * @returns {Promise<Array>}
   */
  async getHistory(agentId, filters = {}, context = {}) {
    const { limit = 20, status, dateRange } = filters;
    const cap = Math.min(Math.max(1, limit), 100);

    // Dynamic WHERE builder: accumulate conditions and params, increment $n per predicate.
    // All values are parameterised — no string interpolation.
    const conditions = ['agent_id = $1'];
    const params     = [agentId];

    if (context?.orgId != null) {
      params.push(context.orgId);
      conditions.push(`org_id = $${params.length}`);
    }

    if (status != null) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (Array.isArray(dateRange) && dateRange.length === 2) {
      params.push(dateRange[0]);
      conditions.push(`started_at >= $${params.length}`);
      params.push(dateRange[1]);
      conditions.push(`started_at <= $${params.length}`);
    }

    params.push(cap);

    const result = await this.pool.query(
      `SELECT id, agent_id, org_id, trigger_type, triggered_by,
              started_at, completed_at, status, result, error,
              tokens_used, execution_log
       FROM agent_executions
       WHERE ${conditions.join(' AND ')}
       ORDER BY started_at DESC
       LIMIT $${params.length}`,
      params
    );

    return result.rows;
  }

  // ── getSchedule ───────────────────────────────────────────────────────────

  /**
   * Return the agent_schedules row for an agentId, or null if not found.
   *
   * @param {string} agentId
   * @returns {Promise<object|null>}
   */
  async getSchedule(agentId) {
    const result = await this.pool.query(
      `SELECT id, agent_id, tool_slug, org_id, schedule, enabled,
              config, last_run_at, last_run_status, next_run_at,
              created_at, updated_at
       FROM agent_schedules
       WHERE agent_id = $1`,
      [agentId]
    );
    return result.rows[0] ?? null;
  }

  // ── _startCronJob (private) ───────────────────────────────────────────────

  _startCronJob(agentId, schedule, orgId, toolSlug) {
    // Stop any existing job for this agentId before creating a new one.
    // Prevents duplicate cron tasks if _startCronJob is called more than once.
    this._stopCronJob(agentId);

    const job = cron.schedule(schedule, async () => {
      try {
        await this.trigger(agentId, {
          orgId,
          toolSlug,
          triggerType: 'scheduled',
          userId:      null,
        });
      } catch (err) {
        // Handler errors and AgentSchedulerErrors (e.g. missing handler) both
        // land here — log and continue. Never crash the process.
        this.logger.error('AgentScheduler: scheduled trigger failed', {
          agentId,
          error: err.message,
        });
      }
    });

    this._jobs.set(agentId, job);
  }

  // ── _stopCronJob (private) ────────────────────────────────────────────────

  _stopCronJob(agentId) {
    const job = this._jobs.get(agentId);
    if (job) {
      job.stop();
      this._jobs.delete(agentId);
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

// Module-level singleton — Node's require cache ensures a single instance is
// shared across all importers. Domain modules call agentScheduler.register()
// at their own module load, which both persists to DB and starts cron jobs.
// On server restart, _restoreSchedules() re-creates cron jobs automatically.
const agentScheduler = new AgentScheduler();

module.exports = { AgentScheduler, AgentSchedulerError, agentScheduler };
