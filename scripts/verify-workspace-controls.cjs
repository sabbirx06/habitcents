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
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus();document.querySelector(${JSON.stringify(selector)}).click()`);
  const close = async () => { await evaluate('document.querySelector("dialog[open]").close()'); await wait('!document.querySelector("dialog")'); };
  const dialogButton = label => evaluate(`{const button=[...document.querySelectorAll('dialog button')].find(button=>button.textContent.trim()===${JSON.stringify(label)});button.focus();button.click();}`);
  const fill = values => evaluate(`Object.entries(${JSON.stringify(values)}).forEach(([name,value])=>{document.querySelector('dialog [name="'+name+'"]').value=value;})`);
  const submit = async () => { await evaluate('document.querySelector("dialog form").requestSubmit()'); await wait('!document.querySelector("dialog")'); };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    for (const width of [1366,768,390,320]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<700});
      for(const page of ['habits','expenses','savings']) {
        await go('/'+page);
        await wait('!document.querySelector(".workspace-status")?.textContent.includes("Loading")');
        assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,page+' overflow at '+width);
        assert.equal(await evaluate('document.querySelectorAll(".page-header").length'),1);
        const fab=await evaluate(`(()=>{const f=document.querySelector('.workspace-fab');if(!f)return null;const r=f.getBoundingClientRect(),d=document.querySelector('.nav-dock').getBoundingClientRect();return {position:getComputedStyle(f).position,visible:r.right<=innerWidth && r.bottom<=innerHeight,clear:r.bottom<d.top,label:f.getAttribute('aria-label'),count:document.querySelectorAll('.workspace-fab').length};})()`);
        if(page==='savings') assert.equal(fab,null);
        else { assert.equal(fab.position,'fixed');assert.ok(fab.visible&&fab.clear);assert.equal(fab.count,1); }
        if(page==='habits') {
          await wait('document.querySelectorAll(".habit-card").length===3');
          assert.equal(await evaluate('document.querySelectorAll(".habit-summaries > section").length'),2);
          const tones=await evaluate('[...document.querySelectorAll(".habit-card")].map(card=>({color:card.dataset.color,tone:getComputedStyle(card).getPropertyValue("--habit-tone"),icon:getComputedStyle(card.querySelector(".habit-icon")).backgroundColor,completed:getComputedStyle(card.querySelector(".heat-cell[data-state=completed]")).backgroundColor}))');
          assert.equal(new Set(tones.map(t=>t.icon)).size,3);assert.equal(new Set(tones.map(t=>t.completed)).size,3);
          assert.equal(await evaluate('!!document.querySelector("#habit-presets")'),false);
          await click('#habit-new'); await wait('!!document.querySelector("dialog input[name=name]")');
          await dialogButton('Choose a preset'); await wait('document.querySelector("dialog h2").textContent==="Explore presets"');
          await dialogButton('Add'); await wait('!!document.querySelector("dialog input[name=name]")');
          assert.ok(await evaluate('!!document.querySelector("dialog input[name=name]").value'));
          await close(); assert.equal(await evaluate('document.activeElement.id'),'habit-new');
          const control=await evaluate('document.querySelector(".habit-complete").getAttribute("aria-pressed")');
          await click('.habit-complete'); await wait(`document.querySelector('.habit-complete').getAttribute('aria-pressed')!==${JSON.stringify(control)}`);
          await wait('!document.querySelector(".habit-complete").disabled');await click('.habit-complete'); await wait(`document.querySelector('.habit-complete').getAttribute('aria-pressed')===${JSON.stringify(control)}`);
        }
        if(page==='expenses') {
          await wait('!!document.querySelector("#expense-month").value');
          assert.equal(await evaluate('document.querySelectorAll(".expense-workspace > .expense-recurring").length'),1);
          if(width===1366) assert.equal(await evaluate('new Set([".expense-budget",".expense-spent",".expense-recurring"].map(s=>Math.round(document.querySelector(s).getBoundingClientRect().top))).size'),1);
          await click('#calendar-open'); await wait('!!document.querySelector("dialog #spending-calendar .calendar-day")');
          await click('dialog .calendar-day'); await close();
          assert.equal(await evaluate('document.activeElement.id'),'calendar-open');
          await click('#expense-new'); await wait('!!document.querySelector("dialog input[name=amount]")');await close();
          await click('#recurring-new');await wait('!!document.querySelector("dialog [name=frequency]")');await close();
          const month=await evaluate('document.querySelector("#expense-month").value');await click('#month-previous');
          assert.notEqual(await evaluate('document.querySelector("#expense-month").value'),month);await click('#month-next');
        }
        if(page==='savings') {
          await wait('document.querySelectorAll(".goal-card").length===2');
          await click('#goals-filter [data-value=completed]');
          assert.equal(await evaluate('document.querySelectorAll(".goal-card").length'),1);
          await click('#goals-view [data-value=linear]');
          assert.equal(await evaluate('document.querySelector(".goal-linear").getAttribute("aria-valuenow")'),'100');
          await click('#goals-filter [data-value=archived]');assert.equal(await evaluate('document.querySelectorAll(".goal-card").length'),0);
          await click('#goals-filter [data-value=active]');assert.equal(await evaluate('document.querySelectorAll(".goal-linear").length'),2);
          assert.equal(await evaluate('document.querySelector(".goal-linear .workspace-meter > span").style.width'),'37.5%');
          await click('#goals-view [data-value=circular]');assert.equal(await evaluate('document.querySelectorAll(".goal-ring").length'),2);
          await evaluate('document.querySelector("#goals-view [data-value=circular]").focus()');
          await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});
          await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'});
          assert.equal(await evaluate('document.querySelector("#goals-view [aria-pressed=true]").dataset.value'),'linear');
          await click('#goal-new');await wait('!!document.querySelector("dialog input[name=target]")');await close();
        }
        await wait('![...document.querySelectorAll(".workspace-status")].some(n=>n.textContent.includes("Loading")) && !document.querySelector(".habit-complete")?.disabled');
        await evaluate('document.fonts.ready');
        await evaluate('window.scrollTo(0,document.body.scrollHeight)');
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        if(page!=='savings') assert.ok(await evaluate(`document.querySelector(${JSON.stringify(page==='habits'?'#habit-list':'.expense-transactions')}).getBoundingClientRect().bottom<=document.querySelector('.workspace-fab').getBoundingClientRect().top`),page+' final content clearance '+JSON.stringify(await evaluate('({scrollY,scrollHeight:document.body.scrollHeight,main:getComputedStyle(document.querySelector("main")).paddingBottom,list:document.querySelector("#habit-list, .expense-transactions").getBoundingClientRect().bottom,fab:document.querySelector(".workspace-fab").getBoundingClientRect().top,height:innerHeight})')));
        await evaluate('window.scrollTo(0,0)');
        const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('artifacts/controls-'+page+'-'+width+'.png',Buffer.from(shot.data,'base64'));
        checks.push({page,width,fab});
      }
    }
    await go('/savings');await wait('document.querySelectorAll(".goal-card").length===2');
    assert.equal(await evaluate('document.querySelectorAll(".goal-linear").length'),2);
    await click('.goal-card .workspace-icon-button');await dialogButton('Archive');await submit();
    await wait('document.querySelectorAll(".goal-card").length===1');
    await click('#goals-filter [data-value=archived]');
    assert.equal(await evaluate('document.querySelectorAll(".goal-card").length'),1);
    await click('.goal-card .recurring-actions button');await submit();
    await click('#goals-filter [data-value=active]');await wait('document.querySelectorAll(".goal-card").length===2');
    // Save a recurring definition through the preview UI; it must not create a transaction.
    await go('/expenses');await wait('!document.querySelector("#expenses-status").textContent.includes("Loading")');
    const before=await evaluate('document.querySelector("#transaction-count").textContent');
    await click('#recurring-new');await fill({name:'Browser scheduled bill',amount:'25.50',starts_on:'2026-10-20'});await submit();
    await wait('document.querySelector("#recurring-list").textContent.includes("Browser scheduled bill")');
    assert.equal(await evaluate('document.querySelector("#transaction-count").textContent'),before);
    for(const page of ['habits','expenses','savings']) for(const scenario of ['empty','failure']) {
      await go('/'+page+'?scenario='+scenario);await wait('!document.querySelector(".workspace-status")?.textContent.includes("Loading")');
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      assert.equal(await evaluate('document.querySelectorAll(".page-header h1").length'),1);
    }
    for(const page of ['dashboard','profile']) {await go('/'+page);assert.equal(await evaluate('document.querySelectorAll(".workspace-fab").length'),0);}
    assert.deepEqual(errors,[]);
    fs.writeFileSync('artifacts/workspace-controls-browser.json',JSON.stringify({checks,errors},null,2));
    console.log('Passed: three pages at 1366/768/390/320px; FAB and dock clearance, presets/check-ins, calendar/months, recurring without transactions, segmented filtering and Circular/Linear, keyboard, empty/error states.');
  } finally {socket.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
