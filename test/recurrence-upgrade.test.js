const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=file=>fs.readFileSync(file,'utf8');
test('recurrence upgrade refuses missing prerequisites before any changes',async()=>{
 const db=new PGlite();try{
  await db.exec(sql('schema.postgres.sql'));
  await assert.rejects(db.exec(sql('migrations/005-habit-recurrence.sql')),/Prerequisites/);await db.exec('ROLLBACK');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='habits' AND column_name='recurrence'")).rows[0].n,0);
 }finally{await db.close();}
});
test('base-to-full and workspace-to-recurrence upgrades preserve source values and unknown history',async()=>{
 const db=new PGlite();try{
  await db.exec(sql('schema.postgres.sql'));
  await db.query("INSERT INTO users(user_id,name,email,password) VALUES(41,'Legacy','legacy@test','unchanged')");
  await db.query("INSERT INTO habits(habit_id,user_id,habit_name,difficulty_score) VALUES(99,41,'Legacy habit',7)");
  await db.query("INSERT INTO habit_logs(habit_id,date,completed_status) VALUES(99,'2024-02-29',true)");
  await db.query("INSERT INTO expenses(user_id,date,amount,description) VALUES(41,'2024-12-31',12.35,'Keep')");
  await db.query("INSERT INTO savings_goals(user_id,name,saved_amount,target_amount) VALUES(41,'Goal',19.23,100)");
  for(const m of ['001-expense-categories.sql','002-universal-streak-draft.sql','003-workspaces.sql'])await db.exec(sql('migrations/'+m));
  await db.query("UPDATE habits SET icon='book',color='pink',target=20,unit='minutes',schedule_days=ARRAY[1,3,5]::smallint[] WHERE habit_id=99");
  await db.query("UPDATE habit_logs SET progress_amount=22 WHERE habit_id=99");
  await db.query("INSERT INTO universal_streak_enrollments(user_id,starts_on,time_zone) VALUES(41,'2024-12-31','UTC')");
  const tables=['users','habits','habit_logs','expenses','savings_goals','habit_schedule_versions','universal_streak_enrollments'];
  const before={};for(const t of tables)before[t]=(await db.query(`SELECT to_jsonb(r) AS row FROM ${t} r`)).rows;
  await db.exec(sql('migrations/005-habit-recurrence.sql'));
  for(const table of tables){const rows=(await db.query(`SELECT to_jsonb(r) AS row FROM ${table} r`)).rows;for(let i=0;i<rows.length;i++)for(const [key,value]of Object.entries(before[table][i].row))assert.deepEqual(rows[i].row[key],value,table+'.'+key);}
  assert.equal((await db.query('SELECT created_on,recurrence,tracking FROM habits')).rows[0].created_on,null);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM universal_streak_days')).rows[0].n,0);
  const status=await require('../lib/storage-status').inspectStorage(db);assert.equal(status.features.workspaces.ready,true);assert.equal(status.features.recurrence.ready,true);assert.equal(status.features.universalStreak.ready,true);
 }finally{await db.close();}
});
