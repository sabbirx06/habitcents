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
  const snapshot = () => evaluate(`(()=>{const selectors=['.expense-budget','.expense-spent','.expense-recurring','.expense-trend','.expense-breakdown','.expense-transactions'];return Object.fromEntries(selectors.map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return [s,{x:r.x,y:r.y,width:r.width,height:r.height,padding:getComputedStyle(e).paddingTop,scroll:e.scrollHeight,client:e.clientHeight}];}));})()`);
  try {
    await send('Runtime.enable');await send('Page.enable');
    if(process.argv.includes('--baseline')) {
      const baseline={};
      for(const width of [1366,768,390,320]) {
        await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<700});
        await go('/expenses');await wait('document.querySelectorAll(".recurring-row").length>0 && !document.querySelector("#expenses-status").textContent.includes("Loading")');
        baseline[width]=await snapshot();
      }
      fs.writeFileSync('artifacts/accent-summary-baseline.json',JSON.stringify(baseline,null,2));console.log('Saved existing summary and layout measurements.');
    } else {
      const baseline=JSON.parse(fs.readFileSync('artifacts/accent-summary-baseline.json','utf8'));
      // Exercise existing preview records and their real history with missing legacy colors.
      await send('Page.addScriptToEvaluateOnNewDocument',{source:`
        const realFetch=window.fetch;
        window.fetch=async(url,...args)=>{
          const response=await realFetch(url,...args);
          if(url!=='/api/habits'||!response.ok)return response;
          const body=await response.json();
          body.habits=body.habits.map((habit,index)=>({...habit,color:index===0?window.savedHabitColor:null,habit_name:'[Demo] '+habit.habit_name}));
          return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
        };
      `});
      for(const width of [1366,768,390,320]) {
        await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<700});
        await go('/habits');await wait('document.querySelectorAll(".habit-card").length===3 && document.querySelectorAll(".habit-heatmap .heat-cell[data-state=completed]").length>0');
        await wait('![...document.querySelectorAll(".habit-history .workspace-status")].some(n=>n.textContent.includes("Loading"))');
        const colors=await evaluate(`[...document.querySelectorAll('.habit-card')].map(card=>({id:card.dataset.habit,color:card.dataset.color,surface:getComputedStyle(card).backgroundColor,icon:getComputedStyle(card.querySelector('.habit-icon')).backgroundColor,completed:getComputedStyle(card.querySelector('.heat-cell[data-state=completed]')).backgroundColor,accent:getComputedStyle(card).getPropertyValue('--habit-accent').trim(),border:getComputedStyle(card).borderTopColor,future:getComputedStyle(card.querySelector('.heat-cell[data-state=future]')).backgroundColor,button:card.querySelector('.habit-complete').getAttribute('aria-pressed')==='true'?getComputedStyle(card.querySelector('.habit-complete')).backgroundColor:null}))`);
        assert.equal(new Set(colors.map(c=>c.icon)).size,3,'existing habits must display distinct icon colors');
        assert.equal(new Set(colors.map(c=>c.completed)).size,3,'existing completed history cells must visibly differ');
        assert.equal(new Set(colors.map(c=>c.future)).size,1,'future cells remain neutral');
        for(const c of colors) {
          assert.equal(c.surface,'rgb(247, 246, 240)');
          assert.equal(c.completed,c.border);
          if(c.button)assert.equal(c.button,c.icon);
        }
        const idColors=Object.fromEntries(colors.map(c=>[c.id,c.color]));
        await evaluate('window.savedHabitColor="peach";window.dispatchEvent(new Event("focus"))');
        await wait('document.querySelector(".habit-card").dataset.color==="peach"');
        await evaluate('window.savedHabitColor=null;window.dispatchEvent(new Event("focus"))');
        await wait(`document.querySelector('.habit-card').dataset.color===${JSON.stringify(colors[0].color)}`);
        assert.deepEqual(await evaluate('Object.fromEntries([...document.querySelectorAll(".habit-card")].map(c=>[c.dataset.habit,c.dataset.color]))'),idColors);
        assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
        const habitShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('artifacts/accents-habits-'+width+'.png',Buffer.from(habitShot.data,'base64'));
        await go('/expenses');await wait('document.querySelectorAll(".recurring-row").length>0 && !document.querySelector("#expenses-status").textContent.includes("Loading")');
        const after=await snapshot();
        for(const [selector,rect] of Object.entries(after)) {
          assert.equal(rect.x,baseline[width][selector].x,selector+' x unchanged');
          assert.equal(rect.width,baseline[width][selector].width,selector+' width unchanged');
          if(['.expense-trend','.expense-breakdown','.expense-transactions'].includes(selector)) assert.equal(rect.height,baseline[width][selector].height,selector+' own layout unchanged');
        }
        if(width===1366) {
          const cards=['.expense-budget','.expense-spent','.expense-recurring'].map(s=>after[s]);
          assert.equal(new Set(cards.map(c=>c.y)).size,1);
          assert.equal(new Set(cards.map(c=>c.height)).size,1);
          assert.ok(cards[0].height<baseline[width]['.expense-budget'].height,'summary row must be shorter');
        }
        assert.ok(after['.expense-recurring'].height<baseline[width]['.expense-recurring'].height);
        assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
        const expenseShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('artifacts/compact-expenses-'+width+'.png',Buffer.from(expenseShot.data,'base64'));
        checks.push({width,colors,summaryBefore:baseline[width]['.expense-recurring'].height,summaryAfter:after['.expense-recurring'].height});
        for(const scenario of ['empty','failure','large']) {
          await go('/expenses?scenario='+scenario);await wait('![...document.querySelectorAll(".workspace-status")].some(n=>n.textContent.includes("Loading"))');
          assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
          assert.ok(await evaluate('[...document.querySelectorAll(".expense-budget,.expense-spent,.expense-recurring")].every(c=>c.scrollHeight<=c.clientHeight+1)'),'summary content must not clip');
        }
      }
      assert.deepEqual(errors,[]);
      fs.writeFileSync('artifacts/accent-summary-browser.json',JSON.stringify({checks,errors},null,2));
      console.log('Passed: existing legacy habit records display distinct consistent accents; custom colors preserved; neutral future cells; summary height reduced with unchanged widths/charts/transactions; 1366/768/390/320px and empty/error/large states.');
    }
  } finally {socket.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
