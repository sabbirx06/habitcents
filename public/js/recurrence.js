/* Shared calendar rules. All arguments are calendar DATE strings, never local instants. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HabitRecurrence=api;})(globalThis,()=>{
 function shift(day,n){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
 function stamp(y,m,d){return String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');}
 function monthEnd(y,m){const d=new Date(0);d.setUTCFullYear(y,m,0);return d.getUTCDate();}
 function period(day,frequency){
  const [y,m]=day.split('-').map(Number);let start,next;
  if(frequency==='weekly'){start=shift(day,-((new Date(day+'T12:00Z').getUTCDay()+6)%7));next=shift(start,7);}
  else if(frequency==='monthly'){start=stamp(y,m,1);next=stamp(m===12?y+1:y,m===12?1:m+1,1);}
  else if(frequency==='yearly'){start=stamp(y,1,1);next=stamp(y+1,1,1);}
  else {start=day;next=shift(day,1);}
  return {start,end:shift(next,-1),next};
 }
 function activation(day,frequency,choice){const p=period(day,frequency);return choice==='this'||(!choice&&day===p.start)?day:p.next;}
 function versionOn(versions,day){return versions.filter(v=>v.effective_on<=day).sort((a,b)=>a.effective_on.localeCompare(b.effective_on)).at(-1)||null;}
 function quota(rule){return rule?.recurrence?.mode==='quota';}
 function due(rule,day){
  if(!rule||rule.archived||quota(rule))return false;
  const r=rule.recurrence, weekday=new Date(day+'T12:00:00Z').getUTCDay()||7;
  if(!r||r.frequency==='daily'||r.frequency==='weekdays')return (rule.schedule_days||[1,2,3,4,5,6,7]).includes(weekday);
  if(r.frequency==='weekly')return r.weekday===weekday;
  const [y,m,d]=day.split('-').map(Number);
  return (r.frequency!=='yearly'||r.month===m)&&d===Math.min(r.day,monthEnd(y,m));
 }
 function label(rule){const r=rule.recurrence;if(!r)return (rule.schedule_days||[]).length===7?'Every day':'Selected weekdays';
  if(r.frequency==='daily')return 'Every day';
  if(r.frequency==='weekdays')return (rule.schedule_days||[]).map(d=>['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d-1]).join(', ');
  if(r.mode==='quota')return 'Each '+({weekly:'week',monthly:'month',yearly:'year'}[r.frequency]);
  if(r.frequency==='weekly')return 'Every '+['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][r.weekday-1];
  return r.frequency==='monthly'?'Day '+r.day+' each month (clamped)':r.month+'/'+r.day+' each year (clamped)';
 }
 return {shift,period,activation,versionOn,quota,due,label,monthEnd};
});
