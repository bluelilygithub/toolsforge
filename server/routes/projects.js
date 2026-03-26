'use strict';

const express            = require('express');
const { requireAuth }    = require('../middleware/requireAuth');
const PermissionService  = require('../services/permissions');
const ProjectService     = require('../services/projectService');
const logger             = require('../utils/logger');

const router = express.Router();

// ---------------------------------------------------------------------------
// Resolve the caller's org-level role once per request and attach it.
// Routes read req.userRole rather than each calling PermissionService.
// ---------------------------------------------------------------------------
async function resolveRole(req, res, next) {
  try {
    const isAdmin = await PermissionService.isOrgAdmin(req.user.id);
    req.userRole = isAdmin ? 'org_admin' : 'member';
    next();
  } catch (err) {
    logger.error('projects: role resolution failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// All project routes require auth and role resolution.
router.use(requireAuth, resolveRole);

// Strips org_id from any object or array before sending.
function stripOrgId(data) {
  if (Array.isArray(data)) return data.map(stripOrgId);
  if (data && typeof data === 'object') {
    const { org_id, ...rest } = data; // eslint-disable-line no-unused-vars
    return rest;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  try {
    const projects = await ProjectService.getProjects(
      req.user.org_id, req.user.id, req.userRole
    );
    res.json(stripOrgId(projects));
  } catch (err) {
    logger.error('GET /projects', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:projectId', async (req, res) => {
  try {
    const project = await ProjectService.getProjectById(
      req.user.org_id, req.user.id, req.userRole, req.params.projectId
    );
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json(stripOrgId(project));
  } catch (err) {
    logger.error('GET /projects/:projectId', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const project = await ProjectService.createProject(
      req.user.org_id, req.user.id, { name, description }
    );
    res.status(201).json(stripOrgId(project));
  } catch (err) {
    logger.error('POST /projects', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:projectId', async (req, res) => {
  try {
    const project = await ProjectService.updateProject(
      req.user.org_id, req.user.id, req.userRole,
      req.params.projectId, req.body
    );
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json(stripOrgId(project));
  } catch (err) {
    logger.error('PATCH /projects/:projectId', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/archive', async (req, res) => {
  try {
    const result = await ProjectService.archiveProject(
      req.user.org_id, req.user.id, req.userRole, req.params.projectId
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ id: result.id, status: result.status });
  } catch (err) {
    logger.error('POST /projects/:projectId/archive', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

router.get('/:projectId/members', async (req, res) => {
  try {
    const members = await ProjectService.getMembers(
      req.user.org_id, req.user.id, req.userRole, req.params.projectId
    );
    if (!members) return res.status(404).json({ error: 'Not found' });
    res.json(stripOrgId(members));
  } catch (err) {
    logger.error('GET /projects/:projectId/members', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/members', async (req, res) => {
  const { userId: targetUserId, role: memberRole } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'userId is required' });

  try {
    const result = await ProjectService.addMember(
      req.user.org_id, req.user.id, req.userRole,
      req.params.projectId, targetUserId, memberRole
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    if (result.error === 'forbidden')       return res.status(403).json({ error: 'Forbidden' });
    if (result.error === 'user_not_in_org') return res.status(404).json({ error: 'Not found' });
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error('POST /projects/:projectId/members', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId/members/:userId', async (req, res) => {
  try {
    const result = await ProjectService.removeMember(
      req.user.org_id, req.user.id, req.userRole,
      req.params.projectId, Number(req.params.userId)
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    if (result.error === 'forbidden')   return res.status(403).json({ error: 'Forbidden' });
    if (result.error === 'last_owner')  return res.status(409).json({ error: 'Cannot remove the last owner' });
    res.status(204).end();
  } catch (err) {
    logger.error('DELETE /projects/:projectId/members/:userId', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

router.get('/:projectId/tasks', async (req, res) => {
  try {
    const tasks = await ProjectService.getTasks(
      req.user.org_id, req.user.id, req.userRole, req.params.projectId
    );
    if (!tasks) return res.status(404).json({ error: 'Not found' });
    res.json(stripOrgId(tasks));
  } catch (err) {
    logger.error('GET /projects/:projectId/tasks', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/tasks', async (req, res) => {
  if (!req.body.title) return res.status(400).json({ error: 'title is required' });
  try {
    const task = await ProjectService.createTask(
      req.user.org_id, req.user.id, req.userRole, req.params.projectId, req.body
    );
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.status(201).json(stripOrgId(task));
  } catch (err) {
    logger.error('POST /projects/:projectId/tasks', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:projectId/tasks/:taskId', async (req, res) => {
  try {
    const task = await ProjectService.updateTask(
      req.user.org_id, req.user.id, req.userRole,
      req.params.projectId, req.params.taskId, req.body
    );
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json(stripOrgId(task));
  } catch (err) {
    logger.error('PATCH /projects/:projectId/tasks/:taskId', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId/tasks/:taskId', async (req, res) => {
  try {
    const result = await ProjectService.deleteTask(
      req.user.org_id, req.user.id, req.userRole,
      req.params.projectId, req.params.taskId
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    logger.error('DELETE /projects/:projectId/tasks/:taskId', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

router.get('/:projectId/milestones', async (req, res) => {
  try {
    const milestones = await ProjectService.getMilestones(
      req.user.org_id, req.user.id, req.userRole, req.params.projectId
    );
    if (!milestones) return res.status(404).json({ error: 'Not found' });
    res.json(stripOrgId(milestones));
  } catch (err) {
    logger.error('GET /projects/:projectId/milestones', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/milestones', async (req, res) => {
  if (!req.body.title) return res.status(400).json({ error: 'title is required' });
  try {
    const milestone = await ProjectService.createMilestone(
      req.user.org_id, req.user.id, req.userRole, req.params.projectId, req.body
    );
    if (!milestone) return res.status(404).json({ error: 'Not found' });
    res.status(201).json(stripOrgId(milestone));
  } catch (err) {
    logger.error('POST /projects/:projectId/milestones', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:projectId/milestones/:milestoneId', async (req, res) => {
  try {
    const milestone = await ProjectService.updateMilestone(
      req.user.org_id, req.user.id, req.userRole,
      req.params.projectId, req.params.milestoneId, req.body
    );
    if (!milestone) return res.status(404).json({ error: 'Not found' });
    res.json(stripOrgId(milestone));
  } catch (err) {
    logger.error('PATCH /projects/:projectId/milestones/:milestoneId', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId/milestones/:milestoneId', async (req, res) => {
  try {
    const result = await ProjectService.deleteMilestone(
      req.user.org_id, req.user.id, req.userRole,
      req.params.projectId, req.params.milestoneId
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    logger.error('DELETE /projects/:projectId/milestones/:milestoneId', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Pinned files
// ---------------------------------------------------------------------------

router.get('/:projectId/files', async (req, res) => {
  try {
    const files = await ProjectService.getPinnedFiles(
      req.user.org_id, req.user.id, req.userRole, req.params.projectId
    );
    if (!files) return res.status(404).json({ error: 'Not found' });
    res.json(stripOrgId(files));
  } catch (err) {
    logger.error('GET /projects/:projectId/files', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/files', async (req, res) => {
  const { fileId } = req.body;
  if (!fileId) return res.status(400).json({ error: 'fileId is required' });
  try {
    const result = await ProjectService.pinFile(
      req.user.org_id, req.user.id, req.userRole, req.params.projectId, fileId
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    if (result.error === 'file_not_found') return res.status(404).json({ error: 'Not found' });
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error('POST /projects/:projectId/files', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId/files/:fileId', async (req, res) => {
  try {
    const result = await ProjectService.unpinFile(
      req.user.org_id, req.user.id, req.userRole,
      req.params.projectId, req.params.fileId
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    logger.error('DELETE /projects/:projectId/files/:fileId', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
