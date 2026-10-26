const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const bcrypt = require('bcrypt');

async function withApp(run) {
  const { createApp } = require('../server');
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, '../schema.postgres.sql'), 'utf8'));
  // Same query/connect/release interface as pg.Pool, backed by a real local PG engine.
  const pool = { query: (...args) => db.query(...args), connect: async () => ({ query: (...args) => db.query(...args), release() {} }) };
  const server = createApp({ db: pool, sessionSecret: 'local-test-secret' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, cookie) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body), redirect: 'manual' });
  const get = (route, cookie) => fetch(base + route, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  try { await run({ db, post, get }); }
  finally { await new Promise(resolve => server.close(resolve)); await db.close(); }
}

test('daily spending aggregates exact owned amounts through selected date without requiring categories',async()=>{
 await withApp(async({db,post,get})=>{
  await post('/signup',{name:'Chart owner',email:'chart@test',password:'secret'});await post('/signup',{name:'Other',email:'other-chart@test',password:'secret'});
  const cookie=(await post('/login',{email:'chart@test',password:'secret'})).headers.get('set-cookie').split(';')[0];
  await db.query("ALTER TABLE expenses DROP COLUMN category");
  await db.query("INSERT INTO expenses(user_id,date,amount) VALUES (1,'2024-02-01',0.10),(1,'2024-02-01',0.20),(1,'2024-02-29',4.56),(1,'2024-03-01',88),(2,'2024-02-01',999),(1,'2025-12-31',1.11),(1,'2026-01-01',2.22)");
  const response=await get('/dashboard-spending?end=2024-02-29',cookie);assert.equal(response.status,200);const data=await response.json();
  assert.deepEqual(data,{range:{startDate:'2024-02-01',endDate:'2024-02-29'},total:'4.86',days:[{date:'2024-02-01',amount:'0.30',count:2},{date:'2024-02-29',amount:'4.56',count:1}]});
  assert.equal((await(await get('/dashboard-spending?end=2024-02-28',cookie)).json()).total,'0.30');
  assert.deepEqual((await(await get('/dashboard-spending?end=2023-01-01',cookie)).json()).days,[]);
  assert.equal((await(await get('/dashboard-spending?end=2026-01-01',cookie)).json()).total,'2.22');
  for(const end of ['2023-02-29','2024-13-01','bad'])assert.equal((await get('/dashboard-spending?end='+end,cookie)).status,400);
  assert.equal((await get('/dashboard-spending?end=2024-02-29')).status,302);
 });
});

