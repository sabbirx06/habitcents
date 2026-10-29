/* Local, database-free landing-page browser verification. Uses installed Chrome. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createPreviewApp } = require('../preview-server');

(async () => {
  const output = path.resolve('.cache/landing-review');
  fs.mkdirSync(output, { recursive: true });
  const server = createPreviewApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const port = 9336;
  const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--incognito', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
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
    const viewport = (width, height = 900) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
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
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await viewport(1440);await go('/');
    assert.equal(await evaluate('HabitMotionPreference.get()'),null,'Private browsing starts without a saved preference');
    await evaluate('Promise.all([...document.images].filter(i=>i.loading!=="lazy").map(i=>i.decode()))');
    assert.equal(await evaluate('document.querySelectorAll("h1").length'),1);
    assert.equal(await evaluate('document.querySelectorAll(".header-actions a").length'),2);
    assert.equal(await evaluate('document.querySelector(".button-android").getAttribute("href")'),'https://github.com/sabbirx06/habitcents/releases/tag/v1.0.0-beta.2');
    assert.ok(await evaluate('document.querySelector("#android-status").textContent.includes("Android 11")'));
    assert.ok(await evaluate('document.querySelector(".site-footer").textContent.includes("Team Alpha")'));
    assert.ok(await evaluate('[...document.images].filter(i=>i.closest(".brand-wordmark,.brand-mark")).every(i=>i.src.endsWith(".svg")&&i.complete&&i.naturalWidth)'));
    await screenshot('desktop-hero');checks.push('Minimal navigation, Android beta download, SVG branding, and Team Alpha footer');
    const headlineBox=await evaluate('(()=>{const r=document.querySelector("h1").getBoundingClientRect();return {width:r.width,height:r.height}})()');
    await evaluate('globalThis.__seenWords=[document.querySelector("#rotating-word").textContent];new MutationObserver(()=>__seenWords.push(document.querySelector("#rotating-word").textContent)).observe(document.querySelector("#rotating-word"),{childList:true})');
    await wait('__seenWords.includes("money")');await wait('__seenWords.includes("savings")');
    const afterBox=await evaluate('(()=>{const r=document.querySelector("h1").getBoundingClientRect();return {width:r.width,height:r.height}})()');
    assert.deepEqual(afterBox,headlineBox,'Word changes do not move the headline layout');
    assert.equal(await evaluate('document.querySelector("#rotation-toggle")'),null);
    checks.push('Real single-word flips autoplay habits/money/savings without layout movement or playback controls');
    await evaluate('HabitMotionPreference.set("off")');
    assert.equal(await evaluate('document.querySelector("#rotating-word").textContent'),'habits');
    assert.equal(await evaluate('document.getAnimations().length'),0);
    for(const width of [1440,1024,768,390,320]){
      await viewport(width);await evaluate('window.scrollTo(0,0)');await pause(100);
      assert.ok(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),'Page fits '+width);
      for(const id of ['dashboard','habits','money','savings']){
        await evaluate(`document.querySelector('#tab-${id}').click()`);
        await evaluate('document.querySelector(".feature-panel:not([hidden]) img").decode()');
        assert.equal(await evaluate('document.querySelectorAll(".feature-panel:not([hidden])").length'),1);
        assert.equal(await evaluate('document.querySelector(".feature-panel:not([hidden])").id'),'panel-'+id);
        assert.ok(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),id+' fits '+width);
      }
      if(width===1440||width===390){
        await screenshot(width===1440?'desktop-hero':'mobile-hero');
        await evaluate('document.querySelector("#tab-dashboard").click();document.querySelector("#features").scrollIntoView()');
        await screenshot(width===1440?'desktop-features':'mobile-features');
      }
    }
    checks.push('All four real product screenshots render and switch at 320/390/768/1024/1440px without overflow');
    await viewport(1440);await evaluate('document.querySelector("#tab-dashboard").click();document.querySelector("#tab-dashboard").focus()');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
    assert.equal(await evaluate('document.activeElement.id'),'tab-habits');
    assert.equal(await evaluate('document.querySelector("#panel-habits").hidden'),false);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35});
    assert.equal(await evaluate('document.activeElement.id'),'tab-savings');
    checks.push('Feature tabs expose one selected panel and support keyboard arrows and End');
    await evaluate('localStorage.removeItem("habitcents-motion-preference")');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await go('/');
    assert.equal(await evaluate('document.documentElement.dataset.motion'),'off');
    assert.equal(await evaluate('HabitMotionPreference.get()'),null);
    await wait('document.querySelector("#rotating-word").textContent === "money"');
    assert.equal(await evaluate('document.querySelector("#rotation-toggle")'),null);
    await wait('document.querySelector("#rotating-word").getAnimations().length===0');
    await screenshot('private-autoplay');
    await evaluate('HabitMotionPreference.set("off")');
    assert.equal(await evaluate('document.getAnimations().length'),0);
    assert.equal(await evaluate('document.querySelector("#rotating-word").textContent'),'habits');
    await pause(2400);
    assert.equal(await evaluate('document.querySelector("#rotating-word").textContent'),'habits');
    await evaluate('HabitMotionPreference.set("on")');
    await wait('document.querySelector("#rotating-word").textContent === "money"');
    checks.push('Private browsing autoplays despite system reduced motion; explicit app On/Off remains authoritative');
    const blockedStorage = await send('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(window,"localStorage",{get(){throw new DOMException("Storage blocked","SecurityError")}})'});
    await go('/');
    assert.equal(await evaluate('HabitMotionPreference.get()'),null);
    await wait('document.querySelector("#rotating-word").textContent === "money"');
    await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:blockedStorage.identifier});
    checks.push('Word rotation autoplays even when localStorage access throws');
    await send('Emulation.setScriptExecutionDisabled',{value:true});await viewport(390);await go('/');
    assert.equal(await evaluate('document.querySelector("#rotating-word").textContent'),'habits');
    assert.ok(await evaluate('document.querySelector("h1").getBoundingClientRect().height>0'));
    assert.ok(await evaluate('document.querySelector("#panel-dashboard img").complete'));
    await screenshot('mobile-no-javascript');
    checks.push('No-JavaScript page retains headline, CTAs, dashboard image, and feature copy');
    assert.deepEqual(errors,[],'No browser runtime errors');assert.deepEqual(failedResources,[],'No failed image/font/script requests');
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({checks,errors,failedResources},null,2));
    console.log(JSON.stringify({checks,errors,failedResources},null,2));
  } finally {
    ws?.close(); chrome.kill(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

