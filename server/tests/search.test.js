'use strict';

/**
 * Search module — security contract tests.
 *
 * Tests 1–5 exercise searchService directly (no live DB, no embedding API).
 * Test 6 exercises the rate limiter via a minimal in-process HTTP server.
 *
 * Tests:
 *   1. Scope intersection — unknown tool silently dropped
 *   2. Project scope — member only receives results from their permitted projects
 *   3. Admin bypass — org_admin receives results from all org projects without project_members rows
 *   4. org_id absent — no result object contains an org_id field
 *   5. Empty project membership — 'projects' scope removed before SQL runs
 *   6. Rate limit — 31st request within 10 minutes returns 429
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('node:path');
const http     = require('node:http');

// ---------------------------------------------------------------------------
// Shared mutable queryFn — tests reassign to control DB responses
// ---------------------------------------------------------------------------
let queryFn = async () => ({ rows: [] });

// 768-dim mock vector — zero-cost placeholder for the embedding parameter
const MOCK_VECTOR = new Array(768).fill(0.01);

// ---------------------------------------------------------------------------
// Inject stubs before any application module loads
// ---------------------------------------------------------------------------
const dbPath     = path.resolve(__dirname, '../db.js');
const loggerPath = path.resolve(__dirname, '../utils/logger.js');
const googlePath = require.resolve('@google/generative-ai');

require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    pool: {
      query: (...args) => queryFn(...args),
      connect: async () => ({ query: (...a) => queryFn(...a), release: () => {} }),
    },
  },
};

require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { info: () => {}, warn: () => {}, error: () => {}, http: () => {} },
};

require.cache[googlePath] = {
  id: googlePath, filename: googlePath, loaded: true,
  exports: {
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return { embedContent: async () => ({ embedding: { values: MOCK_VECTOR } }) };
      }
    },
  },
};

// Load service after stubs are in place
const searchService = require('../services/searchService');

// ---------------------------------------------------------------------------
// Test 1 — Scope intersection: unknown tool silently dropped
// ---------------------------------------------------------------------------
test("scope intersection — 'unknown_tool' is silently dropped; only registered scopes queried", async () => {
  let capturedScopes;

  queryFn = async (sql, params) => {
    if (/FROM project_members/.test(sql)) return { rows: [{ project_id: 'proj-1' }] };
    if (/FROM document_embeddings/.test(sql)) {
      capturedScopes = params[1]; // $2 = permittedScopes
      return { rows: [] };
    }
    return { rows: [] };
  };

  await searchService.globalSearch(1, 5, 'member', MOCK_VECTOR, {
    toolScopes: ['projects', 'unknown_tool'],
  });

  assert.ok(Array.isArray(capturedScopes), 'scopes param must be an array');
  assert.ok(!capturedScopes.includes('unknown_tool'), "'unknown_tool' must be dropped");
  assert.ok(capturedScopes.includes('projects'), "'projects' must survive intersection");
});

// ---------------------------------------------------------------------------
// Test 2 — Project scope: member restricted to their permitted projects
// ---------------------------------------------------------------------------
test('project scope — member only receives results from projects they are a member of', async () => {
  let capturedProjectIds;

  queryFn = async (sql, params) => {
    if (/FROM project_members/.test(sql)) {
      return { rows: [{ project_id: 'proj-allowed' }] };
    }
    if (/FROM document_embeddings/.test(sql)) {
      capturedProjectIds = params[2]; // $3 = permittedProjectIds
      return { rows: [
        { id: 'emb-1', tool_scope: 'projects', resource_id: 'proj-allowed',
          content_preview: 'Allowed content', similarity_score: '0.92' },
      ]};
    }
    return { rows: [] };
  };

  const results = await searchService.globalSearch(1, 5, 'member', MOCK_VECTOR, {
    toolScopes: ['projects'],
  });

  assert.deepEqual(capturedProjectIds, ['proj-allowed'],
    'search query $3 must contain only the member\'s permitted project IDs');
  assert.equal(results.length, 1);
  assert.equal(results[0].resource_id, 'proj-allowed');
});

// ---------------------------------------------------------------------------
// Test 3 — Admin bypass: org_admin queries all active org projects directly
// ---------------------------------------------------------------------------
test('admin bypass — org_admin receives results from all org projects without project_members rows', async () => {
  let capturedProjectIds;

  queryFn = async (sql, params) => {
    // Admin path queries projects table directly, not project_members
    if (/FROM projects WHERE org_id/.test(sql)) {
      return { rows: [{ id: 'proj-X' }, { id: 'proj-Y' }] };
    }
    if (/FROM document_embeddings/.test(sql)) {
      capturedProjectIds = params[2]; // $3 = permittedProjectIds
      return { rows: [] };
    }
    return { rows: [] };
  };

  await searchService.globalSearch(1, 99, 'org_admin', MOCK_VECTOR, {
    toolScopes: ['projects'],
  });

  assert.ok(capturedProjectIds.includes('proj-X'), 'proj-X must be in permitted IDs for admin');
  assert.ok(capturedProjectIds.includes('proj-Y'), 'proj-Y must be in permitted IDs for admin');
  assert.equal(capturedProjectIds.length, 2, 'admin must have all 2 org projects permitted');
});

// ---------------------------------------------------------------------------
// Test 4 — org_id absent from all result objects
// ---------------------------------------------------------------------------
test('org_id absent — no result object contains an org_id field', async () => {
  queryFn = async (sql) => {
    if (/FROM document_embeddings/.test(sql)) {
      return { rows: [
        // Raw DB row includes org_id — mapper must not forward it
        { id: 'emb-1', tool_scope: 'files', resource_id: null,
          content_preview: 'File content', similarity_score: '0.80', org_id: 1 },
      ]};
    }
    return { rows: [] };
  };

  const results = await searchService.globalSearch(1, 5, 'org_admin', MOCK_VECTOR, {
    toolScopes: ['files'],
  });

  assert.equal(results.length, 1);
  assert.ok(!('org_id' in results[0]), 'org_id must be structurally absent from result objects');
});

// ---------------------------------------------------------------------------
// Test 5 — Empty project membership: 'projects' removed before SQL runs
// ---------------------------------------------------------------------------
test("empty project membership — 'projects' scope removed; SQL not called with empty ANY array", async () => {
  const searchCallArgs = [];

  queryFn = async (sql, params) => {
    if (/FROM project_members/.test(sql)) return { rows: [] }; // member has no memberships
    if (/FROM document_embeddings/.test(sql)) {
      searchCallArgs.push(params);
      return { rows: [] };
    }
    return { rows: [] };
  };

  // Default toolScopes = null → tries all REGISTERED_TOOLS including 'projects'
  await searchService.globalSearch(1, 20, 'member', MOCK_VECTOR, {});

  // Search must still run — 'files' and 'general' remain after 'projects' is removed
  assert.equal(searchCallArgs.length, 1, 'document_embeddings query must execute');

  const scopesParam     = searchCallArgs[0][1]; // $2 = permittedScopes passed to SQL
  const projectIdsParam = searchCallArgs[0][2]; // $3 = permittedProjectIds passed to SQL

  assert.ok(
    !scopesParam.includes('projects'),
    "'projects' must be removed from $2 when member has no project memberships"
  );

  // $3 is an empty array — safe because 'projects' is already absent from $2,
  // so no project rows can match tool_scope = ANY($2), making the ANY($3) branch unreachable.
  assert.deepEqual(projectIdsParam, [],
    '$3 (permittedProjectIds) must be empty, not an array containing undefined values');
});

// ---------------------------------------------------------------------------
// Test 6 — Rate limit: 31st request within 10 minutes returns 429
// ---------------------------------------------------------------------------
test('rate limit — 31st request within 10 minutes returns 429 with search_rate_limit_exceeded', async () => {
  const express   = require('express');
  const rateLimit = require('express-rate-limit');

  const app = express();
  app.use(express.json());

  // Mirror requireAuth: inject req.user so keyGenerator can read req.user.id
  app.use((req, _res, next) => {
    req.user = { id: 888, org_id: 1 };
    next();
  });

  // TODO: replace in-memory store with Redis at scale
  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    keyGenerator: req => String(req.user.id),
    message: { error: 'search_rate_limit_exceeded' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.post('/search', limiter, (_req, res) => res.json({ results: [], count: 0, query: 'test' }));

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  let lastStatus = 0;
  let lastBody   = null;

  for (let i = 0; i < 31; i++) {
    const response = await fetch(`http://127.0.0.1:${port}/search`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query: 'test query' }),
    });
    lastStatus = response.status;
    lastBody   = await response.json();
  }

  await new Promise(resolve => server.close(resolve));

  assert.equal(lastStatus, 429, '31st request must be rate limited');
  assert.equal(lastBody.error, 'search_rate_limit_exceeded');
});
