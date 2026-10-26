const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { createPreviewApp } = require("../preview-server");
test('preview records upcoming recurring bills early and rejects duplicate confirmations',async()=>{
 await withPreview(async base=>{
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const today=(await(await fetch(base+'/api/recurring')).json()).today,start=(Number(today.slice(0,4))+1)+'-01-01';
  assert.equal((await post('/api/recurring/save',{name:'Early bill',amount:'12.35',category:'subscriptions',frequency:'monthly',starts_on:start,enabled:true})).status,200);
  const r=(await(await fetch(base+'/api/recurring')).json()).definitions.find(r=>r.name==='Early bill');
  assert.equal(r.last_paid_on,null);
  const body={recurring_id:r.recurring_id,scheduled_for:start,date:today};
  assert.equal((await post('/api/recurring/confirm',body)).status,200);
  assert.equal((await post('/api/recurring/confirm',body)).status,409);
  const updated=(await(await fetch(base+'/api/recurring')).json()).definitions.find(item=>item.recurring_id===r.recurring_id);
  assert.equal(updated.last_paid_on,today);assert.equal(updated.last_paid_for,start);
  const expenses=await(await fetch(base+'/get-expenses')).json();
  assert.equal(expenses.filter(e=>e.recurring_id===r.recurring_id).length,1);
  assert.equal(expenses.find(e=>e.recurring_id===r.recurring_id).date,today);
  const paid=expenses.find(e=>e.recurring_id===r.recurring_id);
  assert.equal((await post('/api/recurring/delete',{recurring_id:r.recurring_id})).status,200);
  assert.equal((await post('/api/recurring/delete',{recurring_id:r.recurring_id})).status,404);
  const retained=(await(await fetch(base+'/get-expenses')).json()).find(e=>e.expense_id===paid.expense_id);
  assert.deepEqual(retained,{...paid,recurring_id:null});
 });
});

