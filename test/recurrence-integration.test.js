const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
async function fixture(run){
 const db=new PGlite();let instant='2026-10-24T18:01:00Z';
 await db.exec(fs.readFileSync('schema.postgres.sql','utf8'));
 for(const file of ['001-expense-categories.sql','002-universal-streak-draft.sql','003-workspaces.sql','005-habit-recurrence.sql'])await db.exec(fs.readFileSync('migrations/'+file,'utf8'));
 await db.query("SET TIME ZONE 'UTC'");
 const query=(sql,args)=>db.query(sql.replace(/CURRENT_TIMESTAMP/g,`'${instant}'::timestamptz`).replace(/CURRENT_DATE/g,`('${instant}'::timestamptz AT TIME ZONE 'UTC')::date`),args);
 // PGlite has one connection: serialize checked-out transactions to emulate pg's exclusive lease.
 let tail=Promise.resolve();
 const pool={query,connect:async()=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query,release};}};
 const server=require('../server').createApp({db:pool,sessionSecret:'recurrence-isolated'}).listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const post=(url,body,cookie)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body),redirect:'manual'});
 const get=(url,cookie)=>fetch(base+url,{headers:cookie?{cookie}:{},redirect:'manual'});
 const login=async(email='a@test')=>{await post('/signup',{name:'Owner',email,password:'secret'});return (await post('/login',{email,password:'secret'})).headers.get('set-cookie').split(';')[0];};
 try{await run({db,query,post,get,login,clock:v=>instant=v});}finally{await new Promise(r=>server.close(r));await db.close();}
}
const habit=(extra={})=>({name:'Gym',schedule_days:[1,2,3,4,5,6,7],target:'3',unit:'visits',tracking:'count',recurrence:{frequency:'weekly',mode:'quota'},...extra});
test('recurring payment status follows the latest scheduled payment and reflects edited or deleted transactions',()=>fixture(async({post,get,login})=>{
 const cookie=await login(),other=await login('other@test');
 await post('/api/budget',{month:'2026-10',amount:'500'},cookie);
 await post('/api/recurring/save',{name:'Internet',amount:'10',frequency:'monthly',starts_on:'2026-10-01'},cookie);
 const record=async()=>(await(await get('/api/recurring',cookie)).json()).definitions[0];
 const r=await record();assert.equal(r.last_paid_on,null);
 const pay=(scheduled_for,date)=>post('/api/recurring/confirm',{recurring_id:r.recurring_id,scheduled_for,date},cookie);
 assert.equal((await pay('2026-10-01','2026-10-24')).status,200);
 assert.equal((await pay('2026-11-01','2026-10-23')).status,200);
 let updated=await record();assert.equal(updated.last_paid_for,'2026-11-01');assert.equal(updated.last_paid_on,'2026-10-23');
 assert.deepEqual((await(await get('/api/recurring',other)).json()).definitions,[]);
 const expenses=(await(await get('/api/expenses?month=2026-10',cookie)).json()).expenses;
 const latest=expenses.find(e=>e.date==='2026-10-23');assert.equal(latest.recurring_id,r.recurring_id);
 assert.equal((await post('/api/expenses/save',{expense_id:latest.expense_id,name:'Internet',amount:'10',date:'2026-10-22',category:'subscriptions'},cookie)).status,200);
 assert.equal((await record()).last_paid_on,'2026-10-22');
 assert.equal((await post('/delete-expense',{expense_id:latest.expense_id},cookie)).status,200);
 updated=await record();assert.equal(updated.last_paid_for,'2026-10-01');assert.equal(updated.last_paid_on,'2026-10-24');
 const first=expenses.find(e=>e.expense_id!==latest.expense_id);
 assert.equal((await post('/delete-expense',{expense_id:first.expense_id},cookie)).status,200);
 updated=await record();assert.equal(updated.last_paid_on,null);assert.equal(updated.last_paid_for,null);
}));
test('upcoming recurring payments can be paid early once, against the actual payment month',()=>fixture(async({db,post,get,login})=>{
 const cookie=await login(),other=await login('other@test');
 await post('/api/budget',{month:'2026-10',amount:'500'},cookie);
 const created=await post('/api/recurring/save',{name:'Early bill',amount:'12.35',frequency:'monthly',starts_on:'2026-11-01',ends_on:'2026-11-01',enabled:true},cookie);
 assert.equal(created.status,200);
 const r=(await(await get('/api/recurring',cookie)).json()).definitions[0];
 assert.equal(r.last_paid_on,null);assert.equal(r.last_paid_for,null);
 const body={recurring_id:r.recurring_id,scheduled_for:r.next_due,date:'2026-10-25'};
 assert.equal((await post('/api/recurring/confirm',body,other)).status,404);
 assert.equal((await post('/api/recurring/confirm',{...body,date:'2026-10-26'},cookie)).status,409);
 assert.equal((await post('/api/recurring/confirm',{...body,date:'2026-09-30'},cookie)).status,409);
 const responses=await Promise.all([1,2].map(()=>post('/api/recurring/confirm',body,cookie)));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const rows=(await db.query('SELECT e.date::text,e.scheduled_for::text,e.amount,b.month,b.year FROM expenses e JOIN budgets b USING(budget_id) WHERE recurring_id=$1',[r.recurring_id])).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-10-25');assert.equal(rows[0].scheduled_for,'2026-11-01');
 assert.equal(Number(rows[0].amount),12.35);assert.equal(rows[0].month,10);assert.equal(rows[0].year,2026);
 const updated=(await(await get('/api/recurring',cookie)).json()).definitions[0];
 assert.equal(updated.next_due,'2026-12-01');assert.equal(updated.enabled,false);
 assert.equal(updated.last_paid_on,'2026-10-25');assert.equal(updated.last_paid_for,'2026-11-01');
 const before=(await db.query('SELECT * FROM expenses WHERE recurring_id=$1',[r.recurring_id])).rows[0];
 assert.equal((await post('/api/recurring/delete',{recurring_id:r.recurring_id},other)).status,404);
 assert.equal((await post('/api/recurring/delete',{recurring_id:'invalid'},cookie)).status,400);
 assert.equal((await post('/api/recurring/delete',{recurring_id:r.recurring_id},cookie)).status,200);
 assert.equal((await post('/api/recurring/delete',{recurring_id:r.recurring_id},cookie)).status,404);
 assert.deepEqual((await(await get('/api/recurring',cookie)).json()).definitions,[]);
 const after=(await db.query('SELECT * FROM expenses WHERE expense_id=$1',[before.expense_id])).rows[0];
 assert.deepEqual(after,{...before,recurring_id:null});
 assert.equal((await post('/api/recurring/confirm',body,cookie)).status,404);
}));
test('quota activation, daily totals, pending changes, rollover and isolation execute real routes',()=>fixture(async({db,post,get,login,clock})=>{
 const cookie=await login(),other=await login('b@test');
 const save=await post('/api/habits/save',habit(),cookie);assert.equal(save.status,200,await save.clone().text());const id=(await save.json()).habit_id;
 let data=await(await get('/api/habits',cookie)).json();assert.equal(data.today,'2026-10-25');assert.equal(data.habits[0].status,'not-started');assert.equal(data.habits[0].pending.effective_on,'2026-10-26');
 assert.equal((await post('/api/habits/save',habit({habit_id:id,target:'4'}),cookie)).status,200);
 data=await(await get('/api/habits',cookie)).json();assert.equal(data.habits[0].status,'not-started','editing a future quota must not invent a daily requirement before activation');
 const beforeStart=await(await get('/api/reviews?kind=weekly&date=2026-10-25',cookie)).json();assert.equal(beforeStart.habits.scheduled.required,0);assert.equal(beforeStart.habits.quotas.length,0);assert.equal(beforeStart.habits.unknownRequirements,false);
 await post('/api/habits/save',habit({habit_id:id,target:'3'}),cookie);
 await post('/api/habits/archive',{habit_id:id,archived:true},cookie);
 await post('/api/habits/archive',{habit_id:id,archived:false},cookie);
 assert.equal((await(await get('/api/habits',cookie)).json()).habits[0].status,'not-started','archive/restore cannot activate a future quota');
 assert.equal((await post('/api/habits/progress',{habit_id:id,date:data.today,progress:'3'},cookie)).status,409);
 clock('2026-10-25T18:01:00Z');
 for(const amount of ['2','2','3','1'])assert.equal((await post('/api/habits/progress',{habit_id:id,date:'2026-10-26',progress:amount},cookie)).status,200);
 data=await(await get('/api/habits',cookie)).json();assert.equal(data.habits[0].period.achieved,1);assert.equal(data.habits[0].period.remaining,2);assert.equal(data.habits[0].due_today,false);
 assert.equal((await(await get('/dashboard-data',cookie)).json()).totalHabits,0);
 assert.deepEqual(await(await get('/get-habits',cookie)).json(),[]);
 assert.equal((await post('/api/habits/save',habit({habit_id:id,target:'5'}),cookie)).status,200);
 data=await(await get('/api/habits',cookie)).json();assert.equal(Number(data.habits[0].target),3);assert.equal(Number(data.habits[0].pending.target),5);
 assert.equal((await post('/api/habits/progress',{habit_id:id,date:'2026-10-26',progress:'9'},other)).status,404);
 assert.equal((await post('/api/habits/progress',{habit_id:id,date:'2026-10-25',progress:'9'},cookie)).status,400);
 clock('2026-11-01T18:01:00Z');data=await(await get('/api/habits',cookie)).json();assert.equal(Number(data.habits[0].target),5);assert.equal(data.habits[0].period.achieved,0);
 assert.equal(Number((await db.query('SELECT progress_amount FROM habit_logs WHERE habit_id=$1',[id])).rows[0].progress_amount),1);
}));
module.exports={fixture,habit};