test('profile account changes are CSRF protected, owned, persisted and exports are truthful and isolated',async()=>{
 await withApp(async({db,post,get})=>{
  await post('/signup',{name:'Profile A',email:'profile-a@test',password:'initial password'});await post('/signup',{name:'Profile B',email:'profile-b@test',password:'initial password'});
  const cookie=(await post('/login',{email:'profile-a@test',password:'initial password'})).headers.get('set-cookie').split(';')[0];
  assert.equal((await post('/profile/account',{name:'No session'})).status,302);
  const page=await get('/profile',cookie),html=await page.text(),token=html.match(/name="csrf-token" content="([^"]+)/)[1];
  assert.equal((await post('/profile/account',{name:'No csrf'},cookie)).status,403);
  for(const name of ['   ','x'.repeat(101)]){const invalid=await fetch(new URL('/profile/account',page.url),{method:'POST',headers:{cookie,'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify({name})});assert.equal(invalid.status,400);}
  const changed=await fetch(new URL('/profile/account',new URL('/profile',page.url)),{method:'POST',headers:{cookie,'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify({name:'  <img src=x> Name  ',user_id:2})});
  assert.equal(changed.status,200);assert.equal((await changed.json()).user.name,'<img src=x> Name');assert.equal((await db.query('SELECT name FROM users WHERE email=$1',['profile-a@test'])).rows[0].name,'<img src=x> Name');
  assert.equal((await db.query('SELECT name FROM users WHERE email=$1',['profile-b@test'])).rows[0].name,'Profile B');
  assert.equal((await get('/profile',cookie)).status,200);assert.match(await(await get('/profile',cookie)).text(),/&lt;img src=x&gt; Name/);
  const passwordRoute=new URL('/profile/password',page.url),passwordPost=data=>fetch(passwordRoute,{method:'POST',headers:{cookie,'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(data)});
  assert.equal((await passwordPost({currentPassword:'initial password',newPassword:'new secret',confirmPassword:'different'})).status,400);
  assert.equal((await passwordPost({currentPassword:'wrong',newPassword:'new secret',confirmPassword:'new secret'})).status,403);
  assert.equal((await passwordPost({currentPassword:'initial password',newPassword:'new secret',confirmPassword:'new secret'})).status,200);
  assert.notEqual((await post('/login',{email:'profile-a@test',password:'initial password'})).headers.get('location'),'/dashboard');assert.equal((await post('/login',{email:'profile-a@test',password:'new secret'})).headers.get('location'),'/dashboard');
  await db.query("INSERT INTO habits(habit_id,user_id,habit_name,difficulty_score) VALUES (11,1,'Owner habit',3),(22,2,'Private habit',2)");
  await db.query("INSERT INTO habit_logs(habit_id,date,completed_status) VALUES (11,'2024-01-01',true),(22,'2024-01-01',true)");
  await db.query("INSERT INTO budgets(user_id,total_budget,month,year) VALUES (1,100,1,2024),(2,200,1,2024)");
  await db.query("INSERT INTO savings_goals(user_id,name,saved_amount,target_amount) VALUES (1,'Owner goal',5,50),(2,'Private goal',9,90)");
  await db.query("INSERT INTO expenses(user_id,date,description,amount) VALUES (1,'2024-01-01',$1,12.30),(2,'2024-01-01','Private expense',999)",["=SUM(1,2),\"quote\"\nUnicode ☃"]);
  const expenses=await get('/profile/export/expenses',cookie),csv=await expenses.text();assert.equal(expenses.status,200);assert.match(expenses.headers.get('content-disposition'),/habitcents-expenses.csv/);assert.match(expenses.headers.get('cache-control'),/no-store/);assert.match(csv,/"'=SUM\(1,2\),""quote""\nUnicode ☃"/);assert.doesNotMatch(csv,/private/);
  const habitCsvResponse=await get('/profile/export/habits',cookie),habitCsv=await habitCsvResponse.text();assert.equal(habitCsvResponse.status,200);assert.match(habitCsv,/Owner habit/);assert.doesNotMatch(habitCsv,/Private/);
  const jsonResponse=await get('/profile/export/json',cookie),json=await jsonResponse.json();assert.equal(jsonResponse.status,200,JSON.stringify(json));assert.equal(json.schemaVersion,1);assert.equal(json.datasets.expenses.length,1);assert.equal(json.datasets.expenses[0].amount,'12.30');assert.equal(json.datasets.habits.length,1);assert.equal(json.datasets.habitHistory.length,1);assert.equal(json.datasets.budgets.length,1);assert.equal(json.datasets.savingsGoals.length,1);assert.equal(JSON.stringify(json).includes('password'),false);assert.ok(json.warnings.some(x=>x.includes('Recurring-expense')));
  assert.equal((await get('/profile/export/json')).status,302);
 });
});

test('all migrated routes execute PostgreSQL SQL and preserve frontend contracts', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.equal(/CURDATE\(|MONTH\(date\)|VALUES \(\?/.test(source), false, 'MySQL SQL must be adapted');
  await withApp(async ({ db, post, get }) => {
    await post('/signup', { name: 'Owner', email: 'owner@test', password: 'secret' });
    const login = await post('/login', { email: 'owner@test', password: 'secret' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await get('/get-habits')).status, 302);
    assert.equal((await get('/dashboard', cookie)).status, 200);
    assert.equal((await get('/profile')).status,302);
    const profile=await get('/profile',cookie);assert.equal(profile.status,200);const html=await profile.text();assert.match(html,/<h1>Owner<\/h1>/);assert.match(html,/href="\/logout"/);
    assert.equal((html.match(/aria-current="page"/g)||[]).length,1);assert.match(html,/aria-current="page"[^>]*href="\/profile"/);
    await post('/add-habit', { name: "Walk ' safely", difficulty: '5', category: 'physical' }, cookie);
    const habits = await (await get('/get-habits', cookie)).json();
    assert.equal(habits.length, 1);
    assert.equal(habits[0].completed, 0);
    const habit_id = habits[0].habit_id;
    assert.equal(await (await post('/toggle-habit', { habit_id }, cookie)).text(), 'checked');
    assert.deepEqual(await (await get('/streak', cookie)).json(), { streak: 5 });
    assert.equal((await (await get('/get-leaderboard', cookie)).json()).leaderboard[0].streak_points, 5);
    assert.equal(await (await post('/toggle-habit', { habit_id }, cookie)).text(), 'unchecked');
    assert.equal((await (await get('/get-leaderboard', cookie)).json()).leaderboard[0].streak_points, 0);
    assert.deepEqual(await (await get('/remaining-budget', cookie)).json(), { remaining: 0, totalBudget: 0, hasBudget: false });
    await post('/set-budget', { amount: 1000 }, cookie);
    await post('/add-expense', { name: "Coffee ' safely", amount: '120.25' }, cookie);
    const expense = (await (await get('/get-expenses', cookie)).json())[0];
    assert.equal(expense.description, "Coffee ' safely");
    assert.match(String(expense.date), /^\d{4}-\d{2}-\d{2}$/);
    await post('/set-budget', { amount: 1100 }, cookie);
    assert.equal((await db.query('SELECT * FROM expenses')).rows.length, 1, 'budget update must retain expenses');
    assert.equal(Number((await (await get('/get-budget', cookie)).json()).total_budget), 1100);
    assert.equal((await (await get('/remaining-budget', cookie)).json()).remaining, 979.75);
    const summary = await (await get('/dashboard-data', cookie)).json();
    assert.equal(summary.totalHabits, 1);
    assert.equal(summary.completed, 0);
    assert.equal(summary.remaining, 979.75);
    await post('/add-goal', { name: 'Bike', target: 500 }, cookie);
    const goal = (await (await get('/savings-data', cookie)).json())[0];
    await post('/add-saving', { goal_id: goal.goal_id, amount: 25 }, cookie);
    assert.equal(Number((await (await get('/savings-data', cookie)).json())[0].saved_amount), 25);
    await post('/delete-expense', { expense_id: expense.expense_id }, cookie);
    assert.equal((await (await get('/get-expenses', cookie)).json()).length, 0);
    assert.deepEqual(await (await post('/delete-habit', { habit_id }, cookie)).json(), { success: true });
    assert.equal((await (await get('/get-habits', cookie)).json()).length, 0);
    assert.equal((await get('/logout', cookie)).status, 302);
    assert.equal((await get('/dashboard', cookie)).status, 302);
  });
});

test('habit ownership blocks cross-user writes and invalid IDs without touching logs', async () => {
  await withApp(async ({ db, post }) => {
    await post('/signup', { name: 'A', email: 'a@test', password: 'secret' });
    await post('/signup', { name: 'B', email: 'b@test', password: 'secret' });
    const cookieA = (await post('/login', { email: 'a@test', password: 'secret' })).headers.get('set-cookie').split(';')[0];
    const cookieB = (await post('/login', { email: 'b@test', password: 'secret' })).headers.get('set-cookie').split(';')[0];
    await post('/add-habit', { name: 'Private habit', difficulty: 7 }, cookieA);
    const habit_id = (await db.query('SELECT habit_id FROM habits')).rows[0].habit_id;
    await post('/toggle-habit', { habit_id }, cookieA);
    for (const route of ['/toggle-habit', '/delete-habit']) {
      assert.equal((await post(route, { habit_id }, cookieB)).status, 404);
      assert.equal((await post(route, { habit_id: "1; DROP TABLE users" }, cookieA)).status, 400);
      assert.equal((await post(route, {}, cookieA)).status, 400);
    }
    assert.equal((await db.query('SELECT * FROM habit_logs')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM habits')).rows.length, 1);
    assert.equal((await post('/delete-habit', { habit_id }, cookieA)).status, 200);
    assert.equal((await db.query('SELECT * FROM habit_logs')).rows.length, 0);
  });
});

test('authentication handles duplicates, oversized passwords, injection text and database failures safely', async () => {
  await withApp(async ({ post }) => {
    await post('/signup', { name: 'A', email: 'a@test', password: 'secret' });
    assert.match((await post('/signup', { name: 'A', email: 'a@test', password: 'secret' })).headers.get('location'), /already/);
    assert.match((await post('/signup', { name: 'A', email: 'large@test', password: 'é'.repeat(37) })).headers.get('location'), /Invalid/);
    assert.notEqual((await post('/login', { email: "' OR 1=1 --", password: 'secret' })).headers.get('location'), '/dashboard');
  });
  const { createApp } = require('../server');
  const server = createApp({ db: { query: async () => { throw new Error('private SQL/password details'); } }, sessionSecret: 'test-secret' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@test', password: 'secret' }) });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Database error' });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('signup hashes passwords, login verifies hashes, and legacy plaintext is rejected', async () => {
  assert.match(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), /function createApp/);
  const { createApp } = require('../server');
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, '../schema.postgres.sql'), 'utf8'));
  const server = createApp({ db, sessionSecret: 'local-test-secret' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, cookie) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body), redirect: 'manual' });
  try {
    const signup = await post('/signup', { name: 'A', email: 'a@test', password: 'safe password' });
    assert.match(signup.headers.get('location'), /Account/);
    const user = (await db.query('SELECT * FROM users')).rows[0];
    assert.notEqual(user.password, 'safe password');
    assert.ok(await bcrypt.compare('safe password', user.password));
    const login = await post('/login', { email: 'a@test', password: 'safe password' });
    assert.equal(login.headers.get('location'), '/dashboard');
    assert.notEqual((await post('/login', { email: 'a@test', password: 'wrong' })).headers.get('location'), '/dashboard');
    await db.query('UPDATE users SET password=$1', ['safe password']);
    assert.notEqual((await post('/login', { email: 'a@test', password: 'safe password' })).headers.get('location'), '/dashboard');
  } finally { await new Promise(resolve => server.close(resolve)); await db.close(); }
});

test('dashboard date matches database day and JSON expense requests report rejection or saved precision', async () => {
 await withApp(async ({db,post,get})=>{
  await post('/signup',{name:'UI',email:'ui@test',password:'secret'});
  const cookie=(await post('/login',{email:'ui@test',password:'secret'})).headers.get('set-cookie').split(';')[0];
  const summary=await (await get('/dashboard-data',cookie)).json();
  assert.equal(summary.currentDate,(await db.query('SELECT CURRENT_DATE::text AS today')).rows[0].today);
  assert.equal(summary.hasBudget,false);
  assert.equal((await post('/add-expense',{name:'Tea',amount:'12.35'},cookie)).status,409);
  await post('/set-budget',{amount:100},cookie);
  assert.equal((await post('/add-expense',{name:' ',amount:'12.35'},cookie)).status,400);
  const saved=await post('/add-expense',{name:'Tea',amount:'12.35'},cookie);
  assert.equal(saved.status,201);assert.equal((await saved.json()).success,true);
  assert.equal(Number((await (await get('/get-expenses',cookie)).json())[0].amount),12.35);
 });
});

test('expense dates use the owned budget for that month and strictly validate leap days',async()=>{
 await withApp(async({db,post,get})=>{
  await post('/signup',{name:'Dated',email:'dated@test',password:'secret'});
  await post('/signup',{name:'Other',email:'other-date@test',password:'secret'});
  const cookie=(await post('/login',{email:'dated@test',password:'secret'})).headers.get('set-cookie').split(';')[0];
  const users=(await db.query('SELECT user_id,email FROM users')).rows;
  const owner=users.find(u=>u.email==='dated@test').user_id,other=users.find(u=>u.email==='other-date@test').user_id;
  await db.query('INSERT INTO budgets(user_id,total_budget,month,year) VALUES ($1,100,2,2024),($2,500,3,2024)',[owner,other]);
  for(const date of ['2023-02-29','2024-02-30','2024-2-29','2024-02-29T00:00:00Z',null,'',"2024-02-29';--"]){assert.equal((await post('/add-expense',{name:'Tea',amount:'12.35',date},cookie)).status,400);}
  assert.equal((await post('/add-expense',{name:'Not my budget',amount:'12.35',date:'2024-03-01'},cookie)).status,409);
  const saved=await post('/add-expense',{name:'Leap day tea',amount:'12.35',date:'2024-02-29'},cookie);
  assert.equal(saved.status,201);assert.equal((await saved.json()).date,'2024-02-29');
  const rows=(await db.query('SELECT e.user_id,e.date::text AS date,e.amount,b.month,b.year FROM expenses e JOIN budgets b USING(budget_id)')).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].user_id,owner);assert.equal(rows[0].date,'2024-02-29');assert.equal(rows[0].month,2);assert.equal(rows[0].year,2024);assert.equal(Number(rows[0].amount),12.35);
  const history=await(await get('/dashboard-history?date=2024-02-29&section=expenses',cookie)).json();assert.equal(history.expenses.length,1);
 });
});

test('production summary exposes boolean budget existence for absent, zero, and positive budgets',async()=>{
 await withApp(async({db,post,get})=>{
  await post('/signup',{name:'Summary',email:'contract@test',password:'secret'});
  const cookie=(await post('/login',{email:'contract@test',password:'secret'})).headers.get('set-cookie').split(';')[0];
  for(const amount of [null,0,30000]){
   if(amount!==null)await post('/set-budget',{amount},cookie);
   const summary=await(await get('/dashboard-data',cookie)).json();
   const record=await(await get('/get-budget',cookie)).json();
   assert.equal(summary.hasBudget,amount!==null);assert.equal(summary.hasBudget,Boolean(record.budget_id));
   assert.equal(typeof summary.hasBudget,'boolean');assert.equal(summary.totalBudget,amount??0);
   assert.equal(summary.currentDate,(await db.query('SELECT CURRENT_DATE::text AS today')).rows[0].today);
  }
 });
});

test('date-filtered history is read-only, strictly validated, and isolated by owner',async()=>{
 await withApp(async({db,post,get})=>{
  for(const email of ['history-a@test','history-b@test'])await post('/signup',{name:email,email,password:'secret'});
  const cookie=(await post('/login',{email:'history-a@test',password:'secret'})).headers.get('set-cookie').split(';')[0];
  await db.query("INSERT INTO habits (user_id,habit_name,difficulty_score) VALUES (1,'Recorded walk',3),(2,'Private walk',2)");
  await db.query("INSERT INTO habit_logs(habit_id,date,completed_status) VALUES (1,'2024-02-29',true),(1,'2024-02-28',false),(2,'2024-02-29',true)");
  await db.query("INSERT INTO expenses(user_id,date,description,amount) VALUES (1,'2024-02-29','Tea',12.35),(2,'2024-02-29','Private',800)");
  assert.equal((await get('/dashboard-history?date=2024-02-29&section=habits')).status,302);
  for(const date of ['2023-02-29','2024-02-30','2024-13-01','2024-2-01',"2024-01-01' OR 1=1 --"]){assert.equal((await get('/dashboard-history?section=habits&date='+encodeURIComponent(date),cookie)).status,400);}
  assert.equal((await get('/dashboard-history?date=2024-02-29&section=other',cookie)).status,400);
  const habits=await(await get('/dashboard-history?date=2024-02-29&section=habits',cookie)).json();
  assert.equal(habits.date,'2024-02-29');assert.equal(habits.completions.length,1);assert.equal(habits.completions[0].habit_name,'Recorded walk');assert.equal(habits.totalHabits,undefined);
  const expenses=await(await get('/dashboard-history?date=2024-02-29&section=expenses',cookie)).json();assert.equal(expenses.expenses.length,1);assert.equal(Number(expenses.spent),12.35);
  const empty=await(await get('/dashboard-history?date=2024-02-28&section=habits',cookie)).json();assert.deepEqual(empty.completions,[]);
  const month=await(await get('/dashboard-activity?month=2024-02',cookie)).json();assert.equal(month.month,'2024-02');assert.deepEqual(month.days,[{date:'2024-02-29',completions:1,expenses:1}]);
  assert.equal((await get('/dashboard-activity?month=2024-13',cookie)).status,400);
  assert.equal((await db.query('SELECT * FROM habit_logs')).rows.length,3);
 });
});

test('dashboard breakdown persists categories, reconciles precise totals and isolates users',async()=>{
 await withApp(async({db,post,get})=>{
  await post('/signup',{name:'A',email:'categories-a@test',password:'secret'});await post('/signup',{name:'B',email:'categories-b@test',password:'secret'});
  const cookie=(await post('/login',{email:'categories-a@test',password:'secret'})).headers.get('set-cookie').split(';')[0];
  await post('/set-budget',{amount:1000},cookie);
  assert.equal((await post('/add-expense',{name:'A ride',amount:'0.10',category:'transport'},cookie)).status,201);
  assert.equal((await post('/add-expense',{name:'A snack',amount:'0.20',category:'food'},cookie)).status,201);
  await post('/add-expense',{name:'Old unclassified',amount:'1.25'},cookie);
  assert.equal((await post('/add-expense',{name:'Invalid',amount:1,category:'invented'},cookie)).status,400);
  const today=(await db.query('SELECT CURRENT_DATE::text AS date')).rows[0].date;
  await db.query('INSERT INTO expenses(user_id,date,description,amount) VALUES (2,$1,$2,999)',[today,'Private']);
  await db.query("INSERT INTO expenses(user_id,date,description,amount,category) VALUES (1,'2024-02-29','Leap fare',4.56,'transport')");
  const response=await get('/dashboard-breakdown?month='+today.slice(0,7),cookie);assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.total,'1.55');assert.equal(data.range.startDate,today.slice(0,7)+'-01');
  assert.deepEqual(Object.fromEntries(data.categories.map(c=>[c.category,c.amount])),{food:'0.20',transport:'0.10',uncategorized:'1.25'});
  const entries=await(await get('/get-expenses',cookie)).json();assert.equal(entries.find(e=>e.description==='A ride').category,'transport');assert.equal(entries.find(e=>e.description==='Old unclassified').category,'uncategorized');
  const day=await(await get('/dashboard-breakdown?date=2024-02-29',cookie)).json();assert.equal(day.total,'4.56');assert.equal(day.range.endDate,'2024-02-29');
  const empty=await(await get('/dashboard-breakdown?date=2024-03-01',cookie)).json();assert.equal(empty.total,'0.00');assert.deepEqual(empty.categories,[]);
  for(const query of ['date=2023-02-29','month=2024-13','date=2024-02-29&month=2024-02'])assert.equal((await get('/dashboard-breakdown?'+query,cookie)).status,400);
  assert.equal((await get('/dashboard-breakdown?date='+today)).status,302);
 });
});

test('habit continuity is bounded, owned and truthful about absent scheduling metadata',async()=>{
 await withApp(async({db,post,get})=>{
  await post('/signup',{name:'A',email:'continuity-a@test',password:'secret'});await post('/signup',{name:'B',email:'continuity-b@test',password:'secret'});
  const cookie=(await post('/login',{email:'continuity-a@test',password:'secret'})).headers.get('set-cookie').split(';')[0];
  await db.query("INSERT INTO habits(habit_id,user_id,habit_name,difficulty_score) VALUES (91,1,'Walk',5),(92,2,'Private',5)");
  await db.query("INSERT INTO habit_logs(habit_id,date,completed_status) VALUES (91,'2024-02-29',true),(91,'2024-02-28',false),(91,'2020-01-01',true),(92,'2024-02-29',true)");
  const response=await get('/dashboard-continuity?habitId=91&end=2024-03-01',cookie);assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.endDate,'2024-03-01');assert.equal(data.startDate,'2023-09-04');assert.deepEqual(data.completedDates,['2024-02-29']);assert.equal(data.habit.createdDate,null);assert.equal(data.streak,null);
  const future=(await db.query("SELECT (CURRENT_DATE+1)::text AS date")).rows[0].date;
  await db.query("INSERT INTO habit_logs(habit_id,date,completed_status) VALUES (91,$1,true)",[future]);
  const futureData=await(await get('/dashboard-continuity?habitId=91&end='+future,cookie)).json();assert.equal(futureData.completedDates.includes(future),false);
  const empty=await(await get('/dashboard-continuity?habitId=91&end=2023-01-01',cookie)).json();assert.deepEqual(empty.completedDates,[]);
  assert.equal((await get('/dashboard-continuity?habitId=92&end=2024-03-01',cookie)).status,404);
  for(const query of ['habitId=91&end=2023-02-29','habitId=1%3BDROP&end=2024-03-01'])assert.equal((await get('/dashboard-continuity?'+query,cookie)).status,400);
 });
});

test('unmigrated expense storage stays readable and refuses category loss on new writes',async()=>{
 await withApp(async({db,post,get})=>{
  await db.exec('ALTER TABLE expenses DROP COLUMN category');
  await post('/signup',{name:'Legacy',email:'legacy-categories@test',password:'secret'});const cookie=(await post('/login',{email:'legacy-categories@test',password:'secret'})).headers.get('set-cookie').split(';')[0];
  await post('/set-budget',{amount:100},cookie);assert.equal((await post('/add-expense',{name:'Old',amount:'1.25'},cookie)).status,201);
  const rejected=await post('/add-expense',{name:'Classified',amount:'2.50',category:'food'},cookie);assert.equal(rejected.status,503);assert.match((await rejected.json()).error,/migration/);
  const rows=await(await get('/get-expenses',cookie)).json();assert.equal(rows.length,1);assert.equal(rows[0].category,'uncategorized');
  const day=(await db.query('SELECT CURRENT_DATE::text AS date')).rows[0].date;const data=await(await get('/dashboard-breakdown?date='+day,cookie)).json();assert.equal(data.total,'1.25');assert.equal(data.categories[0].category,'uncategorized');
 });
});
test('universal streak storage is forward-only, atomic with current habit changes, and user isolated',async()=>{
 await withApp(async({db,post,get})=>{
  await post('/signup',{name:'A',email:'universal-a@test',password:'secret'});await post('/signup',{name:'B',email:'universal-b@test',password:'secret'});
  const cookie=(await post('/login',{email:'universal-a@test',password:'secret'})).headers.get('set-cookie').split(';')[0];
  const other=(await post('/login',{email:'universal-b@test',password:'secret'})).headers.get('set-cookie').split(';')[0];
  const read=async(date)=>{const r=await get('/universal-streak'+(date?'?date='+date:''),cookie);assert.equal(r.status,200);return r.json();};
  assert.equal((await read()).count,null);assert.equal((await get('/universal-streak')).status,302);
  await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/002-universal-streak-draft.sql'),'utf8'));
  await db.query("SET TIME ZONE 'UTC'");
  const clock=(await db.query("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date::text AS today,((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date-1)::text AS yesterday,((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date-2)::text AS start")).rows[0];
  await post('/add-habit',{name:'One',difficulty:2},cookie);await post('/add-habit',{name:'Two',difficulty:9},cookie);
  const habits=await(await get('/get-habits',cookie)).json();
  await db.query("INSERT INTO universal_streak_enrollments(user_id,starts_on,empty_day_policy,day_change_policy,time_zone,policies_confirmed,capture_version) VALUES (1,$1,'reset','apply','Asia/Dhaka',true,1)",[clock.start]);
  assert.equal((await read()).count,null,'no initial snapshot means no invented past streak');
  for(const day of [clock.start,clock.yesterday]){
   await db.query('INSERT INTO universal_streak_days(user_id,day,requirements_complete) VALUES (1,$1,true)',[day]);
   for(const habit of habits)await db.query('INSERT INTO universal_streak_requirements(user_id,day,habit_id,completed) VALUES (1,$1,$2,true)',[day,habit.habit_id]);
  }
  assert.equal((await read()).count,2,'incomplete current day preserves prior successes');
  for(const habit of habits)await post('/toggle-habit',{habit_id:habit.habit_id},cookie);
  assert.equal((await read()).count,3);assert.equal((await read()).count,3,'duplicate reads award no additional days');
  await post('/toggle-habit',{habit_id:habits[0].habit_id},cookie);assert.equal((await read()).count,2);
  await post('/toggle-habit',{habit_id:habits[0].habit_id},cookie);assert.equal((await read()).count,3);
  await post('/add-habit',{name:'Added today',difficulty:1},cookie);assert.equal((await read()).count,2,'new requirement applies today');
  const added=(await(await get('/get-habits',cookie)).json()).find(h=>h.habit_name==='Added today');
  await post('/delete-habit',{habit_id:added.habit_id},cookie);assert.equal((await read()).count,3,'removing current requirement applies today');
  await post('/delete-habit',{habit_id:habits[0].habit_id},cookie);assert.equal((await read(clock.yesterday)).count,2,'deletion does not rewrite closed snapshots');
  assert.equal((await(await get('/universal-streak?user_id=1',other)).json()).count,null,'owner comes only from session');
  assert.equal((await get('/universal-streak?date=2023-02-29',cookie)).status,400);
  await db.query('DELETE FROM universal_streak_days WHERE user_id=1 AND day=$1',[clock.yesterday]);
  assert.equal((await read()).count,1,'closed day without captured activity carries known requirements with zero completions');
  await db.query("SET TIME ZONE 'Pacific/Kiritimati'");assert.equal((await read()).count,1,'session zone cannot redefine tracking days');
  await db.query("UPDATE universal_streak_enrollments SET time_zone='UTC' WHERE user_id=1");assert.equal((await read()).reason,'timezone-review-required');
 });
});
