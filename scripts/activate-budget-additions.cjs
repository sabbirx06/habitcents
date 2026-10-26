// Explicitly authorized migration 006 only. No account test writes or automatic undo.
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {promisify}=require('node:util');
const execFile=promisify(require('node:child_process').execFile);
const {createPool,buildPoolOptions}=require('../db');
const audit=require('../lib/activation-audit');
const migrationFile='migrations/006-budget-additions.sql';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const fileHash=file=>hash(fs.readFileSync(file));
const fail=code=>{throw Object.assign(Error(code),{code});};
function identity(){const u=new URL(process.env.DATABASE_URL);return hash(u.hostname+':'+u.port+u.pathname+u.username);}
async function native(name,args){
  buildPoolOptions();
  const u=new URL(process.env.DATABASE_URL);
  if(!process.env.DATABASE_CA_CERT_PATH)fail('BACKUP_CA_REQUIRED');
  const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGSSLMODE:'verify-full',PGSSLROOTCERT:path.resolve(process.env.DATABASE_CA_CERT_PATH),PGGSSENCMODE:'disable',PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=60000'};
  try{return await execFile(path.resolve('.cache/pg-tools/pgsql/bin/'+name+'.exe'),args,{env,windowsHide:true,timeout:90000,maxBuffer:8*1024*1024});}
  catch{fail('BACKUP_TOOL_FAILED');}
}
async function verifyArchive(dir,manifest){
  const archive=path.join(dir,'before-006.dump');
  const {stdout}=await native('pg_restore',['--list',archive]);
  for(const table of manifest.publicTables)if(!stdout.includes('TABLE DATA public '+table+' '))fail('BACKUP_INCOMPLETE');
  await native('pg_restore',['--file=NUL',archive]);
  if(manifest.archiveSha256 && fileHash(archive)!==manifest.archiveSha256)fail('BACKUP_CHANGED');
  fs.writeFileSync(path.join(dir,'restore.list'),stdout.split(/\r?\n/).map(line=>/^\d+;.*\bSCHEMA - public\b/.test(line)?';'+line:line).join('\n'));
  return fileHash(archive);
}
async function verifyTable(db){
  const columns=(await db.query("SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='budget_additions' ORDER BY ordinal_position")).rows;
  const expected=[['addition_id','integer'],['user_id','integer'],['budget_id','integer'],['amount','numeric'],['source','character varying'],['date','date'],['request_key','character varying'],['created_at','timestamp with time zone']];
  if(columns.length!==expected.length || columns.some((c,i)=>c.column_name!==expected[i][0]||c.data_type!==expected[i][1]||c.is_nullable!=='NO'))fail('HISTORY_COLUMNS_INVALID');
  const {rows:[meta]}=await db.query(`SELECT
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.budget_additions'::regclass) AS rls,
    (SELECT count(*)::int FROM pg_constraint WHERE conrelid='public.budget_additions'::regclass AND contype='f' AND convalidated) AS foreign_keys,
    (SELECT count(*)::int FROM pg_constraint WHERE conrelid='public.budget_additions'::regclass AND contype='c' AND convalidated) AS checks,
    (SELECT count(*)::int FROM pg_index WHERE indrelid='public.budget_additions'::regclass AND indisvalid AND indisready) AS indexes,
    (SELECT count(*)::int FROM public.budget_additions) AS history_rows`);
  if(!meta.rls || meta.foreign_keys!==2 || meta.checks!==2 || meta.indexes!==3 || meta.history_rows!==0)fail('HISTORY_METADATA_INVALID');
  return {columns:columns.length,...meta};
}
async function main(){
  const mode=process.argv[2],dir=path.resolve(process.argv[3]||'');
  if(!['backup','apply','verify'].includes(mode)||!dir.startsWith(path.resolve('.cache/db-activation')+path.sep)||!fs.existsSync(dir))fail('ARGUMENT_ERROR');
  const pool=createPool();let client,committed=false;
  try{
    client=await pool.connect();
    if(mode==='backup'){
      if(fs.existsSync(path.join(dir,'before-006.dump')))fail('DO_NOT_OVERWRITE_BACKUP');
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if((await client.query("SELECT to_regclass('public.budget_additions') IS NOT NULL AS installed")).rows[0].installed)fail('HISTORY_ALREADY_INSTALLED');
      const catalog=await audit.catalogue(client);
      if(!catalog.relations.some(r=>r.table_name==='budgets')||!catalog.relations.some(r=>r.table_name==='users'))fail('PREREQUISITES_MISSING');
      const evidence=await audit.evidence(client,catalog);
      const publicTables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
      const snapshot=(await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
      await native('pg_dump',['--format=custom','--schema=public','--lock-wait-timeout=5000','--snapshot='+snapshot,'--file='+path.join(dir,'before-006.dump')]);
      await client.query('ROLLBACK');
      const manifest={createdAt:new Date().toISOString(),identity:identity(),migration:migrationFile,migrationSha256:fileHash(migrationFile),catalog,evidence,publicTables};
      manifest.archiveSha256=await verifyArchive(dir,manifest);
      fs.writeFileSync(path.join(dir,'manifest.private.json'),JSON.stringify(manifest,null,2));
      fs.writeFileSync(path.join(dir,'RECOVERY.md'),'# Private recovery backup\n\nThis archive contains public schema and data, not Supabase managed auth/storage schemas or cluster roles. Keep this ACL-restricted directory private. The full archive payload was decoded and checked; no restored-instance rehearsal was performed.\n\nFor separately authorized recovery, provision an empty PostgreSQL 17/Supabase-compatible database with required extensions and an empty public schema. Configure a private libpq service named habitcents_recovery for that separate database. Never configure it to point to the live database. Run:\n\n    pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --use-list=restore.list --dbname="service=habitcents_recovery" before-006.dump\n\nThen compare original table counts, financial totals and row fingerprints against manifest.private.json before any cutover. No automatic restore or live undo is authorized.\n');
      console.log(JSON.stringify({phase:'backup-verified',backupDirectory:dir,fullPublicBackup:true,archiveDecoded:true,liveWrites:false}));
      return;
    }
    const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.private.json'),'utf8'));
    if(manifest.identity!==identity()||manifest.migrationSha256!==fileHash(migrationFile))fail('BACKUP_OR_MIGRATION_MISMATCH');
    if(mode==='apply'){
      await verifyArchive(dir,manifest);
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
      // A brief database lock blocks writes while the original data is compared.
      // Identifiers come only from the audit module's fixed table allowlist.
      const tables=manifest.catalog.relations.map(r=>r.table_name);
      if(tables.some(t=>!audit.tables.includes(t)))fail('UNEXPECTED_TABLE');
      await client.query('LOCK TABLE '+tables.map(t=>'public.'+t).join(',')+' IN SHARE ROW EXCLUSIVE MODE');
      audit.assertCatalogue(await audit.catalogue(client),manifest.catalog);
      audit.assertPreserved(manifest.evidence,await audit.evidence(client,manifest.catalog));
      if((await client.query("SELECT to_regclass('public.budget_additions') IS NOT NULL AS installed")).rows[0].installed)fail('HISTORY_ALREADY_INSTALLED');
      const sql=fs.readFileSync(migrationFile,'utf8').replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
      await client.query(sql);
      const history=await verifyTable(client);
      audit.assertCatalogue(await audit.catalogue(client),manifest.catalog);
      audit.assertPreserved(manifest.evidence,await audit.evidence(client,manifest.catalog));
      await client.query('COMMIT');committed=true;
      fs.writeFileSync(path.join(dir,'activation-result.json'),JSON.stringify({migration:migrationFile,committedAt:new Date().toISOString(),originalDataPreserved:true,history},null,2));
      console.log(JSON.stringify({phase:'migration-committed',migration:migrationFile,originalDataPreserved:true,financialTotalsPreserved:true,history}));
      return;
    }
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    audit.assertCatalogue(await audit.catalogue(client),manifest.catalog);
    audit.assertPreserved(manifest.evidence,await audit.evidence(client,manifest.catalog));
    const history=await verifyTable(client);
    await client.query('ROLLBACK');
    console.log(JSON.stringify({phase:'fresh-connection-verified',originalDataPreserved:true,financialTotalsPreserved:true,history}));
  }catch(error){
    if(client)try{await client.query('ROLLBACK');}catch{}
    console.error(JSON.stringify({phase:'activation-stopped',code:error.code||'LOCAL_ERROR',committed}));
    process.exitCode=1;
  }finally{client?.release();await pool.end();}
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({phase:'preflight-stopped',code:error.code||'LOCAL_ERROR'}));process.exitCode=1;});
module.exports={verifyTable};
