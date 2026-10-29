/* Local, database-free habit-strip browser verification. Uses installed Chrome. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createPreviewApp } = require('../preview-server');

(async () => {
  const output = path.resolve('.cache/habit-strip-review');
  fs.mkdirSync(output, { recursive: true });
  const server = createPreviewApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const port = 9338;
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
    await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    for(const width of [1440,1024,768,390,320]){
      await viewport(width);await go('/habits');
      await wait('document.querySelectorAll("#habit-list .habit-card").length > 0 && [...document.querySelectorAll("#habit-list .habit-history .workspace-status")].every(e=>!e.textContent.includes("Loading"))');
      const rows=await evaluate(`Array.from(document.querySelectorAll('#habit-list .habit-card')).map(card=>{
        const cells=[...card.querySelectorAll('.heat-cell')],rects=cells.map(c=>c.getBoundingClientRect());
        return {left:card.getBoundingClientRect().left,top:card.getBoundingClientRect().top,count:cells.length,
          rowCount:new Set(rects.map(r=>Math.round(r.top))).size,square:rects.every(r=>Math.abs(r.width-r.height)<1),
          chronological:cells.every((c,i)=>i===0 || new Date(c.dataset.date)-new Date(cells[i-1].dataset.date)===86400000),
          first:cells[0].dataset.date,last:cells.at(-1).dataset.date};
      })`);
      assert.ok(rows.length>=3);assert.ok(rows.every(r=>r.rowCount===(width<=760?7:3)&&r.square&&r.chronological&&r.count>=42));
      assert.ok(rows.every(r=>r.left===rows[0].left));assert.ok(rows.every((r,i)=>i===0||r.top>rows[i-1].top));
      assert.ok(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'));
      assert.ok(await evaluate(`Array.from(document.querySelectorAll('#habit-list .heatmap-months')).every(months=>{const labels=[...months.children].filter(label=>label.textContent);return labels.every((label,i)=>{const range=document.createRange();range.selectNodeContents(label);return i===labels.length-1||range.getBoundingClientRect().right<=labels[i+1].getBoundingClientRect().left;});})`),'Month labels do not overlap');
      const colors=await evaluate('[...document.querySelectorAll("#habit-list .habit-card")].map(c=>getComputedStyle(c.querySelector(".heat-cell[data-state=completed]")).backgroundColor)');
      assert.equal(new Set(colors).size,colors.length,'Each sample habit uses its own history color');
      assert.ok(await evaluate('[...document.querySelectorAll("#habit-list .habit-card")].every(c=>getComputedStyle(c.querySelector(".heat-cell[data-state=completed]")).backgroundColor===getComputedStyle(c.querySelector(".habit-schedule")).backgroundColor)'), 'Completed history cells exactly match the selected habit color');
      await screenshot('habits-'+width);checks.push(width+'px: '+(width<=760?'seven weekday rows sized to available width':'three square-cell rows')+', distinct habit colors, chronological dates, no page overflow');
    }
    await viewport(1440);await go('/habits');
    await wait('document.querySelector("#habit-list .heat-cell[data-state=completed]") !== null');
    const today=await evaluate('[...document.querySelectorAll("#habit-list .heat-cell")].find(c=>c.tabIndex===0).dataset.date');
    await evaluate('[...document.querySelectorAll("#habit-list .heat-cell")].find(c=>c.tabIndex===0).focus()');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
    assert.equal(await evaluate('document.activeElement.dataset.date'),new Date(new Date(today+'T12:00Z')-86400000).toISOString().slice(0,10));
    await evaluate('document.activeElement.click()');await wait('!!document.querySelector(".workspace-dialog[open] .heat-cell")');
    const calendar=await evaluate('(()=>{const g=document.querySelector(".workspace-dialog .habit-heatmap");return {rows:getComputedStyle(g).gridTemplateRows.split(" ").length,count:g.children.length}})()');
    assert.equal(calendar.rows,7);assert.equal(calendar.count,364);
    checks.push('Left/Right traverses adjacent dates; clicking a day still opens the seven-row full-year calendar');
    await go('/habits?scenario=historyFailure');
    await wait('document.querySelector("#habit-list .workspace-status")?.textContent.includes("History unavailable")');
    assert.equal(await evaluate('document.querySelectorAll("#habit-list .heat-cell[data-state=completed]").length'),0);
    assert.ok(await evaluate('[...document.querySelectorAll("#habit-list .habit-history button")].some(b=>b.textContent==="Retry history"&&!b.hidden)'));
    checks.push('Failed history retains unknown cells and visible retry; no invented completions');
    await go('/habits?scenario=empty');await wait('document.querySelector("#habits-status")?.textContent === ""');
    assert.equal(await evaluate('document.querySelectorAll("#habit-list .habit-card").length'),0);
    checks.push('Empty account shows no fabricated habit rows');
    assert.deepEqual(errors,[],'No browser runtime errors');
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({checks,errors},null,2));
    console.log(JSON.stringify({checks,errors},null,2));
  } finally {
    ws?.close(); chrome.kill(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

