const test = require('node:test');
const assert = require('node:assert/strict');

test('Postgres configuration requires a server URL and enforces verified TLS', () => {
  const { buildPoolOptions } = require('../db');
  assert.throws(() => buildPoolOptions({}), /DATABASE_URL/);
  assert.throws(() => buildPoolOptions({ DATABASE_URL: 'mysql://localhost/db' }), /PostgreSQL/);
  const options = buildPoolOptions({ DATABASE_URL: 'postgresql://user:placeholder@db.example.test:5432/postgres' });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.max, 5);
  for (const suffix of ['?sslmode=disable', '?sslmode=no-verify', '?sslmode=require', '?sslrootcert=bad']) {
    assert.throws(() => buildPoolOptions({ DATABASE_URL: options.connectionString + suffix }), /TLS|SSL/);
  }
  assert.throws(() => buildPoolOptions({ DATABASE_URL: options.connectionString, NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /TLS/);
});
