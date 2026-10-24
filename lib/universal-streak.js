// Forward-looking evidence only. Never compare historical logs to today's habits.
const {validDate}=require('./calendar-date');
function nextDate(iso){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function evaluateUniversalStreak({startsOn,asOf,currentDate,emptyDayPolicy,days}){
 const unavailable=reason=>({status:'setup-required',count:null,reason,asOfDate:asOf,trackingSince:startsOn});
 if(!validDate(startsOn)||!validDate(asOf)||!validDate(currentDate)||!Array.isArray(days))throw new Error('Invalid streak evidence');
 if(!['pause','reset','earn'].includes(emptyDayPolicy))return unavailable('policy-required');
 if(asOf<startsOn)return unavailable('not-tracked');if(asOf>currentDate)return unavailable('future-date');
 const records=new Map();
 for(const day of days){if(!validDate(day.date)||records.has(day.date)||!Number.isSafeInteger(day.required)||!Number.isSafeInteger(day.completed)||day.required<0||day.completed<0||day.completed>day.required)throw new Error('Invalid daily requirements');records.set(day.date,day);}
 let count=0;
 for(let date=startsOn;date<=asOf;date=nextDate(date)){
  const day=records.get(date);if(!day?.sealed)return unavailable('requirements-unavailable');
  if(!day.required){if(emptyDayPolicy==='earn')count++;else if(emptyDayPolicy==='reset'&&date<currentDate)count=0;}
  else if(day.completed===day.required)count++;
  else if(date<currentDate)count=0;
  if(date==='9999-12-31')break;
 }
 return {status:'available',count,asOfDate:asOf,trackingSince:startsOn};
}
module.exports={evaluateUniversalStreak,...require('./streak-storage')};
