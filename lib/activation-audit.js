const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const tables=['users','habits','habit_logs','budgets','expenses','savings_goals','physical_habits','spiritual_habits','healthy_habits','universal_streak_enrollments','universal_streak_days','universal_streak_requirements','habit_schedule_versions','habit_categories','recurring_expenses'];
const added003={habits:['description','icon','color','created_on','archived_on','schedule_days','target','unit'],habit_logs:['progress_amount'],savings_goals:['deadline','archived'],expenses:['recurring_id','scheduled_for'],universal_streak_requirements:['schedule_days']};
const added005={habits:['recurrence','tracking'],habit_schedule_versions:['recurrence','tracking'],universal_streak_requirements:['rules']};
async function catalogue(db){
 const columns=(await db.query("SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,a.attidentity AS identity,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attname",[tables])).rows;
 // PostgreSQL 18 catalogs NOT NULL separately; required is already checked in columns.
 const constraints=(await db.query("SELECT c.relname AS table_name,k.conname AS name,k.convalidated AS validated,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND k.contype<>'n' ORDER BY c.relname,k.conname",[tables])).rows;
 const indexes=(await db.query("SELECT c.relname AS table_name,i.relname AS name,pg_get_indexdef(i.oid) AS definition,x.indisvalid AS valid,x.indisready AS ready FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,i.relname",[tables])).rows;
 const relations=(await db.query("SELECT c.relname AS table_name,c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relkind='r' ORDER BY c.relname",[tables])).rows;
 return {columns,constraints,indexes,relations};
}
function state(catalog,version){
 const columns=new Set(catalog.columns.map(c=>c.table_name+'.'+c.column_name));
 const checks=Object.entries(version===3?added003:added005).flatMap(([table,cols])=>cols.map(col=>columns.has(table+'.'+col)));
 if(version===3)for(const table of ['habit_schedule_versions','habit_categories','recurring_expenses'])checks.push(catalog.relations.some(r=>r.table_name===table));
 else checks.push(catalog.indexes.some(i=>i.name==='habit_versions_effective_idx'));
 return checks.every(Boolean)?'installed':checks.some(Boolean)?'partial':'missing';
}
async function references(){
 const db=new PGlite();try{
  await db.exec(fs.readFileSync('schema.postgres.sql','utf8'));await db.exec(fs.readFileSync('migrations/002-universal-streak-draft.sql','utf8'));
  const base=await catalogue(db);await db.exec(fs.readFileSync('migrations/003-workspaces.sql','utf8'));const workspace=await catalogue(db);
  await db.exec(fs.readFileSync('migrations/005-habit-recurrence.sql','utf8'));return {base,workspace,full:await catalogue(db)};
 }finally{await db.close();}
}
function assertCatalogue(actual,expected){
 for(const key of Object.keys(expected))if(JSON.stringify(actual[key])!==JSON.stringify(expected[key]))throw Object.assign(new Error('Catalogue differs from reviewed prerequisites: '+key),{code:'SCHEMA_MISMATCH',section:key});
}
function removals(plan){const out={};for(const version of plan)for(const [t,cols]of Object.entries(version===3?added003:added005))out[t]=[...(out[t]||[]),...cols];return out;}
async function evidence(db,catalog,omit={}){
 const records={};
 for(const {table_name:table} of catalog.relations){
  // Identifiers come exclusively from the fixed table allowlist above.
  if(!tables.includes(table))throw Error('Unexpected table');
  records[table]=(await db.query(`SELECT count(*)::text AS count,md5(COALESCE(string_agg((to_jsonb(t)-$1::text[])::text,'' ORDER BY (to_jsonb(t)-$1::text[])::text),'')) AS fingerprint FROM public.${table} t`,[omit[table]||[]])).rows[0];
 }
 const money=(await db.query('SELECT (SELECT COALESCE(sum(amount),0)::text FROM expenses) AS expenses,(SELECT COALESCE(sum(total_budget),0)::text FROM budgets) AS budgets,(SELECT COALESCE(sum(saved_amount),0)::text FROM savings_goals) AS saved,(SELECT COALESCE(sum(target_amount),0)::text FROM savings_goals) AS goals')).rows[0];
 const sequences=(await db.query("SELECT sequencename,last_value::text FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
 return {records,money,sequences};
}
function assertPreserved(before,after){
 for(const [table,record]of Object.entries(before.records))if(JSON.stringify(record)!==JSON.stringify(after.records[table]))throw Object.assign(Error('Existing records differ: '+table),{code:'PRESERVATION_FAILED'});
 if(JSON.stringify(before.money)!==JSON.stringify(after.money))throw Object.assign(Error('Financial totals differ'),{code:'PRESERVATION_FAILED'});
 for(const seq of before.sequences)if(after.sequences.find(s=>s.sequencename===seq.sequencename)?.last_value!==seq.last_value)throw Object.assign(Error('Existing sequence differs'),{code:'PRESERVATION_FAILED'});
}
async function captureCheck(db,day){
 const {rows:[r]}=await db.query(`SELECT
 (SELECT count(*) FROM habit_schedule_versions)=(SELECT count(*) FROM habits) AND NOT EXISTS(SELECT 1 FROM habits h LEFT JOIN habit_schedule_versions v USING(habit_id) WHERE v.habit_id IS NULL OR v.effective_on<>$1::date OR v.schedule_days<>h.schedule_days OR v.target IS NOT NULL OR v.unit IS NOT NULL OR v.archived) AS captures,
 NOT EXISTS((SELECT user_id,category AS name FROM habits WHERE category IS NOT NULL AND trim(category)<>'' EXCEPT SELECT user_id,name FROM habit_categories) UNION ALL (SELECT user_id,name FROM habit_categories EXCEPT SELECT user_id,category AS name FROM habits WHERE category IS NOT NULL AND trim(category)<>'')) AS categories,
 NOT EXISTS(SELECT 1 FROM recurring_expenses) AS recurring_empty`,[day]);
 if(!r.captures||!r.categories||!r.recurring_empty)throw Object.assign(Error('Unexpected metadata capture/import'),{code:'METADATA_CAPTURE_FAILED'});
 return r;
}
module.exports={captureCheck,tables,catalogue,state,references,assertCatalogue,removals,evidence,assertPreserved};
