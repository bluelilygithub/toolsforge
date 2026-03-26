'use strict';

/**
 * ProjectService — all data access for the projects module.
 *
 * Every public method receives (orgId, userId) as its first two parameters
 * and hard-scopes all queries to orgId.
 *
 * Access model:
 *   org_admin  — implicit membership on every project in their org
 *   everyone else — requires an explicit row in project_members
 *
 * Callers are responsible for mapping null returns to 404 responses.
 * This service never throws HTTP errors.
 */

const { pool } = require('../db');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function isMember(orgId, userId, projectId) {
  const result = await pool.query(
    `SELECT 1 FROM project_members
     WHERE project_id = $1 AND user_id = $2 AND org_id = $3
     LIMIT 1`,
    [projectId, userId, orgId]
  );
  return result.rows.length > 0;
}

async function isOwnerOrAdmin(orgId, userId, userRole, projectId) {
  if (userRole === 'org_admin') return true;
  const result = await pool.query(
    `SELECT 1 FROM project_members
     WHERE project_id = $1 AND user_id = $2 AND org_id = $3 AND role = 'owner'
     LIMIT 1`,
    [projectId, userId, orgId]
  );
  return result.rows.length > 0;
}

// ---------------------------------------------------------------------------
// Project CRUD
// ---------------------------------------------------------------------------

async function getProjects(orgId, userId, userRole) {
  if (userRole === 'org_admin') {
    const result = await pool.query(
      `SELECT id, org_id, name, description, status, created_by, created_at, updated_at
       FROM projects
       WHERE org_id = $1
       ORDER BY created_at DESC`,
      [orgId]
    );
    return result.rows;
  }

  const result = await pool.query(
    `SELECT p.id, p.org_id, p.name, p.description, p.status, p.created_by,
            p.created_at, p.updated_at
     FROM projects p
     JOIN project_members pm ON pm.project_id = p.id
     WHERE p.org_id = $1 AND pm.user_id = $2 AND pm.org_id = $1
     ORDER BY p.created_at DESC`,
    [orgId, userId]
  );
  return result.rows;
}

async function getProjectById(orgId, userId, userRole, projectId) {
  const result = await pool.query(
    `SELECT id, org_id, name, description, status, created_by, created_at, updated_at
     FROM projects
     WHERE id = $1 AND org_id = $2`,
    [projectId, orgId]
  );
  if (result.rows.length === 0) return null;

  if (userRole === 'org_admin') return result.rows[0];

  const member = await isMember(orgId, userId, projectId);
  return member ? result.rows[0] : null;
}

