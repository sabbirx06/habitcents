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
 monthly.click();await respond(1,result('monthly','2026-02-01','2026-02-28'));assert.match(el('#review-range').children.map(x=>x.textContent).join(' '),/Feb 1\s+–\s+28, 2026/);
 await respond(0,result('weekly','2026-01-26','2026-02-01'));assert.match(el('#review-range').children.map(x=>x.textContent).join(' '),/Feb 1\s+–\s+28, 2026/);
 weekly.click();assert.equal(requests[2].url,'/api/reviews?kind=weekly','current selection must remain anchored to authoritative today');
 await respond(2,result('weekly','2026-01-26','2026-02-01'));monthly.click();assert.equal(requests[3].url,'/api/reviews?kind=monthly');
});

test('review cards label recorded check-ins, preserve partial history, and show exact spending data',async()=>{
 class Element{constructor(){this.children=[];this.dataset={};this.listeners={};this.textContent='';this.disabled=false;this.hidden=false;this.style={};this.attributes={};}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(name,value){this.attributes[name]=value;}addEventListener(name,run){this.listeners[name]=run;}click(){this.listeners.click();}}
 const ids=new Map(),el=id=>{if(!ids.has(id))ids.set(id,new Element());return ids.get(id);},weekly=new Element(),monthly=new Element();weekly.dataset.reviewKind='weekly';monthly.dataset.reviewKind='monthly';let boot;
 const data={kind:'monthly',start:'2026-10-01',end:'2026-10-31',next:'2026-11-01',today:'2026-10-25',soFar:true,habits:{scheduled:{required:9,fulfilled:7,rate:null},unknownRequirements:true,recordedCheckins:7,recordedEntries:9,quotas:[{name:'Read',achieved:1.5,target:3,unit:'hours',start:'2026-10-01',deadline:'2026-10-31',status:'incomplete'}]},spending:{total:'1234.56',categories:[{category:'food',amount:'1000.06',count:2},{category:null,amount:'234.50',count:1}],budget:'1200.00'},savingsNote:'Savings have no dated contribution history.'};
 const context={HabitRecurrence:require('../public/js/recurrence'),document:{querySelector:el,querySelectorAll:()=>[weekly,monthly],createElement:()=>new Element(),addEventListener:(_,run)=>boot=run},fetch:async url=>({ok:true,json:async()=>url.includes('monthly')?data:{...data,kind:'weekly',spending:{...data.spending,budget:null}}})};
 vm.runInNewContext(fs.readFileSync('public/js/reviews.js','utf8'),context);boot();await new Promise(resolve=>setImmediate(resolve));monthly.click();await new Promise(resolve=>setImmediate(resolve));
 const collect=item=>[item.textContent,...item.children.map(collect)].join(' '),output=collect(el('#review-content'));
 assert.match(el('#review-range').children[0].textContent,/Oct 1\s+–\s+31, 2026/);assert.equal(el('#review-range').children[1].textContent,'So far');
 assert.match(output,/7 completed check-ins recorded/);assert.match(output,/Partial history/);assert.match(output,/7 \/ 9 known occurrences/);assert.doesNotMatch(output,/%/);
 assert.match(output,/Tk 1,234\.56/);assert.match(output,/Tk 1,000\.06/);assert.match(output,/Category unavailable/);assert.match(output,/1\.5 \/ 3 hours/);assert.match(output,/Tk 1,200\.00/);
 let cards=el('#review-content').children[0].children;
 assert.equal(cards[1].attributes['aria-label'],'Habit completion percentage');
 assert.equal(cards[1].children[1].textContent,'—');
 assert.ok(!cards.some(item=>item.attributes['aria-label']==='Spending'));
 data.habits.unknownRequirements=false;data.habits.scheduled={required:10,fulfilled:7,rate:.7};
 monthly.click();await new Promise(resolve=>setImmediate(resolve));
 cards=el('#review-content').children[0].children;assert.equal(cards[1].children[1].textContent,'70%');
 data.habits.scheduled={required:10,fulfilled:0,rate:0};
 monthly.click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(el('#review-content').children[0].children[1].children[1].textContent,'0%');
});
