const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// List all tools visible to the authenticated user
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, slug, name, version, enabled, installed_at FROM tools ORDER BY name`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Tools list error:', error);
    res.status(500).json({ error: 'Failed to fetch tools' });
  }
});

module.exports = router;
