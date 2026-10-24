const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const A=require('../lib/activation-audit');
test('activation audit distinguishes missing, partial and installed files and preserves original row projections',async()=>{
 const refs=await A.references();assert.equal(A.state(refs.base,3),'missing');assert.equal(A.state(refs.workspace,3),'installed');assert.equal(A.state(refs.workspace,5),'missing');assert.equal(A.state(refs.full,5),'installed');
 assert.equal(A.state({...refs.base,columns:[...refs.base.columns,{table_name:'habits',column_name:'description'}]},3),'partial');
 assert.throws(()=>A.assertCatalogue({...refs.full,indexes:[]},refs.full),/indexes/);
 const db=new PGlite();try{
  await db.exec(fs.readFileSync('schema.postgres.sql','utf8'));await db.exec(fs.readFileSync('migrations/002-universal-streak-draft.sql','utf8'));
  await db.exec("INSERT INTO users(name,email,password) VALUES('Private','private@test','keep'); INSERT INTO habits(user_id,habit_name,difficulty_score) VALUES(1,'Keep',3); INSERT INTO expenses(user_id,date,amount) VALUES(1,'2024-02-29',12.35)");
  const before=await A.evidence(db,refs.base);
  await db.exec(fs.readFileSync('migrations/003-workspaces.sql','utf8'));await db.exec(fs.readFileSync('migrations/005-habit-recurrence.sql','utf8'));
  const after=await A.evidence(db,refs.full,A.removals([3,5]));A.assertPreserved(before,after);
  const today=(await db.query("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date::text AS day")).rows[0].day;
  assert.deepEqual(await A.captureCheck(db,today),{captures:true,categories:true,recurring_empty:true});
  assert.ok(refs.base.constraints.every(c=>!c.definition.startsWith('NOT NULL')),'NOT NULL is verified via column metadata across PostgreSQL versions');
  await db.exec('UPDATE expenses SET amount=99');await assert.rejects(async()=>A.assertPreserved(before,await A.evidence(db,refs.full,A.removals([3,5]))),/expenses/);
 }finally{await db.close();}
});
