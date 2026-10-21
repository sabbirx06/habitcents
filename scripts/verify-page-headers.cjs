// Database-free Chrome regression checks. Start npm run preview and headless
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
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  try {
    await send('Runtime.enable');
    for (const width of [1366,390,320]) {
      await send('Emulation.setDeviceMetricsOverride', {width,height:900,deviceScaleFactor:1,mobile:width<700});
      for (const page of ['dashboard','habits','expenses','savings','profile']) {
        await go('/'+page);
        await wait('!document.querySelector(".workspace-status")?.textContent.includes("Loading")');
        const layout = await evaluate(`(() => { const h=document.querySelector('.page-header'),r=h.getBoundingClientRect(),s=getComputedStyle(h);return {overflow:document.documentElement.scrollWidth>innerWidth,heading:h.querySelector('h1').textContent,position:s.position,bg:s.backgroundColor,width:r.width,left:r.left,center:h.querySelector('.page-header-center').textContent};})()`);
        assert.equal(layout.overflow,false,`${page} ${width} overflow`);
        assert.equal(layout.position,'static');
        assert.equal(layout.bg,'rgb(34, 35, 32)');
        if(page!=='dashboard') assert.equal(layout.center,'');
        if(page==='habits') {
          await wait('document.querySelector("#habit-history-range").textContent.includes(" – ")');
          await wait('!!document.querySelector(".habit-heatmap .heat-cell")');
          assert.equal(await evaluate(`(() => { const cells=[...document.querySelector('.habit-heatmap').querySelectorAll('.heat-cell')],format=d=>new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric'}).format(new Date(d+'T12:00:00'));return document.querySelector('#habit-history-range').textContent === 'History · '+format(cells[0].dataset.date)+' – '+format(cells.at(-1).dataset.date); })()`),true);
          await click('#habit-new'); await wait('!!document.querySelector("dialog[open]")');
        }
        if(page==='expenses') {
          await wait('!!document.querySelector("#expense-month").value');
          const original=await evaluate('document.querySelector("#expense-month").value');
          await click('#month-previous');
          assert.notEqual(await evaluate('document.querySelector("#expense-month").value'),original);
          await click('#month-next'); assert.equal(await evaluate('document.querySelector("#expense-month").value'),original);
          await evaluate(`const monthInput=document.querySelector('#expense-month');monthInput.value='2025-12';monthInput.dispatchEvent(new Event('change',{bubbles:true}));`);
          await click('#month-next'); assert.equal(await evaluate('document.querySelector("#expense-month").value'),'2026-01');
          await click('#month-previous'); assert.equal(await evaluate('document.querySelector("#expense-month").value'),'2025-12');
          await evaluate(`document.querySelector('#expense-month').value=${JSON.stringify(original)};document.querySelector('#expense-month').dispatchEvent(new Event('change',{bubbles:true}));`);
          await click('#expense-new'); await wait('!!document.querySelector("dialog[open]")');
        }
        if(page==='savings') { await click('#goal-new'); await wait('!!document.querySelector("dialog[open]")'); }
        if(page==='dashboard') {
          await wait('document.querySelector("#live-clock").textContent !== "—" && document.querySelectorAll("#week-strip li").length === 7');
          await click('#browse-dates'); await wait('document.querySelector("#date-browser").open');
          await click('#next-month'); await click('#close-date-browser');
          assert.equal(await evaluate('document.querySelector("#date-browser").open'),false);
        }
        if(page==='profile') assert.equal(await evaluate('document.querySelector(".page-header-right a").getAttribute("href")'),'/logout');
        if(await evaluate('!!document.querySelector("dialog[open]")')) await evaluate('document.querySelector("dialog[open]").close()');
        // Tab forward from a banner control; assert keyboard focus uses a visible outline.
        if(page!=='habits') {
          const first=page==='dashboard'?'#browse-dates':page==='expenses'?'#month-previous':page==='savings'?'#goal-new':'.page-header-right a';
          await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'});
          await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab'});
          await evaluate(`document.querySelector(${JSON.stringify(first)}).focus()`);
          await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',modifiers:8});
          await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',modifiers:8});
          await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'});
          await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab'});
          const focus = await evaluate(`({tag:document.activeElement.tagName,id:document.activeElement.id,visible:document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outlineWidth})`);
          assert.ok(focus.visible && parseFloat(focus.outline)>0,JSON.stringify({page,width,focus}));
        }
        const shot=await send('Page.captureScreenshot',{format:'png'});
        fs.writeFileSync(`artifacts/header-${page}-${width}.png`,Buffer.from(shot.data,'base64'));
        await evaluate('document.documentElement.dataset.theme="dark"');
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".page-header")).backgroundColor'),'rgb(247, 246, 240)');
        checks.push({page,width,...layout});
      }
    }
    for (const page of ['dashboard','habits','expenses','savings','profile']) {
      for(const scenario of ['empty','failure','longName','emptyName']) {
        await go('/'+page+'?scenario='+scenario);
        await wait('!document.querySelector(".workspace-status")?.textContent.includes("Loading")');
        assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,`${page} ${scenario} overflow`);
        assert.equal(await evaluate('document.querySelectorAll(".page-header h1").length'),1);
        if((page==='profile'||page==='dashboard')&&scenario==='longName') assert.match(await evaluate('document.querySelector(".page-header h1").textContent'),/Alexandria/);
      }
    }
    // The preview logout redirects safely without touching real sessions.
    await go('/profile'); await click('.page-header-right a'); await wait('location.pathname === "/dashboard"');
    assert.deepEqual(errors,[]);
    fs.writeFileSync('artifacts/page-header-browser.json',JSON.stringify({checks,errors,scenarios:20},null,2));
    console.log('Passed: five pages at 1366, 390 and 320px; light/dark; actions; calendar; month navigation; 20 empty/error/name scenarios.');
  } finally { socket.close(); }
})().catch(e=>{ console.error(e);process.exitCode=1; });
