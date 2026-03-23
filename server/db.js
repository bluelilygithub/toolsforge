require('dotenv').config({ path: '../.env' });
const { Pool } = require('pg');

console.log('DATABASE_URL:', process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('Full error:', err);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
  }
});

module.exports = pool;