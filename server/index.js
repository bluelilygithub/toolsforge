require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const logger = require('./utils/logger');
const { pool, runMigrations } = require('./db');
const authRoutes        = require('./routes/auth');
const toolsRoutes       = require('./routes/tools');
const datetimeRoutes    = require('./routes/datetime');
const streamRoutes      = require('./routes/stream');
const adminRoutes       = require('./routes/admin');
const orgRoutes         = require('./routes/org');
const invitationRoutes  = require('./routes/invitations');

const app = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', 1);

// CORS — only applied to API routes (static files are same-origin, no CORS needed)
const allowedOrigins = [
  process.env.APP_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
});

// HTTP request logging — skip health checks to keep logs clean
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  skip: (req) => req.path === '/api/health',
  stream: { write: (msg) => logger.http(msg.trim()) },
}));

// CORS — applied to /api routes only (static assets are same-origin, need no CORS)
app.use('/api', corsMiddleware);

app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth',              authRoutes);
app.use('/api/tools/datetime',    datetimeRoutes);
app.use('/api/tools',             streamRoutes);
app.use('/api/tools',             toolsRoutes);
app.use('/api/admin',             adminRoutes);
app.use('/api/org',               orgRoutes);
app.use('/api/invitations',       invitationRoutes);

// Static files + React Router catch-all — after all API routes so /api/* is never intercepted
const clientDist = path.join(__dirname, 'public');
const fs = require('fs');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Start server
async function start() {
  try {
    await runMigrations();
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Health: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    logger.error('Server failed to start', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

start();