test('full schema exports preserve period rules, dated totals and forward streak evidence',()=>fixture(async({db,post,get,login,clock})=>{
 const cookie=await login(),other=await login('b@test');clock('2026-10-25T18:01:00Z');
 const enrolled=await post('/api/habits/streak/start',{confirm:true},cookie);assert.equal(enrolled.status,200,await enrolled.clone().text());
 const id=(await(await post('/api/habits/save',habit({start_choice:'this',name:'=Owner quota'}),cookie)).json()).habit_id;
 await post('/api/habits/progress',{habit_id:id,date:'2026-10-26',progress:'2'},cookie);
 await post('/api/habits/save',habit({habit_id:id,name:'=Owner quota',target:'5'}),cookie);
 await post('/api/habits/save',habit({name:'Private quota',start_choice:'this'}),other);
 const json=await(await get('/profile/export/json',cookie)).json();
 assert.equal(json.datasets.habitScheduleHistory.length,2);assert.equal(json.datasets.habitScheduleHistory[0].recurrence.mode,'quota');assert.equal(json.datasets.habitScheduleHistory[1].target,'5.00');assert.equal(json.datasets.recordedHabitRules[0].target,'3.00');assert.equal(json.datasets.streakEnrollment[0].time_zone,'Asia/Dhaka');assert.ok(json.datasets.streakRequirements[0].rules);assert.equal(JSON.stringify(json).includes('Private quota'),false);assert.equal(JSON.stringify(json).includes('password'),false);
 const csv=await(await get('/profile/export/habits',cookie)).text();assert.match(csv,/rule_effective_on/);assert.match(csv,/'=Owner quota/);assert.match(csv,/3\.00/);assert.doesNotMatch(csv,/5\.00/);
}));

test('scheduled occurrences and quotas share only one streak, repeated totals and deadlines are deterministic',()=>fixture(async({db,post,get,login,clock})=>{
 clock('2026-12-30T18:00:00Z');const cookie=await login();
 assert.equal((await post('/api/habits/streak/start',{confirm:true},cookie)).status,200);
 const create=async h=>{const r=await post('/api/habits/save',h,cookie);assert.equal(r.status,200,await r.clone().text());return (await r.json()).habit_id;};
 const daily=await create(habit({name:'Read',target:'20',unit:'minutes',tracking:'measure',recurrence:{frequency:'daily',mode:'scheduled'}}));
 const annual=await create(habit({name:'Vacation',target:null,unit:null,tracking:'checkoff',recurrence:{frequency:'yearly',mode:'scheduled',month:12,day:31}}));
 const quota=await create(habit({name:'Donate',target:null,unit:null,tracking:'checkoff',recurrence:{frequency:'monthly',mode:'quota'},start_choice:'this'}));
 const progress=(habit_id,extra)=>post('/api/habits/progress',{habit_id,date:'2026-12-31',...extra},cookie);
 for(const p of ['10','20'])assert.equal((await progress(daily,{progress:p})).status,200);
 await Promise.all([progress(annual,{completed:true}),progress(annual,{completed:true})]);
 await Promise.all([progress(quota,{completed:true}),progress(quota,{completed:true})]);
 assert.equal((await(await get('/universal-streak',cookie)).json()).count,1);
 assert.equal((await(await get('/dashboard-data',cookie)).json()).totalHabits,2);
 await progress(daily,{progress:'19'});assert.equal((await(await get('/universal-streak',cookie)).json()).count,0);
 await progress(daily,{progress:'20'});
 const snapshot=(await db.query("SELECT to_jsonb(r) AS row FROM universal_streak_requirements r WHERE day='2026-12-31' ORDER BY habit_id")).rows;
 clock('2026-12-31T18:00:00Z');
 assert.equal((await(await get('/universal-streak',cookie)).json()).count,1);
 assert.equal((await(await get('/dashboard-data',cookie)).json()).totalHabits,1);
 assert.equal((await(await get('/api/habits',cookie)).json()).habits.find(h=>h.habit_id===quota).period.achieved,0);
 await post('/api/habits/save',habit({habit_id:daily,name:'Read',target:'30',unit:'minutes',tracking:'measure',recurrence:{frequency:'daily',mode:'scheduled'}}),cookie);
 assert.deepEqual((await db.query("SELECT to_jsonb(r) AS row FROM universal_streak_requirements r WHERE day='2026-12-31' ORDER BY habit_id")).rows,snapshot);
 clock('2027-01-01T18:00:00Z');assert.equal((await(await get('/universal-streak',cookie)).json()).count,0);
}));

test('Profile review uses owned exact spending, truthful history and separate quotas',()=>fixture(async({db,post,get,login,clock})=>{
 const cookie=await login(),other=await login('b@test');clock('2026-10-25T18:01:00Z');
 const id=(await(await post('/api/habits/save',habit({start_choice:'this'}),cookie)).json()).habit_id;
 await post('/api/habits/progress',{habit_id:id,date:'2026-10-26',progress:'2'},cookie);
 await post('/api/habits/save',habit({name:'Read',tracking:'measure',target:'20',unit:'minutes',recurrence:{frequency:'daily',mode:'scheduled'}}),cookie);
 await db.query("INSERT INTO expenses(user_id,date,amount,category) VALUES(1,'2026-10-26',0.10,'food'),(1,'2026-10-26',0.20,'food'),(2,'2026-10-26',999,'food')");
 await db.query("INSERT INTO budgets(user_id,total_budget,month,year) VALUES(1,100,10,2026)");
 let response=await get('/api/reviews?kind=weekly&date=2026-10-26',cookie);assert.equal(response.status,200);let review=await response.json();
 assert.equal(review.start,'2026-10-26');assert.equal(review.end,'2026-11-01');assert.equal(review.soFar,true);assert.equal(review.spending.total,'0.30');assert.equal(review.spending.budget,null);assert.deepEqual(review.spending.categories,[{category:'food',amount:'0.30',count:2}]);
 assert.equal(review.habits.scheduled.required,1);assert.equal(review.habits.scheduled.fulfilled,0);assert.equal(review.habits.quotas.length,1);assert.equal(review.habits.quotas[0].achieved,2);assert.equal(review.habits.quotas[0].status,'incomplete');
 const monthly=await(await get('/api/reviews?kind=monthly&date=2026-10-26',cookie)).json();assert.equal(monthly.spending.budget,'100.00');
 const legacy=(await db.query("INSERT INTO habits(user_id,habit_name,difficulty_score) VALUES(1,'Legacy',1) RETURNING habit_id")).rows[0].habit_id;
 await db.query("INSERT INTO habit_logs(habit_id,date,completed_status) VALUES($1,'2024-02-29',true)",[legacy]);
 review=await(await get('/api/reviews?kind=monthly&date=2024-02-15',cookie)).json();assert.equal(review.habits.scheduled.rate,null);assert.equal(review.habits.recordedCheckins,1);assert.equal(review.habits.unknownRequirements,true);
 assert.equal((await get('/api/reviews?kind=monthly&date=2024-02-30',cookie)).status,400);assert.equal((await get('/api/reviews?kind=weekly&date=2026-10-26')).status,302);
 assert.equal((await(await get('/api/reviews?kind=weekly&date=2026-10-26',other)).json()).spending.total,'999.00');
}));

test('monthly/yearly quotas, clamped scheduled dates and closed history remain independent',()=>fixture(async({post,get,login,clock})=>{
 const cookie=await login();clock('2026-01-30T18:00:00Z');
 const create=async h=>(await(await post('/api/habits/save',h,cookie)).json()).habit_id;
 const monthly=await create(habit({name:'Monthly sessions',target:'5',recurrence:{frequency:'monthly',mode:'quota'},start_choice:'this'}));
 const yearly=await create(habit({name:'Annual minutes',tracking:'measure',target:'100',unit:'minutes',recurrence:{frequency:'yearly',mode:'quota'},start_choice:'this'}));
 const future=await create(habit({name:'Next year',recurrence:{frequency:'yearly',mode:'quota'}}));
 const scheduled=await create(habit({name:'Month end',tracking:'checkoff',target:null,recurrence:{frequency:'monthly',mode:'scheduled',day:31}}));
 const leap=await create(habit({name:'Leap anchor',tracking:'checkoff',target:null,recurrence:{frequency:'yearly',mode:'scheduled',month:2,day:29}}));
 await post('/api/habits/progress',{habit_id:monthly,date:'2026-01-31',progress:'2'},cookie);
 await post('/api/habits/progress',{habit_id:yearly,date:'2026-01-31',progress:'30'},cookie);
 await post('/api/habits/progress',{habit_id:scheduled,date:'2026-01-31',completed:true},cookie);
 clock('2026-01-31T18:00:00Z');
 await post('/api/habits/progress',{habit_id:monthly,date:'2026-02-01',progress:'4'},cookie);
 await post('/api/habits/progress',{habit_id:yearly,date:'2026-02-01',progress:'10'},cookie);
 let rows=(await(await get('/api/habits',cookie)).json()).habits;assert.equal(rows.find(h=>h.habit_id===monthly).period.achieved,4);assert.equal(rows.find(h=>h.habit_id===yearly).period.achieved,40);assert.equal(rows.find(h=>h.habit_id===future).status,'not-started');
 const january=await(await get('/api/reviews?kind=monthly&date=2026-01-01',cookie)).json();assert.equal(january.habits.quotas.find(q=>q.habit_id===monthly).status,'missed');assert.equal(january.habits.quotas.find(q=>q.habit_id===monthly).achieved,2);assert.equal(january.habits.quotas.some(q=>q.habit_id===future),false);
 const history=await(await get('/api/habits/history?habitId='+monthly+'&start=2026-01-01&end=2026-02-01',cookie)).json();assert.equal(history.periods[0].status,'missed');assert.equal(history.periods[0].achieved,2);assert.equal(history.periods[1].achieved,4);
 clock('2026-02-27T18:00:00Z');rows=await(await get('/get-habits',cookie)).json();assert.ok(rows.some(h=>h.habit_id===scheduled));assert.ok(rows.some(h=>h.habit_id===leap));
 clock('2026-03-27T18:00:00Z');rows=await(await get('/get-habits',cookie)).json();assert.equal(rows.some(h=>h.habit_id===scheduled),false);
 clock('2026-03-30T18:00:00Z');rows=await(await get('/get-habits',cookie)).json();assert.ok(rows.some(h=>h.habit_id===scheduled));
 assert.equal((await post('/api/habits/save',habit({habit_id:monthly,target:'8',recurrence:{frequency:'monthly',mode:'quota'}}),cookie)).status,200);
 const old=await(await get('/api/reviews?kind=monthly&date=2026-01-01',cookie)).json();assert.equal(old.habits.quotas.find(q=>q.habit_id===monthly).target,5);
}));

test('Dhaka midnight/month rollover keeps stored DATEs and monthly money authoritative with UTC sessions',()=>fixture(async({db,post,get,login,clock})=>{
 const cookie=await login();clock('2026-12-31T17:59:59Z');
 const id=(await(await post('/api/habits/save',habit({tracking:'measure',target:'20',unit:'minutes',recurrence:{frequency:'daily',mode:'scheduled'}}),cookie)).json()).habit_id;
 await post('/api/habits/progress',{habit_id:id,date:'2026-12-31',progress:'20'},cookie);
 await db.query("INSERT INTO budgets(user_id,total_budget,month,year) VALUES(1,100,12,2026),(1,200,1,2027)");
 await db.query("INSERT INTO expenses(user_id,date,amount) VALUES(1,'2026-12-31',12.35),(1,'2027-01-01',23.45)");
 let summary=await(await get('/dashboard-data',cookie)).json();assert.equal(summary.currentDate,'2026-12-31');assert.equal(summary.totalBudget,100);assert.equal(summary.remaining,87.65);assert.equal(summary.completed,1);
 clock('2026-12-31T18:00:00Z');summary=await(await get('/dashboard-data',cookie)).json();assert.equal(summary.currentDate,'2027-01-01');assert.equal(summary.totalBudget,200);assert.equal(summary.remaining,176.55);assert.equal(summary.completed,0);
 assert.equal((await post('/api/habits/progress',{habit_id:id,date:'2026-12-31',progress:'0'},cookie)).status,400);
 const records=(await db.query('SELECT date::text FROM habit_logs WHERE habit_id=$1',[id])).rows;assert.deepEqual(records,[{date:'2026-12-31'}]);
 assert.equal((await db.query("SELECT current_setting('TimeZone') AS zone")).rows[0].zone,'UTC');
}));

test('full optional-schema goals, payments, exports and concurrent confirmations persist together',()=>fixture(async({db,post,get,login})=>{
 const cookie=await login();
 const goalResponse=await post('/api/goals/save',{name:'Goal',target:'100',deadline:'2027-02-28'},cookie);assert.equal(goalResponse.status,200);
 const goal=(await(await get('/api/goals',cookie)).json()).goals[0];
 assert.equal(goal.deadline,'2027-02-28');await post('/api/goals/contribute',{goal_id:goal.goal_id,amount:'12.35'},cookie);await post('/api/goals/archive',{goal_id:goal.goal_id,archived:true},cookie);
 await post('/api/budget',{month:'2026-10',amount:'100'},cookie);
 assert.equal((await post('/api/recurring/save',{name:'Internet',amount:'9.99',category:'subscriptions',frequency:'monthly',starts_on:'2026-10-01'},cookie)).status,200);
 const recurring=(await(await get('/api/recurring',cookie)).json()).definitions[0];
 const confirmations=await Promise.all([1,2].map(()=>post('/api/recurring/confirm',{recurring_id:recurring.recurring_id,scheduled_for:'2026-10-01',date:'2026-10-25'},cookie)));
 assert.deepEqual(confirmations.map(r=>r.status).sort(),[200,409]);
 const json=await(await get('/profile/export/json',cookie)).json();assert.equal(json.datasets.expenses.length,1);assert.equal(json.datasets.expenses[0].amount,'9.99');assert.equal(json.datasets.expenses[0].scheduled_for,'2026-10-01');assert.equal(json.datasets.recurringExpenses[0].next_due,'2026-11-01');assert.equal(json.datasets.savingsGoals[0].saved_amount,'12.35');assert.equal(json.datasets.savingsGoals[0].archived,true);
 await db.query('ALTER TABLE expenses DROP COLUMN category');
 const review=await(await get('/api/reviews?kind=monthly&date=2026-10-01',cookie)).json();assert.equal(review.spending.total,'9.99');assert.equal(review.spending.categories[0].category,null);assert.equal(review.spending.budget,'100.00');
}));

test('quota-only accounts earn no streak and pending conversion activates across an unvisited boundary',()=>fixture(async({post,get,login,clock})=>{
 clock('2026-10-18T18:00:00Z');const cookie=await login();await post('/api/habits/streak/start',{confirm:true},cookie);
 const id=(await(await post('/api/habits/save',habit({start_choice:'this'}),cookie)).json()).habit_id;
 await post('/api/habits/progress',{habit_id:id,date:'2026-10-19',progress:'3'},cookie);
 assert.equal((await(await get('/universal-streak',cookie)).json()).count,0);
 assert.equal((await post('/api/habits/save',habit({habit_id:id,target:null,unit:null,tracking:'checkoff',recurrence:{frequency:'daily',mode:'scheduled'}}),cookie)).status,200);
 let h=(await(await get('/api/habits',cookie)).json()).habits[0];assert.equal(h.recurrence.mode,'quota');assert.equal(h.pending.effective_on,'2026-10-26');
 clock('2026-10-25T18:00:00Z');h=(await(await get('/api/habits',cookie)).json()).habits[0];assert.equal(h.recurrence.frequency,'daily');assert.equal(h.due_today,true);
 assert.equal((await(await get('/universal-streak',cookie)).json()).count,0);
 const set=completed=>post('/toggle-habit',{habit_id:id,completed},cookie);
 await Promise.all([set(true),set(true)]);assert.equal((await(await get('/universal-streak',cookie)).json()).count,1);
 await Promise.all([set(false),set(false)]);assert.equal((await(await get('/universal-streak',cookie)).json()).count,0);
}));

test('legacy creation on a full installation records only its known creation-day requirements',()=>fixture(async({post,get,login})=>{
 const cookie=await login();assert.equal((await post('/add-habit',{name:'Daily legacy action',difficulty:4},cookie)).status,302);
 const data=await(await get('/api/habits',cookie)).json();assert.equal(data.habits[0].created_on,'2026-10-25');
 const review=await(await get('/api/reviews?kind=weekly&date=2026-10-25',cookie)).json();assert.equal(review.habits.scheduled.required,1);assert.equal(review.habits.unknownRequirements,false);assert.equal(review.habits.scheduled.rate,0);
}));
