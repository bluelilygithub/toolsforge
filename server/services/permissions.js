const { pool } = require('../db');

/**
 * PermissionService — single source of truth for all authorization checks.
 *
 * Role scoping tiers:
 *   global   — applies across the entire organisation (e.g. org_admin)
 *   tool     — applies within a specific tool (e.g. chat_editor in 'chat')
 *   resource — applies to a specific record (e.g. project_owner for project id 42)
 *
 * A global role always satisfies a tool or resource scope check.
 * A tool role satisfies a resource check within the same tool.
 */
const PermissionService = {

  /**
   * Check if a user holds any of the given roles at the specified scope.
   * Global roles satisfy any scope check.
   *
   * @param {number} userId
   * @param {string[]} roleNames
   * @param {{ type: 'tool'|'resource', id: string } | null} scope
   * @returns {Promise<boolean>}
   */
  async hasRole(userId, roleNames, scope = null) {
    const result = await pool.query(
      `SELECT EXISTS(
         SELECT 1
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1
           AND r.name = ANY($2)
           AND (
             ur.scope_type = 'global'
             OR ($3::text IS NOT NULL AND ur.scope_type = $3 AND ur.scope_id = $4)
           )
       ) AS has_role`,
      [userId, roleNames, scope?.type ?? null, scope?.id?.toString() ?? null]
    );
    return result.rows[0].has_role;
  },

  /**
   * Convenience — check if user is an org-level admin.
   * @param {number} userId
   * @returns {Promise<boolean>}
   */
  async isOrgAdmin(userId) {
    return this.hasRole(userId, ['org_admin']);
  },

  /**
   * Return all role assignments for a user, optionally filtered by scope type.
   * @param {number} userId
   * @param {string|null} scopeType  'global' | 'tool' | 'resource' | null (all)
   * @returns {Promise<Array>}
   */
  async getUserRoles(userId, scopeType = null) {
    const result = await pool.query(
      `SELECT r.name, r.description, ur.scope_type, ur.scope_id, ur.granted_at
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1
         AND ($2::text IS NULL OR ur.scope_type = $2)
       ORDER BY ur.scope_type, r.name`,
      [userId, scopeType]
    );
    return result.rows;
  },

  /**
   * Grant a named role to a user at the given scope.
   * Creates the role if it doesn't exist (tool-defined roles are created on first use).
   *
   * @param {number} userId
   * @param {string} roleName
   * @param {{ type: string, id: string } | null} scope
   * @param {number|null} grantedBy  userId of the admin granting the role
   */
  async grantRole(userId, roleName, scope = null, grantedBy = null) {
    // Ensure the role record exists
    await pool.query(
      `INSERT INTO roles (name, is_system) VALUES ($1, false) ON CONFLICT (name) DO NOTHING`,
      [roleName]
    );

    const roleResult = await pool.query(
      'SELECT id FROM roles WHERE name = $1',
      [roleName]
    );
    const roleId = roleResult.rows[0].id;
    const scopeType = scope?.type ?? 'global';
    const scopeId   = scope?.id?.toString() ?? null;

    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, scope_type, scope_id, granted_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, role_id, scope_type, COALESCE(scope_id, '')) DO NOTHING`,
      [userId, roleId, scopeType, scopeId, grantedBy]
    );
  },

  /**
   * Revoke a named role from a user at the given scope.
   *
   * @param {number} userId
   * @param {string} roleName
   * @param {{ type: string, id: string } | null} scope
   */
  async revokeRole(userId, roleName, scope = null) {
    const scopeType = scope?.type ?? 'global';
    const scopeId   = scope?.id?.toString() ?? null;

    await pool.query(
      `DELETE FROM user_roles
       WHERE user_id = (SELECT id FROM users WHERE id = $1)
         AND role_id = (SELECT id FROM roles WHERE name = $2)
         AND scope_type = $3
         AND COALESCE(scope_id, '') = COALESCE($4, '')`,
      [userId, roleName, scopeType, scopeId]
    );
  },
};

module.exports = PermissionService;