async function createProject(orgId, userId, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const projectResult = await client.query(
      `INSERT INTO projects (org_id, name, description, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, org_id, name, description, status, created_by, created_at, updated_at`,
      [orgId, data.name, data.description ?? null, userId]
    );
    const project = projectResult.rows[0];

    await client.query(
      `INSERT INTO project_members (project_id, user_id, org_id, role)
       VALUES ($1, $2, $3, 'owner')`,
      [project.id, userId, orgId]
    );

    await client.query('COMMIT');
    return project;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateProject(orgId, userId, userRole, projectId, data) {
  const allowed = await isOwnerOrAdmin(orgId, userId, userRole, projectId);
  if (!allowed) return null;

  const fields = [];
  const values = [];
  let idx = 1;

  if (data.name !== undefined)        { fields.push(`name = $${idx++}`);        values.push(data.name); }
  if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
  if (data.status !== undefined)      { fields.push(`status = $${idx++}`);      values.push(data.status); }

  if (fields.length === 0) {
    // Nothing to update — return current record
    return getProjectById(orgId, userId, userRole, projectId);
  }

  fields.push(`updated_at = NOW()`);
  values.push(projectId, orgId);

  const result = await pool.query(
    `UPDATE projects SET ${fields.join(', ')}
     WHERE id = $${idx++} AND org_id = $${idx++}
     RETURNING id, org_id, name, description, status, created_by, created_at, updated_at`,
    values
  );
  return result.rows[0] ?? null;
}

async function archiveProject(orgId, userId, userRole, projectId) {
  const allowed = await isOwnerOrAdmin(orgId, userId, userRole, projectId);
  if (!allowed) return null;

  const result = await pool.query(
    `UPDATE projects SET status = 'archived', updated_at = NOW()
     WHERE id = $1 AND org_id = $2
     RETURNING id, status`,
    [projectId, orgId]
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

async function getMembers(orgId, userId, userRole, projectId) {
  // Verify caller has access first
  const project = await getProjectById(orgId, userId, userRole, projectId);
  if (!project) return null;

  const result = await pool.query(
    `SELECT pm.id, pm.user_id, pm.role, pm.added_at,
            u.email, u.first_name, u.last_name
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1 AND pm.org_id = $2
     ORDER BY pm.added_at ASC`,
    [projectId, orgId]
  );
  return result.rows;
}

async function addMember(orgId, userId, userRole, projectId, targetUserId, memberRole) {
  const allowed = await isOwnerOrAdmin(orgId, userId, userRole, projectId);
  if (!allowed) return { error: 'forbidden' };

  // Verify target user exists in the same org
  const userCheck = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND org_id = $2`,
    [targetUserId, orgId]
  );
  if (userCheck.rows.length === 0) return { error: 'user_not_in_org' };

  await pool.query(
    `INSERT INTO project_members (project_id, user_id, org_id, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [projectId, targetUserId, orgId, memberRole ?? 'member']
  );
  return { ok: true };
}

async function removeMember(orgId, userId, userRole, projectId, targetUserId) {
  const allowed = await isOwnerOrAdmin(orgId, userId, userRole, projectId);
  if (!allowed) return { error: 'forbidden' };

  // Prevent removing the last owner
  const ownerCount = await pool.query(
    `SELECT COUNT(*) AS n FROM project_members
     WHERE project_id = $1 AND org_id = $2 AND role = 'owner'`,
    [projectId, orgId]
  );

  const targetMember = await pool.query(
    `SELECT role FROM project_members
     WHERE project_id = $1 AND user_id = $2 AND org_id = $3`,
    [projectId, targetUserId, orgId]
  );

  if (
    targetMember.rows.length > 0 &&
    targetMember.rows[0].role === 'owner' &&
    Number(ownerCount.rows[0].n) <= 1
  ) {
    return { error: 'last_owner' };
  }

  await pool.query(
    `DELETE FROM project_members
     WHERE project_id = $1 AND user_id = $2 AND org_id = $3`,
    [projectId, targetUserId, orgId]
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

async function getTasks(orgId, userId, userRole, projectId) {
  const project = await getProjectById(orgId, userId, userRole, projectId);
  if (!project) return null;

  const result = await pool.query(
    `SELECT id, project_id, org_id, title, description, status,
            assigned_to, due_date, created_by, created_at, updated_at
     FROM tasks
     WHERE project_id = $1 AND org_id = $2
     ORDER BY created_at ASC`,
    [projectId, orgId]
  );
  return result.rows;
}

async function createTask(orgId, userId, userRole, projectId, data) {
  const project = await getProjectById(orgId, userId, userRole, projectId);
  if (!project) return null;

  const result = await pool.query(
    `INSERT INTO tasks (project_id, org_id, title, description, assigned_to, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, project_id, org_id, title, description, status,
               assigned_to, due_date, created_by, created_at, updated_at`,
    [
      projectId, orgId,
      data.title,
      data.description ?? null,
      data.assigned_to ?? null,
      data.due_date ?? null,
      userId,
    ]
  );
  return result.rows[0];
}

async function updateTask(orgId, userId, userRole, projectId, taskId, data) {
  const project = await getProjectById(orgId, userId, userRole, projectId);
  if (!project) return null;

  const fields = [];
  const values = [];
  let idx = 1;

  if (data.title !== undefined)       { fields.push(`title = $${idx++}`);       values.push(data.title); }
  if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
  if (data.status !== undefined)      { fields.push(`status = $${idx++}`);      values.push(data.status); }
  if (data.assigned_to !== undefined) { fields.push(`assigned_to = $${idx++}`); values.push(data.assigned_to); }
  if (data.due_date !== undefined)    { fields.push(`due_date = $${idx++}`);    values.push(data.due_date); }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(taskId, projectId, orgId);

  const result = await pool.query(
    `UPDATE tasks SET ${fields.join(', ')}
     WHERE id = $${idx++} AND project_id = $${idx++} AND org_id = $${idx++}
     RETURNING id, project_id, org_id, title, description, status,
               assigned_to, due_date, created_by, created_at, updated_at`,
    values
  );
  return result.rows[0] ?? null;
}

async function deleteTask(orgId, userId, userRole, projectId, taskId) {
  const project = await getProjectById(orgId, userId, userRole, projectId);
  if (!project) return null;

  const result = await pool.query(
    `DELETE FROM tasks WHERE id = $1 AND project_id = $2 AND org_id = $3 RETURNING id`,
    [taskId, projectId, orgId]
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

async function getMilestones(orgId, userId, userRole, projectId) {
  const project = await getProjectById(orgId, userId, userRole, projectId);
  if (!project) return null;

  const result = await pool.query(
    `SELECT id, project_id, org_id, title, description, due_date, status,
            created_by, created_at, updated_at
     FROM milestones
     WHERE project_id = $1 AND org_id = $2
     ORDER BY due_date ASC NULLS LAST, created_at ASC`,
    [projectId, orgId]
  );
  return result.rows;
}

async function createMilestone(orgId, userId, userRole, projectId, data) {
  const project = await getProjectById(orgId, userId, userRole, projectId);
  if (!project) return null;

  const result = await pool.query(
    `INSERT INTO milestones (project_id, org_id, title, description, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, project_id, org_id, title, description, due_date, status,
               created_by, created_at, updated_at`,
    [projectId, orgId, data.title, data.description ?? null, data.due_date ?? null, userId]
  );
  return result.rows[0];
}

async function updateMilestone(orgId, userId, userRole, projectId, milestoneId, data) {
  const project = await getProjectById(orgId, userId, userRole, projectId);
  if (!project) return null;

  const fields = [];
  const values = [];
  let idx = 1;

  if (data.title !== undefined)       { fields.push(`title = $${idx++}`);       values.push(data.title); }
  if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
  if (data.due_date !== undefined)    { fields.push(`due_date = $${idx++}`);    values.push(data.due_date); }
  if (data.status !== undefined)      { fields.push(`status = $${idx++}`);      values.push(data.status); }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(milestoneId, projectId, orgId);

  const result = await pool.query(
    `UPDATE milestones SET ${fields.join(', ')}
     WHERE id = $${idx++} AND project_id = $${idx++} AND org_id = $${idx++}
     RETURNING id, project_id, org_id, title, description, due_date, status,
               created_by, created_at, updated_at`,
    values
  );
  return result.rows[0] ?? null;
}

async function deleteMilestone(orgId, userId, userRole, projectId, milestoneId) {
  const project = await getProjectById(orgId, userId, userRole, projectId);
  if (!project) return null;

  const result = await pool.query(
    `DELETE FROM milestones WHERE id = $1 AND project_id = $2 AND org_id = $3 RETURNING id`,
    [milestoneId, projectId, orgId]
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Pinned files
// ---------------------------------------------------------------------------

async function getPinnedFiles(orgId, userId, userRole, projectId) {
  const project = await getProjectById(orgId, userId, userRole, projectId);
  if (!project) return null;

  const result = await pool.query(
    `SELECT ppf.id, ppf.file_id, ppf.pinned_by, ppf.pinned_at,
            de.file_name, de.file_type, de.extraction_status
     FROM project_pinned_files ppf
     JOIN document_extractions de ON de.id = ppf.file_id
     WHERE ppf.project_id = $1 AND ppf.org_id = $2
     ORDER BY ppf.pinned_at DESC`,
    [projectId, orgId]
  );
  return result.rows;
}

async function pinFile(orgId, userId, userRole, projectId, fileId) {
  // Verify caller has project access
  const project = await getProjectById(orgId, userId, userRole, projectId);
  if (!project) return null;

  // Verify file belongs to same org
  const fileCheck = await pool.query(
    `SELECT id FROM document_extractions WHERE id = $1 AND org_id = $2`,
    [fileId, orgId]
  );
  if (fileCheck.rows.length === 0) return { error: 'file_not_found' };

  const result = await pool.query(
    `INSERT INTO project_pinned_files (project_id, org_id, file_id, pinned_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, file_id) DO NOTHING
     RETURNING id, file_id, pinned_at`,
    [projectId, orgId, fileId, userId]
  );
  return result.rows[0] ?? { ok: true, alreadyPinned: true };
}

async function unpinFile(orgId, userId, userRole, projectId, fileId) {
  const project = await getProjectById(orgId, userId, userRole, projectId);
  if (!project) return null;

  const result = await pool.query(
    `DELETE FROM project_pinned_files
     WHERE project_id = $1 AND file_id = $2 AND org_id = $3
     RETURNING id`,
    [projectId, fileId, orgId]
  );
  return result.rows[0] ?? null;
}

module.exports = {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  archiveProject,
  getMembers,
  addMember,
  removeMember,
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  getMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  getPinnedFiles,
  pinFile,
  unpinFile,
};
