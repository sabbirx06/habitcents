const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { inspectStorage } = require('../lib/storage-status');

test('installation status distinguishes base and complete optional storage without changing data', async () => {
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync('schema.postgres.sql', 'utf8'));
    const base = await inspectStorage(db);
    assert.equal(base.features.workspaces.ready, false);
    assert.equal(base.features.universalStreak.ready, false);
    assert.ok(base.features.workspaces.missing.includes('habits.target'));
    for (const migration of ['001-expense-categories.sql','002-universal-streak-draft.sql','003-workspaces.sql'])
      await db.exec(fs.readFileSync('migrations/' + migration, 'utf8'));
    const full = await inspectStorage(db);
    assert.equal(full.features.workspaces.ready, true);
    assert.equal(full.features.universalStreak.ready, true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM universal_streak_enrollments')).rows[0].n, 0);
    await db.exec('ALTER TABLE habit_logs DROP COLUMN progress_amount');
    assert.deepEqual((await inspectStorage(db)).features.workspaces.missing, ['habit_logs.progress_amount']);
  } finally { await db.close(); }
});
