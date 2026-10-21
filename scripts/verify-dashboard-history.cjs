// Run with the preview server on 3001 and headless Chrome debugging on 9223.
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
 const tabs = await (await fetch('http://127.0.0.1:9223/json/list')).json();
 const ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
 await new Promise(resolve => ws.addEventListener('open', resolve, { once:true }));
 let id = 0;
 const pending = new Map();
 ws.addEventListener('message', ({ data }) => {
  const event = JSON.parse(data);
  if (!event.id) return;
  const request = pending.get(event.id);
  pending.delete(event.id);
  event.error ? request.reject(event.error) : request.resolve(event.result);
 });
 const send = (method, params = {}) => new Promise((resolve, reject) => {
  pending.set(++id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
 });
 const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
 };
 const wait = async expression => {
  for (let attempt = 0; attempt < 100; attempt++) {
   if (await evaluate(expression)) return;
   await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out: ' + expression);
 };
 try {
  await send('Page.enable');
  await send('Page.navigate', { url:'http://127.0.0.1:3001/dashboard' });
  await wait('document.querySelector("#habit-progress")?.textContent === "1/3"');
  for (const [width, height] of [[1715,993], [1366,768], [900,900], [390,844], [320,740]]) {
   await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false });
   await evaluate(width === 1715 ? 'document.querySelector("#week-strip button:not([aria-current=date])").click()' : '(document.querySelector("#week-strip [aria-current=date]").closest("li").nextElementSibling?.querySelector("button") || document.querySelector("#week-strip button:not([aria-current=date])")).click()');
   await wait('document.querySelector("#dashboard-workspace").dataset.mode === "history" && document.querySelector("#history-spent .money-integer") !== null && !document.querySelector("#spending-chart").hidden');
   await evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
   assert.equal(await evaluate('getComputedStyle(document.querySelector(".savings-ring svg")).display'), 'none');
   assert.equal(await evaluate('getComputedStyle(document.querySelector(".savings-ring"), "::after").height'), '6px');
   assert.equal(await evaluate('document.querySelector("#savings-progress").style.getPropertyValue("--savings-fill")'), '37.5%');
   const geometry = await evaluate(`(() => {
    const selectors = ['.historical-progress', '.historical-habits', '.historical-summary', '.historical-expenses', '.universal-streak-panel', '.savings-panel', '.completion-panel', '.spending-panel'];
    return { width:document.documentElement.scrollWidth, cards:selectors.map(selector => {
     const r = document.querySelector(selector).getBoundingClientRect();
     return { selector, x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
    }) };
   })()`);
   assert.ok(geometry.width <= width, JSON.stringify(geometry));
   for (const card of geometry.cards) {
    assert.ok(card.width > 0 && card.height > 0 && card.x >= 0 && card.right <= width, JSON.stringify(card));
    for (const other of geometry.cards) {
     if (card === other) continue;
     assert.ok(card.right <= other.x + 1 || other.right <= card.x + 1 || card.bottom <= other.y + 1 || other.bottom <= card.y + 1, JSON.stringify({card,other}));
    }
   }
   if (width > 1100) {
    const [progress, habits, recorded, expenses, streak, savings, completion, spending] = geometry.cards;
    assert.ok(Math.abs(expenses.y - progress.y) < 1 && Math.abs(expenses.bottom - savings.bottom) < 1);
    assert.ok(Math.abs(habits.y - progress.y) < 1 && Math.abs(habits.bottom - streak.bottom) < 1);
    assert.ok(Math.abs(streak.x - progress.x) < 1 && Math.abs(savings.x - recorded.x) < 1);
    assert.ok(Math.abs(completion.y - spending.y) < 1 && spending.width > completion.width * 2);
   }
   const screenshot = await send('Page.captureScreenshot', { format:'png', captureBeyondViewport:true });
   fs.writeFileSync(`artifacts/dashboard-history-fixed-${width}.png`, Buffer.from(screenshot.data, 'base64'));
   await evaluate('document.querySelector("#back-to-today").click()');
   await wait('!document.querySelector("#dashboard-grid").hidden && document.querySelector("#history-view").hidden');
   await wait('document.querySelector("#habit-progress").textContent === "1/3"');
   assert.ok(await evaluate('document.querySelector(".progress-panel #habit-progress-bar") !== null && document.querySelector(".progress-panel #habit-progress-note") !== null'));
   assert.equal(await evaluate('document.querySelector(".progress-panel h2").textContent'), 'Today’s progress');
   assert.equal(await evaluate('document.querySelector(".completion-panel").getBoundingClientRect().height'), 0);
   assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".savings-ring svg")).display'), 'none');
   assert.equal(await evaluate('getComputedStyle(document.querySelector(".savings-ring"), "::after").content'), 'none');
   if (width > 1100) {
    const areas = await evaluate(`['.progress-panel','.budget-panel','.savings-panel'].map(selector=>getComputedStyle(document.querySelector(selector)).gridArea.split(' / ')[0])`);
    assert.deepEqual(areas, ['progress','budget','savings']);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".dashboard-lower")).display'), 'grid');
   }
   const screenshotToday = await send('Page.captureScreenshot', { format:'png', captureBeyondViewport:true });
   fs.writeFileSync(`artifacts/dashboard-fixed-today-${width}.png`, Buffer.from(screenshotToday.data, 'base64'));
   console.log(`PASS ${width}×${height}: date layout has no overlaps or overflow; original Today layout restored`);
  }
 } finally { ws.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
