const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/js/recurrence');
test('calendar periods use Monday weeks, calendar years and anchored clamped dates',()=>{
 assert.deepEqual(R.period('2027-01-01','weekly'),{start:'2026-12-28',end:'2027-01-03',next:'2027-01-04'});
 assert.equal(R.period('2024-02-29','monthly').end,'2024-02-29');
 assert.equal(R.period('2024-12-31','yearly').next,'2025-01-01');
 const monthly={recurrence:{frequency:'monthly',mode:'scheduled',day:31}};
 for(const d of ['2024-02-29','2025-02-28','2025-03-31'])assert.equal(R.due(monthly,d),true);
 assert.equal(R.due(monthly,'2025-03-28'),false);
 const yearly={recurrence:{frequency:'yearly',mode:'scheduled',month:2,day:29}};
 assert.equal(R.due(yearly,'2025-02-28'),true);assert.equal(R.due(yearly,'2028-02-29'),true);
 assert.equal(R.due({schedule_days:[1,3]},'2026-10-26'),true);
 assert.equal(R.due({recurrence:{frequency:'weekly',mode:'quota'}},'2026-10-25'),false);
});
test('quota start defaults and effective versions preserve pending and closed rules',()=>{
 assert.equal(R.activation('2026-10-24','weekly'),'2026-10-26');
 assert.equal(R.activation('2026-10-26','weekly'),'2026-10-26');
 const versions=[{effective_on:'2026-10-19',target:3},{effective_on:'2026-10-26',target:5}];
 assert.equal(R.versionOn(versions,'2026-10-24').target,3);
 assert.equal(R.versionOn(versions,'2026-10-26').target,5);
 assert.equal(R.versionOn(versions,'2026-10-18'),null);
});
