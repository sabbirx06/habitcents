// Live-safe: metadata only. Never runs migrations or reads account records.
require('dotenv').config({quiet:true});
const {createPool}=require('../db');
const {inspectStorage}=require('../lib/storage-status');
async function main(){
 const pool=createPool();let c;
 try{
  c=await pool.connect();await c.query('BEGIN READ ONLY');
  const status=await inspectStorage(c);
  const tables=['users','habits','habit_logs','budgets','expenses','savings_goals','physical_habits','spiritual_habits','healthy_habits','universal_streak_enrollments','universal_streak_days','universal_streak_requirements','habit_schedule_versions','habit_categories','recurring_expenses'];
  const columns=(await c.query('SELECT table_name,column_name,udt_name,is_nullable,column_default,is_identity FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position',[tables])).rows;
  const constraints=(await c.query("SELECT c.relname AS table_name,k.conname AS name,k.contype AS type,k.convalidated AS validated,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) ORDER BY c.relname,k.conname",[tables])).rows;
  const indexes=(await c.query('SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename=ANY($1::text[]) ORDER BY tablename,indexname',[tables])).rows;
  const server=(await c.query("SELECT current_setting('server_version_num') AS version_num,current_schema() AS schema,pg_is_in_recovery() AS replica")).rows[0];
  const activity=(await c.query("SELECT count(*)::int AS other_connections,count(*) FILTER(WHERE state<>'idle')::int AS non_idle FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")).rows[0];
  if(process.argv.includes('--verify-full')){
   const A=require('../lib/activation-audit'),refs=await A.references();
   A.assertCatalogue(await A.catalogue(c),refs.full);
   await c.query('ROLLBACK');console.log(JSON.stringify({server,fullCatalogueVerified:true,checks:['column types/defaults/nullability','validated constraints','index definitions/readiness/validity','table RLS'],status}));return;
  }
  if(process.argv.includes('--catalogue-diff')){
   const A=require('../lib/activation-audit'),refs=await A.references(),actual=await A.catalogue(c);
   const expected=refs.base,differences={};
   for(const section of Object.keys(expected)){
    const key=r=>r.table_name+'.'+(r.name||r.column_name||'');
    const a=new Map(actual[section].map(r=>[key(r),r])),e=new Map(expected[section].map(r=>[key(r),r]));
    differences[section]=[...new Set([...a.keys(),...e.keys()])].filter(k=>JSON.stringify(a.get(k))!==JSON.stringify(e.get(k))).map(k=>({key:k,actual:a.get(k)||null,expected:e.get(k)||null}));
   }
   await c.query('ROLLBACK');console.log(JSON.stringify({server,differences},null,2));return;
  }
  await c.query('ROLLBACK');
  console.log(JSON.stringify({server,status,columns,constraints,indexes,activity},null,2));
 }finally{c?.release();await pool.end();}
}
main().catch(error=>{console.error(JSON.stringify({error:'Read-only activation preflight failed',code:error.code||null}));process.exitCode=1;});
