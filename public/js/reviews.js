(function(root){
 function initReviews(){
  const $=selector=>document.querySelector(selector);if(!$('#profile-reviews'))return;
  const content=$('#review-content');let kind='weekly',generation=0;
  const make=(tag,className,value)=>{const el=document.createElement(tag);if(className)el.className=className;if(value!==undefined)el.textContent=value;return el;};
  const date=dateText=>{const [y,m,d]=dateText.split('-').map(Number);return new Date(Date.UTC(y,m-1,d));};
  function periodLabel(start,end){
   const a=date(start),b=date(end),format=new Intl.DateTimeFormat('en',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
   return format.formatRange?format.formatRange(a,b):format.format(a)+' – '+format.format(b);
  }
  function amount(value){
   if(value===null||value===undefined||value==='')return '—';
   const raw=String(value);if(!/^\d+(\.\d{1,2})?$/.test(raw))return '—';
   const [whole,fraction='']=raw.split('.');return 'Tk '+new Intl.NumberFormat('en-BD').format(BigInt(whole))+'.'+fraction.padEnd(2,'0');
  }
  function count(value){return value!==null&&value!==undefined&&value!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0?new Intl.NumberFormat('en').format(Number(value)):'—';}
  function quantity(value){return value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(Number(value)):'—';}
  function card(title,color){const el=make('section','review-card '+color);el.setAttribute('aria-label',title);el.append(make('h3','review-card-title',title));return el;}
  function render(data){
   const h=data.habits,scheduled=h.scheduled,sp=data.spending,grid=make('div','review-grid');
   $('#review-range').replaceChildren(make('span','',periodLabel(data.start,data.end)),...(data.soFar?[make('span','review-so-far','So far')]:[]));
   const habits=card('Habits','review-habits'),main=make('p','review-metric',count(h.recordedCheckins));
   habits.append(main,make('p','review-metric-label','completed check-ins recorded'));
   const fulfillment=make('div','review-submetric');
   fulfillment.append(make('span','review-submetric-label','Scheduled fulfilment'),make('strong','',count(scheduled.fulfilled)+' / '+count(scheduled.required)+' known occurrences'));
   habits.append(fulfillment);
   if(h.unknownRequirements)habits.append(make('span','review-qualifier','Partial history'));
   else if(!scheduled.required)habits.append(make('p','review-card-note','No scheduled occurrences in this period.'));
   grid.append(habits);

   const completion=card('Habit completion percentage','review-completion'),rate=scheduled.rate;
   completion.append(make('p','review-metric',typeof rate==='number'&&Number.isFinite(rate)&&rate>=0&&rate<=1?Math.round(rate*100)+'%':'—'),make('p','review-metric-label','scheduled occurrences completed'));
   if(h.unknownRequirements)completion.append(make('span','review-qualifier','Partial history'));
   else if(!scheduled.required)completion.append(make('p','review-card-note','No scheduled occurrences in this period.'));
   if(data.previous?.habitRate!==null&&data.previous?.habitRate!==undefined)completion.append(make('p','review-card-note','Previous period · '+Math.round(data.previous.habitRate*100)+'%'));
   grid.append(completion);

   const categories=card('Category breakdown','review-categories'),rows=Array.isArray(sp.categories)?sp.categories:null,total=Number(sp.total);
   if(rows?.length){
    const list=make('div','review-category-list');
    for(const item of rows){
     const label=item.category?String(item.category).replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()):'Category unavailable',value=Number(item.amount),share=Number.isFinite(total)&&total>0&&Number.isFinite(value)?Math.max(0,Math.min(100,value/total*100)):0,row=make('div','review-category-row');
     row.append(make('span','review-category-name',label),make('strong','review-category-amount',amount(item.amount)));
     const track=make('div','review-category-track'),fill=make('span','review-category-fill');fill.style.width=share+'%';track.setAttribute('aria-hidden','true');track.append(fill);row.append(track);list.append(row);
    }
    categories.append(list);
   }else categories.append(make('p','review-card-note',rows&&Number.isFinite(total)&&total===0?'No recorded expenses in this period.':'Category totals unavailable.'));
   grid.append(categories);

   if(data.kind==='monthly'&&sp.budget!==null&&sp.budget!==undefined){
    const budget=card('Monthly budget','review-budget'),spent=Number(sp.total),limit=Number(sp.budget),share=Number.isFinite(spent)&&Number.isFinite(limit)&&limit>0?Math.max(0,Math.min(100,spent/limit*100)):spent>0?100:0;
    budget.append(make('p','review-budget-figures',amount(sp.total)+' spent'),make('p','review-budget-label','of '+amount(sp.budget)));
    const track=make('div','review-budget-track');track.setAttribute('role','img');track.setAttribute('aria-label',amount(sp.total)+' spent of '+amount(sp.budget)+' budget');const fill=make('span','review-budget-fill');fill.style.width=share+'%';track.append(fill);budget.append(track);
    if(Number.isFinite(spent)&&Number.isFinite(limit)&&spent>limit)budget.append(make('p','review-card-note',amount((spent-limit).toFixed(2))+' over budget'));
    grid.append(budget);
   }

   if(h.quotas.length){
    const quotas=card('Flexible quota results','review-quotas');
    for(const q of h.quotas){const row=make('div','review-quota-row');row.append(make('strong','',q.name),make('span','',quantity(q.achieved)+' / '+quantity(q.target)+' '+(q.unit||'occurrences')),make('small','',periodLabel(q.start,q.deadline)+' · '+q.status));quotas.append(row);}
    grid.append(quotas);
   }
   content.replaceChildren(grid);

  }
  async function load(){
   const token=++generation;$('#review-status').textContent='Loading review…';$('#review-retry').hidden=true;content.replaceChildren();
   document.querySelectorAll('[data-review-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.reviewKind===kind)));
   try{const response=await fetch('/api/reviews?kind='+kind,{headers:{Accept:'application/json'}});if(!response.ok||response.redirected)throw Error('Review unavailable. Please try again.');const data=await response.json();if(token!==generation)return;
    if(data.kind!==kind||!data.habits||!data.spending)throw Error('Unexpected review response.');render(data);$('#review-status').textContent='';
   }catch(e){if(token!==generation)return;$('#review-range').replaceChildren();$('#review-status').textContent=e.message;$('#review-retry').hidden=false;}
  }
  document.querySelectorAll('[data-review-kind]').forEach(b=>b.addEventListener('click',()=>{kind=b.dataset.reviewKind;load();}));
  $('#review-retry').addEventListener('click',load);load();
 }
 root.HabitReviews={initReviews};if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',initReviews);
})(globalThis);
