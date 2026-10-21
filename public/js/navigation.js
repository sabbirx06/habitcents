// Dock tooltips are named by aria-label and may be dismissed with Escape.
document.addEventListener('DOMContentLoaded',()=>{
 const dock=document.querySelector('.nav-dock');if(!dock)return;
 const current=dock.querySelector('[aria-current=page]');
 if(current){
  const bounds=dock.getBoundingClientRect(),box=current.getBoundingClientRect();
  const indicator=document.createElement('span');indicator.className='dock-indicator';indicator.setAttribute('aria-hidden','true');
  Object.assign(indicator.style,{left:(box.left-bounds.left)+'px',top:(box.top-bounds.top)+'px',width:box.width+'px',height:box.height+'px'});
  dock.prepend(indicator);dock.dataset.motionIndicator='';
  const align=()=>{const outer=dock.getBoundingClientRect(),selected=current.getBoundingClientRect();Object.assign(indicator.style,{left:(selected.left-outer.left)+'px',top:(selected.top-outer.top)+'px',width:selected.width+'px',height:selected.height+'px'});};
  window.addEventListener('resize',align);
  window.addEventListener('pagehide',()=>window.removeEventListener('resize',align));
  window.addEventListener('pageshow',()=>{align();window.addEventListener('resize',align);});
  try{const previous=JSON.parse(sessionStorage.getItem('habitcents-dock-from')||'null');sessionStorage.removeItem('habitcents-dock-from');
   if(previous&&previous.path!==location.pathname&&Math.abs(previous.x-(box.left-bounds.left))<320)
    globalThis.HabitMotion?.effect(indicator,[{transform:`translateX(${previous.x-(box.left-bounds.left)}px)`},{transform:'translateX(0)'}],{duration:220,easing:'cubic-bezier(.2,.75,.25,1)'});
  }catch{}
  for(const link of dock.querySelectorAll('.dock-links a'))link.addEventListener('click',event=>{
   if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   try{sessionStorage.setItem('habitcents-dock-from',JSON.stringify({path:location.pathname,x:current.getBoundingClientRect().left-dock.getBoundingClientRect().left}));}catch{}
  });
 }
 const reset=()=>dock.removeAttribute('data-tooltips-dismissed');
 for(const link of dock.querySelectorAll('a')){link.addEventListener('focus',reset);link.addEventListener('pointerenter',reset);}
 document.addEventListener('keydown',event=>{if(event.key==='Escape')dock.setAttribute('data-tooltips-dismissed','');});
});
