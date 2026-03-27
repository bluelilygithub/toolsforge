'use strict';

/**
 * AgentScheduler — platform-level cron scheduling primitive.
 *
 * Registers agents to run on a schedule. On each tick, calls runFn and
 * persists the result to agent_runs via the shared persistRun helper.
 *
 * Supports hot-reload: calling register() again for the same slug stops the
 * existing cron task before starting a new one. Use updateSchedule() to change
 * a running agent's cron expression without restarting the server.
 *
 * Nothing in this file is specific to any agent or domain.
 */

const cron           = require('node-cron');
const { pool }       = require('../db');
const logger         = require('../utils/logger');
const { persistRun } = require('./createAgentRoute');

const AgentScheduler = {
  /** slug → { task, runFn, orgId } — enables hot-reload via updateSchedule(). */
  _jobs: {},

  /**
   * Register an agent for scheduled execution.
   * If already registered under the same slug, the existing job is stopped first.
   *
   * @param {string}      slug      Agent slug, e.g. 'google-ads-monitor'
   * @param {string}      schedule  Standard 5-field cron, e.g. '0 6,18 * * *'
   * @param {Function}    runFn     async (context) => { result, trace, tokensUsed }
   * @param {number|null} [orgId]   Target org. Resolved from DB if omitted.
   */
  register({ slug, schedule, runFn, orgId: fixedOrgId = null }) {
    if (!cron.validate(schedule)) {
      throw new Error(`AgentScheduler: invalid cron expression "${schedule}" for slug "${slug}"`);
    }

    // Stop existing task for this slug before re-registering.
    if (this._jobs[slug]) {
      this._jobs[slug].task.stop();
      delete this._jobs[slug];
    }

    const handler = async () => {
      let orgId = fixedOrgId;

      if (orgId == null) {
        try {
          const res = await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 1');
          orgId = res.rows[0]?.id ?? null;
        } catch (err) {
          logger.error('AgentScheduler: failed to resolve orgId', { slug, error: err.message });
          return;
        }
      }

      if (orgId == null) {
        logger.error('AgentScheduler: no organization found, skipping run', { slug });
        return;
      }

      const startTime = Date.now();
      logger.info('AgentScheduler: starting scheduled run', { slug, orgId });

      try {
        const { result, trace, tokensUsed } = await runFn({ orgId, toolSlug: slug });
        await persistRun({ slug, orgId, status: 'complete', summary: result, trace, tokensUsed, startTime });
        logger.info('AgentScheduler: scheduled run complete', {
          slug, orgId, durationMs: Date.now() - startTime,
        });
      } catch (err) {
        logger.error('AgentScheduler: scheduled run failed', { slug, orgId, error: err.message });
        try {
          await persistRun({
            slug, orgId, status: 'error', summary: err.message,
            trace: [], tokensUsed: {}, startTime,
          });
        } catch (dbErr) {
          logger.warn('AgentScheduler: failed to persist error run', { slug, error: dbErr.message });
        }
      }
    };

    const task = cron.schedule(schedule, handler);
    this._jobs[slug] = { task, runFn, orgId: fixedOrgId };
    logger.info('AgentScheduler: registered', { slug, schedule });
  },

  /**
   * Update the cron schedule for a registered agent without restarting the server.
   * Stops the existing task and re-registers with the new expression.
   *
   * @param {string} slug
   * @param {string} newSchedule
   * @throws {Error} if the slug is not registered or the expression is invalid
   */
  updateSchedule(slug, newSchedule) {
    const existing = this._jobs[slug];
    if (!existing) {
      throw new Error(`AgentScheduler: no registered job for slug "${slug}"`);
    }
    if (!cron.validate(newSchedule)) {
      throw new Error(`AgentScheduler: invalid cron expression "${newSchedule}"`);
    }
    this.register({ slug, schedule: newSchedule, runFn: existing.runFn, orgId: existing.orgId });
    logger.info('AgentScheduler: schedule updated', { slug, schedule: newSchedule });
  },

  /**
   * Return the current schedule expression for a registered slug, or null.
   * @param {string} slug
   * @returns {string|null}
   */
  getSchedule(slug) {
    return this._jobs[slug]?.schedule ?? null;
  },
};

module.exports = { AgentScheduler };
