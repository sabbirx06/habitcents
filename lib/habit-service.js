const R=require('../public/js/recurrence');
const {DAY,trackingDay}=require('./tracking-clock');
const {validDate}=require('./calendar-date');
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
async function recurrenceInstalled(db){return (await db.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='habits' AND column_name='recurrence') AS ready")).rows[0].ready;}
async function loadData(db,user,start,end,versionEnd=null){
 const {rows:habits}=await db.query("SELECT h.*,to_jsonb(h)->>'created_on' AS created_on,to_jsonb(h)->>'archived_on' AS archived_on FROM habits h WHERE user_id=$1 ORDER BY habit_id",[user]);
 const {rows:logs}=await db.query("SELECT l.*,l.date::text AS date FROM habit_logs l JOIN habits h USING(habit_id) WHERE h.user_id=$1 AND l.date BETWEEN $2::date AND $3::date ORDER BY l.date",[user,start,end]);
 let versions=[];
 const storage=(await db.query("SELECT to_regclass('habit_schedule_versions') IS NOT NULL AS ready")).rows[0].ready;
 if(storage)versions=(await db.query(`SELECT v.*,v.effective_on::text AS effective_on FROM habit_schedule_versions v JOIN habits h USING(habit_id) WHERE h.user_id=$1 ${versionEnd?'AND ((v.effective_on<=$3::date AND (v.effective_on>=$2::date OR v.effective_on=(SELECT MAX(p.effective_on) FROM habit_schedule_versions p WHERE p.habit_id=v.habit_id AND p.effective_on<$2::date))) OR v.effective_on=(SELECT MIN(f.effective_on) FROM habit_schedule_versions f WHERE f.habit_id=v.habit_id))':''} ORDER BY v.effective_on`,versionEnd?[user,start,versionEnd]:[user])).rows;
 return {habits,logs,versions};
}
function ruleFor(h,versions,day){return R.versionOn(versions,day);}
function quotaFrom(versions,rule,start){
 let from=rule.effective_on||start;
 for(const v of versions.filter(v=>v.effective_on<=from).slice().reverse()){
  if(!R.quota(v)||v.recurrence.frequency!==rule.recurrence.frequency)break;
  from=v.effective_on;
 }
 return from>start?from:start;
}
function project(h,versions,logs,day){
 const active=ruleFor(h,versions,day),pending=versions.find(v=>v.effective_on>day)||null;
 const rule=active||(!versions.length?h:null),q=R.quota(rule),rec=rule?.recurrence;
 const entry=logs.find(l=>l.date===day),target=rule?.target??null;
 const window=R.period(day,rec?.frequency),started=!!rule&&(!h.created_on||h.created_on<=day);
 const amount=q?logs.filter(l=>l.date>=quotaFrom(versions,rule,window.start)&&l.date<=window.end).reduce((sum,l)=>sum+(rule.tracking==='checkoff'||target==null?(l.completed_status?1:0):Math.round(Number(l.progress_amount||0)*100)/100),0):Number(entry?.progress_amount||0);
 const required=q?Number(target??1):target==null?1:Number(target);
 const achieved=q?Math.round(amount*100)/100:target==null?(entry?.completed_status?1:0):amount;
 const available=started&&!rule?.archived&&!h.archived_on;
 return {...h,...(active||{}),habit_id:h.habit_id,archived_on:h.archived_on,created_on:h.created_on,
  tracking:rule?.tracking||(target==null?'checkoff':'measure'),recurrence:rec||null,
  schedule_days:rule?.schedule_days||h.schedule_days||[1,2,3,4,5,6,7],target,unit:rule?.unit??h.unit,
  due_today:available&&R.due(rule,day),can_record:available&&(q||R.due(rule,day)),
  completed:q?entry?.completed_status===true:target==null?entry?.completed_status===true:achieved>=required,
  progress_amount:entry?.progress_amount??null,pending,period:q?{...window,achieved,target:required,remaining:Math.max(0,Math.round((required-achieved)*100)/100),status:achieved>=required?'complete':'incomplete'}:null,
  status:!started?'not-started':!available?'not-due':q?(achieved>=required?'complete':'incomplete'):R.due(rule,day)?(achieved>=required?'complete':'incomplete'):'not-due',
 };
}
function quotaHistory(versions,logs,start,end,today){
 const periods=[],seen=new Set();
 for(let day=start;day<=end&&day<=today;day=R.shift(day,1)){
  const rule=R.versionOn(versions,day);if(!R.quota(rule)||rule.archived)continue;
  const p=R.period(day,rule.recurrence.frequency),key=p.start+':'+p.end;if(seen.has(key))continue;seen.add(key);
  const achieved=Math.round(logs.filter(l=>l.date>=quotaFrom(versions,rule,p.start)&&l.date<=p.end&&l.date<=today).reduce((n,l)=>n+(rule.tracking==='checkoff'||rule.target==null?(l.completed_status?1:0):Number(l.progress_amount||0)),0)*100)/100;
  const target=Number(rule.target??1);periods.push({...p,achieved,target,unit:rule.unit,asOf:end<today?end:today,status:achieved>=target?'complete':p.end<today&&p.end<=end?'missed':'incomplete'});
 }
 return periods;
}
async function currentHabits(db,user,day=null){const today=day||await trackingDay(db),start=R.period(today,'yearly').start;const data=await loadData(db,user,R.shift(start,-7),today);return {today,habits:data.habits.map(h=>project(h,data.versions.filter(v=>String(v.habit_id)===String(h.habit_id)),data.logs.filter(l=>String(l.habit_id)===String(h.habit_id)),today))};}
function configuration(body){
 const {habitInput}=require('./workspaces');
 const h=habitInput({...body,schedule_days:body.schedule_days||[1,2,3,4,5,6,7]});
 const r=body.recurrence||{frequency:h.days.length===7?'daily':'weekdays',mode:'scheduled'};
 if(!r||!['daily','weekdays','weekly','monthly','yearly'].includes(r.frequency)||!['scheduled','quota'].includes(r.mode))fail('Choose a valid recurrence.');
 if(['daily','weekdays'].includes(r.frequency)&&r.mode!=='scheduled')fail('Daily schedules are scheduled occurrences.');
 const recurrence={frequency:r.frequency,mode:r.mode};
 if(r.mode==='scheduled'){
  if(r.frequency==='weekly'){if(!Number.isInteger(r.weekday)||r.weekday<1||r.weekday>7)fail('Choose a weekday.');recurrence.weekday=r.weekday;}
  if(['monthly','yearly'].includes(r.frequency)){if(!Number.isInteger(r.day)||r.day<1||r.day>31)fail('Choose a valid day.');recurrence.day=r.day;}
  if(r.frequency==='yearly'){if(!Number.isInteger(r.month)||r.month<1||r.month>12||r.day>R.monthEnd(2024,r.month))fail('Choose a valid annual date.');recurrence.month=r.month;}
 }
 const tracking=body.tracking||(h.target==null?'checkoff':'measure');
 if(!['checkoff','count','measure'].includes(tracking))fail('Choose how to track progress.');
 if(tracking==='checkoff'){h.target=null;h.unit=null;}
 else if(h.target==null)fail('Enter a target.');
 if(tracking==='count'&&!Number.isInteger(h.target))fail('Count targets must be whole numbers.');
 if(r.frequency==='daily')h.days=[1,2,3,4,5,6,7];
 return {...h,recurrence,tracking};
}
async function saveRule(client,habit,effective,h,archived=false){
 await client.query(`INSERT INTO habit_schedule_versions(habit_id,effective_on,schedule_days,target,unit,archived,recurrence,tracking) VALUES($1,$2::date,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT(habit_id,effective_on) DO UPDATE SET schedule_days=EXCLUDED.schedule_days,target=EXCLUDED.target,unit=EXCLUDED.unit,archived=EXCLUDED.archived,recurrence=EXCLUDED.recurrence,tracking=EXCLUDED.tracking`,[habit,effective,h.days||h.schedule_days,h.target,h.unit,archived,JSON.stringify(h.recurrence),h.tracking]);
}
function registerRecurrence(app,{db,requireLogin,presets}){
 const wrap=run=>async(req,res,next)=>{try{res.set('Cache-Control','private, no-store');await run(req,res,next);}catch(e){if(e.status)return res.status(e.status).json({error:e.message,...(e.status===503?{setupRequired:true}:{})});if(['42P01','42703'].includes(e.code))return res.status(503).json({setupRequired:true,error:'This feature requires the reviewed workspace and recurrence migrations. Existing records are unchanged.'});next(e);}};
 const tx=async(user,run)=>{const c=await db.connect();try{await c.query('BEGIN');await c.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE',[user]);const out=await run(c);await require('./universal-streak').captureUniversalDay(c,user);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 app.get('/api/habits',requireLogin,wrap(async(req,res)=>{
  const data=await currentHabits(db,req.session.user.user_id);let categories=[];
  try{categories=(await db.query('SELECT * FROM habit_categories WHERE user_id=$1 ORDER BY name',[req.session.user.user_id])).rows;}catch(e){if(e.code!=='42P01')throw e;}
  res.json({...data,categories,presets,recurrenceReady:await recurrenceInstalled(db),streak:await require('./universal-streak').readUniversalStreak(db,req.session.user.user_id)});
 }));
 app.post('/api/habits/save',requireLogin,wrap(async(req,res,next)=>{
  if(!await recurrenceInstalled(db)){if(req.body.recurrence||req.body.tracking)fail('Install the reviewed recurrence migration before saving these controls.',503);return next();}
  const h=configuration(req.body),user=req.session.user.user_id;
  res.json(await tx(user,async c=>{
   const today=await trackingDay(c);let habit=req.body.habit_id,old=null;
   if(habit){if(!/^[1-9]\d{0,15}$/.test(String(habit)))fail('Invalid habit ID.');old=(await currentHabits(c,user)).habits.find(x=>String(x.habit_id)===String(habit));if(!old)fail('Habit not found.',404);}
   let effective=today;
   if(old&&(R.quota(old)||R.quota(h)||old.pending&&R.quota(old.pending)))effective=R.period(today,R.quota(old)?old.recurrence.frequency:h.recurrence.frequency).next;
   else if(!old&&R.quota(h)){if(req.body.start_choice&&!['this','next'].includes(req.body.start_choice))fail('Choose this or next period.');effective=R.activation(today,h.recurrence.frequency,req.body.start_choice);}
   if(!old){habit=(await c.query(`INSERT INTO habits(user_id,habit_name,difficulty_score,description,category,icon,color,schedule_days,target,unit,created_on,recurrence,tracking) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::jsonb,$12) RETURNING habit_id`,[user,h.name,h.description,h.category,h.icon,h.color,h.days,h.target,h.unit,today,JSON.stringify(h.recurrence),h.tracking])).rows[0].habit_id;}
   else {
    await c.query('UPDATE habits SET habit_name=$1,description=$2,category=$3,icon=$4,color=$5 WHERE habit_id=$6 AND user_id=$7',[h.name,h.description,h.category,h.icon,h.color,habit,user]);
    // Legacy habits first acquire only TODAY's known rule, never fabricated history.
    if(!(await c.query('SELECT habit_id FROM habit_schedule_versions WHERE habit_id=$1 LIMIT 1',[habit])).rows.length)await saveRule(c,habit,today,old,!!old.archived_on);
    await c.query('DELETE FROM habit_schedule_versions WHERE habit_id=$1 AND effective_on>$2::date',[habit,today]);
    if(effective===today)await c.query('UPDATE habits SET schedule_days=$1,target=$2,unit=$3,recurrence=$4::jsonb,tracking=$5 WHERE habit_id=$6',[h.days,h.target,h.unit,JSON.stringify(h.recurrence),h.tracking,habit]);
   }
   await saveRule(c,habit,effective,h,!!old?.archived_on);
   if(h.category)await c.query('INSERT INTO habit_categories(user_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING',[user,h.category]);
   if(effective===today&&h.target!=null)await c.query(`UPDATE habit_logs SET completed_status=COALESCE(progress_amount,0)>=$2 WHERE habit_id=$1 AND date=$3::date`,[habit,h.target,today]);
   return {success:true,habit_id:habit,effective_on:effective};
  }));
 }));
 app.post('/api/habits/progress',requireLogin,wrap(async(req,res,next)=>{
  if(!await recurrenceInstalled(db))return next();
  res.json(await tx(req.session.user.user_id,async c=>{
   const data=await currentHabits(c,req.session.user.user_id),day=req.body.date;
   if(!validDate(day)||day!==data.today)fail('Past records are read-only. Record progress for today.');
   const h=data.habits.find(h=>String(h.habit_id)===String(req.body.habit_id));if(!h)fail('Habit not found.',404);
   if(!h.can_record)fail('This habit is not scheduled or has not started.',409);
   let progress=null,completed;
   if(h.tracking==='checkoff'){if(typeof req.body.completed!=='boolean')fail('Choose a completion state.');completed=req.body.completed;}
   else {progress=require('./workspaces').money(req.body.progress,true);if(h.tracking==='count'&&!Number.isInteger(progress))fail('Today’s count must be a whole number.');completed=progress>=Number(h.target);}
   await c.query('INSERT INTO habit_logs(habit_id,date,completed_status,progress_amount) VALUES($1,$2::date,$3,$4) ON CONFLICT(habit_id,date) DO UPDATE SET completed_status=EXCLUDED.completed_status,progress_amount=EXCLUDED.progress_amount',[h.habit_id,day,completed,progress]);
   return {success:true,completed,progress};
  }));
 }));
 app.post('/api/habits/archive',requireLogin,wrap(async(req,res,next)=>{
  if(!await recurrenceInstalled(db))return next();
  if(typeof req.body.archived!=='boolean')fail('Choose an archive state.');
  res.json(await tx(req.session.user.user_id,async c=>{
   const data=await currentHabits(c,req.session.user.user_id),h=data.habits.find(x=>String(x.habit_id)===String(req.body.habit_id));if(!h)fail('Habit not found.',404);
   await c.query('UPDATE habits SET archived_on=CASE WHEN $2 THEN $3::date ELSE NULL END WHERE habit_id=$1',[h.habit_id,req.body.archived,data.today]);
   // Archive/restore retains the existing today-effective behavior and pending schedule.
   if(h.status!=='not-started')await saveRule(c,h.habit_id,data.today,h,req.body.archived);
   await c.query('UPDATE habit_schedule_versions SET archived=$2 WHERE habit_id=$1 AND effective_on>$3::date',[h.habit_id,req.body.archived,data.today]);
   return {success:true};
  }));
 }));
}
module.exports={R,DAY,loadData,currentHabits,project,configuration,registerRecurrence,recurrenceInstalled,quotaHistory};
