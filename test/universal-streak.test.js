const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateUniversalStreak}=require('../lib/universal-streak');
const day=(date,completed=2,required=2)=>({date,sealed:true,required,completed});
const input=days=>({startsOn:'2026-10-17',asOf:'2026-10-19',currentDate:'2026-10-19',emptyDayPolicy:'pause',days});
test('universal days count all required completions once, preserve an incomplete current day, and revoke undo',()=>{
 const days=[day('2026-10-17'),day('2026-10-18'),day('2026-10-19',1)];
 assert.equal(evaluateUniversalStreak(input(days)).count,2);
 days[2].completed=2;assert.equal(evaluateUniversalStreak(input(days)).count,3);assert.equal(evaluateUniversalStreak(input(days)).count,3);
 days[2].completed=1;assert.equal(evaluateUniversalStreak(input(days)).count,2);
});
test('closed misses reset while missing snapshots and pre-tracking history remain unavailable',()=>{
 assert.equal(evaluateUniversalStreak(input([day('2026-10-17'),day('2026-10-18',1),day('2026-10-19',1)])).count,0);
 assert.equal(evaluateUniversalStreak(input([day('2026-10-17'),day('2026-10-19')])).count,null);
 assert.equal(evaluateUniversalStreak({...input([]),asOf:'2026-10-16'}).count,null);
});
test('rollover closes an incomplete day and explicit daily denominators survive habit-set changes',()=>{
 const days=[day('2026-10-17'),day('2026-10-18'),day('2026-10-19',1)];
 assert.equal(evaluateUniversalStreak({...input(days),currentDate:'2026-10-20',asOf:'2026-10-19'}).count,0);
 assert.equal(evaluateUniversalStreak(input([day('2026-10-17',1,1),day('2026-10-18',3,3),day('2026-10-19',2,2)])).count,3);
});
test('empty-day behavior is explicit, never an implicit successful day',()=>{
 const data=input([day('2026-10-17'),day('2026-10-18',0,0),day('2026-10-19',1)]);
 assert.equal(evaluateUniversalStreak({...data,emptyDayPolicy:null}).count,null);
 assert.equal(evaluateUniversalStreak(data).count,1);
 assert.equal(evaluateUniversalStreak({...data,emptyDayPolicy:'reset'}).count,0);
 assert.equal(evaluateUniversalStreak({...data,emptyDayPolicy:'earn'}).count,2);
});
test('a current no-habit day earns nothing and resets only at its closing deadline',()=>{
 const data=input([day('2026-10-17'),day('2026-10-18'),day('2026-10-19',0,0)]);
 assert.equal(evaluateUniversalStreak({...data,emptyDayPolicy:'reset'}).count,2);
 assert.equal(evaluateUniversalStreak({...data,emptyDayPolicy:'reset',currentDate:'2026-10-20'}).count,0);
});
