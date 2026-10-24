const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('review navigation discards stale responses and switching current periods stays current',async()=>{
 class Element{constructor(){this.children=[];this.dataset={};this.listeners={};this.textContent='';this.disabled=false;}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(){}addEventListener(name,run){this.listeners[name]=run;}click(){this.listeners.click();}}
 const ids=new Map(),el=id=>{if(!ids.has(id))ids.set(id,new Element());return ids.get(id);};
 const weekly=new Element(),monthly=new Element();weekly.dataset.reviewKind='weekly';monthly.dataset.reviewKind='monthly';
 let boot;const requests=[];
 const context={HabitRecurrence:require('../public/js/recurrence'),document:{querySelector:el,querySelectorAll:()=>[weekly,monthly],createElement:()=>new Element(),addEventListener:(_,run)=>boot=run},fetch:url=>new Promise(resolve=>requests.push({url,resolve}))};
 vm.runInNewContext(fs.readFileSync('public/js/reviews.js','utf8'),context);boot();assert.equal(requests.length,1);
 const result=(kind,start,end)=>({kind,start,end,next:'2026-03-01',today:'2026-02-01',soFar:true,habits:{scheduled:{required:0,fulfilled:0,rate:null},quotas:[],recordedEntries:0,recordedCheckins:0},spending:{total:'0.00',categories:[],budget:null},savingsNote:'No contribution history.'});
 const respond=async(index,data)=>{requests[index].resolve({ok:true,json:async()=>data});await new Promise(r=>setImmediate(r));};
 monthly.click();await respond(1,result('monthly','2026-02-01','2026-02-28'));assert.match(el('#review-range').textContent,/2026-02-01/);
 await respond(0,result('weekly','2026-01-26','2026-02-01'));assert.match(el('#review-range').textContent,/2026-02-01 – 2026-02-28/);
 weekly.click();assert.equal(requests[2].url,'/api/reviews?kind=weekly','current selection must remain anchored to authoritative today');
 await respond(2,result('weekly','2026-01-26','2026-02-01'));monthly.click();assert.equal(requests[3].url,'/api/reviews?kind=monthly');
});
