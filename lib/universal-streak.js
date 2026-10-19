// Forward-looking evidence only. Never compare historical logs to today's habits.
const {validDate}=require('./calendar-date');
function nextDate(iso){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function evaluateUniversalStreak({startsOn,asOf,currentDate,emptyDayPolicy,days}){
 const unavailable=reason=>({status:'setup-required',count:null,reason,asOfDate:asOf,trackingSince:startsOn});
 if(!validDate(startsOn)||!validDate(asOf)||!validDate(currentDate)||!Array.isArray(days))throw new Error('Invalid streak evidence');
 if(!['pause','reset','earn'].includes(emptyDayPolicy))return unavailable('policy-required');
 if(asOf<startsOn)return unavailable('not-tracked');if(asOf>currentDate)return unavailable('future-date');
 const records=new Map();
 for(const day of days){if(!validDate(day.date)||records.has(day.date)||!Number.isSafeInteger(day.required)||!Number.isSafeInteger(day.completed)||day.required<0||day.completed<0||day.completed>day.required)throw new Error('Invalid daily requirements');records.set(day.date,day);}
 let count=0;
 for(let date=startsOn;date<=asOf;date=nextDate(date)){
  const day=records.get(date);if(!day?.sealed)return unavailable('requirements-unavailable');
  if(!day.required){if(emptyDayPolicy==='earn')count++;else if(emptyDayPolicy==='reset'&&date<currentDate)count=0;}
  else if(day.completed===day.required)count++;
  else if(date<currentDate)count=0;
  if(date==='9999-12-31')break;
 }
 return {status:'available',count,asOfDate:asOf,trackingSince:startsOn};
}
async function streakStorageExists(db){
 const {rows}=await db.query("SELECT to_regclass('public.universal_streak_enrollments') IS NOT NULL AND to_regclass('public.universal_streak_days') IS NOT NULL AND to_regclass('public.universal_streak_requirements') IS NOT NULL AS ready");return rows[0].ready;
}
async function readUniversalStreak(db,userId,date){
 const {rows:[clock]}=await db.query('SELECT CURRENT_DATE::text AS today,current_setting(\'TimeZone\') AS zone');
 const asOf=date||clock.today,base={count:null,asOfDate:asOf,currentDate:clock.today,status:'setup-required'};
 if(asOf>clock.today)return {...base,reason:'future-date'};
 if(!await streakStorageExists(db))return {...base,reason:'storage-required'};
 const {rows:[enrollment]}=await db.query('SELECT starts_on::text,empty_day_policy,day_change_policy,policies_confirmed,time_zone,capture_version FROM universal_streak_enrollments WHERE user_id=$1',[userId]);
 if(!enrollment?.policies_confirmed||enrollment.capture_version!==1||enrollment.empty_day_policy!=='reset'||enrollment.day_change_policy!=='apply')return {...base,reason:'policy-and-enrollment-required'};
 if(enrollment.time_zone!==clock.zone)return {...base,reason:'timezone-review-required'};
 if(asOf<enrollment.starts_on)return {...base,reason:'not-tracked'};
 const due="(to_jsonb(r)->'schedule_days' IS NULL OR to_jsonb(r)->'schedule_days'='null'::jsonb OR to_jsonb(r)->'schedule_days' @> to_jsonb(EXTRACT(ISODOW FROM d.day)::integer))";
 const {rows}=await db.query(`SELECT d.day::text AS date,d.requirements_complete AS sealed,COUNT(r.habit_id) FILTER(WHERE ${due})::integer AS required,COUNT(r.habit_id) FILTER (WHERE r.completed IS TRUE AND ${due})::integer AS completed,
 COALESCE(jsonb_agg(to_jsonb(r)) FILTER(WHERE r.habit_id IS NOT NULL),'[]'::jsonb) AS requirements
 FROM universal_streak_days d LEFT JOIN universal_streak_requirements r ON r.user_id=d.user_id AND r.day=d.day
 WHERE d.user_id=$1 AND d.day>=$2::date AND d.day<=$3::date GROUP BY d.user_id,d.day,d.requirements_complete ORDER BY d.day`,[userId,enrollment.starts_on,asOf]);
 // After enrollment, every habit-set/completion mutation captures a sealed day
 // atomically. A gap after a sealed snapshot therefore carries its required
 // cohort with no recorded completions; this never applies to legacy history.
 const records=new Map(rows.map(day=>[day.date,day])),expanded=[];let previous=null;
 for(let day=enrollment.starts_on;day<=asOf;day=nextDate(day)){
  const record=records.get(day);if(record){expanded.push(record);previous=record.sealed?record:null;}
  else if(previous){const weekday=new Date(day+'T12:00:00Z').getUTCDay()||7;const required=previous.requirements?previous.requirements.filter(r=>!r.schedule_days||r.schedule_days.includes(weekday)).length:previous.required;expanded.push({...previous,date:day,required,completed:0});}
  if(day==='9999-12-31')break;
 }
 return {...evaluateUniversalStreak({startsOn:enrollment.starts_on,asOf,currentDate:clock.today,emptyDayPolicy:enrollment.empty_day_policy,days:expanded}),currentDate:clock.today};
}
// Called inside the habit-mutation transaction, under an owned-user lock.
// Enrollment and its initial snapshot are explicit setup, never an automatic
// backfill. Required identities and completions survive later habit deletion.
async function captureUniversalDay(db,userId){
 if(!await streakStorageExists(db))return;
 const {rows:[enrollment]}=await db.query(`SELECT user_id FROM universal_streak_enrollments WHERE user_id=$1 AND policies_confirmed IS TRUE AND capture_version=1 AND empty_day_policy='reset' AND day_change_policy='apply' AND time_zone=current_setting('TimeZone') AND starts_on<=CURRENT_DATE`,[userId]);
 if(!enrollment)return;
 const {rows:[storage]}=await db.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='universal_streak_requirements' AND table_schema='public' AND column_name='schedule_days') AS scheduled");
 await db.query('INSERT INTO universal_streak_days(user_id,day) VALUES ($1,CURRENT_DATE) ON CONFLICT DO NOTHING',[userId]);
 if(storage.scheduled)await db.query(`INSERT INTO universal_streak_requirements(user_id,day,habit_id,completed,schedule_days)
 SELECT h.user_id,CURRENT_DATE,h.habit_id,COALESCE(hl.completed_status,false),h.schedule_days FROM habits h LEFT JOIN habit_logs hl ON hl.habit_id=h.habit_id AND hl.date=CURRENT_DATE WHERE h.user_id=$1 AND h.archived_on IS NULL
 ON CONFLICT(user_id,day,habit_id) DO UPDATE SET completed=EXCLUDED.completed,schedule_days=EXCLUDED.schedule_days`,[userId]);
 else await db.query(`INSERT INTO universal_streak_requirements(user_id,day,habit_id,completed)
 SELECT h.user_id,CURRENT_DATE,h.habit_id,COALESCE(hl.completed_status,false) FROM habits h LEFT JOIN habit_logs hl ON hl.habit_id=h.habit_id AND hl.date=CURRENT_DATE WHERE h.user_id=$1
 ON CONFLICT(user_id,day,habit_id) DO UPDATE SET completed=EXCLUDED.completed`,[userId]);
 await db.query(`DELETE FROM universal_streak_requirements r WHERE r.user_id=$1 AND r.day=CURRENT_DATE AND NOT EXISTS(SELECT 1 FROM habits h WHERE h.user_id=r.user_id AND h.habit_id=r.habit_id AND to_jsonb(h)->>'archived_on' IS NULL)`,[userId]);
 await db.query('UPDATE universal_streak_days SET requirements_complete=true WHERE user_id=$1 AND day=CURRENT_DATE',[userId]);
}
module.exports={evaluateUniversalStreak,readUniversalStreak,captureUniversalDay};
