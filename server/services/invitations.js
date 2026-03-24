const crypto = require('crypto');
const { pool } = require('../db');
const PermissionService = require('./permissions');

const EXPIRY_HOURS = 48;

const InvitationService = {

  /**
   * Create an invited user account and generate a one-time activation token.
   * The user is inactive (is_active = false) with no password until they accept.
   *
   * @param {string} email
   * @param {number} orgId
   * @param {string} roleName  Initial role to assign (e.g. 'org_member')
   * @param {number} invitedBy  userId of the admin creating the invite
   * @returns {{ userId: number, token: string, expiresAt: Date }}
   */
  async createInvitation(email, orgId, roleName, invitedBy) {
    const client = await pool.connect();
    let userId;
    try {
      await client.query('BEGIN');

      // Create the inactive user (no password yet)
      const userResult = await client.query(
        `INSERT INTO users (org_id, email, is_active)
         VALUES ($1, $2, false)
         RETURNING id`,
        [orgId, email.toLowerCase()]
      );
      userId = userResult.rows[0].id;

      // Generate invitation token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);

      await client.query(
        `INSERT INTO invitation_tokens (user_id, token, expires_at, invited_by)
         VALUES ($1, $2, $3, $4)`,
        [userId, token, expiresAt, invitedBy]
      );

      await client.query('COMMIT');

      // Assign initial role after commit — PermissionService uses pool directly
      await PermissionService.grantRole(userId, roleName, null, invitedBy);

      return { userId, token, expiresAt };

    } catch (error) {
      await client.query('ROLLBACK');
      // Clean up user if it was created before the error
      if (userId) {
        await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
      }
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Look up a valid (unused, unexpired) invitation token.
   * @param {string} token
   * @returns {{ userId: number, email: string } | null}
   */
  async getInvitation(token) {
    const result = await pool.query(
      `SELECT it.user_id, u.email
       FROM invitation_tokens it
       JOIN users u ON u.id = it.user_id
       WHERE it.token = $1
         AND it.used = false
         AND it.expires_at > NOW()`,
      [token]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  },

  /**
   * Resend an invitation for a pending (inactive) user.
   * Invalidates all existing unused tokens and issues a fresh 48h token.
   *
   * @param {number} userId
   * @param {number} invitedBy  userId of the admin resending
   * @returns {{ email: string, token: string, expiresAt: Date }}
   */
  async resendInvitation(userId, invitedBy) {
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE id = $1 AND is_active = false',
      [userId]
    );
    if (userResult.rows.length === 0) {
      throw new Error('User not found or already active');
    }
    const { email } = userResult.rows[0];

    // Invalidate any existing unused tokens
    await pool.query(
      'UPDATE invitation_tokens SET used = true WHERE user_id = $1 AND used = false',
      [userId]
    );

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO invitation_tokens (user_id, token, expires_at, invited_by)
       VALUES ($1, $2, $3, $4)`,
      [userId, token, expiresAt, invitedBy]
    );

    return { email, token, expiresAt };
  },

  /**
   * Accept an invitation — set the user's password and activate the account.
   * @param {string} token
   * @param {string} passwordHash  Pre-hashed password
   * @returns {{ userId: number, email: string }}
   */
  async acceptInvitation(token, passwordHash) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const invite = await this.getInvitation(token);
      if (!invite) throw new Error('Invalid or expired invitation');

      // Activate user and set password
      await client.query(
        `UPDATE users
         SET password_hash = $1, is_active = true, updated_at = NOW()
         WHERE id = $2`,
        [passwordHash, invite.user_id]
      );

      // Mark token used
      await client.query(
        `UPDATE invitation_tokens SET used = true WHERE token = $1`,
        [token]
      );

      await client.query('COMMIT');
      return { userId: invite.user_id, email: invite.email };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};

module.exports = InvitationService;
