// Dock tooltips are named by aria-label and may be dismissed with Escape.
document.addEventListener('DOMContentLoaded',()=>{
 const dock=document.querySelector('.nav-dock');if(!dock)return;
 const reset=()=>dock.removeAttribute('data-tooltips-dismissed');
 for(const link of dock.querySelectorAll('a')){link.addEventListener('focus',reset);link.addEventListener('pointerenter',reset);}
 document.addEventListener('keydown',event=>{if(event.key==='Escape')dock.setAttribute('data-tooltips-dismissed','');});
});
