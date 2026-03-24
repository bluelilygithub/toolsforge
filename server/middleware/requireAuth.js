const { pool } = require('../db');
const PermissionService = require('../services/permissions');
const logger = require('../utils/logger');

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.org_id
       FROM users u
       JOIN auth_sessions s ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = result.rows[0];
    req.token = token;
    next();

  } catch (error) {
    logger.error('Auth middleware error', { error: error.message });
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// Check that the authenticated user holds at least one of the given role names.
// Checks global scope by default; pass scope to check tool/resource scope too.
function requireRole(roleNames, scope = null) {
  return async function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const allowed = await PermissionService.hasRole(req.user.id, roleNames, scope);
      if (!allowed) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      next();
    } catch (error) {
      logger.error('requireRole error', { error: error.message });
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };
}

module.exports = { requireAuth, requireRole };
