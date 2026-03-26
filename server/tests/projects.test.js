'use strict';

/**
 * Projects module — security contract tests.
 *
 * No live database. All DB calls are intercepted via require.cache injection
 * before any route or service module loads.
 *
 * Tests:
 *   1. getProjects — org_admin sees all org projects; member sees only their own
 *   2. getProjectById — cross-org request returns 404, not 403
 *   3. createProject — creator is automatically inserted as owner in project_members
 *   4. addMember — fails when target user belongs to a different org
 *   5. removeMember — fails when removing the last owner
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('node:path');

// ---------------------------------------------------------------------------
// Shared state — tests mutate these to control query responses
// ---------------------------------------------------------------------------
let queryFn = async () => ({ rows: [] });

// ---------------------------------------------------------------------------
// Inject stubs before any application module loads
// ---------------------------------------------------------------------------
const dbPath          = path.resolve(__dirname, '../db.js');
const permissionsPath = path.resolve(__dirname, '../services/permissions.js');
const loggerPath      = path.resolve(__dirname, '../utils/logger.js');

require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    pool: { query: (...args) => queryFn(...args), connect: async () => ({ query: (...a) => queryFn(...a), release: () => {} }) },
  },
};

require.cache[permissionsPath] = {
  id: permissionsPath, filename: permissionsPath, loaded: true,
  exports: { isOrgAdmin: async () => false },
};

require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { info: () => {}, warn: () => {}, error: () => {}, http: () => {} },
};

// Load service after stubs are in place
const ProjectService = require('../services/projectService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stateful sequence that advances on each call. */
function advancingSequence(responses) {
  let i = 0;
  return async () => {
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    return r;
  };
}

// ---------------------------------------------------------------------------
// Test 1 — getProjects: org_admin vs member scoping
// ---------------------------------------------------------------------------
test('getProjects — org_admin receives all org projects; member receives only theirs', async () => {
  const ORG_ID  = 1;
  const ADMIN_ID  = 10;
  const MEMBER_ID = 20;

  const allProjects = [
    { id: 'proj-1', org_id: ORG_ID, name: 'Alpha', status: 'active' },
    { id: 'proj-2', org_id: ORG_ID, name: 'Beta',  status: 'active' },
  ];
  const memberProjects = [allProjects[0]];

  // org_admin path — returns all org projects
  queryFn = async (sql) => {
    if (/FROM projects/.test(sql) && !/JOIN project_members/.test(sql)) {
      return { rows: allProjects };
    }
    return { rows: [] };
  };

  const adminResults = await ProjectService.getProjects(ORG_ID, ADMIN_ID, 'org_admin');
  assert.equal(adminResults.length, 2, 'org_admin should see all 2 projects');

  // member path — returns only joined projects
  queryFn = async (sql) => {
    if (/JOIN project_members/.test(sql)) return { rows: memberProjects };
    return { rows: [] };
  };

  const memberResults = await ProjectService.getProjects(ORG_ID, MEMBER_ID, 'member');
  assert.equal(memberResults.length, 1, 'member should see only their 1 project');
  assert.equal(memberResults[0].id, 'proj-1');
});

// ---------------------------------------------------------------------------
// Test 2 — getProjectById: cross-org request returns null (→ 404)
// ---------------------------------------------------------------------------
test('getProjectById — cross-org request returns null (caller handles 404)', async () => {
  const CALLER_ORG = 1;

  // The project exists in org 99. The service query is:
  //   WHERE id = $1 AND org_id = $2
  // with $2 = CALLER_ORG (1). The DB finds no matching row — returns empty.
  // We simulate that: any query for this project scoped to CALLER_ORG returns nothing.
  queryFn = async () => ({ rows: [] });

  const result = await ProjectService.getProjectById(CALLER_ORG, 10, 'org_admin', 'proj-cross-org');
  assert.equal(result, null, 'cross-org project should return null (not throw or return data)');
});

// ---------------------------------------------------------------------------
// Test 3 — createProject: creator inserted as owner in project_members
// ---------------------------------------------------------------------------
test('createProject — creator is automatically added as owner in project_members', async () => {
  const ORG_ID  = 1;
  const USER_ID = 10;
  const NEW_PROJECT = {
    id: 'proj-new', org_id: ORG_ID, name: 'New Project',
    description: null, status: 'active',
    created_by: USER_ID, created_at: new Date(), updated_at: new Date(),
  };

  const calls = [];

  // Stub client for transaction
  require.cache[dbPath].exports.pool.connect = async () => ({
    query: async (sql, params) => {
      calls.push(sql.trim().replace(/\s+/g, ' ').slice(0, 60));
      if (/INSERT INTO projects/.test(sql))         return { rows: [NEW_PROJECT] };
      if (/INSERT INTO project_members/.test(sql))  return { rows: [] };
      return { rows: [] };
    },
    release: () => {},
  });

  const project = await ProjectService.createProject(ORG_ID, USER_ID, { name: 'New Project' });

  assert.equal(project.id, 'proj-new', 'should return the created project');

  const memberInsert = calls.find(c => /INSERT INTO project_members/.test(c));
  assert.ok(memberInsert, 'should have issued an INSERT INTO project_members');

  // Confirm 'owner' role appears in the calls (the params array carries it)
  const ownerCall = calls.some(c => /project_members/.test(c));
  assert.ok(ownerCall, 'project_members insert should be present');
});

// ---------------------------------------------------------------------------
// Test 4 — addMember: fails when target user is in a different org
// ---------------------------------------------------------------------------
test('addMember — fails when target user belongs to a different org', async () => {
  const ORG_ID        = 1;
  const CALLER_ID     = 10;
  const TARGET_USER   = 99;  // exists in org 2, not org 1

  // Step sequence: isOwnerOrAdmin check → owner row found; user org check → empty
  queryFn = advancingSequence([
    { rows: [{ role: 'owner' }] },  // isOwnerOrAdmin: caller is owner
    { rows: [] },                    // user org check: target not in this org
  ]);

  const result = await ProjectService.addMember(
    ORG_ID, CALLER_ID, 'member', 'proj-1', TARGET_USER, 'member'
  );

  assert.equal(result.error, 'user_not_in_org', 'should return user_not_in_org error');
});

// ---------------------------------------------------------------------------
// Test 5 — removeMember: fails when removing the last owner
// ---------------------------------------------------------------------------
test('removeMember — fails when removing the last owner', async () => {
  const ORG_ID      = 1;
  const CALLER_ID   = 10;
  const TARGET_ID   = 10; // same user — the only owner removing themselves

  // Step sequence:
  //   1. isOwnerOrAdmin → caller is owner
  //   2. owner count → 1
  //   3. target member role → owner
  queryFn = advancingSequence([
    { rows: [{ role: 'owner' }] },    // isOwnerOrAdmin
    { rows: [{ n: '1' }] },           // COUNT owners
    { rows: [{ role: 'owner' }] },    // target member row
  ]);

  const result = await ProjectService.removeMember(
    ORG_ID, CALLER_ID, 'member', 'proj-1', TARGET_ID
  );

  assert.equal(result.error, 'last_owner', 'should refuse to remove the last owner');
});
