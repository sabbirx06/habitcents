/* Disposable local-preview checks via Chrome/CDP. Never uses the live app/database. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const tabs = await (await fetch('http://127.0.0.1:9225/json/list')).json();
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve));
  let serial = 0; const pending = new Map(), errors = [], checks = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(message.error) : p.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++serial, { resolve, reject }); ws.send(JSON.stringify({ id: serial, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(50); } throw Error('Timed out: ' + expression); };
  const ready = async () => { await wait("document.readyState==='complete' && !!globalThis.HabitMotion"); await pause(650); };
  const go = async path => { await send('Page.navigate', { url: 'http://127.0.0.1:3001' + path }); await ready(); };
  const key = async (key, code, v) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: v, ...(key === ' ' ? { text: ' ' } : key === 'Enter' ? { text: '\r' } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: v });
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1000, deviceScaleFactor: 1, mobile: false });
  const monitor = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    globalThis.__motionFrames=[];globalThis.__chartFrames=[];
    const nativeAnimate=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){
      const animation=nativeAnimate.call(this,frames,options),node=this;
      if(frames[0]?.transform==='scaleY(0)'){
        const sample=()=>{__chartFrames.push({time:animation.currentTime,transform:getComputedStyle(node).transform});if(animation.playState==='running')requestAnimationFrame(sample);};requestAnimationFrame(sample);
      }return animation;
    };
    Object.defineProperty(globalThis,'HabitMotion',{configurable:true,set(motion){
      Object.defineProperty(globalThis,'HabitMotion',{value:motion,configurable:true});
      const values=motion.values;motion.values=(node,key,target,paint,options)=>values(node,key,target,frame=>{
        paint(frame);__motionFrames.push({key,frame:{...frame},target:{...target},width:document.querySelector('#habit-progress-bar')?.style.width});
      },options);
    }});
  ` });
  await go('/profile'); await evaluate('localStorage.removeItem("habitcents-motion-preference")');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.reload'); await ready();
  assert.equal(await evaluate("document.querySelector('#animations').getAttribute('aria-checked')"), 'false');
  await evaluate("document.querySelector('#animations').focus()");
  await key('Enter', 'Enter', 13);
  assert.equal(await evaluate("document.querySelector('#animations').getAttribute('aria-checked')"), 'true');
  assert.ok(await evaluate("document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle!=='none'"));
  assert.equal(await evaluate('localStorage.getItem("habitcents-motion-preference")'), 'on');
  checks.push('Keyboard Enter enables On under reduced motion; visible focus and switch semantics');
  for (let refresh = 0; refresh < 2; refresh++) {
    if (!refresh) await go('/dashboard');
    await send('Page.reload'); await ready();
    const frames = await evaluate('__motionFrames');
    assert.ok(frames.some(f => Object.keys(f.frame).some(k => f.target[k] > 0 && f.frame[k] > 0 && f.frame[k] < f.target[k])), 'Actual intermediate numeric values');
    assert.ok(frames.some(f => parseFloat(f.width) > 0 && parseFloat(f.width) < 33), 'Actual intermediate progress width');
    assert.equal(await evaluate('HabitMotion.reduced()'), false);
  }
  checks.push('Two consecutive dashboard refreshes animate actual intermediate values/progress under reduced motion + explicit On');
  await go('/expenses');
  const charts = await evaluate('__chartFrames');
  assert.ok(charts.some(f => f.time > 0 && f.transform !== 'none' && !f.transform.includes(', 1, 0, 0)')), 'Intermediate chart transforms');
  await evaluate("__chartFrames=[];import('/js/expenses.js').then(m=>m.loadExpenses())"); await pause(550);
  assert.equal(await evaluate('__chartFrames.length'), 0, 'Unchanged API response does not replay bars');
  await send('Page.reload'); await ready();
  assert.ok(await evaluate('__chartFrames.some(f=>f.time>0)'), 'Chart entrance replays on refresh');
  await evaluate("document.querySelector('#expense-new').click()");
  const dialog = await evaluate("(()=>{const d=document.querySelector('dialog[open]');return {duration:getComputedStyle(d).animationDuration,name:getComputedStyle(d).animationName,running:d.getAnimations().length}})()");
  assert.equal(dialog.name, 'dialog-scale-in'); assert.notEqual(dialog.duration, '0s'); assert.ok(dialog.running > 0);
  assert.equal(await evaluate("(()=>{const d=document.querySelector('dialog[open]');d.close();HabitMotionPreference.set('off');return !d.isConnected})()"), true);
  await evaluate("HabitMotionPreference.set('on')");
  await evaluate("document.querySelector('#expense-new').click()");
  await key('Escape', 'Escape', 27); await wait("!document.querySelector('dialog[open]')");
  checks.push('Chart transforms and CSS dialog animation run with reduced motion + explicit On');
  await go('/habits');
  const noReplay = await evaluate(`(async()=>{
    __motionFrames=[];const h=await import('/js/habits.js');await h.loadHabits();await new Promise(r=>setTimeout(r,500));
    return __motionFrames.every(f=>Object.keys(f.frame).every(k=>f.frame[k]===f.target[k]));
  })()`);
  assert.equal(noReplay, true);
  checks.push('Unchanged API response and same-page rerender do not replay metric entrances');
  const settled = await evaluate(`(()=>{
    let frame;const node=document.querySelector('#habit-summary');
    HabitMotion.values(node,'browser-interrupt',{value:123.45,percent:37},v=>frame={...v});
    return new Promise(resolve=>setTimeout(()=>{const intermediate=frame.value;HabitMotionPreference.set('off');
      const final={...frame};HabitMotionPreference.set('on');setTimeout(()=>resolve({intermediate,final,later:frame}),80);
    },80));
  })()`);
  assert.ok(settled.intermediate > 0 && settled.intermediate < 123.45);
  assert.deepEqual(settled.final, { value: 123.45, percent: 37 });assert.deepEqual(settled.later, settled.final);
  checks.push('Switching Off mid-tween settles exact synchronized targets; On does not replay');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await go('/profile'); await evaluate("document.querySelector('#animations').focus()"); await key(' ', 'Space', 32);
  assert.equal(await evaluate("document.querySelector('#animations').getAttribute('aria-checked')"), 'false');
  await go('/dashboard');await send('Page.reload');await ready();
  assert.ok(await evaluate('__motionFrames.every(f=>Object.keys(f.frame).every(k=>f.frame[k]===f.target[k]))'));
  assert.equal(await evaluate('__chartFrames.length'), 0);
  await evaluate("document.querySelector('#browse-dates').click()");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#date-browser')).animationName"), 'none');
  await key('Escape','Escape',27);
  checks.push('Space selects Off; persists across navigation/refresh; system allowed + Off disables JS charts/numbers and CSS date dialog');
  const blocked = await send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(window,'localStorage',{get(){throw Error('Blocked storage')}})" });
  await go('/profile');
  assert.equal(await evaluate('HabitMotionPreference.get()'), null);
  await evaluate("document.querySelector('#animations').click()");
  assert.equal(await evaluate('HabitMotionPreference.reduced()'), true);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocked.identifier });
  checks.push('Unavailable localStorage falls back to system and switch remains usable');
  await go('/profile');await evaluate("localStorage.setItem('habitcents-motion-preference','corrupt')");
  await send('Page.reload');await ready();
  assert.equal(await evaluate('HabitMotionPreference.get()'), null);
  assert.equal(await evaluate('HabitMotionPreference.reduced()'), false);
  checks.push('Corrupt stored choice falls back to the current system preference');
  assert.deepEqual(errors, []);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: monitor.identifier });
  fs.mkdirSync('.cache/ui-motion', { recursive: true });
  fs.writeFileSync('.cache/ui-motion/preference-results.json', JSON.stringify({ checks, errors, dialog, chartSamples: charts.length, settled }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2)); ws.close();
})().catch(error => { console.error(error); process.exit(1); });
