const { Pool, types } = require('pg');
const fs = require('node:fs');

// DATE remains YYYY-MM-DD; bounded NUMERIC(10,2) amounts match existing JSON.
types.setTypeParser(1082, value => value);
types.setTypeParser(1700, value => Number(value));

function buildPoolOptions(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required (server-only PostgreSQL connection string)');
  const url = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  // pg URL SSL options can override the explicit ssl object.
  if ([...url.searchParams.keys()].some(key => key.toLowerCase().startsWith('ssl'))) {
    throw new Error('Remove SSL/TLS URL parameters; verified TLS is configured by the server');
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS certificate verification must not be disabled');
  return {
    connectionString: env.DATABASE_URL,
    // A pooler may ignore startup GUCs. Tracking queries explicitly select the Dhaka day.
    options: '-c timezone=Asia/Dhaka',
    ssl: { rejectUnauthorized: true, ...(env.DATABASE_CA_CERT_PATH ? { ca: fs.readFileSync(env.DATABASE_CA_CERT_PATH, 'utf8') } : {}) },
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  };
}

function createPool(env = process.env) {
  const pool = new Pool(buildPoolOptions(env));
  pool.on('error', () => console.error('Unexpected idle PostgreSQL connection error'));
  return pool;
}

module.exports = { buildPoolOptions, createPool };
