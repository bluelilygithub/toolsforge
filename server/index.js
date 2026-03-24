require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool, runMigrations } = require('./db');
const authRoutes        = require('./routes/auth');
const toolsRoutes       = require('./routes/tools');
const datetimeRoutes    = require('./routes/datetime');
const adminRoutes       = require('./routes/admin');
const orgRoutes         = require('./routes/org');
const invitationRoutes  = require('./routes/invitations');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS — locked to known origins
const allowedOrigins = [
  process.env.APP_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth',              authRoutes);
app.use('/api/tools/datetime',    datetimeRoutes);
app.use('/api/tools',             toolsRoutes);
app.use('/api/admin',       adminRoutes);
app.use('/api/org',         orgRoutes);
app.use('/api/invitations', invitationRoutes);

// Serve React app if client/dist exists (production build present)
const clientDist = path.join(__dirname, 'public');
const fs = require('fs');
console.log('Static dir:', clientDist);
console.log('Static dir exists:', fs.existsSync(clientDist));
if (fs.existsSync(clientDist)) {
  console.log('Static dir contents:', fs.readdirSync(clientDist));
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
      console.log(`Server running on port ${PORT}`);
      console.log(`Health: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('Server failed to start:', error);
    process.exit(1);
  }
}

start();
