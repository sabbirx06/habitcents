const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/motion.js','utf8');
function harness({ reduced = false, storage = new Map() } = {}) {
  let now=0, serial=0;const frames=new Map(), events={}, media={matches:reduced,addEventListener(name,fn){this.change=fn;}};
  const context={console,performance:{now:()=>now},matchMedia:()=>media,location:{pathname:'/habits'},document:{visibilityState:'visible',addEventListener(name,fn){events[name]=fn;}},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),addEventListener:(name,fn)=>events[name]=fn};
  context.document.documentElement={setAttribute(){}};
  context.dispatchEvent=event=>events[event.type]?.(event);
  context.CustomEvent=class {constructor(type,options){this.type=type;this.detail=options.detail;}};
  vm.runInNewContext(fs.readFileSync('public/js/motion-preference.js','utf8'),context);
  vm.runInNewContext(source,context);
  return {motion:context.HabitMotion,frames,media,storage,context,events,node:{isConnected:true,getClientRects:()=>[{}]},tick(time){now=time;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));}};
}
test('summary and fill use one monotone timeline and finish at the exact source',()=>{
  const h=harness(),source={percent:100/3,count:2,total:6},seen=[];
  h.motion.values(h.node,'summary',source,frame=>seen.push({...frame}),{initial:{total:6}});
  assert.equal(seen[0].percent,0);
  assert.equal(seen[0].total,6);
  for(const ms of [80,160,240,360,440])h.tick(ms);
  assert.equal(seen.at(-1).percent,source.percent);assert.equal(seen.at(-1).count,2);
  assert.ok(seen.every((v,i)=>v.percent>=0&&v.percent<=source.percent&&(!i||v.percent>=seen[i-1].percent)));
  assert.deepEqual(source,{percent:100/3,count:2,total:6});assert.equal(h.frames.size,0);
});
test('a decrease interrupts from the currently displayed value without overshoot',()=>{
  const h=harness();let displayed;
  h.motion.values({...h.node,getBoundingClientRect:()=>({top:-200,bottom:-100,left:0,right:10})},'offscreen',{value:17},v=>displayed=v.value);
  assert.equal(displayed,17);assert.equal(h.frames.size,0);
  h.motion.bars({...h.node,children:[],getClientRects:()=>[]},'offscreen-bars');
  assert.equal(h.storage.size,0);
  const paint=v=>displayed=v.value;
  h.motion.values(h.node,'metric',{value:100},paint);h.tick(110);const current=displayed;
  assert.ok(current>0&&current<100);
  h.motion.values(h.node,'metric',{value:20},paint);assert.equal(displayed,current);assert.equal(h.frames.size,1);
  h.tick(220);assert.ok(displayed<current&&displayed>20);h.tick(550);assert.equal(displayed,20);assert.equal(h.frames.size,0);
  h.motion.values(h.node,'metric',{value:-12.35},paint);h.tick(990);assert.equal(displayed,-12.35);assert.equal(h.frames.size,0);
});
test('rapid retargets and same-target rerenders keep the active presentation timeline',()=>{
  const h=harness();let displayed;
  const paint=v=>displayed=v.value;
  h.motion.values(h.node,'metric',{value:100},paint);h.tick(100);
  h.motion.values(h.node,'metric',{value:30},paint);h.tick(150);
  const current=displayed;h.motion.values(h.node,'metric',{value:80},paint);assert.equal(displayed,current);
  h.tick(200);h.motion.values({...h.node},'metric',{value:80},paint);
  h.tick(590);assert.equal(displayed,80);assert.equal(h.frames.size,0);
});
test('unknown cancels presentation instead of fabricating zero',()=>{
  const h=harness();let painted=0;
  h.motion.values(h.node,'metric',{value:100},()=>painted++);h.tick(100);
  h.motion.values(h.node,'metric',{value:null},()=>painted++);const prior=painted;h.tick(600);
  assert.equal(painted,prior);assert.equal(h.frames.size,0);
});
test('reduced motion and a mid-animation preference change show exact final values promptly',()=>{
  const h=harness({reduced:true});let displayed;
  h.motion.values(h.node,'metric',{value:33},v=>displayed=v.value);assert.equal(displayed,33);assert.equal(h.frames.size,0);
  const a=harness();a.motion.values(a.node,'metric',{value:90},v=>displayed=v.value);a.tick(80);
  a.media.matches=true;a.media.change({matches:true});assert.equal(displayed,90);assert.equal(a.frames.size,0);
});
test('hidden content settles; each fresh document replays without session suppression',()=>{
  const h=harness();let displayed;
  h.motion.values({...h.node,getClientRects:()=>[]},'metric',{value:50},v=>displayed=v.value);
  assert.equal(displayed,50);assert.equal(h.frames.size,0);
  const returned=harness({storage:h.storage});returned.motion.values(returned.node,'metric',{value:50},v=>displayed=v.value);
  assert.equal(displayed,0);assert.equal(returned.frames.size,1);returned.tick(440);assert.equal(displayed,50);assert.equal(h.storage.size,0);
});
test('pagehide and document hiding release animation frames',()=>{
  for(const event of ['pagehide','visibilitychange']){
    const h=harness();let displayed;
    h.motion.values(h.node,'metric',{value:42},v=>displayed=v.value);assert.equal(h.frames.size,1);
    if(event==='visibilitychange')h.context.document.visibilityState='hidden';h.events[event]();
    assert.equal(displayed,42);assert.equal(h.frames.size,0);
  }
});

