// Database-free shared expense-icon regression checks. Start npm run preview and headless
// Chrome with --remote-debugging-port=9224 before running this script.
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const targets = await (await fetch('http://127.0.0.1:9224/json/list')).json();
  const socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => socket.addEventListener('open', r));
  let id = 0;
  const pending = new Map(), errors = [], checks = [];
  socket.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const wait = async expression => {
    for (let i=0;i<100;i++) { if (await evaluate(expression)) return; await new Promise(r=>setTimeout(r,100)); }
    throw Error('Timed out: ' + expression);
  };
  const go = async path => {
    await send('Page.navigate', {url:'http://127.0.0.1:3001'+path});
    await wait('document.readyState === "complete" && !!document.querySelector(".page-header")');
  };
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await go('/expenses');
    await wait('document.querySelectorAll(".transaction-icon").length > 0');
    const originalPaths=await evaluate('Object.fromEntries([...document.querySelectorAll(".transaction")].map(row=>[row.dataset.category,row.querySelector("path").getAttribute("d")]))');
    const categories=['transport','food','subscriptions','shopping','uncategorized','unknown','toString'];
    await send('Page.addScriptToEvaluateOnNewDocument',{source:
      'window.originalFetch=window.fetch;window.fetch=(url,...args)=>url==="/get-expenses"?Promise.resolve(new Response(JSON.stringify('+JSON.stringify(categories)+'.map((category,i)=>({expense_id:i+1,category,description:i===0?"Very long household essentials description ".repeat(5):category+" purchase",amount:i===0?99999999.99:240.25,date:"2026-10-20"}))),{status:200,headers:{"Content-Type":"application/json"}})):originalFetch(url,...args);'
    });
    for (const width of [1366,768,390,320]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<700});
      await go('/dashboard');
      await wait('document.querySelectorAll("#recent-expenses .expense-row").length === 7');
      const rows=await evaluate(`[...document.querySelectorAll('#recent-expenses .expense-row')].map(row=>{const [icon,info,amount]=row.children,r=row.getBoundingClientRect(),i=icon.getBoundingClientRect(),t=info.getBoundingClientRect(),a=amount.getBoundingClientRect(),description=info.querySelector('.expense-description');return {category:row.dataset.category,path:icon.querySelector('path').getAttribute('d'),decorative:icon.getAttribute('aria-hidden'),focusable:icon.querySelector('svg').getAttribute('focusable'),tileWidth:i.width,textWidth:t.width,ordered:i.right<=t.left && t.right<=a.left,contained:a.right<=r.right && i.left>=r.left,aligned:Math.abs((a.top+a.height/2)-(i.top+i.height/2))<2,ellipsis:getComputedStyle(description).textOverflow,fullCopy:description.textContent===description.title,background:getComputedStyle(row).backgroundColor,height:r.height,amount:amount.textContent};})`);
      for (const row of rows) {
        assert.equal(row.path,originalPaths[row.category]);
        assert.equal(row.decorative,'true');assert.equal(row.focusable,'false');
        assert.equal(row.tileWidth,32);assert.ok(row.textWidth>35,JSON.stringify({width,row}));
        assert.ok(row.ordered && row.contained && row.aligned,JSON.stringify({width,row}));
        assert.equal(row.ellipsis,'ellipsis');assert.ok(row.fullCopy);
        assert.notEqual(row.background,'rgba(0, 0, 0, 0)');
      }
      assert.match(rows[0].amount,/99,999,999\.99/);
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      assert.equal(await evaluate('document.querySelector(".activity-panel .card-bottom").getAttribute("href")'),'/expenses');
      await evaluate('document.querySelector(".activity-panel").scrollIntoView({block:"center"})');
      const screenshot=await send('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync('artifacts/expense-icons-'+width+'.png',Buffer.from(screenshot.data,'base64'));
      checks.push({width,rows});
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync('artifacts/expense-icons-browser.json',JSON.stringify({checks,errors},null,2));
    console.log('Passed: shared paths match Expenses; all categories and unknown fallbacks; long copy and large amounts; 1366, 768, 390 and 320px.');
  } finally { socket.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
