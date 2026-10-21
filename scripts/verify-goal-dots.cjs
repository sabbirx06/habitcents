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
    await send('Runtime.enable');await send('Page.enable');
    const goals=[{name:'Emergency fund',saved_amount:25,target_amount:100},{name:'Travel savings with a longer descriptive goal name',saved_amount:50,target_amount:100},{name:'Learning fund',saved_amount:100,target_amount:100}];
    await send('Page.addScriptToEvaluateOnNewDocument',{source:'const originalFetch=window.fetch;window.fetch=(url,...args)=>url==="/savings-data"?Promise.resolve(new Response('+JSON.stringify(JSON.stringify(goals))+',{status:200,headers:{"Content-Type":"application/json"}})):originalFetch(url,...args);'});
    for(const width of [1366,390,320]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<700});
      await go('/dashboard');await wait('document.querySelectorAll(".savings-dot").length===3');
      assert.equal(await evaluate('document.querySelector("#savings-goal-name").textContent'),'Emergency fund');
      assert.equal(await evaluate('document.querySelectorAll("select#savings-selector").length'),0);
      const originalSize=await evaluate('(()=>{const r=document.querySelector(".savings-panel").getBoundingClientRect();return {width:r.width,height:r.height};})()');
      for(let i=0;i<3;i++) {
        await evaluate(`document.querySelectorAll('.savings-dot')[${i}].click()`);
        assert.equal(await evaluate('document.querySelector("#savings-goal-name").textContent'),goals[i].name);
        assert.equal(await evaluate('document.querySelector("#savings-percentage").textContent'),[25,50,100][i]+'%');
        assert.equal(await evaluate('document.querySelectorAll(".savings-dot[aria-pressed=true]").length'),1);
        assert.ok(await evaluate('(()=>{const p=document.querySelector(".savings-panel").getBoundingClientRect(),n=document.querySelector("#savings-goal-name").getBoundingClientRect(),d=document.querySelector("#savings-selector").getBoundingClientRect();return n.top>=p.top && d.bottom<=p.bottom;})()'));
        assert.equal(await evaluate('document.querySelector(".savings-panel").getBoundingClientRect().height'),originalSize.height);
        assert.equal(await evaluate('getComputedStyle(document.querySelector("#savings-goal-name")).textOverflow'),'ellipsis');
        assert.equal(await evaluate('document.querySelector("#savings-goal-name").title'),goals[i].name);
        assert.ok(await evaluate('(()=>{const r=document.querySelector("#savings-progress").getBoundingClientRect(),t=document.querySelector("#savings-percentage").getBoundingClientRect();return Math.hypot(t.width/2,t.height/2)<=r.width*.4-4;})()'),'percentage has clearance inside the ring');
      }
      if(width===1366) assert.equal(originalSize.height,originalSize.width);
      assert.ok(await evaluate('document.querySelector("#savings-selector").getBoundingClientRect().top-document.querySelector("#savings-progress").getBoundingClientRect().bottom>=6'));
      assert.equal(await evaluate('document.querySelector(".savings-dot").getBoundingClientRect().width'),24);
      await evaluate('document.querySelectorAll(".savings-dot")[2].focus()');
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'});
      assert.equal(await evaluate('document.querySelector("#savings-goal-name").textContent'),'Emergency fund');
      assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Show Emergency fund');
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      assert.ok(await evaluate('(()=>{const n=document.querySelector("#savings-goal-name").getBoundingClientRect(),r=document.querySelector("#savings-progress").getBoundingClientRect(),d=document.querySelector("#savings-selector").getBoundingClientRect();return n.bottom<=r.top && r.bottom<=d.top;})()'));
      const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('artifacts/goal-dots-'+width+'.png',Buffer.from(shot.data,'base64'));
      checks.push({width,dots:3,keyboard:true,layout:true});
    }
    assert.deepEqual(errors,[]);
    console.log('Passed: name/ring/dots order, three-goal selection, long name, keyboard wrapping, and no overflow at 1366/390/320px.');
  } finally {socket.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