test('explicit off settles work and on only animates subsequent changes',()=>{
 const h=harness();let frame;const paint=v=>frame={...v};
 h.motion.values(h.node,'paired',{value:90,percent:30},paint);h.tick(80);
 let cancelled=0;h.motion.effect({...h.node,animate:()=>({cancel(){cancelled++;},addEventListener(){}})},[],{});
 h.context.HabitMotionPreference.set('off');assert.deepEqual(frame,{value:90,percent:30});assert.equal(h.frames.size,0);assert.equal(cancelled,1);
 h.context.HabitMotionPreference.set('on');assert.equal(h.frames.size,0);
 h.motion.values(h.node,'paired',{value:90,percent:30},paint);assert.equal(h.frames.size,0);
 h.motion.values(h.node,'paired',{value:100,percent:40},paint);assert.equal(frame.value,90);assert.equal(h.frames.size,1);
});
test('chart entrances deduplicate within a document and replay in a fresh document',()=>{
 const storage=new Map();for(let load=0;load<2;load++){
 const h=harness({storage});let entrances=0;
 const bar={...h.node,animate:()=>{entrances++;return {addEventListener(){},cancel(){}};}};
 const container={...h.node,children:[bar]};h.motion.bars(container,'chart');h.motion.bars(container,'chart');assert.equal(entrances,1);
 const node={...h.node,style:{}};h.motion.radial(node,'donut');h.tick(100);
 const current=node.style.maskImage;h.motion.radial(node,'donut');assert.equal(node.style.maskImage,current);
 h.tick(440);assert.equal(node.style.maskImage,'none');h.motion.radial(node,'donut');assert.equal(h.frames.size,0);
 }
});

test('explicit on ignores system changes during a tween; explicit off starts at final',()=>{
 const h=harness({reduced:true});let displayed;
 h.context.HabitMotionPreference.set('on');
 h.motion.values(h.node,'metric',{value:77},v=>displayed=v.value);h.tick(100);
 assert.ok(displayed>0&&displayed<77);
 h.media.change({matches:true});assert.equal(h.frames.size,1);
 h.tick(440);assert.equal(displayed,77);
 h.context.HabitMotionPreference.set('off');
 h.motion.values(h.node,'other',{value:12.35},v=>displayed=v.value);
 assert.equal(displayed,12.35);assert.equal(h.frames.size,0);
});
