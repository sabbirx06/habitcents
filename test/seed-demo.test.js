const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.join(__dirname, '..');
const placeholder = 'REPLACE_WITH_REGISTERED_EMAIL';
const email = 'demo-owner@example.invalid';
const tables = ['users','habits','habit_logs','physical_habits','spiritual_habits','healthy_habits','budgets','expenses','savings_goals'];
function sql(target = email) {
  return fs.readFileSync(path.join(root, 'scripts/seed-demo.sql'), 'utf8').replace(placeholder, target);
}
async function fixture() {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(root, 'schema.postgres.sql'), 'utf8'));
  await db.exec("SET TIME ZONE 'Asia/Dhaka'");
  // Synthetic local-only account, not a usable password or a Supabase Auth account.
  await db.query('INSERT INTO users(name,email,password) VALUES ($1,$2,$3),($4,$5,$6)',
    ['Fixture owner',email,'NOT_A_LOGIN_HASH','Other account','other@example.invalid','NOT_A_LOGIN_HASH']);
  await db.exec(`INSERT INTO habits(user_id,habit_name,difficulty_score,category) VALUES(2,'Existing habit',3,'healthy');
    INSERT INTO habit_logs(habit_id,date,completed_status) VALUES(1,CURRENT_DATE-1,true);
    INSERT INTO budgets(user_id,total_budget,month,year) VALUES(1,777,EXTRACT(MONTH FROM CURRENT_DATE),EXTRACT(YEAR FROM CURRENT_DATE));
    INSERT INTO expenses(user_id,budget_id,date,description,amount) VALUES(1,1,CURRENT_DATE,'Existing expense',9.50);
    INSERT INTO savings_goals(user_id,name,saved_amount,target_amount) VALUES(2,'Other goal',10,100);`);
  return db;
}
async function snapshot(db) {
  const result = {};
  for (const table of tables) result[table] = (await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
  return result;
}
async function rejectedUnchanged(db, source, pattern) {
  const before = await snapshot(db);
  await assert.rejects(db.exec(source), pattern);
  await db.exec('ROLLBACK'); // Recover the intentionally aborted explicit transaction.
  assert.deepEqual(await snapshot(db), before);
}

test('seed populates owned, explicitly marked history without changing existing rows', async (t) => {
  assert.ok(fs.existsSync(path.join(root, 'scripts/seed-demo.sql')), 'demo seed SQL must exist');
  const db = await fixture();
  try {
    const before = await snapshot(db);
    await db.exec(sql());
    const after = await snapshot(db);
    for (const table of tables) for (const row of before[table]) assert.ok(after[table].some(actual => JSON.stringify(actual) === JSON.stringify(row)), `preserve ${table}`);
    const habits = (await db.query("SELECT * FROM habits WHERE habit_name LIKE '[Demo]%' ORDER BY habit_id")).rows;
    assert.equal(habits.length, 6);
    assert.ok(habits.every(h => h.user_id === 1));
    assert.deepEqual([...new Set(habits.map(h => h.category))].sort(), ['healthy','physical','spiritual']);
    for (const category of ['healthy','physical','spiritual']) assert.equal(after[`${category}_habits`].length, 2);
    const logs = (await db.query(`SELECT hl.habit_id,hl.completed_status,hl.date::text AS date, (date_trunc('week',CURRENT_DATE)::date-175)::text AS start_day, CURRENT_DATE::text AS today
      FROM habit_logs hl JOIN habits h USING(habit_id) WHERE h.habit_name LIKE '[Demo]%'`)).rows;
    const {rows:[bounds]} = await db.query("SELECT (date_trunc('week',CURRENT_DATE)::date-175)::text AS start, CURRENT_DATE::text AS today");
    const span = Math.round((Date.parse(bounds.today) - Date.parse(bounds.start)) / 86400000) + 1;
    let expected = 0;
    const activeDays = new Set();
    for (let day = 0; day < span; day++) for (let habit = 1; habit <= 6; habit++) {
      if (day === span-1 ? habit <= 3 : day === span-7 ? habit <= 2 : day >= span-10 ? true : (day+habit) % (habit+1) !== 0) { expected++; activeDays.add(day); }
    }
    assert.equal(logs.length, expected);
    assert.ok(logs.every(l => l.completed_status === true && l.date >= l.start_day && l.date <= l.today));
    assert.equal(new Set(logs.map(l => l.date)).size, activeDays.size);
    assert.equal(logs.filter(l => l.date === bounds.today).length, 3); // No false-status log masquerading as incomplete.
    assert.equal(new Set(logs.map(l => l.habit_id)).size, 6);
    const expenses = (await db.query("SELECT expense_id,user_id,budget_id,date::text AS date,description,amount,category FROM expenses WHERE description LIKE '[Demo]%' ORDER BY expense_id")).rows;
    assert.equal(expenses.length, 85);
    assert.ok(expenses.every(e => e.user_id === 1 && e.date <= bounds.today));
    const expenseDays = (await db.query("SELECT date::text AS date,COUNT(DISTINCT category)::int AS count FROM expenses WHERE description LIKE '[Demo]%' GROUP BY date")).rows;
    assert.equal(expenseDays.length, 17);
    assert.ok(expenseDays.every(row => row.count === 5));
    assert.ok(expenseDays.some(row => row.date === bounds.today));
    const offsets = [0,1,2,4,7,10,14,21,28,35,42,49,56,63,70,77,83];
    const amounts = {transport:80,food:240,subscriptions:120,shopping:450,uncategorized:60};
    const totals = (await db.query("SELECT category,SUM(amount)::text AS total,COUNT(*)::int AS count FROM expenses WHERE description LIKE '[Demo]%' GROUP BY category")).rows;
    assert.equal(totals.length, 5);
    for (const entry of totals) {
      assert.equal(entry.count, offsets.length);
      assert.equal(Number(entry.total), offsets.reduce((sum, offset) => sum + amounts[entry.category] + (offset % 7)*10 + offset*3, 0));
    }
    assert.equal((await db.query(`SELECT COUNT(*)::int AS count FROM expenses e JOIN budgets b USING(budget_id)
      WHERE e.description LIKE '[Demo]%' AND e.user_id=b.user_id AND b.month=EXTRACT(MONTH FROM e.date) AND b.year=EXTRACT(YEAR FROM e.date)`)).rows[0].count, 85);
    assert.equal(after.budgets[0].total_budget, '777.00');
    const goals = after.savings_goals.filter(g => g.name.startsWith('[Demo]'));
    assert.deepEqual(goals.map(g => [g.saved_amount,g.target_amount]), [['12500.00','50000.00'],['8000.00','8000.00'],['0.00','15000.00']]);
    t.diagnostic(JSON.stringify({today:bounds.today,habits:habits.length,completionLogs:logs.length,todayCompleted:3,todayIncomplete:3,expenses:expenses.length,newBudgets:after.budgets.length-before.budgets.length,goals:goals.length,categoryTotals:totals.sort((a,b)=>a.category.localeCompare(b.category))}));
  } finally { await db.close(); }
});

test('rerun aborts before any row or sequence mutation', async () => {
  const db = await fixture();
  try {
    await db.exec(sql());
    const sequences = async () => (await db.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
    const before = await sequences();
    await rejectedUnchanged(db, sql(), /already contains \[Demo\]/i);
    assert.deepEqual(await sequences(), before);
  } finally { await db.close(); }
});

test('editable placeholder and missing registered account fail explicitly without mutations', async () => {
  const db = await fixture();
  try {
    await rejectedUnchanged(db, sql(placeholder), /replace.*target.*email/i);
    await rejectedUnchanged(db, sql('nobody@example.invalid'), /registered account.*not found/i);
  } finally { await db.close(); }
});

test('missing category migration is applied additively before seed writes', async () => {
  const db = await fixture();
  try {
    await db.exec('ALTER TABLE expenses DROP COLUMN category');
    await db.exec(sql());
    assert.equal((await db.query("SELECT category FROM expenses WHERE description='Existing expense'")).rows[0].category,'uncategorized');
  } finally { await db.close(); }
});

test('calendar boundaries remain past-only and budgets follow expense month/year', async () => {
  for (const today of ['2024-01-01','2024-03-01','2023-12-31']) {
    const db = await fixture();
    try {
      // Test-only clock substitution; delivered SQL always uses CURRENT_DATE.
      await db.exec(sql().replace('demo_today date := CURRENT_DATE;', `demo_today date := DATE '${today}';`));
      const rows = (await db.query(`SELECT hl.date::text AS date FROM habit_logs hl JOIN habits h USING(habit_id)
        WHERE h.habit_name LIKE '[Demo]%' ORDER BY hl.date`)).rows;
      const bounds = (await db.query("SELECT (date_trunc('week',$1::date)::date-175)::text AS start", [today])).rows[0];
      assert.equal(rows[0].date, bounds.start);
      assert.ok(rows.every(row => row.date >= bounds.start && row.date <= today));
      assert.equal(rows.filter(row => row.date === today).length, 3);
      assert.equal((await db.query(`SELECT COUNT(DISTINCT date_trunc('week',hl.date))::int AS count
        FROM habit_logs hl JOIN habits h USING(habit_id) WHERE h.habit_name LIKE '[Demo]%'`)).rows[0].count, 26);
      assert.equal((await db.query(`SELECT COUNT(*)::int AS count FROM expenses e JOIN budgets b USING(budget_id)
        WHERE e.description LIKE '[Demo]%' AND e.date<=$1::date AND e.date >= $1::date-83
        AND e.user_id=b.user_id AND b.month=EXTRACT(MONTH FROM e.date) AND b.year=EXTRACT(YEAR FROM e.date)`, [today])).rows[0].count, 85);
      if (today === '2024-03-01') assert.ok(rows.some(row => row.date === '2024-02-29'));
    } finally { await db.close(); }
  }
});

test('late write failure rolls back all seeded rows', async () => {
  const db = await fixture();
  try {
    // Local-only fault injection after habits, logs, budgets and expenses would be written.
    await db.exec("ALTER TABLE savings_goals ADD CONSTRAINT fixture_reject_demo CHECK(name NOT LIKE '[Demo]%')");
    await rejectedUnchanged(db, sql(), /fixture_reject_demo/);
    // PostgreSQL identity sequences are nontransactional; gaps after a late failure
    // are normal. This test promises row rollback, not sequence rollback on all failures.
  } finally { await db.close(); }
});

module.exports = { fixture, sql, snapshot, rejectedUnchanged };
