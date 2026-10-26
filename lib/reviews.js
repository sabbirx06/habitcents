const {validDate}=require('./calendar-date');
const {trackingDay}=require('./tracking-clock');
const {R,loadData}=require('./habit-service');
function completed(rule,entry){return rule.target==null?entry?.completed_status===true:Number(entry?.progress_amount||0)>=Number(rule.target);}
async function review(db,user,kind,date,today=null){
 today ||= await trackingDay(db);
 const range=R.period(date,kind==='weekly'?'weekly':'monthly'),cutoff=range.end<today?range.end:today;
 // A review may intersect a yearly quota: fetch that bounded quota window as well.
 const data=await loadData(db,user,range.start.slice(0,4)+'-01-01',cutoff,range.end);
 let required=0,fulfilled=0,unknown=false,recordedCheckins=0,recordedEntries=0;
 const quotas=[];
 for(const h of data.habits){
  const versions=data.versions.filter(v=>String(v.habit_id)===String(h.habit_id));
  const logs=data.logs.filter(l=>String(l.habit_id)===String(h.habit_id)),entries=new Map(logs.map(l=>[l.date,l])),seen=new Set();
  recordedCheckins+=logs.filter(l=>l.date>=range.start&&l.date<=cutoff&&l.completed_status).length;
  recordedEntries+=logs.filter(l=>l.date>=range.start&&l.date<=cutoff).length;
  for(let day=range.start;day<=cutoff;day=R.shift(day,1)){
   if(h.created_on&&day<h.created_on)continue;
   const rule=R.versionOn(versions,day);
   if(!rule){if(!h.created_on||!versions.length)unknown=true;continue;}
   if(rule.archived)continue;
   if(!R.quota(rule)){if(R.due(rule,day)){required++;if(completed(rule,entries.get(day)))fulfilled++;}continue;}
   const window=R.period(day,rule.recurrence.frequency),key=window.start+':'+window.end;
   if(seen.has(key))continue;seen.add(key);
   const end=window.end<cutoff?window.end:cutoff;
   const total=logs.filter(l=>l.date>=window.start&&l.date>=rule.effective_on&&l.date<=end).reduce((n,l)=>n+(rule.tracking==='checkoff'||rule.target==null?(l.completed_status?1:0):Math.round(Number(l.progress_amount||0)*100)),0);
   const achieved=rule.tracking==='checkoff'||rule.target==null?total:total/100,target=Number(rule.target??1);
   quotas.push({habit_id:h.habit_id,name:h.habit_name,frequency:rule.recurrence.frequency,start:window.start,activeFrom:rule.effective_on>window.start?rule.effective_on:window.start,deadline:window.end,target,unit:rule.unit,achieved,remaining:Math.max(0,Math.round((target-achieved)*100)/100),status:achieved>=target?'complete':window.end<today&&window.end<=range.end?'missed':'incomplete',deadlineInReview:window.end>=range.start&&window.end<=range.end});
  }
 }
 const {rows:[spending]}=await db.query(`SELECT
  COALESCE((SELECT jsonb_agg(c ORDER BY category) FROM (SELECT to_jsonb(e)->>'category' AS category,SUM(amount)::text AS amount,COUNT(*)::integer AS count FROM expenses e WHERE user_id=$1 AND date BETWEEN $2::date AND $3::date GROUP BY to_jsonb(e)->>'category') c),'[]'::jsonb) AS categories,
  (SELECT total_budget::text FROM budgets WHERE user_id=$1 AND year=EXTRACT(YEAR FROM $2::date) AND month=EXTRACT(MONTH FROM $2::date) AND $4='monthly') AS budget`,[user,range.start,cutoff,kind]);
 const {categories,budget}=spending;
 // Sum integer cents; never infer categories or budgets from missing rows.
 const cents=categories.reduce((n,r)=>n+BigInt(r.amount.replace('.','')),0n);
 const decimal=n=>(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');
 return {kind,...range,today,asOf:cutoff,soFar:today>=range.start&&today<=range.end,
  habits:{scheduled:{required,fulfilled,rate:!unknown&&required?fulfilled/required:null},unknownRequirements:unknown,recordedCheckins,recordedEntries,quotas},
  spending:{total:decimal(cents),categories,budget},savingsNote:'Savings balances have no dated contribution history; period savings cannot be established.'};
}
function registerReviews(app,{db,requireLogin}){
 app.get('/api/reviews',requireLogin,async(req,res,next)=>{
  if(!['weekly','monthly'].includes(req.query.kind)||(req.query.date!==undefined&&!validDate(req.query.date)))return res.status(400).json({error:'Choose a valid review period and date.'});
  let client;
  try{
   client=await db.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const today=await trackingDay(client);if(req.query.date>today){await client.query('ROLLBACK');return res.status(400).json({error:'Future reviews are unavailable.'});}
   const result=await review(client,req.session.user.user_id,req.query.kind,req.query.date||today,today);
   // Compare only complete calendar periods, and only reliable denominators for habits.
   if(!result.soFar&&result.start>'0001-01-01'){const prior=await review(client,req.session.user.user_id,req.query.kind,R.shift(result.start,-1),today);result.previous={start:prior.start,end:prior.end,spending:prior.spending.total,habitRate:result.habits.scheduled.rate!=null&&prior.habits.scheduled.rate!=null?prior.habits.scheduled.rate:null};}
   await client.query('COMMIT');res.set('Cache-Control','private, no-store').json(result);
  }catch(e){if(client)await client.query('ROLLBACK');next(e);}finally{client?.release();}
 });
}
module.exports={review,registerReviews};
