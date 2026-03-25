/**
 * User Settings — per-user key/value store.
 *
 * GET  /api/user-settings          — returns all settings as { key: value, ... }
 * POST /api/user-settings          — upsert { key, value }
 */

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { pool }        = require('../db');
const logger          = require('../utils/logger');

const router = express.Router();

router.use(requireAuth);

// GET /api/user-settings
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT key, value FROM user_settings WHERE user_id = $1',
      [req.user.id]
    );
    const settings = {};
    for (const row of result.rows) settings[row.key] = row.value;
    res.json(settings);
  } catch (err) {
    logger.error('user-settings GET error', { error: err.message });
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// POST /api/user-settings
router.post('/', async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key is required' });

  try {
    await pool.query(
      `INSERT INTO user_settings (user_id, key, value, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [req.user.id, key, JSON.stringify(value)]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error('user-settings POST error', { error: err.message });
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

module.exports = router;
