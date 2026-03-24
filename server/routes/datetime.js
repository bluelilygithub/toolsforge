const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const requireToolAccess = require('../middleware/requireToolAccess');

const router = express.Router();
const TOOL_SLUG = 'datetime';

router.get('/', requireAuth, requireToolAccess(TOOL_SLUG), (req, res) => {
  const now = new Date();
  const isExtended = req.toolAccess.isAdmin || req.toolAccess.roles.includes('datetime_extended');

  const data = {
    date: now.toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    time: now.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    iso: now.toISOString(),
    accessLevel: isExtended ? 'extended' : 'basic',
  };

  if (isExtended) {
    data.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    data.utcOffset = -now.getTimezoneOffset() / 60;
    data.serverLocation = process.env.SERVER_LOCATION || 'Railway (Global Edge)';
  }

  res.json(data);
});

module.exports = router;
