const PermissionService = require('../services/permissions');
const logger = require('../utils/logger');

/**
 * Middleware factory — gates a route to users with any tool-scoped role for the given tool,
 * or org_admin. Attaches req.toolAccess = { roles: string[], isAdmin: boolean }.
 *
 * @param {string} toolSlug  The tool's slug (matches scope_id in user_roles)
 */
function requireToolAccess(toolSlug) {
  return async function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const isAdmin = await PermissionService.isOrgAdmin(req.user.id);
      if (isAdmin) {
        req.toolAccess = { roles: [], isAdmin: true };
        return next();
      }

      const allRoles = await PermissionService.getUserRoles(req.user.id, 'tool');
      const toolRoles = allRoles
        .filter(r => r.scope_id === toolSlug)
        .map(r => r.name);

      if (toolRoles.length === 0) {
        return res.status(403).json({ error: 'You do not have access to this tool' });
      }

      req.toolAccess = { roles: toolRoles, isAdmin: false };
      next();

    } catch (error) {
      logger.error('requireToolAccess error', { error: error.message, toolSlug });
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };
}

module.exports = requireToolAccess;
