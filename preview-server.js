const express = require("express");
const path = require("node:path");

const projectRoot = __dirname;
// Mock dates use the host's local calendar day; production returns PostgreSQL CURRENT_DATE.
function sampleDay() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
const sampleDate = sampleDay();
function shiftDemoDay(date,offset){const [y,m,d]=date.split('-').map(Number),day=new Date(0);day.setFullYear(y,m-1,d+offset);day.setHours(12,0,0,0);return day.getFullYear()+'-'+String(day.getMonth()+1).padStart(2,'0')+'-'+String(day.getDate()).padStart(2,'0');}
function demoBounds(end){const [y,m,d]=end.split('-').map(Number),day=new Date(0);day.setFullYear(y,m-1,d);return shiftDemoDay(end,-(day.getDay()+6)%7-175);}


function createPreviewApp() {
  const app = express();
  const habits = [
    { habit_id: 101, habit_name: "Morning walk", category: "Movement", completed: true },
    { habit_id: 102, habit_name: "Read for 20 minutes", category: "Learning", completed: false },
    { habit_id: 103, habit_name: "Drink enough water", category: "Wellbeing", completed: false },
  ];
  const expenses = [
    { expense_id: 202, description: "Groceries", amount: 1850, date: sampleDate, category:"food" },
    { expense_id: 201, description: "Coffee with a friend", amount: 320, date: sampleDate, category:"uncategorized" },
  ];
  expenses.push({expense_id:901,description:'Demo lunch',amount:240.25,date:shiftDemoDay(sampleDate,-1),category:'food'},{expense_id:902,description:'Demo tea',amount:12.35,date:'2024-02-29',category:'uncategorized'});
  // Explicit in-memory records for the spending chart; never used in the live app.
  for(const [index,offset,amount,category] of [[0,3,450,'food'],[1,6,180,'transport'],[2,9,780.50,'shopping'],[3,12,299,'subscriptions'],[4,15,625,'food']])expenses.push({expense_id:910+index,description:'Demo '+category+' expense',amount,date:shiftDemoDay(sampleDate,-offset),category});
  let budget = 30000;
  const savingsGoals=[{goal_id:401,name:'Travel fund',saved_amount:'4500.00',target_amount:'12000.00',deadline:sampleDay().slice(0,4)+'-12-31',archived:false},{goal_id:402,name:'Emergency fund',saved_amount:'10000.00',target_amount:'10000.00',deadline:null,archived:false}];
  const extraHabits=Array.from({length:6},(_,i)=>({habit_id:104+i,habit_name:'Demo routine '+(i+4),completed:false}));
  const extraExpenses=Array.from({length:6},(_,i)=>({expense_id:200-i,description:'Demo purchase '+(i+3),amount:100.25,date:sampleDate,category:["transport","food","subscriptions","shopping","uncategorized"][i%5]}));
  function scenarioHabits(req){
    const items=['many','long'].includes(req.scenario)?[...habits,...extraHabits]:habits;
    return req.scenario==='empty'?[]:items.filter(h=>!h.archived_on&&(!h.schedule_days||h.schedule_days.includes(new Date(sampleDay()+'T12:00Z').getUTCDay()||7))).map(h=>req.scenario==='long'?{...h,habit_name:h.habit_name+' — take an unhurried break outside, stretch, and make time for a longer routine before the busy day begins'}:h);
  }
  function scenarioExpenses(req){
    if(req.scenario==='empty')return [];
    const items=req.scenario==='small'?expenses.slice(0,2):['many','long'].includes(req.scenario)?[...expenses,...extraExpenses]:expenses;
    return items.map((e,i)=>({...e,description:req.scenario==='long'?e.description+' — supplies for a week of home cooking, household essentials and a shared family dinner':e.description,amount:req.scenario==='small'?(i===0?12.35:7.65):req.scenario==='large'&&i===0?98765432.10:e.amount}));
  }
  function scenarioBudget(req){return ['empty','noBudget'].includes(req.scenario)?0:req.scenario==='large'?999999999.99:req.scenario==='small'?100:budget;}

  app.set("view engine", "ejs");
  app.set("views", path.join(projectRoot, "views"));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(projectRoot, "public")));

  app.use((req,res,next)=>{
    const match=(req.headers.cookie || '').match(/preview-scenario=(\w+)/);
    req.scenario=match?.[1] || 'populated';
    res.locals.demo=true;
    if(['/dashboard','/habits','/expenses','/savings'].includes(req.path)) {
      req.scenario=['empty','failure','summaryFailure','legacySummary','small','populated','noBudget','long','large','many','longName','emptyName','historyFailure','savingsFailure','completedGoals','breakdownFailure','continuityFailure','emptyHistory','partialContinuityFailure','streakFailure','streakSetup'].includes(req.query.scenario)?req.query.scenario:'populated';
      res.cookie('preview-scenario',req.scenario,{sameSite:'lax'});
    }
    if(req.scenario==='summaryFailure' && req.path==='/dashboard-data')return res.status(503).json({error:'Demo summary request failure'});
    if(req.scenario==='failure' && ['/dashboard-data','/get-habits','/get-expenses'].includes(req.path))return res.status(503).json({error:'Demo request failure'});
    next();
  });
  app.get("/", (_req, res) => res.redirect(302, "/dashboard"));
  app.get("/dashboard", (_req, res) => {
    res.render("dashboard", { title: "Dashboard · HabitCents", user: { name: _req.scenario==="longName"?"Alexandria Catherine Montgomery Sullivan Whitaker":_req.scenario==="emptyName"?"":"Demo User" }, page: "dashboard", demo: true });
  });
  app.get('/universal-streak',(req,res)=>{
    const {validDate}=require('./lib/calendar-date'),today=sampleDay(),date=req.query.date||today,start=shiftDemoDay(today,-7);
    if(!validDate(date))return res.status(400).json({error:'Invalid date'});
    if(['failure','streakFailure'].includes(req.scenario))return res.status(503).json({error:'Demo streak failure'});
    if(['empty','streakSetup'].includes(req.scenario)||date<start||date>today)return res.json({status:'setup-required',reason:date<start?'not-tracked':'policy-and-enrollment-required',count:null,currentDate:today,asOfDate:date});
    const days=Array.from({length:8},(_,i)=>{const day=shiftDemoDay(start,i);return {date:day,sealed:true,required:day===today?scenarioHabits(req).length:3,completed:day===today?scenarioHabits(req).filter(h=>h.completed).length:3};});
    res.json({...require('./lib/universal-streak').evaluateUniversalStreak({startsOn:start,asOf:date,currentDate:today,emptyDayPolicy:'reset',days}),currentDate:today});
  });
  app.get("/dashboard-data", (req, res) => {
    const shownHabits=scenarioHabits(req),shownExpenses=scenarioExpenses(req),total=scenarioBudget(req);
    const spent=shownExpenses.filter(e=>e.date.startsWith(sampleDay().slice(0,7))).reduce((sum,e)=>sum+Number(e.amount),0);
    const summary={currentDate:sampleDay(),hasBudget:!['empty','noBudget'].includes(req.scenario),totalHabits:shownHabits.length,completed:shownHabits.filter(h=>h.completed).length,totalBudget:total,remaining:total-spent};
    // Explicit compatibility fixture: existence must be verified with /get-budget.
    if(req.scenario==='legacySummary')delete summary.hasBudget;
    res.json(summary);
  });
  app.get("/get-habits", (req, res) => res.json(scenarioHabits(req).filter(h=>!h.archived_on&&(!h.schedule_days||h.schedule_days.includes(new Date(sampleDay()+'T12:00Z').getUTCDay()||7)))));
  app.post("/toggle-habit", (req, res) => {
    const habit = [...habits,...extraHabits].find((item) => item.habit_id === Number(req.body.habit_id));
    if (!habit) return res.status(404).json({ error: "Habit not found" });
    habit.completed = !habit.completed;
    if(habit.target!=null)habit.progress_amount=habit.completed?habit.target:0;
    res.json({ success: true, completed: habit.completed });
  });
  app.get("/get-expenses", (req, res) => res.json(scenarioExpenses(req).sort((a,b)=>b.date.localeCompare(a.date)||Number(b.expense_id)-Number(a.expense_id))));
  app.post("/add-expense", (req, res) => {
    const date = req.body.date === undefined ? sampleDay() : req.body.date;
    if (!require('./lib/calendar-date').validDate(date)) return res.status(400).json({error:"Choose a valid expense date."});
    const description = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const category=require('./lib/expense-category').parseCategory(req.body.category);
    if(!category)return res.status(400).json({error:"Invalid category"});
    const amount = Number(req.body.amount);
    if (!description || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({error:"Enter an expense description and a positive amount."});
    }
    if(["empty","noBudget"].includes(req.scenario))return res.status(409).json({error:"Set a monthly budget in Expenses before adding an expense."});
    if(date.slice(0,7)!==sampleDay().slice(0,7))return res.status(409).json({error:"Demo has a budget only for the current month. Choose a date in that month."});
    expenses.unshift({ expense_id: Date.now(), description, amount, category, date });
    if(req.is("application/json"))return res.status(201).json({success:true,date});
    res.redirect(303, "/dashboard");
  });

  app.get('/streak',(_req,res)=>res.json({streak:0}));
  app.get('/get-budget',(req,res)=>res.json(['empty','noBudget'].includes(req.scenario)?{total_budget:0}:{budget_id:1,total_budget:scenarioBudget(req)}));
  app.get('/remaining-budget',(_req,res)=>res.json({remaining:budget-expenses.reduce((sum,e)=>sum+Number(e.amount),0),totalBudget:budget,hasBudget:true}));
  app.get('/savings-data',(req,res)=>{
    if(['failure','savingsFailure'].includes(req.scenario))return res.status(503).json({error:'Demo savings failure'});
    if(req.scenario==='empty')return res.json([]);
    res.json(savingsGoals.filter(g=>!g.archived).map(g=>req.scenario==='completedGoals'?{...g,saved_amount:g.target_amount}:g));
  });
  // Explicit, repeatable sample records used only by this database-free demo.
  const demoOffsets={101:[1,2,4,8,9,14,15,18,22,25,28,29,34,36,41,43,47,49,55,59,60,65,69,72,77,80],102:[3,5,7,10,13,16,20,23,27,31,35,39,44,48,52,57,61,66,70,75,79],103:[2,6,11,17,24,32,40,46,54,62,68,76]};
  function demoHistory(req){
    const records=new Map();const entry=date=>{if(!records.has(date))records.set(date,{completions:[],expenses:[]});return records.get(date);};
    if(req.scenario!=='emptyHistory')for(const habit of habits)for(const offset of demoOffsets[habit.habit_id]||[])entry(shiftDemoDay(sampleDay(),-offset)).completions.push({habit_id:habit.habit_id,habit_name:habit.habit_name});
    if(req.scenario!=='emptyHistory')entry('2024-02-29').completions.push({habit_id:102,habit_name:'Read for 20 minutes'});
    entry(sampleDay()).completions=req.scenario==='emptyHistory'?[]:habits.filter(h=>h.completed);
    for(const expense of scenarioExpenses(req))entry(expense.date).expenses.push(expense);
    return records;
  }
  app.get('/dashboard-history',(req,res)=>{
    const {validDate}=require('./lib/calendar-date');const {date,section}=req.query;
    if(!validDate(date)||!['habits','expenses'].includes(section))return res.status(400).json({error:'Invalid date or section'});
    if(['failure','historyFailure'].includes(req.scenario))return res.status(503).json({error:'Demo history failure'});
    const record=req.scenario==='empty'?null:demoHistory(req).get(date);
    if(section==='habits')return res.json({date,completions:record?.completions??[]});
    const items=record?.expenses??[];res.json({date,expenses:items,spent:(items.reduce((sum,e)=>sum+Math.round(Number(e.amount)*100),0)/100).toFixed(2)});
  });
  app.get('/dashboard-activity',(req,res)=>{
    const {validMonth}=require('./lib/calendar-date');const {month}=req.query;
    if(!validMonth(month))return res.status(400).json({error:'Invalid month'});
    if(['failure','historyFailure'].includes(req.scenario))return res.status(503).json({error:'Demo activity failure'});
    const days=req.scenario==='empty'?[]:[...demoHistory(req)].filter(([date,record])=>date.startsWith(month)&&(record.completions.length||record.expenses.length)).map(([date,record])=>({date,completions:record.completions.length,expenses:record.expenses.length})).sort((a,b)=>a.date.localeCompare(b.date));
    res.json({month,days});
  });
  app.get('/dashboard-spending',(req,res)=>{
    const {validDate}=require('./lib/calendar-date'),{end}=req.query;
    if(!validDate(end))return res.status(400).json({error:'Invalid end date'});
    if(['failure','breakdownFailure'].includes(req.scenario))return res.status(503).json({error:'Demo spending failure'});
    const start=end.slice(0,7)+'-01',days=new Map();let total=0;
    for(const expense of scenarioExpenses(req).filter(e=>e.date>=start&&e.date<=end)){
      const day=days.get(expense.date)||{cents:0,count:0};const amount=Math.round(Number(expense.amount)*100);day.cents+=amount;day.count++;days.set(expense.date,day);total+=amount;
    }
    res.json({range:{startDate:start,endDate:end},total:(total/100).toFixed(2),days:[...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,day])=>({date,amount:(day.cents/100).toFixed(2),count:day.count}))});
  });
  app.get('/dashboard-breakdown',(req,res)=>{
    const {validDate,validMonth}=require('./lib/calendar-date'),{date,month}=req.query;
    if((date!==undefined)===(month!==undefined)||date!==undefined&&!validDate(date)||month!==undefined&&!validMonth(month))return res.status(400).json({error:'Invalid range'});
    if(['failure','breakdownFailure'].includes(req.scenario))return res.status(503).json({error:'Demo breakdown failure'});
    const start=date||month+'-01';let end=date;
    if(!date){const [y,m]=month.split('-').map(Number),last=new Date(0);last.setFullYear(y,m,0);end=month+'-'+String(last.getDate()).padStart(2,'0');}
    const amounts=new Map(),counts=new Map();let total=0;
    for(const expense of scenarioExpenses(req).filter(e=>e.date>=start&&e.date<=end)){const key=require('./lib/expense-category').parseCategory(expense.category)||'uncategorized',amount=Math.round(Number(expense.amount)*100);amounts.set(key,(amounts.get(key)||0)+amount);counts.set(key,(counts.get(key)||0)+1);total+=amount;}
    res.json({range:{kind:date?'day':'month',startDate:start,endDate:end},total:(total/100).toFixed(2),categories:[...amounts].sort(([a],[b])=>a.localeCompare(b)).map(([category,amount])=>({category,amount:(amount/100).toFixed(2),count:counts.get(category)}))});
  });
  app.get('/dashboard-continuity',(req,res)=>{
    const {validDate}=require('./lib/calendar-date'),{habitId,end}=req.query;
    if(!validDate(end)||typeof habitId!=='string'||!/^\d+$/.test(habitId))return res.status(400).json({error:'Invalid habit/date'});
    if(['failure','continuityFailure'].includes(req.scenario)||(req.scenario==='partialContinuityFailure'&&habitId==='102'))return res.status(503).json({error:'Demo continuity failure'});
    const habit=scenarioHabits(req).find(h=>String(h.habit_id)===habitId);if(!habit)return res.status(404).json({error:'Habit not found'});
    const startDate=demoBounds(end),completedDates=[...demoHistory(req)].filter(([date,record])=>date>=startDate&&date<=end&&date<=sampleDay()&&record.completions.some(h=>String(h.habit_id)===habitId)).map(([date])=>date).sort();
    res.json({habit:{id:habit.habit_id,name:habit.habit_name,createdDate:null},startDate,endDate:end,currentDate:sampleDay(),completedDates,streak:null,streakNote:'Streak unavailable: habit start dates and schedules are not recorded.'});
  });
  app.get('/logout',(_req,res)=>res.redirect('/dashboard'));
  require('./lib/preview-workspaces').registerPreviewWorkspaces(app,{habits,expenses,goals:savingsGoals,history:demoHistory,today:sampleDay,shift:shiftDemoDay,getBudget:()=>budget,setBudget:value=>budget=value,presets:{physical:[{name:'Walking 10,000 Steps'},{name:'Going to the gym'},{name:'Playing football'}],spiritual:[{name:'Meditation'},{name:'Prayer'},{name:'Gratitude Journal'}],healthy:[{name:'Drinking Water'},{name:'Sleep Early',displayName:'Going to sleep early'},{name:'Eating Healthy'}]}});
  app.get(['/habits','/expenses','/savings','/profile'],(req,res)=>{
    const page=req.path.slice(1);
    res.render(page,{title:page+' · Demo',page,user:{name:'Demo User'},demo:true});
  });
  // Other account mutations are intentionally unavailable in this database-free preview.
  app.post(/.*/,(_req,res)=>res.status(405).send('Demo preview: this action is available in the authenticated app.'));

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PREVIEW_PORT) || 3001;
  const server=createPreviewApp().listen(port, "127.0.0.1", () => {
    console.log(`HabitCents frontend preview running at http://127.0.0.1:${port}`);
  });
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Preview port '+port+' is already in use. Stop the old preview process or set PREVIEW_PORT to an unused port.':error.message);process.exitCode=1;});
}

module.exports = { createPreviewApp };
