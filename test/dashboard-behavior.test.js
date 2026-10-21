const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('public/js/dashboard.js','utf8').replace('./expense-icons.js', 'data:text/javascript;base64,'+Buffer.from(fs.readFileSync('public/js/expense-icons.js','utf8')).toString('base64'));
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
class Element {
  constructor() { this.children=[]; this.style={setProperty(key,value){this[key]=value;}}; this.dataset={}; this.attributes={}; this.listeners={}; this.classList={toggle(){}}; this.parentElement=this; this.textContent=''; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this._text='';this.children=items; }
  get textContent() { return this._text+this.children.map(item=>item.textContent).join(''); }
  set textContent(value) { this._text=String(value);this.children=[]; }
  setAttribute(k,v) { this.attributes[k]=v; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(k,v) { this.listeners[k]=v; }
  closest() { return this; }
  reset() { this.wasReset=true; }
  reportValidity() { return true; }
}
function setup(responses,{withoutContinuity=false}={}) {
  const elements = new Map();
  global.document = {querySelector: key => { if(withoutContinuity&&key.startsWith('#continuity'))return null; if(!elements.has(key)) elements.set(key,new Element()); return elements.get(key); },createElement:()=>new Element(),createElementNS:()=>new Element()};
  global.fetch=async url=> {const data=responses[url]; if(data instanceof Error) throw data; return {ok:true,redirected:false,json:async()=>data};};
  return key=>document.querySelector(key);
}
const fixture = {'/savings-data':[],'/dashboard-data':{currentDate:'2026-01-01',hasBudget:true,totalHabits:1,completed:0,totalBudget:100,remaining:87.65},'/get-habits':[{habit_id:1,habit_name:'<unsafe>',completed:false}],'/get-expenses':[{description:'Tea',date:'2026-01-01',amount:12.35}]};
test('week strip crosses years using local calendar arithmetic',async()=>{
 const {getWeekDays}=await modulePromise;
 const days=getWeekDays('2026-01-01');
 assert.equal(days.length,7); assert.equal(days[0].iso,'2025-12-29'); assert.equal(days[6].iso,'2026-01-04'); assert.equal(days.filter(d=>d.today)[0].iso,'2026-01-01');
 assert.equal(getWeekDays('2024-03-01')[3].iso,'2024-02-29');
});
test('dashboard retains precision, safe text and a visible local week',async()=>{
 const el=setup(fixture); await (await modulePromise).initDashboard();
 assert.match(el('#budget-spent').textContent,/12\.35/);
 assert.equal(el('#today-habits').children[0].children[0].children[1].textContent,'<unsafe>');
 assert.equal(el('#week-strip').children.length,7);
});
test('failed loads settle with visible recoverable errors',async()=>{
 const el=setup({'/dashboard-data':new Error('offline'),'/get-habits':new Error('offline'),'/get-expenses':new Error('offline')});
 await (await modulePromise).initDashboard();
 assert.match(el('#today-habits').children[0].textContent,/could not|unable/i);
 assert.match(el('#recent-expenses').children[0].textContent,/could not|unable/i);
 assert.match(el('#dashboard-status').textContent,/retry|try again/i);
});
test('failed check-in rolls back and enables retry; successful uncheck persists',async()=>{
 const el=setup(fixture); await (await modulePromise).initDashboard();
 const box=el('#today-habits').children[0].children[0].children[0];box.checked=true;
 global.fetch=async()=>({ok:false});
 await el('#today-habits').listeners.change({target:box});
 assert.equal(box.checked,false);assert.equal(box.disabled,false);assert.match(el('#habit-status').textContent,/could not/i);
 global.fetch=async()=>({ok:true}); box.checked=false;
 await el('#today-habits').listeners.change({target:box});
 assert.equal(box.checked,false);assert.equal(box.disabled,false);
});
test('expense rejection is visible, retains values and blocks concurrent submissions',async()=>{
 const el=setup(fixture); await (await modulePromise).initDashboard();
 el('#expense-name').value='Tea';el('#expense-amount').value='12.35';
 let resolve;let count=0;global.fetch=()=>{count++;return new Promise(r=>resolve=r)};
 const event={preventDefault(){}};
 const pending=el('.expense-form').listeners.submit(event);
 await el('.expense-form').listeners.submit(event);assert.equal(count,1);
 resolve({ok:false,json:async()=>({error:'Set a monthly budget first.'})});await pending;
 assert.match(el('#expense-status').textContent,/budget/i);assert.equal(el('.expense-form').wasReset,undefined);assert.equal(el('.primary-action').disabled,false);
});

test('expense entry submits the selected calendar date and preserves it on rejection',async()=>{
 const el=setup(fixture);await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 el('#expense-name').value='Earlier tea';el('#expense-amount').value='12.35';el('#expense-date').value='2023-02-29';
 const normal=global.fetch,sent=[];let accepted=false;
 global.fetch=async(url,options)=>{if(url!=='/add-expense')return normal(url,options);sent.push(JSON.parse(options.body));return {ok:accepted,json:async()=>accepted?{success:true}:{error:'Set a budget for the selected month.'}};};
 await el('.expense-form').listeners.submit({preventDefault(){}});assert.equal(sent.length,0);assert.match(el('#expense-status').textContent,/valid expense date/);
 el('#expense-date').value='2024-02-29';await el('.expense-form').listeners.submit({preventDefault(){}});
 assert.equal(sent[0].date,'2024-02-29');assert.equal(el('#expense-date').value,'2024-02-29');assert.match(el('#expense-status').textContent,/selected month/);
 accepted=true;await el('.expense-form').listeners.submit({preventDefault(){}});assert.equal(el('#expense-date').value,'2026-01-01');
});

test('empty account and unset budget are explicit, and expense validation avoids sending requests',async()=>{
 const el=setup({'/dashboard-data':{currentDate:'2026-01-01',hasBudget:false,totalHabits:0,completed:0,totalBudget:0,remaining:-12.35},'/get-habits':[],'/get-expenses':[]});
 await (await modulePromise).initDashboard();
 assert.equal(el('#dashboard-budget').textContent,'Not set');assert.match(el('#budget-spent').textContent,/12\.35/);
 assert.match(el('#budget-warning').textContent,/Set a budget/);assert.match(el('#today-habits').children[0].textContent,/No habits/);
 let requests=0;global.fetch=async()=>{requests++};el('#expense-name').value=' ';el('#expense-amount').value='5';
 await el('.expense-form').listeners.submit({preventDefault(){}});assert.equal(requests,0);assert.match(el('#expense-status').textContent,/description/);
 el('#expense-name').value='Tea';el('#expense-amount').value='-1';
 await el('.expense-form').listeners.submit({preventDefault(){}});assert.equal(requests,0);
});
test('budget warnings distinguish low and exceeded balances',async()=>{
 const data={...fixture['/dashboard-data'],remaining:20};let el=setup({...fixture,'/dashboard-data':data});await (await modulePromise).initDashboard();
 assert.match(el('#budget-warning').textContent,/running low/);
 data.remaining=-12.35;el=setup({...fixture,'/dashboard-data':data});await (await modulePromise).initDashboard();
 assert.match(el('#budget-warning').textContent,/Over budget.*12\.35/);
});

test('dashboard caps lists and reports the number of items available on full pages',async()=>{
 const habits=Array.from({length:9},(_,i)=>({habit_id:i+1,habit_name:'Habit '+i,completed:i<2}));
 const expenses=Array.from({length:12},(_,i)=>({description:'Expense '+i,date:'2026-01-01',amount:12.35}));
 const el=setup({...fixture,'/get-habits':habits,'/get-expenses':expenses});await (await modulePromise).initDashboard();
 assert.equal(el('#today-habits').children.length,5);assert.equal(el('#recent-expenses').children.length,8);
 assert.match(el('#habits-more').textContent,/4 more/);assert.match(el('#expenses-more').textContent,/4 more/);
 // Prioritize outstanding tasks without making a just-completed visible checkbox disappear.
 assert.equal(el('#today-habits').children[0].children[0].children[0].dataset.habitId,3);
});
test('missing or invalid summary dates keep the local calendar and honest financial metrics',async()=>{
 for(const currentDate of [undefined,null,'','wrong','2026-02-30','2026-13-01']){
  const el=setup({...fixture,'/dashboard-data':{...fixture['/dashboard-data'],currentDate}});
  await (await modulePromise).initDashboard({now:new Date(2025,11,31,23,59)});
  assert.equal(el('#week-strip').children.length,7);
  assert.equal(el('#week-strip').children.map(day=>day.children[0]).find(day=>day.attributes['aria-current']==='date').attributes['aria-label'],'Wed, 2025-12-31, today');
  assert.equal(el('#week-source').textContent,'');
  assert.match(el('#dashboard-budget').textContent,/87\.65/);
  assert.equal(el('#today-habits').children.length,1);
 }
});
test('malformed summary numbers are rejected instead of silently rendered as zero',async()=>{
 const el=setup({...fixture,'/dashboard-data':{...fixture['/dashboard-data'],remaining:'invalid'}});await (await modulePromise).initDashboard();
 assert.equal(el('#dashboard-budget').textContent,'—');assert.match(el('#dashboard-status').textContent,/remaining/);
});

test('long full names use a smaller subset rather than clipping text',async()=>{
 const habits=Array.from({length:7},(_,i)=>({habit_id:i+1,habit_name:'A'.repeat(115),completed:false}));
 const expenses=Array.from({length:7},()=>({description:'B'.repeat(115),date:'2026-01-01',amount:50}));
 const el=setup({...fixture,'/get-habits':habits,'/get-expenses':expenses});await (await modulePromise).initDashboard();
 assert.equal(el('#today-habits').children.length,2);assert.equal(el('#recent-expenses').children.length,6);
 assert.match(el('#habits-more').textContent,/5 more/);assert.equal(el('#today-habits').children[0].children[0].children[1].textContent.length,115);
});

test('calendar renders immediately before requests settle and remains on request failure',async()=>{
 const el=setup({});let reject;global.fetch=()=>new Promise((_,r)=>{reject=r});
 // All three requests share the same rejection so no pending request is abandoned.
 const rejected=new Promise((_,r)=>{reject=r});global.fetch=()=>rejected;
 const pending=(await modulePromise).initDashboard({now:new Date(2026,0,1,0,1)});
 assert.equal(el('#week-strip').children.length,7);
 assert.match(el('#header-month').textContent,/JAN/);
 reject(new Error('offline'));await pending;
 assert.equal(el('#week-strip').children.length,7);
 assert.equal(el('#dashboard-budget').textContent,'—');assert.equal(el('#budget-spent').textContent,'—');
 assert.match(el('#budget-status').textContent,/unavailable/i);
 assert.equal(el('#budget-spent').dataset.state,'unavailable');
});
test('server date does not shift the local header or week across the year boundary',async()=>{
 const el=setup(fixture);
 await (await modulePromise).initDashboard({now:new Date(2025,11,31,23,59)});
 assert.match(el('#header-month').textContent,/DEC/);
 assert.equal(el('#week-strip').children.map(day=>day.children[0]).find(day=>day.attributes['aria-current']==='date').attributes['aria-label'],'Wed, 2025-12-31, today');
 assert.equal(el('#expense-date').value,'2025-12-31');
});
test('expense date stays local when financial fields are invalid',async()=>{
 const el=setup({...fixture,'/dashboard-data':{...fixture['/dashboard-data'],remaining:'invalid'}});
 await (await modulePromise).initDashboard({now:new Date(2025,11,31)});
 assert.equal(el('#expense-date').value,'2025-12-31');assert.equal(el('#dashboard-budget').textContent,'—');
});

test('legacy summary without hasBudget verifies the actual budget record including zero budgets',async()=>{
 for(const [budget,record,expected] of [[100,{budget_id:7,total_budget:'100.00'},true],[0,{budget_id:8,total_budget:'0.00'},true],[0,{total_budget:0},false]]){
  const {hasBudget,...summary}=fixture['/dashboard-data'];summary.totalBudget=budget;summary.remaining=budget;
  const el=setup({...fixture,'/dashboard-data':summary,'/get-budget':record});await (await modulePromise).initDashboard();
  assert.equal(el('#dashboard-status').textContent,'');
  assert.equal(el('#dashboard-budget').textContent==='Not set',!expected);
 }
});
test('missing budget flag with failed or contradictory verification stays unavailable',async()=>{
 for(const record of [new Error('offline'),{budget_id:7,total_budget:999},{total_budget:0},{budget_id:'bad',total_budget:100}]){
  const {hasBudget,...summary}=fixture['/dashboard-data'];
  const el=setup({...fixture,'/dashboard-data':summary,'/get-budget':record});await (await modulePromise).initDashboard();
  assert.equal(el('#dashboard-budget').textContent,'—');assert.ok(el('#dashboard-status').textContent);assert.doesNotMatch(el('#dashboard-status').textContent,/restart/i);
 }
});
test('invalid typed budget flags are rejected rather than coerced',async()=>{
 const el=setup({...fixture,'/dashboard-data':{...fixture['/dashboard-data'],hasBudget:'false'}});await (await modulePromise).initDashboard();
 assert.equal(el('#dashboard-budget').textContent,'—');assert.doesNotMatch(el('#dashboard-status').textContent,/restart/i);
});


test('summary currency uses separate prefix and fractional parts without losing transaction precision',async()=>{
 const el=setup({...fixture,'/dashboard-data':{...fixture['/dashboard-data'],totalBudget:10000,remaining:8800}});await (await modulePromise).initDashboard();
 assert.equal(el('#dashboard-budget').textContent,'Tk 8,800');
 assert.equal(el('#dashboard-budget').children[0].className,'money-currency');
 assert.equal(el('#dashboard-budget').children[1].textContent,'8,800');
 assert.equal(el('#budget-percentage').textContent,'88% available');
 assert.match(el('#recent-expenses').textContent,/12\.35/);
 const fractional=setup(fixture);await (await modulePromise).initDashboard();
 assert.equal(fractional('#dashboard-budget').children[2].className,'money-decimals');
 assert.equal(fractional('#dashboard-budget').children[2].textContent,'.65');
});
test('expense selector defaults to the local calendar date',async()=>{
 const el=setup(fixture);await (await modulePromise).initDashboard({now:new Date(2026,0,1,23,59)});
 assert.equal(el('#week-source').textContent,'');assert.equal(el('#expense-date').value,'2026-01-01');
});
test('different server day does not overwrite the chosen expense date',async()=>{
 const el=setup(fixture);await (await modulePromise).initDashboard({now:new Date(2025,11,31,23,59)});
 assert.equal(el('#header-day').textContent,'31');
 assert.equal(el('#expense-date').value,'2025-12-31');
 el('#expense-date').value='2024-02-29';await el('#retry-dashboard').listeners.click();
 assert.equal(el('#expense-date').value,'2024-02-29');
});


test('repeated initialization does not fetch twice or bind duplicate listeners',async()=>{
 const el=setup(fixture);let requests=0;const fetcher=global.fetch;global.fetch=(...args)=>{requests++;return fetcher(...args)};
 const module=await modulePromise;await module.initDashboard({now:new Date(2026,0,1,9,3)});const count=requests;
 await module.initDashboard({now:new Date(2030,1,1)});assert.equal(requests,count);assert.equal(el('#live-clock').textContent,'09:03');
});
test('date selection is read-only and rapid switching cannot overwrite the latest day',async()=>{
 const el=setup(fixture);await (await modulePromise).initDashboard({now:new Date(2026,0,1)});
 const deferred=new Map();let writes=0;const normal=global.fetch;
 global.fetch=(url,options)=>{
  if(options?.method==='POST')writes++;
  if(url.startsWith('/dashboard-history'))return new Promise(resolve=>deferred.set(url,resolve));
  return normal(url,options);
 };
 const button=new Element();button.dataset.date='2025-12-30';
 const first=el('#week-strip').listeners.click({target:button});
 button.dataset.date='2025-12-31';const second=el('#week-strip').listeners.click({target:button});
 for(const [url,resolve] of deferred)if(url.includes('2025-12-31'))resolve({ok:true,json:async()=>url.includes('habits')?{date:'2025-12-31',completions:[{habit_name:'Latest record'}]}:{date:'2025-12-31',spent:'12.35',expenses:[]}});
 await second;
 for(const [url,resolve] of deferred)if(url.includes('2025-12-30'))resolve({ok:true,json:async()=>url.includes('habits')?{date:'2025-12-30',completions:[{habit_name:'Stale record'}]}:{date:'2025-12-30',spent:'999',expenses:[]}});
 await first;
 assert.equal(el('#history-habits').textContent,'Latest record');assert.match(el('#history-spent').textContent,/12\.35/);
 assert.equal(el('#dashboard-grid').hidden,true);assert.equal(el('#history-view').hidden,false);
 const box=new Element();box.dataset.habitId=1;box.checked=true;await el('#today-habits').listeners.change({target:box});
 await el('.expense-form').listeners.submit({preventDefault(){}});assert.equal(writes,0);
 await el('#back-to-today').listeners.click();assert.equal(el('#dashboard-grid').hidden,false);assert.equal(el('#history-view').hidden,true);assert.equal(el('#habit-progress').textContent,'0/1');
});
test('failed and empty historical sections stay independent and retryable',async()=>{
 const el=setup({...fixture,'/dashboard-history?date=2025-12-31&section=habits':new Error('offline'),'/dashboard-history?date=2025-12-31&section=expenses':{date:'2025-12-31',spent:'0.00',expenses:[]}});
 await (await modulePromise).initDashboard({now:new Date(2026,0,1)});
 const button=new Element();button.dataset.date='2025-12-31';await el('#week-strip').listeners.click({target:button});
 assert.match(el('#history-habits-status').textContent,/could not/);assert.equal(el('#retry-history-habits').hidden,false);
 assert.match(el('#history-expenses').textContent,/No expenses recorded/);assert.equal(el('#history-expenses-status').textContent,'');
 assert.equal(el('#week-strip').children.length,7);
});
test('savings empty and failed responses have distinct honest states',async()=>{
 let el=setup(fixture);await (await modulePromise).initDashboard();assert.match(el('#savings-status').textContent,/No savings goals/);assert.equal(el('#savings-goal').hidden,true);
 el=setup({...fixture,'/savings-data':new Error('offline')});await (await modulePromise).initDashboard();assert.equal(el('#savings-goal').hidden,true);assert.equal(el('#retry-savings').hidden,false);
});

test('dashboard goal dots match the goal count, select progress, and hide for a single goal',async()=>{
 const goals=[{name:'One',saved_amount:25,target_amount:100},{name:'Two',saved_amount:50,target_amount:100},{name:'Three',saved_amount:75,target_amount:100}];
 let el=setup({...fixture,'/savings-data':goals});await(await modulePromise).initDashboard();
 const dots=el('#savings-selector').children;
 assert.equal(dots.length,3);assert.equal(el('#savings-selector').hidden,false);
 dots[2].listeners.click();
 assert.equal(el('#savings-goal-name').textContent,'Three');assert.equal(el('#savings-percentage').textContent,'75%');
 assert.deepEqual(dots.map(dot=>dot.attributes['aria-pressed']),['false','false','true']);
 el=setup({...fixture,'/savings-data':goals.slice(0,1)});await(await modulePromise).initDashboard();
 assert.equal(el('#savings-selector').hidden,true);assert.equal(el('#savings-goal-name').textContent,'One');
});

test('savings selector changes the linked ring and distinguishes unavailable targets',async()=>{
 const el=setup({...fixture,'/savings-data':[{name:'Travel',saved_amount:'25',target_amount:'100'},{name:'Emergency',saved_amount:'30',target_amount:'0'}]});
 await (await modulePromise).initDashboard();
 assert.equal(el('#savings-selector').hidden,false);assert.equal(el('#savings-selector').children.length,2);
 assert.equal(el('#savings-selector').children[0].attributes['aria-pressed'],'true');
 assert.equal(el('#savings-selector').children[1].attributes['aria-label'],'Show Emergency');
 assert.equal(el('#savings-percentage').textContent,'25%');assert.equal(el('#savings-arc').style.strokeDasharray,'25 100');
 assert.equal(el('#savings-goal-name').textContent,'Travel');
 assert.match(el('#savings-link').attributes['aria-label'],/Travel.*current progress 25%/);
 el('#savings-selector').children[1].listeners.click();
 assert.equal(el('#savings-percentage').textContent,'—');assert.equal(el('#savings-progress').attributes['aria-valuenow'],undefined);
 assert.equal(el('#savings-goal-name').textContent,'Emergency');
 assert.match(el('#savings-status').textContent,/unavailable/);
});

test('week controls browse without selecting a date or requesting history and Today restores both',async()=>{
 const el=setup(fixture);let requests=[];const normal=global.fetch;global.fetch=(url,...args)=>{requests.push(url);return normal(url,...args)};
 await (await modulePromise).initDashboard({now:new Date(2026,0,1)});
 const days=()=>el('#week-strip').children.map(li=>li.children[0]);
 assert.equal(days()[0].dataset.date,'2025-12-29');
 await el('#previous-week').listeners.click();assert.equal(days()[0].dataset.date,'2025-12-22');assert.equal(days().some(d=>d.attributes['aria-current']==='date'),false);
 assert.notEqual(el('#dashboard-grid').hidden,true);assert.equal(requests.some(url=>url.startsWith('/dashboard-history')),false);
 await el('#next-week').listeners.click();assert.equal(days()[0].dataset.date,'2025-12-29');assert.equal(days().find(d=>d.dataset.date==='2026-01-01').attributes['aria-pressed'],'true');
 const day=new Element();day.dataset.date='2025-12-30';await el('#week-strip').listeners.click({target:day});
 const selectedLabel=el('#selected-date-label').textContent,count=requests.length;
 await el('#previous-week').listeners.click();assert.equal(el('#selected-date-label').textContent,selectedLabel);assert.equal(requests.length,count);assert.equal(el('#history-view').hidden,false);
 await el('#week-today').listeners.click();
 assert.equal(days()[0].dataset.date,'2025-12-29');assert.equal(el('#history-view').hidden,true);
});

function continuityFixture(habitId=1,end='2026-01-01',completedDates=[]){return {habit:{id:habitId,name:'Habit '+habitId,createdDate:null},startDate:'2025-07-07',endDate:end,currentDate:'2026-01-01',completedDates,streak:null};}
const spendingFixture=(date,amount='12.35')=>({range:{startDate:date.slice(0,7)+'-01',endDate:date},total:amount,days:[{date,amount,count:1}]});

test('spending scale adapts rounded whole-taka ticks to data and plotting height',async()=>{
 const {spendingScale}=await modulePromise;
 assert.deepEqual(spendingScale(185000).ticks,[200000,150000,100000,50000,0]);
 assert.deepEqual(spendingScale(100000,90).ticks,[120000,80000,40000,0]);
 assert.deepEqual(spendingScale(100000,180).ticks,[120000,90000,60000,30000,0]);
 for(const peak of [0,1,99,1235,185000,223175,9876543210])for(const height of [90,180]){
  const scale=spendingScale(peak,height);
  assert.ok(scale.max>=peak*1.08);assert.ok(scale.ticks.length>=4&&scale.ticks.length<=5);
  assert.equal(scale.ticks.at(-1),0);assert.equal(scale.ticks[0],scale.max);
  assert.equal(scale.step%100,0);assert.ok(scale.ticks.every(Number.isInteger));
  if(peak>=1000)assert.ok(scale.max<peak*1.6);
 }
 assert.deepEqual(spendingScale(NaN),spendingScale(0));
 assert.deepEqual(spendingScale(-100),spendingScale(0));
 const el=setup({...fixture,'/dashboard-spending?end=2026-01-01':spendingFixture('2026-01-01','1000.00')});
 await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 assert.deepEqual(el('#spending-y-axis').children.map(n=>n.textContent),['Tk 1,200','Tk 900','Tk 600','Tk 300','Tk 0']);
 assert.equal(el('#spending-bars').children[0].style.height,(100000/120000)*100+'%');
 assert.equal(el('#spending-bars').style['--spending-interval'],'25%');
});

test('adaptive chart keeps fractional transaction amounts exact for inspection',async()=>{
 const el=setup({...fixture,'/dashboard-spending?end=2026-01-01':spendingFixture('2026-01-01','2231.75')});
 await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 const bar=el('#spending-bars').children[0];
 assert.equal(bar.dataset.amount,'223175');
 assert.match(bar.title,/2,231\.75/);assert.match(bar.attributes['aria-label'],/2,231\.75/);
 assert.match(el('#spending-detail').textContent,/2,231\.75/);
 assert.equal(bar.style.height,(223175/300000)*100+'%');
});

test('spending empty and failed states stay distinct and future selection never plots future days',async()=>{
 const empty={range:{startDate:'2026-01-01',endDate:'2026-01-01'},total:'0.00',days:[]};
 const el=setup({...fixture,'/dashboard-spending?end=2026-01-01':empty});const requests=[],normal=global.fetch;global.fetch=(url,...args)=>{requests.push(url);return normal(url,...args);};
 await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 assert.equal(el('#spending-bars').children.length,1);assert.match(el('#spending-status').textContent,/No expenses recorded/);assert.match(el('#spending-inspect').textContent,/no entries recorded/);
 const day=new Element();day.dataset.date='2026-01-03';await el('#week-strip').listeners.click({target:day});
 assert.equal(el('#spending-bars').children.length,1);assert.equal(requests.includes('/dashboard-spending?end=2026-01-03'),false);
 day.dataset.date='2026-02-01';await el('#week-strip').listeners.click({target:day});assert.match(el('#spending-status').textContent,/No elapsed dates/);assert.equal(el('#spending-chart').hidden,true);
 global.fetch=async()=>({ok:false,status:503});await el('#week-today').listeners.click();
 assert.match(el('#spending-status').textContent,/unavailable/);assert.equal(el('#spending-chart').hidden,true);assert.equal(el('#retry-spending').hidden,false);
 assert.equal(el('#spending-detail').textContent,'');assert.equal(el('#spending-detail').attributes['aria-label'],undefined);assert.equal(el('#spending-inspect').disabled,true);
});

test('full-size history date inspector uses the existing read-only date browser flow',async()=>{
 const el=setup({...fixture,'/dashboard-continuity?habitId=1&end=2026-01-01':continuityFixture()});await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 el('#continuity-inspect').value='2025-12-31';await el('#continuity-open').listeners.click();
 assert.equal(el('#history-view').hidden,false);assert.equal(el('#dashboard-grid').hidden,true);assert.match(el('#selected-date-label').textContent,/December 31, 2025/);
 await el('#back-to-today').listeners.click();assert.equal(el('#history-view').hidden,true);
});
test('daily spending and continuity render real records and category labels independently',async()=>{
 const el=setup({...fixture,'/dashboard-spending?end=2026-01-01':spendingFixture('2026-01-01'),'/dashboard-continuity?habitId=1&end=2026-01-01':continuityFixture(1,'2026-01-01',['2026-01-01'])});
 await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 assert.match(el('#spending-table').textContent,/Tk 12.35/);assert.equal(el('#continuity-grid').children.length,182);
 assert.equal(el('#continuity-grid').children.filter(c=>c.dataset.state==='completed').length,1);assert.equal(el('#continuity-grid').children.filter(c=>c.dataset.state==='future').length,3);
 assert.equal(el('#recent-expenses').children[0].dataset.category,'uncategorized');assert.match(el('#recent-expenses').textContent,/Uncategorized/);
});

test('recent expenses reuse decorative SVG category tiles and retain full copy, amounts and neutral fallbacks',async()=>{
 const categories=['transport','food','subscriptions','shopping','uncategorized','unknown','toString'];
 const description='A very long description with household essentials and groceries '.repeat(3);
 const expenses=categories.map((category,i)=>({description:i===0?description:category,date:'2026-01-01',amount:99999999.99,category}));
 const el=setup({...fixture,'/get-expenses':expenses});
 await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 const rows=el('#recent-expenses').children;
 assert.equal(rows.length,7);
 const paths=[];
 rows.forEach((row,i)=>{
  const [tile,info,amount]=row.children;
  assert.equal(tile.className,'transaction-icon');
  assert.equal(tile.attributes['aria-hidden'],'true');
  assert.equal(tile.children[0].attributes.focusable,'false');
  paths.push(tile.children[0].children[0].attributes.d);
  assert.equal(info.children[0].textContent,expenses[i].description);
  assert.equal(info.children[0].title,expenses[i].description);
  assert.equal(info.children[1].textContent,'Jan 1, 2026');
  assert.match(amount.textContent,/99,999,999\.99/);
 });
 assert.equal(new Set(paths.slice(0,5)).size,5);
 assert.equal(paths[5],paths[4]);assert.equal(paths[6],paths[4]);
 assert.equal(rows[5].dataset.category,'uncategorized');
 assert.equal(rows[6].dataset.category,'uncategorized');
});
test('rapid habit selection cannot replace the latest continuity with stale data',async()=>{
 const el=setup({...fixture,'/get-habits':[{habit_id:1,habit_name:'One'},{habit_id:2,habit_name:'Two'}],'/dashboard-continuity?habitId=1&end=2026-01-01':continuityFixture()});
 await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 const pending=new Map(),normal=global.fetch;global.fetch=(url,...args)=>url.startsWith('/dashboard-continuity')?new Promise(resolve=>pending.set(url,resolve)):normal(url,...args);
 const second=el('#continuity-habit').listeners.change({target:{value:'2'}}),first=el('#continuity-habit').listeners.change({target:{value:'1'}});
 pending.get('/dashboard-continuity?habitId=1&end=2026-01-01')({ok:true,json:async()=>continuityFixture(1,'2026-01-01',['2026-01-01'])});await first;
 pending.get('/dashboard-continuity?habitId=2&end=2026-01-01')({ok:true,json:async()=>continuityFixture(2)});await second;
 assert.equal(el('#continuity-grid').children.filter(c=>c.dataset.state==='completed').length,1);
});
test('rapid historical dates discard stale breakdown totals and keep empty and failed modules honest',async()=>{
 const el=setup({...fixture,'/dashboard-continuity?habitId=1&end=2026-01-01':continuityFixture()});await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 assert.match(el('#continuity-status').textContent,/No completions/);assert.match(el('#spending-status').textContent,/unavailable/);
 const pending=new Map(),normal=global.fetch;global.fetch=(url,...args)=>{
  if(url.startsWith('/dashboard-spending?end='))return new Promise(resolve=>pending.set(url,resolve));
  if(url.startsWith('/dashboard-history')){const params=new URLSearchParams(url.split('?')[1]);return Promise.resolve({ok:true,json:async()=>({date:params.get('date'),spent:'0.00',expenses:[],completions:[]})});}
  return normal(url,...args);
 };
 const day=new Element();day.dataset.date='2025-12-30';const first=el('#week-strip').listeners.click({target:day});day.dataset.date='2025-12-31';const latest=el('#week-strip').listeners.click({target:day});
 pending.get('/dashboard-spending?end=2025-12-31')({ok:true,json:async()=>spendingFixture('2025-12-31')});await latest;
 pending.get('/dashboard-spending?end=2025-12-30')({ok:true,json:async()=>spendingFixture('2025-12-30','999.00')});await first;
 assert.match(el('#spending-range').textContent,/Dec 31, 2025/);assert.match(el('#spending-table').textContent,/12.35/);assert.doesNotMatch(el('#spending-table').textContent,/999/);
 assert.match(el('#continuity-status').textContent,/unavailable/);assert.equal(el('#continuity-grid').children.length,182);
});

test('both continuity grids exist before habits resolve and survive an empty account',async()=>{
 const el=setup({...fixture,'/get-habits':[]});const normal=global.fetch,pending=[];
 global.fetch=(url,...args)=>url==='/get-habits'?new Promise(resolve=>pending.push(resolve)):normal(url,...args);
 const initialization=(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 for(const suffix of ['', '-2']){assert.equal(el('#continuity-grid'+suffix).children.length,182);assert.match(el('#continuity-grid'+suffix).children.find(c=>c.dataset.date==='2026-01-01').attributes['aria-label'],/Jan 1, 2026.*loading/i);}
 for(const resolve of pending)resolve({ok:true,json:async()=>[]});await initialization;
 for(const suffix of ['', '-2']){assert.equal(el('#continuity-grid'+suffix).children.length,182);assert.match(el('#continuity-status'+suffix).textContent,/No habits/);assert.equal(el('#continuity-add'+suffix).hidden,false);assert.equal(el('#continuity-grid'+suffix).children.filter(c=>c.dataset.state==='completed').length,0);}
});
test('two existing habits with empty history keep neutral grids and independent names',async()=>{
 const el=setup({...fixture,'/get-habits':[{habit_id:1,habit_name:'Walk'},{habit_id:2,habit_name:'Read'}],'/dashboard-continuity?habitId=1&end=2026-01-01':continuityFixture(),'/dashboard-continuity?habitId=2&end=2026-01-01':continuityFixture(2)});
 await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 for(const suffix of ['', '-2']){assert.equal(el('#continuity-grid'+suffix).children.length,182);assert.match(el('#continuity-status'+suffix).textContent,/No completions recorded/);assert.equal(el('#continuity-grid'+suffix).children.filter(c=>c.dataset.state==='completed').length,0);assert.ok(el('#continuity-grid'+suffix).children.some(c=>c.dataset.state==='unrecorded'));}
 assert.equal(el('#continuity-habit').value,'1');assert.equal(el('#continuity-habit-2').value,'2');
 assert.equal(el('#continuity-name').textContent,'Walk');assert.equal(el('#continuity-name-2').textContent,'Read');
 assert.equal(el('#continuity-inspect').children.length,182);assert.match(el('#continuity-inspect').children.find(o=>o.value==='2026-01-01').textContent,/not a confirmed miss/);
});
test('failed history retains unknown dates while the other card fills only recorded cells',async()=>{
 const responses={...fixture,'/get-habits':[{habit_id:1,habit_name:'Walk'},{habit_id:2,habit_name:'Read'}],'/dashboard-continuity?habitId=1&end=2026-01-01':continuityFixture(1,'2026-01-01',['2026-01-01']),'/dashboard-continuity?habitId=2&end=2026-01-01':new Error('offline')};const el=setup(responses);
 await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 assert.equal(el('#continuity-grid').children.filter(c=>c.dataset.state==='completed').length,1);assert.equal(el('#continuity-grid-2').children.length,182);assert.match(el('#continuity-status-2').textContent,/unavailable/);assert.equal(el('#retry-continuity-2').hidden,false);
 assert.match(el('#continuity-grid-2').children.find(c=>c.dataset.date==='2025-12-31').attributes['aria-label'],/unavailable.*not a confirmed miss/i);
 responses['/dashboard-continuity?habitId=2&end=2026-01-01']=continuityFixture(2,'2026-01-01',['2025-12-31']);await el('#retry-continuity-2').listeners.click();
 assert.equal(el('#continuity-grid-2').children.filter(c=>c.dataset.state==='completed').length,1);assert.equal(el('#continuity-grid').children.filter(c=>c.dataset.state==='completed').length,1);
});

test('known creation dates remain distinct when a subsequent history request fails',async()=>{
 const data=continuityFixture(1);data.habit.createdDate='2025-12-25';
 const responses={...fixture,'/dashboard-continuity?habitId=1&end=2026-01-01':data},el=setup(responses);
 await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 assert.equal(el('#continuity-grid').children.find(c=>c.dataset.date==='2025-12-24').dataset.state,'before-creation');
 responses['/dashboard-continuity?habitId=1&end=2026-01-01']=new Error('offline');await el('#retry-continuity').listeners.click();
 assert.equal(el('#continuity-grid').children.find(c=>c.dataset.date==='2025-12-24').dataset.state,'before-creation');assert.equal(el('#continuity-grid').children.find(c=>c.dataset.date==='2025-12-31').dataset.state,'unknown');assert.equal(el('#continuity-grid').children.find(c=>c.dataset.date==='2026-01-02').dataset.state,'future');
});
test('the second card also rejects stale habit responses',async()=>{
 const el=setup({...fixture,'/get-habits':[{habit_id:1,habit_name:'One'},{habit_id:2,habit_name:'Two'}],'/dashboard-continuity?habitId=1&end=2026-01-01':continuityFixture(),'/dashboard-continuity?habitId=2&end=2026-01-01':continuityFixture(2)});await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 const pending=new Map(),normal=global.fetch;global.fetch=(url,...args)=>url.startsWith('/dashboard-continuity')?new Promise(resolve=>pending.set(url,resolve)):normal(url,...args);
 const first=el('#continuity-habit-2').listeners.change({target:{value:'1'}}),latest=el('#continuity-habit-2').listeners.change({target:{value:'2'}});
 pending.get('/dashboard-continuity?habitId=2&end=2026-01-01')({ok:true,json:async()=>continuityFixture(2,'2026-01-01',['2026-01-01'])});await latest;
 pending.get('/dashboard-continuity?habitId=1&end=2026-01-01')({ok:true,json:async()=>continuityFixture()});await first;
 assert.equal(el('#continuity-grid-2').children.filter(c=>c.dataset.state==='completed').length,1);assert.equal(el('#continuity-grid').children.filter(c=>c.dataset.state==='completed').length,0);
});

test('dashboard requests no contribution data and renders universal streak independently',async()=>{
 const responses={...fixture,'/universal-streak':{status:'available',count:4,currentDate:'2026-01-01',asOfDate:'2026-01-01'}};
 const el=setup(responses,{withoutContinuity:true}),requests=[],normal=global.fetch;global.fetch=(url,...args)=>{requests.push(url);return normal(url,...args);};
 await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 assert.equal(requests.some(url=>url.startsWith('/dashboard-continuity')),false);assert.equal(el('#universal-streak').textContent,'4');
 responses['/universal-streak']={status:'setup-required',count:null,currentDate:'2026-01-01',asOfDate:'2026-01-01',reason:'storage-required'};await el('#retry-streak').listeners.click();
 assert.equal(el('#universal-streak').textContent,'—');assert.match(el('#streak-status').textContent,/needs setup/);
 responses['/universal-streak']=new Error('offline');await el('#retry-streak').listeners.click();assert.match(el('#streak-status').textContent,/unavailable/);assert.equal(el('#retry-streak').hidden,false);
});
test('historical universal streak responses cannot overwrite a later selected date',async()=>{
 const el=setup(fixture,{withoutContinuity:true});await(await modulePromise).initDashboard({now:new Date(2026,0,1)});
 const pending=new Map(),normal=global.fetch;global.fetch=(url,...args)=>url.startsWith('/universal-streak?date=')?new Promise(resolve=>pending.set(url,resolve)):normal(url,...args);
 const day=new Element();day.dataset.date='2025-12-30';const first=el('#week-strip').listeners.click({target:day});day.dataset.date='2025-12-31';const second=el('#week-strip').listeners.click({target:day});
 pending.get('/universal-streak?date=2025-12-31')({ok:true,json:async()=>({status:'available',count:3,asOfDate:'2025-12-31',currentDate:'2026-01-01'})});await second;
 pending.get('/universal-streak?date=2025-12-30')({ok:true,json:async()=>({status:'available',count:9,asOfDate:'2025-12-30',currentDate:'2026-01-01'})});await first;
 assert.equal(el('#universal-streak').textContent,'3');assert.match(el('#streak-asof').textContent,/Dec 31, 2025/);
});
