const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {readUniversalStreak}=require('../lib/universal-streak');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const seed=()=>read('scripts/seed-demo.sql').replace('REPLACE_WITH_REGISTERED_EMAIL','demo@example.invalid');
async function fixture(migrated=false){
 const db=new PGlite();
 let schema=read('schema.postgres.sql');
 if(!migrated) schema=schema.replace(/^    category VARCHAR\(32\).*\n/m,'');
 await db.exec(schema);
 if(migrated) await db.exec(read('migrations/002-universal-streak-draft.sql'));
 await db.exec(`SET TIME ZONE 'UTC';
 INSERT INTO users(name,email,password) VALUES('Demo','demo@example.invalid','NOT_A_LOGIN_HASH'),('Other','other@example.invalid','NOT_A_LOGIN_HASH');
 INSERT INTO habits(user_id,habit_name,difficulty_score,category) VALUES(2,'Keep habit',4,'healthy');
 INSERT INTO habit_logs(habit_id,date) VALUES(1,CURRENT_DATE-1);
 INSERT INTO budgets(user_id,total_budget,month,year) VALUES(1,777,EXTRACT(MONTH FROM CURRENT_DATE),EXTRACT(YEAR FROM CURRENT_DATE));
 INSERT INTO expenses(user_id,budget_id,date,description,amount) VALUES(1,1,CURRENT_DATE,'Keep expense',9.5);
 INSERT INTO savings_goals(user_id,name,target_amount) VALUES(1,'Keep goal',100);`);
 return db;
}
async function snapshot(db){
 const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
 const result={};
 for(const {tablename} of tables) result[tablename]=(await db.query(`SELECT to_jsonb(t) AS row FROM ${tablename} t ORDER BY to_jsonb(t)::text`)).rows;
 return result;
}
for(const migrated of [false,true]) test(`self-contained seed on ${migrated?'fully migrated':'original no-category'} schema supplies real account-wide streak`,async()=>{
 const db=await fixture(migrated);
 try{
  const before=await snapshot(db);
  await db.exec(seed());
  const after=await snapshot(db);
  for(const [table,rows] of Object.entries(before)) for(const {row} of rows){
   const expected=table==='expenses'&&!migrated?{...row,category:'uncategorized'}:row;
   assert.ok(after[table].some(actual=>require('node:util').isDeepStrictEqual(actual.row,expected)),`preserve ${table}`);
  }
  const result=await readUniversalStreak(db,1);
  assert.equal(result.status,'available');assert.equal(result.count,5);
  const {rows:[clock]}=await db.query('SELECT CURRENT_DATE::text AS today,(CURRENT_DATE-6)::text AS miss,(CURRENT_DATE-7)::text AS earlier');
  assert.equal((await readUniversalStreak(db,1,clock.miss)).count,0);
  assert.equal((await readUniversalStreak(db,1,clock.earlier)).count,3);
  const evidence=(await db.query(`SELECT d.day::text,COUNT(*)::int AS required,COUNT(*) FILTER(WHERE r.completed)::int AS completed
   FROM universal_streak_days d JOIN universal_streak_requirements r USING(user_id,day) WHERE d.user_id=1 GROUP BY d.day ORDER BY d.day`)).rows;
  assert.equal(evidence.length,10);assert.ok(evidence.every(d=>d.required===6));
  assert.equal(evidence.at(-1).completed,3);assert.equal(evidence.at(-7).completed,2);
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM universal_streak_requirements r
   LEFT JOIN habit_logs l ON l.habit_id=r.habit_id AND l.date=r.day
   WHERE r.completed IS DISTINCT FROM COALESCE(l.completed_status,false)`)).rows[0].n,0);
  const totals=(await db.query("SELECT date,SUM(amount)::numeric AS total FROM expenses WHERE description LIKE '[Demo]%' GROUP BY date")).rows;
  assert.equal(new Set(totals.map(d=>d.total)).size,17,'all demo spending day totals differ');
  const saved=await snapshot(db);
  const sequences=(await db.query('SELECT sequencename,last_value FROM pg_sequences ORDER BY sequencename')).rows;
  await assert.rejects(db.exec(seed()),/already contains \[Demo\]/);await db.exec('ROLLBACK');
  assert.deepEqual(await snapshot(db),saved);
  assert.deepEqual((await db.query('SELECT sequencename,last_value FROM pg_sequences ORDER BY sequencename')).rows,sequences);
 }finally{await db.close();}
});
module.exports={fixture,snapshot,seed};

test('invalid targets retain the entire legacy schema, constraints, records and sequences',async()=>{
 for(const target of ['REPLACE_WITH_REGISTERED_EMAIL','absent@example.invalid','DEMO@example.invalid']){
  const db=await fixture(false);try{
   const before=await snapshot(db),shape=await catalog(db);
   const constraints=async()=>(await db.query(`SELECT conrelid,conname,pg_get_constraintdef(oid) AS definition,convalidated
    FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conrelid,conname`)).rows;
   const originalConstraints=await constraints();
   const sequences=(await db.query('SELECT sequencename,last_value FROM pg_sequences ORDER BY sequencename')).rows;
   await assert.rejects(db.exec(read('scripts/seed-demo.sql').replace('REPLACE_WITH_REGISTERED_EMAIL',target)),/Replace target_email|Registered account not found/);
   await db.exec('ROLLBACK');
   assert.deepEqual(await snapshot(db),before);assert.deepEqual(await catalog(db),shape);
   assert.deepEqual(await constraints(),originalConstraints);
   assert.deepEqual((await db.query('SELECT sequencename,last_value FROM pg_sequences ORDER BY sequencename')).rows,sequences);
  }finally{await db.close();}
 }
});

for(const migrated of [false,true]) test(`seeded ${migrated?'current':'legacy'} data serves actual authenticated dashboard and streak endpoints`,async()=>{
 const {createApp}=require('../server');
 const db=await fixture(migrated);let server;
 try{
  // Local fixture authentication only; delivered seed never writes users/passwords.
  const bcrypt=require('bcrypt');
  await db.query('UPDATE users SET password=$1 WHERE user_id=1',[await bcrypt.hash('local-fixture-only',4)]);
  await db.exec(seed());
  const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
  server=createApp({db:pool,sessionSecret:'seed-local-test-only'}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.on('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'demo@example.invalid',password:'local-fixture-only'}),redirect:'manual'});
  assert.equal(login.status,302);const cookie=login.headers.get('set-cookie').split(';')[0];
  const get=async route=>{const response=await fetch(base+route,{headers:{cookie}});assert.equal(response.status,200,route);return response.json();};
  const {today,miss,earlier}=(await db.query('SELECT CURRENT_DATE::text AS today,(CURRENT_DATE-6)::text AS miss,(CURRENT_DATE-7)::text AS earlier')).rows[0];
  const summary=await get('/dashboard-data');assert.equal(summary.totalHabits,6);assert.equal(summary.completed,3);assert.equal(summary.totalBudget,777);
  assert.equal((await get('/universal-streak')).count,5);
  assert.equal((await get('/universal-streak?date='+miss)).count,0);
  assert.equal((await get('/universal-streak?date='+earlier)).count,3);
  const spending=await get('/dashboard-spending?end='+today);
  const expected=(await db.query(`SELECT date::text AS date,SUM(amount)::text AS amount,COUNT(*)::integer AS count
   FROM expenses WHERE user_id=1 AND date>=date_trunc('month',CURRENT_DATE)::date AND date<=CURRENT_DATE GROUP BY date ORDER BY date`)).rows;
  assert.deepEqual(spending.days,expected);
  const cents=value=>Math.round(Number(value)*100);
  assert.equal(cents(spending.total),expected.reduce((sum,d)=>sum+cents(d.amount),0));
  assert.equal(summary.remaining,777-Number(spending.total));
  const breakdown=await get('/dashboard-breakdown?month='+today.slice(0,7));
  assert.equal(cents(breakdown.total),cents(spending.total));assert.equal(breakdown.categories.length,5);
  const habits=await get('/get-habits');assert.equal(habits.length,6);assert.equal(habits.filter(h=>h.completed).length,3);
  const goals=await get('/savings-data');assert.equal(goals.length,4);
  assert.deepEqual(goals.filter(g=>g.name.startsWith('[Demo]')).map(g=>[Number(g.saved_amount),Number(g.target_amount)]),[[12500,50000],[8000,8000],[0,15000]]);
  const pending=habits.filter(h=>!h.completed);
  for(const habit of pending){const response=await fetch(base+'/toggle-habit',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({habit_id:habit.habit_id})});assert.equal(await response.text(),'checked');}
  assert.equal((await get('/universal-streak')).count,6,'one account-wide increment, not one per habit');
  await fetch(base+'/toggle-habit',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({habit_id:pending[0].habit_id})});
  assert.equal((await get('/universal-streak')).count,5,'undo removes only today');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
});

test('seed timezone is transaction-local and configurable to an exact app session zone',async()=>{
 const db=await fixture(false);try{
  await db.exec("SET TIME ZONE 'Asia/Dhaka'");
  await db.exec(seed().replace("SET LOCAL TIME ZONE 'UTC'","SET LOCAL TIME ZONE 'Asia/Dhaka'"));
  assert.equal((await db.query("SELECT current_setting('TimeZone') AS zone")).rows[0].zone,'Asia/Dhaka');
  assert.equal((await readUniversalStreak(db,1)).count,5);
 }finally{await db.close();}
 const other=await fixture(false);try{
  await other.exec("SET TIME ZONE 'Asia/Dhaka'");await other.exec(seed());
  assert.equal((await other.query("SELECT current_setting('TimeZone') AS zone")).rows[0].zone,'Asia/Dhaka');
  assert.equal((await other.query('SELECT time_zone FROM universal_streak_enrollments WHERE user_id=1')).rows[0].time_zone,'UTC');
 }finally{await other.close();}
});

async function catalog(db){
 return (await db.query(`SELECT c.relname,c.relrowsecurity,a.attname,a.atttypid,a.atttypmod,a.attnotnull,
 pg_get_expr(d.adbin,d.adrelid) AS default_expr
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname,a.attnum`)).rows;
}
async function rejectedUnchanged(db,pattern){
 const rows=await snapshot(db),schema=await catalog(db);
 const seq=(await db.query('SELECT sequencename,last_value FROM pg_sequences ORDER BY sequencename')).rows;
 await assert.rejects(db.exec(seed()),pattern);await db.exec('ROLLBACK');
 assert.deepEqual(await snapshot(db),rows);assert.deepEqual(await catalog(db),schema);
 return seq;
}
test('unsafe existing types, defaults, and constraints block rather than being repaired',async()=>{
 const changes=[
  ['ALTER TABLE universal_streak_days DISABLE ROW LEVEL SECURITY',/Unsafe universal_streak_days.*RLS/],
  ['ALTER TABLE expenses ALTER COLUMN category TYPE text',/Unsafe expenses.category/],
  ["ALTER TABLE expenses ALTER COLUMN category SET DEFAULT 'food'",/Unsafe expenses.category/],
  ['ALTER TABLE expenses ALTER COLUMN category DROP NOT NULL',/Unsafe expenses.category/],
  ['ALTER TABLE expenses DROP CONSTRAINT expenses_category_check',/Unsafe expenses.category/],
  ["ALTER TABLE expenses ADD CONSTRAINT narrower_categories CHECK(category <> 'food')",/Unsafe expenses.category/],
  ["ALTER TABLE expenses ADD CONSTRAINT unreviewed_category CHECK(category <> 'food') NOT VALID",/Unsafe expenses.category/],
  ['ALTER TABLE universal_streak_requirements ALTER COLUMN habit_id TYPE integer',/Unsafe universal_streak_requirements/],
  ['ALTER TABLE universal_streak_requirements DROP CONSTRAINT universal_streak_requirements_user_id_day_fkey',/Unsafe universal_streak_requirements/],
  ['ALTER TABLE universal_streak_requirements DROP CONSTRAINT universal_streak_requirements_pkey',/Unsafe universal_streak_requirements/],
  ['ALTER TABLE universal_streak_enrollments ALTER COLUMN capture_version SET DEFAULT 1',/Unsafe universal_streak_enrollments/],
 ];
 for(const [change,pattern] of changes){const db=await fixture(true);try{
  await db.exec(change);const seq=await rejectedUnchanged(db,pattern);
  assert.deepEqual((await db.query('SELECT sequencename,last_value FROM pg_sequences ORDER BY sequencename')).rows,seq);
 }finally{await db.close();}}
});
test('late failure restores both legacy schema and all records, including newly created streak storage',async()=>{
 const db=await fixture(false);try{
  await db.exec("ALTER TABLE savings_goals ADD CONSTRAINT fixture_late_failure CHECK(name NOT LIKE '[Demo]%')");
  await rejectedUnchanged(db,/fixture_late_failure/);
 }finally{await db.close();}
});
test('existing owned habits or streak enrollment are never rewritten to manufacture successful days',async()=>{
 for(const existing of ['habit','enrollment']){const db=await fixture(true);try{
  if(existing==='habit')await db.exec("INSERT INTO habits(user_id,habit_name,difficulty_score) VALUES(1,'Real habit',5)");
  else await db.exec("INSERT INTO universal_streak_enrollments(user_id,starts_on,time_zone) VALUES(1,CURRENT_DATE,'Asia/Dhaka')");
  const seq=await rejectedUnchanged(db,existing==='habit'?/no existing habits/:/Existing streak enrollment/);
  assert.deepEqual((await db.query('SELECT sequencename,last_value FROM pg_sequences ORDER BY sequencename')).rows,seq);
 }finally{await db.close();}}
});
test('actual capture service completes and undoes today, and timezone mismatch stays explicitly unavailable',async()=>{
 const {captureUniversalDay}=require('../lib/universal-streak');
 const db=await fixture(true);try{
  await db.exec(seed());
  await db.exec(`INSERT INTO habit_logs(habit_id,date)
   SELECT habit_id,CURRENT_DATE FROM habits WHERE user_id=1
   ON CONFLICT(habit_id,date) DO NOTHING`);
  await captureUniversalDay(db,1);assert.equal((await readUniversalStreak(db,1)).count,6);
  await db.exec('DELETE FROM habit_logs WHERE habit_id=(SELECT MIN(habit_id) FROM habits WHERE user_id=1) AND date=CURRENT_DATE');
  await captureUniversalDay(db,1);assert.equal((await readUniversalStreak(db,1)).count,5);
  await db.exec("SET TIME ZONE 'Asia/Dhaka'");
  assert.equal((await readUniversalStreak(db,1)).reason,'timezone-review-required');
 }finally{await db.close();}
});

