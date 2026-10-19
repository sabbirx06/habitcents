const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const mod=()=>import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('public/js/dashboard.js','utf8')).toString('base64'));

test('daily spending fills elapsed unrecorded dates and validates exact totals across leap/year boundaries',async()=>{
 const {buildDailySpending}=await mod();
 const make=(end,days=[],total='0.00')=>({range:{startDate:end.slice(0,7)+'-01',endDate:end},days,total});
 const leap=buildDailySpending(make('2024-02-29',[{date:'2024-02-29',amount:'0.30',count:2}],'0.30'));
 assert.equal(leap.length,29);assert.deepEqual(leap[0],{date:'2024-02-01',cents:0,count:0});assert.equal(leap.at(-1).cents,30);
 assert.equal(buildDailySpending(make('2025-12-31')).length,31);assert.equal(buildDailySpending(make('2026-01-01')).length,1);
 assert.throws(()=>buildDailySpending(make('2024-02-28',[{date:'2024-02-29',amount:'1',count:1}],'1')),/day/);
 assert.throws(()=>buildDailySpending(make('2024-02-29',[{date:'2024-02-29',amount:'0.30',count:2}],'0.31')),/reconcile/);
 assert.throws(()=>buildDailySpending(make('2023-02-29')),/period/);
});
test('local clock aligns minutes, rolls local midnight/year and resumes without duplicate timers',async()=>{
 const {createLocalClock}=await mod();let current=new Date(2025,11,31,23,59,30);const ticks=[],timers=new Map(),listeners=new Map();let id=0;
 const doc={hidden:false,addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k)};
 const clock=createLocalClock({now:()=>current,onTick:d=>ticks.push(d),doc,win:null,schedule:(f,delay)=>{timers.set(++id,{f,delay});return id;},cancel:n=>timers.delete(n)});
 clock.start();clock.start();assert.equal(timers.size,1);assert.equal(listeners.size,1);assert.equal([...timers.values()][0].delay,30000);
 current=new Date(2026,0,1,0,0);[...timers.values()][0].f();assert.equal(timers.size,1);assert.equal(ticks.at(-1).getDate(),1);assert.equal(ticks.at(-1).getFullYear(),2026);
 doc.hidden=true;current=new Date(2026,1,1,9,21);doc.hidden=false;listeners.get('visibilitychange')();assert.equal(timers.size,1);assert.equal(ticks.at(-1).getMonth(),1);
 clock.stop();assert.equal(timers.size,0);assert.equal(listeners.size,0);
});
test('month browser handles leap days and year rollover',async()=>{
 const {getMonthDays,shiftMonth}=await mod();assert.equal(getMonthDays('2024-02').length,29);assert.equal(getMonthDays('2023-02').length,28);assert.equal(shiftMonth('2025-12',1),'2026-01');assert.equal(shiftMonth('2026-01',-1),'2025-12');
});
test('savings summarizer distinguishes no goals and reached targets using exact cents',async()=>{
 const {summarizeSavings}=await mod();assert.deepEqual(summarizeSavings([]),{goals:[],total:'0.00',count:0,belowTarget:0,goal:null});
 const s=summarizeSavings([{goal_id:1,name:'One',saved_amount:'0.10',target_amount:'0.10'},{goal_id:2,name:'Two',saved_amount:'0.20',target_amount:'1.00'}]);
 assert.equal(s.total,'0.30');assert.equal(s.belowTarget,1);assert.equal(s.goal.name,'Two');assert.equal(s.goal.progress,20);
 assert.equal(summarizeSavings([{goal_id:1,name:'Done',saved_amount:'120',target_amount:'100'}]).goal.progress,100);
 assert.throws(()=>summarizeSavings([{saved_amount:'bad',target_amount:100}]),/Invalid/);
});

test('savings rings clamp real progress and do not represent invalid targets as zero',async()=>{
 const {summarizeSavings}=await mod();
 const goal=(saved,target)=>summarizeSavings([{name:'Goal',saved_amount:saved,target_amount:target}]).goal;
 assert.equal(goal('150','100').progress,100);assert.equal(goal('-2','100').progress,0);
 assert.equal(goal('0','100').progress,0);assert.equal(goal('10','0').progress,null);
 assert.equal(goal('10','-1').progress,null);assert.throws(()=>goal('10','bad'),/Invalid/);
 assert.throws(()=>goal(null,'100'),/Invalid/);
});

test('bounded date ranges cross leap days and years without UTC conversion',async()=>{
 const {dateRange,shiftDate}=await mod();
 assert.equal(shiftDate('2026-01-01',-7),'2025-12-25');
 assert.equal(shiftDate('2024-02-28',1),'2024-02-29');assert.equal(shiftDate('2024-02-29',1),'2024-03-01');
 assert.equal(shiftDate('0001-01-01',-1),'0001-01-01');assert.equal(shiftDate('9999-12-31',1),'9999-12-31');
 const days=dateRange('2026-01-01');assert.equal(days.length,91);assert.ok(days[0].startsWith('2025-'));assert.ok(days.at(-1).startsWith('2026-'));
 assert.ok(dateRange('2024-03-01').includes('2024-02-29'));assert.equal(dateRange('2026-01-01',200,200).length,151);
});

test('breakdown validates exact cents and rejects contradictory totals instead of showing zeros',async()=>{
 const {validateBreakdown}=await mod();
 const range={kind:'day',startDate:'2024-02-29',endDate:'2024-02-29'};
 const data=validateBreakdown({range,total:'0.30',categories:[{category:'food',amount:'0.10',count:1},{category:'uncategorized',amount:'0.20',count:1}]});
 assert.equal(data.totalCents,30);assert.equal(data.categories[0].cents,10);
 assert.throws(()=>validateBreakdown({range,total:'0.31',categories:[{category:'food',amount:'0.30'}]}),/total/i);
});
test('continuity grid aligns weekdays, distinguishes future/pre-creation/unrecorded and ends historical ranges',async()=>{
 const {buildContinuityCells}=await mod();
 const data={startDate:'2024-02-26',endDate:'2024-02-29',currentDate:'2024-02-29',habit:{createdDate:'2024-02-27'},completedDates:['2024-02-29']};
 const today=buildContinuityCells(data,false);assert.equal(today.length,7);assert.deepEqual(today.map(c=>c.state),['before-creation','unrecorded','unrecorded','completed','future','future','future']);
 const historical=buildContinuityCells({...data,currentDate:'2026-01-01'},true);assert.equal(historical[4].state,'outside-range');assert.equal(historical[4].date,null);
 assert.throws(()=>buildContinuityCells({...data,completedDates:['2024-02-30']},false),/date/i);
});
test('half-year history remains bounded without inventing older completions',async()=>{
 const {buildContinuityCells}=await mod();
 const data={startDate:'2025-07-07',endDate:'2026-01-01',currentDate:'2026-01-01',habit:{createdDate:null},completedDates:['2026-01-01']};
 const cells=buildContinuityCells(data);assert.equal(cells.length,182);assert.equal(cells.filter(c=>c.state==='completed').length,1);assert.equal(cells[0].state,'unrecorded');
 assert.throws(()=>buildContinuityCells({...data,startDate:'2025-06-30'}),/too large/);
});
