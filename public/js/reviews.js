(function(root){
 function initReviews(){
  const $=selector=>document.querySelector(selector);if(!$('#profile-reviews'))return;
  const R=root.HabitRecurrence,content=$('#review-content');let kind='weekly',anchor=null,result=null,generation=0;
  const text=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el;};
  function render(data){
   const h=data.habits,s=h.scheduled,sp=data.spending;
   $('#review-range').textContent=data.start+' – '+data.end+(data.soFar?' · Current period · so far':'')+' · Asia/Dhaka';
   content.replaceChildren(text('h3','Habits'),text('p',s.fulfilled+' fulfilled / '+s.required+' known required scheduled occurrences'+(s.rate==null?' · Completion rate unavailable': ' · '+Math.round(s.rate*100)+'%')),
    text('p',h.recordedEntries+' recorded entries, including '+h.recordedCheckins+' completed check-ins.'+(h.unknownRequirements?' Some historical requirements are unknown; no overall rate can be established.':'')));
   if(h.quotas.length){content.append(text('h3','Flexible quotas'),text('p','Whole quota-period progress as of '+data.asOf+'. Separate from scheduled completion and the daily streak.'));
    for(const q of h.quotas)content.append(text('p',q.name+' · '+q.achieved+' / '+q.target+' '+(q.unit||'occurrences')+' · '+q.remaining+' remaining · '+q.start+' – '+q.deadline+' · '+q.status));
   }
   content.append(text('h3','Recorded spending'),text('p','Tk '+sp.total));
   for(const c of sp.categories)content.append(text('p',(c.category||'Category unavailable')+' · Tk '+c.amount+' ('+c.count+' records)'));
   if(data.kind==='monthly')content.append(text('p',sp.budget==null?'No budget recorded for this month.':'Monthly budget: Tk '+sp.budget+' · recorded spending: Tk '+sp.total));
   if(data.previous)content.append(text('p','Previous complete period ('+data.previous.start+' – '+data.previous.end+'): recorded spending Tk '+data.previous.spending+(data.previous.habitRate!=null?' · scheduled completion '+Math.round(data.previous.habitRate*100)+'%':'')));
   content.append(text('p',data.savingsNote));
   $('#review-previous').disabled=data.start==='0001-01-01';$('#review-next').disabled=data.next>data.today;
  }
  async function load(){
   const token=++generation;$('#review-status').textContent='Loading review…';$('#review-retry').hidden=true;content.replaceChildren();
   document.querySelectorAll('[data-review-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.reviewKind===kind)));
   try{const response=await fetch('/api/reviews?kind='+kind+(anchor?'&date='+anchor:''),{headers:{Accept:'application/json'}});if(!response.ok||response.redirected)throw Error('Review unavailable. Please try again.');const data=await response.json();if(token!==generation)return;
    if(data.kind!==kind||!data.habits||!data.spending)throw Error('Unexpected review response.');result=data;render(data);$('#review-status').textContent='';
   }catch(e){if(token!==generation)return;$('#review-range').textContent='';$('#review-status').textContent=e.message;$('#review-retry').hidden=false;}
  }
  document.querySelectorAll('[data-review-kind]').forEach(b=>b.addEventListener('click',()=>{kind=b.dataset.reviewKind;load();}));
  $('#review-previous').addEventListener('click',()=>{if(result){anchor=R.shift(R.period(anchor||result.start,kind).start,-1);load();}});
  $('#review-next').addEventListener('click',()=>{if(result){const next=R.period(anchor||result.start,kind).next;if(next<=result.today){anchor=next;load();}}});
  $('#review-current').addEventListener('click',()=>{anchor=null;load();});$('#review-retry').addEventListener('click',load);load();
 }
 root.HabitReviews={initReviews};if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',initReviews);
})(globalThis);
