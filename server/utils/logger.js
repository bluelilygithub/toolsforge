const { createLogger, format, transports } = require('winston');
const Transport = require('winston-transport');

const isDev = process.env.NODE_ENV !== 'production';

// Persist warn + error to the database for the in-app log viewer.
// Pool is lazy-required to avoid a circular dependency (db.js requires logger.js).
class DBTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.name = 'database';
  }

  log(info, callback) {
    callback(); // never block the logging pipeline
    const { level, message, [Symbol.for('splat')]: _splat, ...meta } = info;

    // Strip Winston internals from meta before storing
    const clean = Object.fromEntries(
      Object.entries(meta).filter(([k]) => !k.startsWith('Symbol('))
    );

    setImmediate(() => {
      try {
        const { pool } = require('../db');
        pool.query(
          `INSERT INTO app_logs (level, message, meta) VALUES ($1, $2, $3)`,
          [level, message, Object.keys(clean).length ? clean : null]
        ).catch(() => {}); // silent — don't log a log failure
      } catch (_) {}
    });
  }
}

// Development: coloured, human-readable
// Production:  JSON, one line per entry — Railway log viewer parses this cleanly
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'http',
  format: isDev
    ? format.combine(
        format.colorize(),
        format.timestamp({ format: 'HH:mm:ss' }),
        format.printf(({ timestamp, level, message, ...meta }) => {
          const clean = Object.fromEntries(
            Object.entries(meta).filter(([k]) => !k.startsWith('Symbol('))
          );
          const extras = Object.keys(clean).length ? ' ' + JSON.stringify(clean) : '';
          return `${timestamp} ${level}: ${message}${extras}`;
        })
      )
    : format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
      ),
  transports: [
    new transports.Console(),
    new DBTransport({ level: 'info' }), // info, warn, error go to DB (http request logs are excluded)
  ],
});

module.exports = logger;
