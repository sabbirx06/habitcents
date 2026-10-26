const {DAY,ZONE,trackingDay}=require('./tracking-clock');
const R=require('../public/js/recurrence');
async function exists(db){return (await db.query("SELECT to_regclass('universal_streak_enrollments') IS NOT NULL AND to_regclass('universal_streak_days') IS NOT NULL AND to_regclass('universal_streak_requirements') IS NOT NULL AS ready")).rows[0].ready;}
function due(r,day){return r.rules?R.due(R.versionOn(r.rules,day),day):R.due(r,day);}
async function readUniversalStreak(db,userId,date){
 const {rows:[clock]}=await db.query(`SELECT ${DAY}::text AS today,to_regclass('universal_streak_enrollments') IS NOT NULL AND to_regclass('universal_streak_days') IS NOT NULL AND to_regclass('universal_streak_requirements') IS NOT NULL AS ready`);
 const today=clock.today,asOf=date||today,base={count:null,asOfDate:asOf,currentDate:today,status:'setup-required'};
 if(asOf>today)return {...base,reason:'future-date'};
 if(!clock.ready)return {...base,reason:'storage-required'};
 const {rows:[e]}=await db.query('SELECT *,starts_on::text AS starts_on FROM universal_streak_enrollments WHERE user_id=$1',[userId]);
 if(!e?.policies_confirmed||e.capture_version!==1||e.empty_day_policy!=='reset'||e.day_change_policy!=='apply')return {...base,reason:'policy-and-enrollment-required'};
 if(e.time_zone!==ZONE)return {...base,reason:'timezone-review-required'};
 if(asOf<e.starts_on)return {...base,reason:'not-tracked'};
 const {rows}=await db.query(`SELECT d.day::text AS date,d.requirements_complete AS sealed,COALESCE(jsonb_agg(to_jsonb(r)) FILTER(WHERE r.habit_id IS NOT NULL),'[]'::jsonb) AS requirements FROM universal_streak_days d LEFT JOIN universal_streak_requirements r ON r.user_id=d.user_id AND r.day=d.day WHERE d.user_id=$1 AND d.day BETWEEN $2::date AND $3::date GROUP BY d.user_id,d.day,d.requirements_complete ORDER BY d.day`,[userId,e.starts_on,asOf]);
 const records=new Map(rows.map(r=>[r.date,r])),days=[];let previous=null;
 for(let day=e.starts_on;day<=asOf;day=R.shift(day,1)){
  const record=records.get(day),evidence=record||previous;
  if(!evidence)days.push({date:day,sealed:false,required:0,completed:0});
  else {const required=evidence.requirements.filter(r=>due(r,day));days.push({date:day,sealed:evidence.sealed,required:required.length,completed:record?required.filter(r=>r.completed).length:0});}
  if(record)previous=record.sealed?record:null;
  if(day==='9999-12-31')break;
 }
 return {...require('./universal-streak').evaluateUniversalStreak({startsOn:e.starts_on,asOf,currentDate:today,emptyDayPolicy:e.empty_day_policy,days}),currentDate:today};
}
async function captureUniversalDay(db,userId){
 if(!await exists(db))return;
 const {rows:[e]}=await db.query(`SELECT user_id FROM universal_streak_enrollments WHERE user_id=$1 AND policies_confirmed IS TRUE AND capture_version=1 AND empty_day_policy='reset' AND day_change_policy='apply' AND time_zone=$2 AND starts_on<=${DAY}`,[userId,ZONE]);if(!e)return;
 const columns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='universal_streak_requirements'")).rows.map(r=>r.column_name);
 const service=require('./habit-service'),today=await trackingDay(db),data=await service.loadData(db,userId,today,today);
 await db.query(`INSERT INTO universal_streak_days(user_id,day) VALUES($1,${DAY}) ON CONFLICT DO NOTHING`,[userId]);
 await db.query(`DELETE FROM universal_streak_requirements WHERE user_id=$1 AND day=${DAY}`,[userId]);
 for(const h of data.habits){
  const versions=data.versions.filter(v=>String(v.habit_id)===String(h.habit_id));
  const projected=service.project(h,versions,data.logs.filter(l=>String(l.habit_id)===String(h.habit_id)),today);
  const rules=versions.length?versions:[{effective_on:today,schedule_days:h.schedule_days||null,target:h.target??null,archived:!!h.archived_on,recurrence:h.recurrence||null}];
  const completed=projected.due_today&&projected.completed;
  if(columns.includes('rules'))await db.query(`INSERT INTO universal_streak_requirements(user_id,day,habit_id,completed,schedule_days,rules) VALUES($1,${DAY},$2,$3,$4,$5::jsonb)`,[userId,h.habit_id,completed,projected.schedule_days,JSON.stringify(rules)]);
  else if(!h.archived_on){if(columns.includes('schedule_days'))await db.query(`INSERT INTO universal_streak_requirements(user_id,day,habit_id,completed,schedule_days) VALUES($1,${DAY},$2,$3,$4)`,[userId,h.habit_id,completed,projected.schedule_days]);else await db.query(`INSERT INTO universal_streak_requirements(user_id,day,habit_id,completed) VALUES($1,${DAY},$2,$3)`,[userId,h.habit_id,completed]);}
 }
 await db.query(`UPDATE universal_streak_days SET requirements_complete=true WHERE user_id=$1 AND day=${DAY}`,[userId]);
}
module.exports={readUniversalStreak,captureUniversalDay};
