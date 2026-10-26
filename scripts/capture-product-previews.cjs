/* Local, database-free habit-strip browser verification. Uses installed Chrome. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createPreviewApp } = require('../preview-server');

(async () => {
  const output = path.resolve('.cache/product-capture');
  fs.mkdirSync(output, { recursive: true });
  const server = createPreviewApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const port = 9340;
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
    const assets=path.resolve('public/media/previews');fs.mkdirSync(assets,{recursive:true});
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await viewport(1280,840);
    for(const [page,ready] of [
      ['dashboard','document.querySelector("#habit-progress").textContent !== "—" && !!document.querySelector("#today-habits .habit-row, #today-habits button")'],
      ['habits','!!document.querySelector("#habit-list .heat-cell[data-state=completed]")'],
      ['expenses','document.querySelector("#expenses-status").textContent === ""'],
      ['savings','!!document.querySelector("#goals-list .goal-card")']
    ]){
      await go('/'+page);await wait(ready);await pause(500);
      await evaluate(`document.querySelectorAll('.demo-notice,.preview-banner,main>.workspace-muted:first-child').forEach(e=>e.hidden=true)`);
      await evaluate('document.fonts.ready');
      const shot=await send('Page.captureScreenshot',{format:'webp',quality:88,captureBeyondViewport:false});
      fs.writeFileSync(path.join(assets,page+'.webp'),Buffer.from(shot.data,'base64'));
      console.log(page+': captured local sample-data preview');
    }
    assert.deepEqual(errors,[]);
  } finally {
    ws?.close(); chrome.kill(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });


