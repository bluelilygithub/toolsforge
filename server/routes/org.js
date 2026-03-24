const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// Current user's organisation
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, created_at FROM organizations WHERE id = $1',
      [req.user.org_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Organisation not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Org error:', error);
    res.status(500).json({ error: 'Failed to fetch organisation' });
  }
});

module.exports = router;
