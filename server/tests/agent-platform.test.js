'use strict';

/**
 * agent-platform.test.js — Integration tests for the agent platform services.
 *
 * Tests:
 *   1. StateManager.setState()       — INSERT params[0] is context.orgId
 *   2. StateManager.getState()       — SELECT params[0] is context.orgId
 *   3. StateManager.saveConclusion() — INSERT params[0] is context.orgId
 *   4. Full pipeline                 — context.orgId flows through AgentOrchestrator
 *                                      → tool execute → StateManager INSERT
 *   5. AgentScheduler                — register, trigger, history, pause/resume
 *   6. AgentScheduler boot           — _restoreSchedules() on constructor
 *
 * Uses node:test (built-in). No external test framework or test database.
 * All external dependencies are stubbed via require.cache injection before any
 * service module is loaded.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// ─── Silent logger ────────────────────────────────────────────────────────────

const silentLogger = {
  info:  () => {},
  warn:  () => {},
  error: () => {},
  debug: () => {},
};

// ─── Stub helper ──────────────────────────────────────────────────────────────

function stubModule(resolvedPath, exports) {
  require.cache[resolvedPath] = {
    id:       resolvedPath,
    filename: resolvedPath,
    loaded:   true,
    exports,
  };
}

// ─── Stub all external dependencies BEFORE loading service modules ────────────
//
// Order matters: stubs must be in place before the first require() of any
// service that imports them. Node's require cache is checked before the
// filesystem, so a stub placed here takes precedence.

// 1. Logger
const loggerPath = require.resolve(path.resolve(__dirname, '../utils/logger'));
stubModule(loggerPath, silentLogger);

// 2. DB pool — shared stub; individual tests override .query as needed
const dbStub = {
  pool: {
    query: async () => ({ rows: [], rowCount: 0 }),
  },
};
const dbPath = require.resolve(path.resolve(__dirname, '../db'));
stubModule(dbPath, dbStub);

// 3. Anthropic SDK — stub the constructor so AgentOrchestrator can be
//    instantiated without a real API key. Tests inject a mock client directly.
const anthropicPath = require.resolve('@anthropic-ai/sdk');
function MockAnthropic() {
  this.messages = {
    create: async () => {
      throw new Error('Real Anthropic API must not be called in tests');
    },
  };
}
stubModule(anthropicPath, MockAnthropic);

// 4. node-cron — captures schedule() calls without starting real timers.
//    cronCapture is reset per-test via cronCapture.reset() to prevent state leakage.
const nodeCronPath = require.resolve('node-cron');
const cronCapture = {
  calls:     [], // [{ expr: string, task: object, fn: Function }]
  stopCalls: [], // cron expressions whose tasks were stopped
  reset() {
    this.calls     = [];
    this.stopCalls = [];
  },
};
const nodeCronStub = {
  validate: (_expr) => true, // accept all expressions in tests
  schedule: (expr, fn) => {
    const task = {
      _expr: expr,
      stop:  () => { cronCapture.stopCalls.push(expr); },
    };
    cronCapture.calls.push({ expr, task, fn });
    return task;
  },
};
stubModule(nodeCronPath, nodeCronStub);

// ─── Load service modules after stubs are in place ───────────────────────────

const { StateManager }                          = require('../services/StateManager');
const { AgentOrchestrator }                     = require('../services/AgentOrchestrator');
const { AgentScheduler, AgentSchedulerError }   = require('../services/AgentScheduler');

// ─── StateManager tests ───────────────────────────────────────────────────────

describe('StateManager', () => {
  test('setState() — params[0] of INSERT is context.orgId', async () => {
    const capturedQueries = [];

    dbStub.pool.query = async (sql, params) => {
      capturedQueries.push({ sql, params });
      return {
        rows: [{
          id:         'test-uuid',
          org_id:     params[0],
          tool_slug:  params[1],
          session_id: params[2],
          key:        params[3],
          value:      params[4],
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      };
    };

    const sm = new StateManager({ logger: silentLogger, pool: dbStub.pool });
    const context = { userId: 1, orgId: 42, toolSlug: 'test-tool' };

    await sm.setState(context, 'myKey', { some: 'data' });

    const insertQuery = capturedQueries.find(q => q.sql.includes('INSERT INTO agent_states'));
    assert.ok(insertQuery, 'INSERT INTO agent_states must be executed');
    assert.strictEqual(
      insertQuery.params[0],
      context.orgId,
      'params[0] must equal context.orgId (42)'
    );
  });

  test('getState() — params[0] of SELECT is context.orgId', async () => {
    const capturedQueries = [];

    dbStub.pool.query = async (sql, params) => {
      capturedQueries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    };

    const sm = new StateManager({ logger: silentLogger, pool: dbStub.pool });
    const context = { userId: 1, orgId: 55, toolSlug: 'test-tool' };

    await sm.getState(context, 'someKey');

    const selectQuery = capturedQueries.find(
      q => q.sql.includes('SELECT') && q.sql.includes('agent_states')
    );
    assert.ok(selectQuery, 'SELECT FROM agent_states must be executed');
    assert.strictEqual(
      selectQuery.params[0],
      context.orgId,
      'params[0] must equal context.orgId (55)'
    );
  });

  test('saveConclusion() — params[0] of INSERT is context.orgId', async () => {
    const capturedQueries = [];

    dbStub.pool.query = async (sql, params) => {
      capturedQueries.push({ sql, params });
      return {
        rows: [{
          id:         'conc-uuid',
          org_id:     params[0],
          tool_slug:  params[1],
          run_id:     params[3],
          created_at: new Date().toISOString(),
        }],
        rowCount: 1,
      };
    };

    const sm = new StateManager({ logger: silentLogger, pool: dbStub.pool });
    const context = { userId: 2, orgId: 77, toolSlug: 'my-agent' };

    await sm.saveConclusion(context, {
      runId:      'run-abc-123',
      result:     'The answer is 42.',
      trace:      [],
      tokensUsed: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
      iterations: 3,
    });

    const insertQuery = capturedQueries.find(q => q.sql.includes('INSERT INTO agent_conclusions'));
    assert.ok(insertQuery, 'INSERT INTO agent_conclusions must be executed');
    assert.strictEqual(
      insertQuery.params[0],
      context.orgId,
      'params[0] must equal context.orgId (77)'
    );
  });
});

// ─── Full pipeline test ───────────────────────────────────────────────────────

describe('Full pipeline', () => {
  test('context.orgId flows through AgentOrchestrator → tool execute → StateManager INSERT', async () => {
    const capturedQueries = [];

    // Pool that records every SQL call made during the pipeline run
    const testPool = {
      query: async (sql, params) => {
        capturedQueries.push({ sql, params });
        return {
          rows: [{
            id:         'state-uuid',
            org_id:     params?.[0],
            tool_slug:  params?.[1],
            session_id: params?.[2],
            key:        params?.[3],
            value:      params?.[4],
            updated_at: new Date().toISOString(),
          }],
          rowCount: 1,
        };
      },
    };

    const sm = new StateManager({ logger: silentLogger, pool: testPool });

    // Mock Anthropic client: first call returns one tool_use block, second
    // returns end_turn. This exercises the full two-iteration ReAct loop.
    let apiCallCount = 0;
    const mockAnthropicClient = {
      messages: {
        create: async () => {
          apiCallCount++;
          if (apiCallCount === 1) {
            return {
              stop_reason: 'tool_use',
              content: [
                {
                  type:  'tool_use',
                  id:    'tu_pipeline_1',
                  name:  'save_agent_state',
                  input: { key: 'pipeline-result', value: { verified: true } },
                },
              ],
              usage: {
                input_tokens:                100,
                output_tokens:               30,
                cache_read_input_tokens:     0,
                cache_creation_input_tokens: 0,
              },
            };
          }
          return {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'State saved and task complete.' }],
            usage: {
              input_tokens:                50,
              output_tokens:               10,
              cache_read_input_tokens:     0,
              cache_creation_input_tokens: 0,
            },
          };
        },
      },
    };

    const orchestrator = new AgentOrchestrator({ logger: silentLogger });
    // Inject mock client — prevents any real Anthropic API call
    orchestrator.anthropic = mockAnthropicClient;

    // Tool under test: execute receives context from AgentOrchestrator and passes
    // it directly to StateManager. orgId must flow from context, not from input.
    const saveAgentStateTool = {
      name:        'save_agent_state',
      description: 'Persist a result to agent state.',
      input_schema: {
        type:       'object',
        properties: {
          key:   { type: 'string'  },
          value: { type: 'object' },
        },
        required: ['key', 'value'],
      },
      execute: async (input, ctx) => {
        // orgId comes from ctx — the tool cannot substitute a different orgId
        return await sm.setState(ctx, input.key, input.value);
      },
    };

    const context = { userId: 7, orgId: 42, toolSlug: 'pipeline-test' };

    const { result, iterations } = await orchestrator.run({
      systemPrompt:  'You are a pipeline test agent.',
      userMessage:   'Save the result of the pipeline verification.',
      tools:         [saveAgentStateTool],
      context,
      maxIterations: 5,
    });

    // Agent must complete and return a final text result
    assert.ok(result, 'AgentOrchestrator must return a non-empty result');
    assert.strictEqual(
      iterations, 2,
      'Agent must complete in exactly 2 iterations (tool call + end_turn)'
    );

    // ── Critical assertion: orgId isolation ───────────────────────────────────
    // The StateManager INSERT must have been executed. Its first SQL parameter
    // must equal context.orgId — not a hardcoded value, not a value from
    // tool input. This is the structural proof that orgId isolation holds end-to-end.
    const insertQuery = capturedQueries.find(q => q.sql.includes('INSERT INTO agent_states'));
    assert.ok(
      insertQuery,
      'StateManager INSERT INTO agent_states must be executed during the agent run'
    );
    assert.strictEqual(
      insertQuery.params[0],
      context.orgId,
      'INSERT params[0] (org_id) must equal context.orgId (42) — ' +
      'orgId must flow from context, not from tool input'
    );
  });
});

// ─── AgentScheduler tests ─────────────────────────────────────────────────────
//
// Each test creates a fresh AgentScheduler instance with an isolated pool mock.
// cronCapture is reset at the start of each test to prevent state leakage.

// Helper: build a pool that records queries and returns sensible defaults.
// Override specific SQL patterns via the 'overrides' map: { sqlFragment: returnValue }
function makeSchedulerPool(overrides = {}) {
  const queries = [];
  const pool = {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      for (const [fragment, value] of Object.entries(overrides)) {
        if (sql.includes(fragment)) return value;
      }
      // Default: _restoreSchedules SELECT returns empty (no schedules to restore)
      if (sql.includes('FROM agent_schedules') && sql.includes('WHERE enabled = true')) {
        return { rows: [], rowCount: 0 };
      }
      // Default: INSERT INTO agent_executions RETURNING id
      if (sql.includes('INSERT INTO agent_executions') && sql.includes('RETURNING id')) {
        return { rows: [{ id: 'exec-uuid-default' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  return pool;
}

describe('AgentScheduler', () => {

  // ── 5a: register() ─────────────────────────────────────────────────────────

  test('5a: register() upserts to DB and starts cron job only when schedule is set', async () => {
    cronCapture.reset();
    const pool = makeSchedulerPool();
    const scheduler = new AgentScheduler({ logger: silentLogger, pool });
    await scheduler._ready;
    cronCapture.reset(); // clear any calls from _restoreSchedules

    const handler = async () => ({ done: true });

    // With schedule — cron.schedule() must be called
    const result1 = await scheduler.register({
      agentId:  'sched-agent',
      schedule: '0 9 * * *',
      handler,
      scope:    { toolSlug: 'test-tool', orgId: 42 },
      config:   { threshold: 10 },
    });

    assert.deepStrictEqual(result1, { agentId: 'sched-agent' });

    const upsertQuery = pool.queries.find(q => q.sql.includes('INSERT INTO agent_schedules'));
    assert.ok(upsertQuery, 'INSERT INTO agent_schedules must be called');
    assert.strictEqual(upsertQuery.params[0], 'sched-agent', 'params[0] must be agentId');
    assert.strictEqual(cronCapture.calls.length, 1, 'cron.schedule must be called once');
    assert.strictEqual(cronCapture.calls[0].expr, '0 9 * * *', 'cron expression must match schedule');

    // Without schedule — cron.schedule() must NOT be called
    cronCapture.reset();
    const result2 = await scheduler.register({
      agentId:  'manual-agent',
      schedule: null,
      handler,
      scope:    { toolSlug: 'test-tool', orgId: 42 },
    });

    assert.deepStrictEqual(result2, { agentId: 'manual-agent' });
    assert.strictEqual(cronCapture.calls.length, 0, 'cron.schedule must NOT be called for manual-only agents');
  });

  // ── 5b: trigger() ──────────────────────────────────────────────────────────

  test('5b: trigger() calls handler with context and persists execution row', async () => {
    cronCapture.reset();
    const pool = makeSchedulerPool();
    const scheduler = new AgentScheduler({ logger: silentLogger, pool });
    await scheduler._ready;

    let handlerCalledWith = null;
    const handler = async (ctx) => {
      handlerCalledWith = ctx;
      return { answer: 42 };
    };
    scheduler._handlers.set('trigger-agent', handler);

    const context = { orgId: 10, userId: 5, triggerType: 'manual', toolSlug: 'test' };
    const { executionId, result, status } = await scheduler.trigger('trigger-agent', context);

    // Handler assertions
    assert.strictEqual(handlerCalledWith, context, 'handler must receive the exact context object');
    assert.deepStrictEqual(result, { answer: 42 });
    assert.strictEqual(status, 'success');
    assert.strictEqual(executionId, 'exec-uuid-default');

    // INSERT INTO agent_executions — orgId must come from context
    const insertQuery = pool.queries.find(q =>
      q.sql.includes('INSERT INTO agent_executions') && q.sql.includes('RETURNING id')
    );
    assert.ok(insertQuery, 'INSERT INTO agent_executions must be called');
    assert.strictEqual(insertQuery.params[1], context.orgId,
      'INSERT params[1] (org_id) must equal context.orgId'
    );

    // UPDATE agent_executions with success outcome
    const updateExec = pool.queries.find(q =>
      q.sql.includes('UPDATE agent_executions') && q.sql.includes('completed_at')
    );
    assert.ok(updateExec, 'UPDATE agent_executions must be called on completion');
    assert.strictEqual(updateExec.params[0], 'success', 'UPDATE status param must be "success"');
  });

  // ── 5c: handler error ──────────────────────────────────────────────────────

  test('5c: handler error is caught, execution updated with status "error", no rethrow', async () => {
    cronCapture.reset();
    const pool = makeSchedulerPool();
    const scheduler = new AgentScheduler({ logger: silentLogger, pool });
    await scheduler._ready;

    scheduler._handlers.set('error-agent', async () => {
      throw new Error('handler explosion');
    });

    const context = { orgId: 77, triggerType: 'manual' };

    // trigger() must resolve, not reject
    let triggerResult;
    await assert.doesNotReject(
      async () => { triggerResult = await scheduler.trigger('error-agent', context); },
      'trigger() must not rethrow handler errors'
    );

    assert.strictEqual(triggerResult.status, 'error', 'returned status must be "error"');

    const updateExec = pool.queries.find(q =>
      q.sql.includes('UPDATE agent_executions') && q.sql.includes('completed_at')
    );
    assert.ok(updateExec, 'UPDATE agent_executions must be called on handler error');
    assert.strictEqual(updateExec.params[0], 'error',
      'UPDATE status param must be "error"'
    );
    assert.strictEqual(updateExec.params[2], 'handler explosion',
      'UPDATE error param must contain the error message'
    );
  });

  // ── 5d: getHistory() ───────────────────────────────────────────────────────

  test('5d: getHistory() filters SELECT by agentId and orgId', async () => {
    cronCapture.reset();
    const historyRows = [
      { id: 'h-1', agent_id: 'hist-agent', org_id: 99, status: 'success' },
      { id: 'h-2', agent_id: 'hist-agent', org_id: 99, status: 'error'   },
    ];

    const pool = makeSchedulerPool({
      'FROM agent_executions': { rows: historyRows, rowCount: 2 },
    });
    const scheduler = new AgentScheduler({ logger: silentLogger, pool });
    await scheduler._ready;

    const results = await scheduler.getHistory('hist-agent', { limit: 5 }, { orgId: 99 });

    assert.strictEqual(results.length, 2, 'getHistory must return the mocked rows');

    const histQuery = pool.queries.find(q => q.sql.includes('FROM agent_executions'));
    assert.ok(histQuery, 'SELECT FROM agent_executions must be called');
    assert.strictEqual(histQuery.params[0], 'hist-agent', 'params[0] must be agentId');
    assert.strictEqual(histQuery.params[1], 99,           'params[1] must be context.orgId');
  });

  // ── 5e: pause() / resume() ─────────────────────────────────────────────────

  test('5e: pause() stops cron job and resume() restarts it', async () => {
    cronCapture.reset();

    const scheduleRow = {
      agent_id:  'pausable-agent',
      schedule:  '0 * * * *',
      org_id:    42,
      tool_slug: 'test-tool',
      enabled:   true,
    };

    const pool = makeSchedulerPool({
      // getSchedule() SELECT — used by both pause() and resume()
      'FROM agent_schedules\n       WHERE agent_id': { rows: [scheduleRow], rowCount: 1 },
    });
    const scheduler = new AgentScheduler({ logger: silentLogger, pool });
    await scheduler._ready;
    cronCapture.reset();

    // Inject a pre-existing mock cron task so _stopCronJob has something to stop
    const mockTask = { stop: () => cronCapture.stopCalls.push('pausable-agent-stopped') };
    scheduler._jobs.set('pausable-agent', mockTask);

    // ── pause() ──
    const pauseResult = await scheduler.pause('pausable-agent');
    assert.deepStrictEqual(pauseResult, { agentId: 'pausable-agent', enabled: false });
    assert.ok(
      cronCapture.stopCalls.includes('pausable-agent-stopped'),
      'cron task must be stopped on pause'
    );
    assert.ok(
      !scheduler._jobs.has('pausable-agent'),
      'job must be removed from _jobs after pause'
    );
    const pauseUpdate = pool.queries.find(q =>
      q.sql.includes('UPDATE agent_schedules') && q.sql.includes('enabled = false')
    );
    assert.ok(pauseUpdate, 'UPDATE agent_schedules SET enabled = false must be called');

    // ── resume() ──
    cronCapture.reset();
    pool.queries.length = 0;

    const resumeResult = await scheduler.resume('pausable-agent');
    assert.deepStrictEqual(resumeResult, { agentId: 'pausable-agent', enabled: true });

    const resumeUpdate = pool.queries.find(q =>
      q.sql.includes('UPDATE agent_schedules') && q.sql.includes('enabled = true')
    );
    assert.ok(resumeUpdate, 'UPDATE agent_schedules SET enabled = true must be called');
    assert.strictEqual(cronCapture.calls.length, 1, 'cron.schedule must be called once on resume');
    assert.ok(scheduler._jobs.has('pausable-agent'), 'job must be in _jobs after resume');
  });

});

// ─── AgentScheduler boot tests ────────────────────────────────────────────────

describe('AgentScheduler boot', () => {

  // ── 6b: two active schedules restored ──────────────────────────────────────

  test('6b: _restoreSchedules() creates a cron job for each enabled schedule in DB', async () => {
    cronCapture.reset();

    const activeSchedules = [
      { agent_id: 'boot-agent-1', schedule: '0 9 * * *',  org_id: 10, tool_slug: 'tool-a' },
      { agent_id: 'boot-agent-2', schedule: '0 18 * * *', org_id: 20, tool_slug: 'tool-b' },
    ];

    const pool = makeSchedulerPool({
      'WHERE enabled = true AND schedule IS NOT NULL': {
        rows:     activeSchedules,
        rowCount: activeSchedules.length,
      },
    });

    const scheduler = new AgentScheduler({ logger: silentLogger, pool });
    // _ready must be awaited — it resolves when _restoreSchedules() completes
    await scheduler._ready;

    assert.strictEqual(scheduler._jobs.size, 2,
      'two cron jobs must be in _jobs after boot restore'
    );
    assert.strictEqual(cronCapture.calls.length, 2,
      'cron.schedule must be called once per active schedule'
    );
    assert.ok(scheduler._jobs.has('boot-agent-1'), '_jobs must contain boot-agent-1');
    assert.ok(scheduler._jobs.has('boot-agent-2'), '_jobs must contain boot-agent-2');
  });

  // ── 6c: disabled schedule is not restarted ─────────────────────────────────

  test('6c: _restoreSchedules() skips rows with enabled = false', async () => {
    cronCapture.reset();

    // Mock returns 3 rows including one with enabled = false, simulating a scenario
    // where the WHERE clause passes a disabled row (tests defence-in-depth filtering
    // inside _restoreSchedules()).
    const mixedSchedules = [
      { agent_id: 'active-1',   schedule: '0 9 * * *',  org_id: 10, tool_slug: 'x', enabled: true  },
      { agent_id: 'active-2',   schedule: '0 18 * * *', org_id: 20, tool_slug: 'x', enabled: true  },
      { agent_id: 'disabled-1', schedule: '0 12 * * *', org_id: 30, tool_slug: 'x', enabled: false },
    ];

    const pool = makeSchedulerPool({
      'WHERE enabled = true AND schedule IS NOT NULL': {
        rows:     mixedSchedules,
        rowCount: mixedSchedules.length,
      },
    });

    const scheduler = new AgentScheduler({ logger: silentLogger, pool });
    await scheduler._ready;

    assert.strictEqual(scheduler._jobs.size, 2,
      'disabled schedule must not be added to _jobs'
    );
    assert.ok(
      !scheduler._jobs.has('disabled-1'),
      'disabled-1 must not have a cron job after boot restore'
    );
    assert.strictEqual(cronCapture.calls.length, 2,
      'cron.schedule must be called only for the 2 enabled schedules'
    );
  });

});
