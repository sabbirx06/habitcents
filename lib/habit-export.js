const R=require('../public/js/recurrence');
async function habitExport(db,user){
 const {rows:logs}=await db.query("SELECT h.habit_id,h.habit_name,l.date::text AS date,l.completed_status,to_jsonb(l)->>'progress_amount' AS progress_amount FROM habits h JOIN habit_logs l USING(habit_id) WHERE h.user_id=$1 ORDER BY h.habit_id,l.date",[user]);
 let versions=[];
 if((await db.query("SELECT to_regclass('habit_schedule_versions') IS NOT NULL AS ready")).rows[0].ready)versions=(await db.query("SELECT v.habit_id,v.effective_on::text AS effective_on,v.schedule_days,v.target::text AS target,v.unit,v.archived,to_jsonb(v)->'recurrence' AS recurrence,to_jsonb(v)->>'tracking' AS tracking FROM habit_schedule_versions v JOIN habits h USING(habit_id) WHERE h.user_id=$1 ORDER BY v.habit_id,v.effective_on",[user])).rows;
 return {versions,logs:logs.map(l=>{const rule=R.versionOn(versions.filter(v=>String(v.habit_id)===String(l.habit_id)),l.date);return {...l,target:rule?.target??null,unit:rule?.unit??null,tracking:rule?.tracking??null,recurrence:rule?.recurrence??null,schedule_days:rule?.schedule_days??null,effective_on:rule?.effective_on??null};})};
}
async function optionalOwned(db,table,user){
 const tables={habitCategories:'habit_categories',streakEnrollment:'universal_streak_enrollments',streakDays:'universal_streak_days',streakRequirements:'universal_streak_requirements'};
 if(!(await db.query('SELECT to_regclass($1) IS NOT NULL AS ready',[tables[table]])).rows[0].ready)return {rows:[],warning:table+' storage is unavailable.'};
 const queries={
  habitCategories:'SELECT category_id,user_id,name FROM habit_categories WHERE user_id=$1 ORDER BY category_id',
  streakEnrollment:'SELECT user_id,starts_on::text AS starts_on,empty_day_policy,day_change_policy,policies_confirmed,time_zone,capture_version FROM universal_streak_enrollments WHERE user_id=$1',
  streakDays:'SELECT user_id,day::text AS day,requirements_complete FROM universal_streak_days WHERE user_id=$1 ORDER BY day',
  streakRequirements:"SELECT user_id,day::text AS day,habit_id,completed,to_jsonb(r)->'schedule_days' AS schedule_days,to_jsonb(r)->'rules' AS rules FROM universal_streak_requirements r WHERE user_id=$1 ORDER BY day,habit_id",
 };
 try{return {rows:(await db.query(queries[table],[user])).rows};}catch(e){if(e.code!=='42P01')throw e;return {rows:[],warning:table+' storage is unavailable.'};}
}
module.exports={habitExport,optionalOwned};
