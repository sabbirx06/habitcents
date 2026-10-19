const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

async function database() {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, '../schema.postgres.sql'), 'utf8'));
  return db;
}

test('Postgres schema executes, enforces uniqueness, and cascades only owned habit logs', async () => {
  const db = await database();
  try {
    await db.query("INSERT INTO users (name,email,password) VALUES ($1,$2,$3)", ['A','a@test','hash']);
    await db.query("INSERT INTO habits (habit_id,user_id,habit_name,difficulty_score) VALUES ($1,$2,$3,$4)", [123,1,'Walk',5]);
    await db.query('INSERT INTO habit_logs (habit_id,date,completed_status) VALUES ($1,CURRENT_DATE,true)', [123]);
    await assert.rejects(db.query('INSERT INTO habit_logs (habit_id,date) VALUES ($1,CURRENT_DATE)', [123]), /unique/);
    await db.query('DELETE FROM habits WHERE habit_id=$1 AND user_id=$2', [123,2]);
    assert.equal((await db.query('SELECT * FROM habit_logs')).rows.length, 1);
    await db.query('DELETE FROM habits WHERE habit_id=$1 AND user_id=$2', [123,1]);
    assert.equal((await db.query('SELECT * FROM habit_logs')).rows.length, 0);
    const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    assert.equal(tables.rows.length, 9);
  } finally { await db.close(); }
});

module.exports = { database };

test('expense category migration is additive, repeatable and retains old entries',async()=>{
 const db=new PGlite();try{
  await db.exec("CREATE TABLE expenses(expense_id integer,description text,amount numeric(10,2));INSERT INTO expenses VALUES(1,'Old entry',12.35)");
  const sql=fs.readFileSync(path.join(__dirname,'../migrations/001-expense-categories.sql'),'utf8');await db.exec(sql);await db.exec(sql);
  assert.deepEqual((await db.query('SELECT description,amount,category FROM expenses')).rows,[{description:'Old entry',amount:'12.35',category:'uncategorized'}]);
  await assert.rejects(db.query("INSERT INTO expenses VALUES(2,'Invalid',1,'guess')"),/check/);
 }finally{await db.close();}
});