async function withPreview(run) {
  const server = createServer(createPreviewApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("preview serves the dashboard without authenticating or connecting to MySQL", async () => {
  await withPreview(async (base) => {
    const response = await fetch(`${base}/dashboard`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Demo User/);
    assert.match(html, /Habit check-in/);
    assert.match(html, /Log an expense/);
  });
});

test('preview saves explicit expense dates and rejects invalid dates or unbudgeted months',async()=>{
 await withPreview(async base=>{
  const html=await(await fetch(base+'/dashboard')).text();assert.match(html,/id="expense-date"[^>]*type="date"/);assert.doesNotMatch(html,/What was it for\?|expense-date-note/);
  const today=(await(await fetch(base+'/dashboard-data')).json()).currentDate,date=today.slice(0,8)+(today.endsWith('01')?'02':'01');
  const post=body=>fetch(base+'/add-expense',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({name:'Invalid day',amount:'12.35',date:'2023-02-29'})).status,400);
  assert.equal((await post({name:'Other month',amount:'12.35',date:'2000-01-01'})).status,409);
  const saved=await post({name:'Dated demo',amount:'12.35',date});assert.equal(saved.status,201);assert.equal((await saved.json()).date,date);
  const expenses=await(await fetch(base+'/get-expenses')).json();assert.equal(expenses.find(e=>e.description==='Dated demo').date,date);
 });
});

test("preview exposes sample dashboard, habit, and expense data", async () => {
  await withPreview(async (base) => {
    const [summaryResponse, habitsResponse, expensesResponse] = await Promise.all([
      fetch(`${base}/dashboard-data`),
      fetch(`${base}/get-habits`),
      fetch(`${base}/get-expenses`),
    ]);
    const summary = await summaryResponse.json();
    const habits = await habitsResponse.json();
    const expenses = await expensesResponse.json();
    assert.equal(summary.totalHabits, 3);
    assert.equal(summary.completed, 1);
    assert.equal(summary.totalBudget, 30000);
    assert.equal(habits.length, 3);
    assert.equal(expenses.length, 9);
  });
});

test("preview habit check-ins and quick expenses update in-memory data", async () => {
  await withPreview(async (base) => {
    const toggle = await fetch(`${base}/toggle-habit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ habit_id: 102 }),
    });
    assert.equal(toggle.status, 200);
    const habits = await (await fetch(`${base}/get-habits`)).json();
    assert.equal(habits.find((habit) => habit.habit_id === 102).completed, true);

    const addExpense = await fetch(`${base}/add-expense`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Preview coffee", amount: "120" }),
      redirect: "manual",
    });
    assert.equal(addExpense.status, 303);
    const expenses = await (await fetch(`${base}/get-expenses`)).json();
    assert.equal(expenses[0].description, "Preview coffee");
    assert.equal(Number(expenses[0].amount), 120);
  });
});

test('preview scenarios expose explicit empty and failing states and render shared navigation',async()=>{
 await withPreview(async base=>{
  const empty=await fetch(base+'/dashboard?scenario=empty');const cookie=empty.headers.get('set-cookie').split(';')[0];
  const summary=await(await fetch(base+'/dashboard-data',{headers:{cookie}})).json();
  assert.equal(summary.hasBudget,false);assert.equal(summary.totalHabits,0);assert.match(summary.currentDate,/^\d{4}-\d{2}-\d{2}$/);
  const rejected=await fetch(base+'/add-expense',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'Tea',amount:'12.35'})});assert.equal(rejected.status,409);
  const failure=await fetch(base+'/dashboard?scenario=failure');const failureCookie=failure.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/get-habits',{headers:{cookie:failureCookie}})).status,503);
  for(const page of ['habits','expenses','savings','profile']){const response=await fetch(base+'/'+page);const html=await response.text();assert.equal(response.status,200);assert.match(html,/Primary navigation/);assert.match(html,/Demo preview/);}
 });
});

test('preview stress scenarios keep the summary contract consistent and isolate summary failures',async()=>{
 await withPreview(async base=>{
  for(const scenario of ['many','long','large','summaryFailure']){
   const page=await fetch(base+'/dashboard?scenario='+scenario);const cookie=page.headers.get('set-cookie').split(';')[0];
   const options={headers:{cookie}};
   const response=await fetch(base+'/dashboard-data',options);
   const habits=await(await fetch(base+'/get-habits',options)).json();
   const expenses=await(await fetch(base+'/get-expenses',options)).json();
   assert.ok(habits.length>0);assert.ok(expenses.length>0);
   if(scenario==='summaryFailure'){assert.equal(response.status,503);continue;}
   const summary=await response.json();assert.match(summary.currentDate,/^\d{4}-\d{2}-\d{2}$/);assert.equal(summary.hasBudget,true);
   assert.equal(summary.totalHabits,habits.length);
   assert.ok(Math.abs(summary.remaining-(summary.totalBudget-expenses.filter(e=>e.date.startsWith(summary.currentDate.slice(0,7))).reduce((sum,e)=>sum+Number(e.amount),0)))<.001);
   if(scenario==='long')assert.ok(habits[0].habit_name.length>100);
   if(scenario==='large')assert.ok(summary.remaining>100000000);
  }
 });
});

test('preview summary and budget record agree in populated and missing-budget states',async()=>{
 await withPreview(async base=>{
  for(const scenario of ['populated','empty','noBudget','large']){
   const page=await fetch(base+'/dashboard?scenario='+scenario);const cookie=page.headers.get('set-cookie').split(';')[0];
   const summary=await(await fetch(base+'/dashboard-data',{headers:{cookie}})).json();
   const record=await(await fetch(base+'/get-budget',{headers:{cookie}})).json();
   assert.equal(typeof summary.hasBudget,'boolean');assert.equal(summary.hasBudget,Boolean(record.budget_id));
   assert.equal(summary.totalBudget,Number(record.total_budget));
  }
 });
});

test('short-value and legacy preview fixtures expose real coherent demo records',async()=>{
 await withPreview(async base=>{
  for(const scenario of ['small','legacySummary']){
   const page=await fetch(base+'/dashboard?scenario='+scenario);const cookie=page.headers.get('set-cookie').split(';')[0];
   const summary=await(await fetch(base+'/dashboard-data',{headers:{cookie}})).json();
   const record=await(await fetch(base+'/get-budget',{headers:{cookie}})).json();
   if(scenario==='small'){assert.equal(summary.totalBudget,100);assert.equal(summary.remaining,80);assert.equal(summary.hasBudget,true);}
   else{assert.equal(summary.hasBudget,undefined);assert.equal(record.budget_id,1);assert.equal(Number(record.total_budget),summary.totalBudget);}
  }
 });
});

test('preview history and activity expose only explicit demo records and validate dates',async()=>{
 await withPreview(async base=>{
  const habits=await(await fetch(base+'/dashboard-history?date=2024-02-29&section=habits')).json();assert.equal(habits.date,'2024-02-29');assert.equal(habits.completions.length,1);
  const expenses=await(await fetch(base+'/dashboard-history?date=2024-02-29&section=expenses')).json();assert.equal(expenses.spent,'12.35');assert.equal(expenses.expenses.length,1);
  assert.equal((await fetch(base+'/dashboard-history?date=2023-02-29&section=habits')).status,400);
  const month=await(await fetch(base+'/dashboard-activity?month=2024-02')).json();assert.deepEqual(month.days,[{date:'2024-02-29',completions:1,expenses:1}]);
  const empty=await(await fetch(base+'/dashboard-activity?month=2023-02')).json();assert.deepEqual(empty.days,[]);
  const savings=await(await fetch(base+'/savings-data')).json();assert.equal(savings.length,2);assert.equal(savings.reduce((n,g)=>n+Number(g.saved_amount),0),14500);
 });
});

test('preview additions reconcile recorded expenses and use bounded explicit continuity fixtures',async()=>{
 await withPreview(async base=>{
  const expenses=await(await fetch(base+'/get-expenses')).json(),summary=await(await fetch(base+'/dashboard-data')).json();
  const data=await(await fetch(base+'/dashboard-breakdown?month='+summary.currentDate.slice(0,7))).json();
  const expected=expenses.filter(e=>e.date.startsWith(summary.currentDate.slice(0,7))).reduce((sum,e)=>sum+Math.round(Number(e.amount)*100),0);
  assert.equal(Math.round(Number(data.total)*100),expected);assert.equal(data.categories.reduce((sum,c)=>sum+Math.round(Number(c.amount)*100),0),expected);
  const date=summary.currentDate,response=await fetch(base+'/dashboard-continuity?habitId=101&end='+date);assert.equal(response.status,200);const history=await response.json();assert.equal(history.endDate,date);assert.equal(history.habit.createdDate,null);assert.ok(history.completedDates.length>0);assert.ok(history.completedDates.every(d=>d>=history.startDate&&d<=date));
  const day=await(await fetch(base+'/dashboard-breakdown?date=2024-02-29')).json();assert.equal(day.total,'12.35');assert.equal(day.range.kind,'day');
  assert.equal((await fetch(base+'/dashboard-continuity?habitId=9999&end='+date)).status,404);
  assert.equal((await fetch(base+'/dashboard-breakdown?date=2023-02-29')).status,400);
 });
});

test('daily spending preview aggregates only explicit dated expenses and separates failures from empty data',async()=>{
 await withPreview(async base=>{
  const data=await(await fetch(base+'/dashboard-spending?end=2024-02-29')).json();
  assert.deepEqual(data,{range:{startDate:'2024-02-01',endDate:'2024-02-29'},total:'12.35',days:[{date:'2024-02-29',amount:'12.35',count:1}]});
  assert.deepEqual((await(await fetch(base+'/dashboard-spending?end=2023-02-28')).json()).days,[]);
  const failure=await fetch(base+'/dashboard?scenario=breakdownFailure'),cookie=failure.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/dashboard-spending?end=2024-02-29',{headers:{cookie}})).status,503);
  assert.equal((await fetch(base+'/dashboard-spending?end=2023-02-29')).status,400);
 });
});
test('preview universal streak uses explicit daily requirements and revokes only todays earned day',async()=>{
 await withPreview(async base=>{
  const read=async()=>{const r=await fetch(base+'/universal-streak');assert.equal(r.status,200);return r.json();};
  assert.equal((await read()).count,7);
  for(const habit_id of [102,103])await fetch(base+'/toggle-habit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({habit_id})});
  assert.equal((await read()).count,8);assert.equal((await read()).count,8);
  await fetch(base+'/toggle-habit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({habit_id:102})});assert.equal((await read()).count,7);
 });
});
