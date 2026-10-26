const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {loadData,currentHabits}=require('../lib/habit-service');
test('batched habit reads preserve large IDs, owned history, empty accounts and legacy storage in at most two queries',async()=>{
 const db=new PGlite();let queries=0;
 const reader={query:(...args)=>{queries++;return db.query(...args);}};
 try{
  await db.exec(fs.readFileSync('schema.postgres.sql','utf8'));
  await db.query("INSERT INTO users(user_id,name,email,password) VALUES(1,'Owner','owner@test','unused'),(2,'Other','other@test','unused')");
  const id='9007199254740993';
  await db.query("INSERT INTO habits(habit_id,user_id,habit_name,difficulty_score) VALUES($1,1,'Owned',1),(2,2,'Private',1)",[id]);
  await db.query("INSERT INTO habit_logs(habit_id,date,completed_status) VALUES($1,'2026-10-24',true),(2,'2026-10-24',true)",[id]);
  let data=await loadData(reader,1,'2026-10-01','2026-10-25');
  assert.equal(queries,1);assert.equal(String(data.habits[0].habit_id),id);
  assert.equal(data.logs.length,1);assert.equal(data.logs[0].habit_id,data.habits[0].habit_id);
  assert.equal(data.logs[0].date,'2026-10-24');assert.deepEqual(data.versions,[]);
  for(const file of ['002-universal-streak-draft.sql','003-workspaces.sql','005-habit-recurrence.sql'])await db.exec(fs.readFileSync('migrations/'+file,'utf8'));
  await db.query("UPDATE habits SET target=12.35,created_on='2026-10-01' WHERE habit_id=$1",[id]);
  await db.query("UPDATE habit_logs SET progress_amount=4.25 WHERE habit_id=$1",[id]);
  await db.query("DELETE FROM habit_schedule_versions WHERE habit_id=$1",[id]);
  await db.query("INSERT INTO habit_schedule_versions(habit_id,effective_on,schedule_days,target) VALUES($1,'2026-10-01',ARRAY[1,2,3,4,5,6,7]::smallint[],12.35)",[id]);
  queries=0;data=await loadData(reader,1,'2026-10-01','2026-10-25','2026-10-31');
  assert.equal(queries,2);assert.equal(String(data.versions[0].habit_id),id);
  assert.equal(Number(data.habits[0].target),12.35);assert.equal(Number(data.logs[0].progress_amount),4.25);
  assert.equal(data.habits[0].created_on,'2026-10-01');
  queries=0;const empty=await currentHabits(reader,999);
  assert.deepEqual(empty.habits,[]);assert.match(empty.today,/^\d{4}-\d{2}-\d{2}$/);assert.equal(queries,2);
 }finally{await db.close();}
});
