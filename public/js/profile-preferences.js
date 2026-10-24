(() => {
  const keys={clock:'habitcents-clock-format',week:'habitcents-week-start'};
  let storage=true;
  const read=(key,allowed,fallback)=>{try{const value=localStorage.getItem(key);return allowed.includes(value)?value:fallback;}catch{storage=false;return fallback;}};
  const state={clock:read(keys.clock,['12','24'],'24'),week:read(keys.week,['monday','sunday'],'monday'),storage};
  const publish=(field,value)=>{state[field]=value;try{localStorage.setItem(keys[field],value);state.storage=true;}catch{state.storage=false;}globalThis.dispatchEvent(new CustomEvent('habitcentspreferenceschange',{detail:{...state}}));};
  globalThis.HabitCentsPreferences={get:()=>({...state}),set:publish};
  const sync=()=>{document.querySelectorAll('[data-clock]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.clock===state.clock));});document.querySelectorAll('[data-week]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.week===state.week)));};
  document.addEventListener('DOMContentLoaded',()=>{
    const animations=document.querySelector('#animations'),motion=globalThis.HabitMotionPreference;
    if(animations&&motion){const update=()=>{const on=!motion.reduced();animations.setAttribute('aria-checked',String(on));animations.querySelector('.motion-switch-state').textContent=on?'On':'Off';};animations.addEventListener('click',()=>motion.set(motion.reduced()?'on':'off'));globalThis.addEventListener('habitmotionchange',update);update();}
    document.querySelectorAll('[data-clock]').forEach(b=>b.addEventListener('click',()=>publish('clock',b.dataset.clock)));
    document.querySelectorAll('[data-week]').forEach(b=>b.addEventListener('click',()=>publish('week',b.dataset.week)));
    globalThis.addEventListener('habitcentspreferenceschange',()=>{sync();const note=document.querySelector('#preference-status');if(note)note.textContent=state.storage?'':'Storage unavailable; this choice applies for this page only.';});sync();if(!state.storage){const note=document.querySelector('#preference-status');if(note)note.textContent='Storage unavailable; defaults apply for this page only.';}
  });
})();
