/* Database-free mobile dashboard regression checks using installed Chrome. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createPreviewApp } = require('../preview-server');

(async () => {
  const output = path.resolve('.cache/mobile-dashboard');
  fs.mkdirSync(output, { recursive: true });
  const server = createPreviewApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const port = 9346;
  const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(output, 'chrome-profile')}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let ws;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const checks = [], errors = [], failedResources = [];
  try {
    let targets;
    for (let i = 0; i < 80; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(1000)})).json(); if (targets.some(t => t.type === 'page')) break; } catch {}
      await pause(100);
    }
    assert.ok(targets?.some(t => t.type === 'page'), 'Chrome debugger available');
    ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve));
    let serial = 0;
    const pending = new Map();
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = pending.get(message.id); pending.delete(message.id);
        message.error ? request.reject(message.error) : request.resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) failedResources.push(message.params.response.url);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
      pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    };
    const wait = async expression => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(50); }
      throw new Error('Timed out: ' + expression);
    };
    const viewport = (width, height = 900) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 760 });
    const go = async route => {
      await send('Page.navigate', { url: origin + route });
      await wait('document.readyState === "complete"');
      await evaluate('document.fonts.ready');
      await pause(100);
    };
    const screenshot = async name => {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
    };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await send('Emulation.setEmulatedMedia', { features: [{name:'prefers-reduced-motion',value:'reduce'}] });
    for (const width of [320, 330, 390, 760, 1280]) {
      await viewport(width, 820); await go('/dashboard');
      await wait('document.querySelectorAll("#week-strip li").length === 7');
      const layout = await evaluate(`(() => {
        const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
        const visible = s => getComputedStyle(document.querySelector(s)).display !== 'none';
        return {header:rect('.time-header'),identity:rect('.header-identity'),date:rect('.header-date'),strip:rect('#week-strip'),previous:rect('#previous-week'),next:rect('#next-week'),clock:visible('#live-clock'),today:visible('#week-today'),overflow:document.documentElement.scrollWidth>innerWidth,days:[...document.querySelectorAll('#week-strip button')].map(b=>({width:b.clientWidth,scroll:b.scrollWidth}))};
      })()`);
      if (width <= 760) {
        assert.equal(layout.clock,false); assert.equal(layout.today,false);
        assert.ok(layout.date.x >= layout.identity.right - 1, 'date sits to the right of identity');
        assert.ok(layout.date.bottom <= layout.header.bottom, 'date remains inside header');
        assert.equal(layout.previous.width,0,'previous arrow hidden');
        assert.equal(layout.next.width,0,'next arrow hidden');
        assert.equal(layout.overflow,false); assert.ok(layout.days.every(d=>d.scroll<=d.width), 'day text fits');
      } else { assert.equal(layout.clock,true); assert.equal(layout.today,true); }
      if (width === 330 || width === 1280) await screenshot('dashboard-header-'+width);
      if (width <= 760) {
        const placement=await evaluate(`(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();const streak=document.querySelector('.streak-figure');return {progress:r('.progress-panel').toJSON(),trigger:r('#open-dashboard-expense').toJSON(),streak:r('.universal-streak-panel').toJSON(),figure:r('.streak-figure').toJSON(),number:r('#universal-streak').toJSON(),label:r('.streak-figure>span:last-child').toJSON(),savings:r('.savings-panel').toJSON(),last:r('.spending-panel').toJSON(),inline:getComputedStyle(document.querySelector('.quick-entry-panel')).display,streakOverflow:streak.scrollWidth>streak.clientWidth};})()`);
        assert.equal(placement.inline,'none');
        assert.ok(Math.abs(placement.progress.y-placement.trigger.y)<1,'expense button beside progress');
        assert.ok(placement.streak.y>=placement.trigger.bottom,'streak below expense button');
        assert.ok(Math.abs(placement.streak.bottom-placement.progress.bottom)<1,'progress spans both cards');
        assert.ok(placement.savings.y>=placement.last.bottom,'savings is last');
        assert.equal(placement.streakOverflow,false,'streak fits horizontally');
        assert.ok(placement.number.y>=placement.streak.y && placement.number.bottom<=placement.streak.bottom,'number fits card height');
        assert.ok(placement.number.height<60,'streak number stays on one line');
        assert.ok(placement.label.right<=placement.streak.right,'streak label fits card');
        await wait(`document.querySelector('#universal-streak').dataset.state==='ready'`);
        const realStreak=await evaluate(`fetch('/universal-streak').then(r=>r.json()).then(data=>data.count)`);
        assert.equal(await evaluate(`document.querySelector('#universal-streak').textContent`),String(realStreak));
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('.spent-figure')).display`),'none');
        await evaluate(`document.querySelector('#open-dashboard-expense').click();document.querySelector('#expense-name').value='Draft tea';`);
        assert.equal(await evaluate(`document.querySelector('#dashboard-expense-dialog').open && document.querySelector('#dashboard-expense-dialog .expense-form')!==null`),true);
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('.quick-entry-panel')).display !== 'none'`),true);
        if(width===330) await screenshot('dashboard-expense-modal-330');
        await evaluate(`document.querySelector('#close-dashboard-expense').click()`);
        await wait(`document.querySelector('.dashboard-entry-group .expense-form')!==null`);
        assert.equal(await evaluate(`document.querySelector('#expense-name').value`),'Draft tea');
        assert.equal(await evaluate(`document.querySelector('.dashboard-entry-group .expense-form')!==null`),true);
        await evaluate(`document.querySelector('#open-dashboard-expense').click()`);
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await wait(`!document.querySelector('#dashboard-expense-dialog').open && document.querySelector('.dashboard-entry-group .expense-form')!==null`);
        assert.equal(await evaluate(`document.activeElement.id`),'open-dashboard-expense','focus returns after Escape');
      } else {
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('#open-dashboard-expense')).display`),'none');
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('.quick-entry-panel')).display !== 'none'`),true);
        assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.spent-figure')).display`),'none');
      }
      checks.push({width,status:'passed'});
    }
    await viewport(390,820);await go('/dashboard');
    await wait(`document.querySelector('#week-strip button')!==null`);
    const first=await evaluate(`document.querySelector('#week-strip button').dataset.date`);
    const touch=async (x1,y1,x2,y2)=>{
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1}]});
      await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x2,y:y2}]});
      await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    };
    const strip=await evaluate(`document.querySelector('#week-strip').getBoundingClientRect().toJSON()`);
    await touch(strip.x+strip.width*.8,strip.y+30,strip.x+strip.width*.2,strip.y+30);
    await wait(`document.querySelector('#week-strip button').dataset.date!==${JSON.stringify(first)}`);
    assert.equal(await evaluate(`document.querySelector('#dashboard-workspace').dataset.mode`),'today','swipe does not select a date');
    await touch(strip.x+strip.width*.2,strip.y+30,strip.x+strip.width*.8,strip.y+30);
    await wait(`document.querySelector('#week-strip button').dataset.date===${JSON.stringify(first)}`);
    await evaluate(`document.querySelector('#week-strip button').click()`);
    await wait(`document.querySelector('#dashboard-workspace').dataset.mode==='history'`);
    assert.equal(await evaluate(`document.querySelector('#open-dashboard-expense').hidden`),true,'history hides expense button');
    await evaluate(`document.querySelector('#back-to-today').click()`);
    await wait(`document.querySelector('#dashboard-workspace').dataset.mode==='today'`);
    await evaluate(`document.querySelector('#open-dashboard-expense').click()`);
    await viewport(1280,820);
    await wait(`!document.querySelector('#dashboard-expense-dialog').open && document.querySelector('.dashboard-entry-group .expense-form')!==null`);
    checks.push({interaction:'week swipes, history, Escape, draft preservation and desktop resize',status:'passed'});
    for(const theme of ['light','dark'])for(const scenario of ['empty','failure','longName','streakSetup']){
      await viewport(320,820);await go('/dashboard?scenario='+scenario);
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await wait(`!document.querySelector('#streak-status').textContent.startsWith('Loading')`);
      assert.notEqual(await evaluate(`document.querySelector('#universal-streak').getAttribute('aria-label')`),'Demo streak: 23 days');
      assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`),false,theme+' '+scenario+' fits');
      await screenshot('dashboard-'+theme+'-'+scenario);
      checks.push({theme,scenario,status:'passed'});
    }
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    for(const page of ['login','signup']){
      await evaluate(`localStorage.removeItem('habitcents-motion-preference')`);
      await go('/'+page);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.auth-submit')).transitionDuration`),'0s','system reduced motion disables auth transition');
      await evaluate(`HabitMotionPreference.set('on')`);
      await wait(`getComputedStyle(document.querySelector('.auth-submit')).transitionDuration!=='0s'`);
      await evaluate(`HabitMotionPreference.set('off')`);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.auth-submit')).transitionDuration`),'0s','explicit off disables auth transition');
      checks.push({page,interaction:'system motion preference and explicit on/off',status:'passed'});
    }
    assert.deepEqual(errors,[],'no browser runtime errors');
    console.log(JSON.stringify(checks,null,2));
  } finally { ws?.close(); chrome.kill(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
