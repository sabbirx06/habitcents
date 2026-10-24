// Manual, authorized 003/005 activation only. No enrollment, seeds, reset or deployment.
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile),A=require('../lib/activation-audit');
const {createPool,buildPoolOptions}=require('../db');
const {inspectStorage}=require('../lib/storage-status');
const {trackingDay}=require('../lib/tracking-clock');
const dir=path.resolve(process.argv[3]||'');
const cacheRoot=path.resolve('.cache/db-activation')+path.sep;
const mode=process.argv[2],applied=[];
let phase='preflight';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const fileHash=file=>hash(fs.readFileSync(file));
function identity(){const u=new URL(process.env.DATABASE_URL);return hash(u.hostname+':'+u.port+u.pathname+u.username);}
const migrations={3:'migrations/003-workspaces.sql',5:'migrations/005-habit-recurrence.sql'};
function nativeEnv(){
 buildPoolOptions(); // Same TLS configuration validation as the application.
 const u=new URL(process.env.DATABASE_URL);
 if(!process.env.DATABASE_CA_CERT_PATH)throw Object.assign(Error('Verified native backup needs a CA path'),{code:'BACKUP_CA_REQUIRED'});
 return {...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGSSLMODE:'verify-full',PGSSLROOTCERT:path.resolve(process.env.DATABASE_CA_CERT_PATH),PGGSSENCMODE:'disable',PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=60000'};
}
async function native(name,args){try{return await exec(path.resolve('.cache/pg-tools/pgsql/bin/'+name+'.exe'),args,{env:nativeEnv(),windowsHide:true,timeout:90000,maxBuffer:8*1024*1024});}catch(error){throw Object.assign(Error('Native backup/recovery verification failed'),{code:'BACKUP_TOOL_FAILED',tool:name});}}
function planFor(catalog,refs){
 const s3=A.state(catalog,3),s5=A.state(catalog,5);
 if(s3==='partial'||s5==='partial'||s3==='missing'&&s5!=='missing')throw Object.assign(Error('Partial migration detected'),{code:'PARTIAL_MIGRATION',s3,s5});
 A.assertCatalogue(catalog,s5==='installed'?refs.full:s3==='installed'?refs.workspace:refs.base);
 return [s3==='missing'?3:null,s5==='missing'?5:null].filter(Boolean);
}
async function verifyArchive(archive,catalog){
 const {stdout:list}=await native('pg_restore',['--list',archive]);
 for(const {table_name:t}of catalog.relations)if(!list.includes('TABLE DATA public '+t+' '))throw Object.assign(Error('Backup missing application table'),{code:'BACKUP_INCOMPLETE'});
 await native('pg_restore',['--file=NUL',archive]); // Decode ALL archive payloads; never restore to live.
 fs.writeFileSync(path.join(dir,'restore.list'),list.split(/\r?\n/).map(line=>/^\d+;.*\bSCHEMA - public\b/.test(line)?';'+line:line).join('\n'),{mode:0o600});
 return fileHash(archive);
}
async function snapshot(db,catalog,omit={}){return A.evidence(db,catalog,omit);}

async function main(){
 if(!['backup','apply'].includes(mode)||!dir.startsWith(cacheRoot)||!fs.existsSync(dir))throw Object.assign(Error('Explicit private backup directory required'),{code:'ARGUMENT_ERROR'});
 const refs=await A.references(),pool=createPool();let c;
 try{
  c=await pool.connect();await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const catalog=await A.catalogue(c),plan=planFor(catalog,refs);
  const evidence=await snapshot(c,catalog);
  if(mode==='backup'){
   phase='backup';const archive=path.join(dir,'before-003-005.dump');
   if(fs.existsSync(archive))throw Object.assign(Error('Do not overwrite recovery backups'),{code:'BACKUP_EXISTS'});
   const exported=(await c.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
   await native('pg_dump',['--format=custom','--schema=public','--lock-wait-timeout=5000','--snapshot='+exported,'--file='+archive]);
   await c.query('ROLLBACK');
   const sha256=await verifyArchive(archive,catalog);
   const manifest={createdAt:new Date().toISOString(),identity:identity(),serverMajor:17,plan,migrations:Object.fromEntries(plan.map(v=>[v,fileHash(migrations[v])])),catalog,evidence,archiveSha256:sha256,archive:'before-003-005.dump',verification:'pg_restore list and complete SQL payload decode; no restore was performed'};
   fs.writeFileSync(path.join(dir,'manifest.private.json'),JSON.stringify(manifest,null,2),{mode:0o600});
   fs.writeFileSync(path.join(dir,'RECOVERY.md'),`# Recovery backup\n\nThe archive contains the complete public schema and data at one exported repeatable-read snapshot, including application users and all streak enrollments/evidence. It contains sensitive data; keep this ACL-restricted directory private. No credentials are embedded in recovery commands. SHA-256: ${sha256}.\n\nRecovery procedure (not executed): provision a separate empty PostgreSQL 17/Supabase-compatible recovery database, with required extension dependencies and an empty public schema. Configure its connection privately as libpq service habitcents_recovery; do not point that service at the live database. Run:\n\n    pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --use-list=restore.list --dbname="service=habitcents_recovery" before-003-005.dump\n\nThe supplied restore.list omits only creation of the default public schema, which already exists in the empty recovery database. Original ownership/ACL metadata remain in the archive; review grants before any separately approved recovery cutover. Verify the original table counts, financial totals and row fingerprints against manifest.private.json inside the private recovery environment. An actual restored-instance rehearsal has not been performed. Never restore over the live database automatically or use the initial application schema as an upgrade/undo script.\n`,{mode:0o600});
   console.log(JSON.stringify({phase:'backup-verified',backupDirectory:dir,archive:'before-003-005.dump',recovery:'RECOVERY.md',plan:plan.map(v=>migrations[v]),verifiedArchive:true,liveWrites:false}));return;
  }
  await c.query('ROLLBACK');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.private.json'),'utf8'));
  if(manifest.identity!==identity()||JSON.stringify(manifest.plan)!==JSON.stringify(plan))throw Object.assign(Error('Backup target/plan mismatch'),{code:'BACKUP_MISMATCH'});
  for(const v of plan)if(fileHash(migrations[v])!==manifest.migrations[v])throw Object.assign(Error('Reviewed migration changed since backup'),{code:'MIGRATION_CHANGED'});
  if(await verifyArchive(path.join(dir,manifest.archive),manifest.catalog)!==manifest.archiveSha256)throw Object.assign(Error('Backup digest differs'),{code:'BACKUP_MISMATCH'});
  A.assertPreserved(manifest.evidence,evidence);
  if(process.env.HABITCENTS_WRITE_PAUSE!=='suspended-local-server')throw Object.assign(Error('Controlled application write pause required'),{code:'WRITE_PAUSE_REQUIRED'});
  const others=(await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND (xact_start IS NOT NULL OR state IS NULL OR state<>'idle')")).rows[0].n;
  if(others)throw Object.assign(Error('Other database clients are not verifiably idle'),{code:'OTHER_CLIENT_ACTIVITY'});
  const omit=A.removals(plan);let captures=null;
  for(const v of plan){
   phase='migration-'+v;
   const day=await trackingDay(c);
   const sql=fs.readFileSync(migrations[v],'utf8').replace('BEGIN;',"BEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='60s';\nLOCK TABLE public.users,public.habits,public.habit_logs,public.expenses,public.budgets,public.savings_goals,public.universal_streak_enrollments,public.universal_streak_days,public.universal_streak_requirements IN ACCESS EXCLUSIVE MODE;");
   try{await c.query(sql);}catch(error){await c.query('ROLLBACK');throw error;}
   applied.push(v);console.log(JSON.stringify({phase:'migration-committed',migration:migrations[v]}));
   phase='verify-after-'+v;await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const afterCatalog=await A.catalogue(c);A.assertCatalogue(afterCatalog,v===3?refs.workspace:refs.full);
   const after=await snapshot(c,afterCatalog,omit);A.assertPreserved(manifest.evidence,after);
   if(v===3)captures=await A.captureCheck(c,day);
   await c.query('ROLLBACK');
  }
  phase='final-read-only-verification';await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const afterCatalog=await A.catalogue(c);A.assertCatalogue(afterCatalog,refs.full);
  const after=await snapshot(c,afterCatalog,omit);A.assertPreserved(manifest.evidence,after);
  const status=await inspectStorage(c);await c.query('ROLLBACK');
  const report={phase:'activation-verified',applied:applied.map(v=>migrations[v]),backupDirectory:dir,existingRecordsUnchanged:true,financialTotalsUnchanged:true,enrollmentsUnchanged:true,existingSequencesUnchanged:true,captures,status,noAccountTestWrites:true};
  fs.writeFileSync(path.join(dir,'activation-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{if(c){try{await c.query('ROLLBACK');}catch{}c.release();}await pool.end();}
}
main().catch(error=>{
 const report={phase,error:'Activation stopped; no automatic undo or retry was attempted.',code:error.code||'LOCAL_ERROR',section:error.section||null,applied:applied.map(v=>migrations[v])};
 try{if(dir.startsWith(cacheRoot)&&fs.existsSync(dir))fs.writeFileSync(path.join(dir,'activation-error.json'),JSON.stringify(report,null,2));}catch{}
 console.error(JSON.stringify(report));process.exitCode=1;
});
