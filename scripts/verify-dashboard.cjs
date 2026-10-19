// Optional local Chrome verification. Start Chrome with --headless=new --remote-debugging-port=9223
// and a disposable --user-data-dir, then run after starting the database-free preview.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:3001';
(async()=>{
 const tabs=await(await fetch('http://127.0.0.1:9223/json/list')).json();
 const target=tabs.find(t=>t.type==='page');
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map(),errors=[],assets=[],fontRequests=[],requests=[];
 ws.addEventListener('message',({data})=>{const event=JSON.parse(data);if(event.id){const p=pending.get(event.id);pending.delete(event.id);event.error?p.reject(event.error):p.resolve(event.result);}else if(event.method==='Network.requestWillBeSent')requests.push(event.params.request.url);else if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.text);else if(event.method==='Network.responseReceived' && event.params.type==='Font')fontRequests.push({url:event.params.response.url,status:event.params.response.status});else if(event.method==='Network.loadingFailed')assets.push(event.params.errorText);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
 const measurements=[];
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+expression);};
 const navigate=async path=>{await send('Page.navigate',{url:base+path});await wait('document.readyState==="complete"');};
 const viewport=async(width,height)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<761});await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');};
 const screenshot=async name=>{const result=await send('Page.captureScreenshot',{captureBeyondViewport:true,clip:await evaluate('({x:0,y:0,width:innerWidth,height:document.documentElement.scrollHeight,scale:1})')});fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/'+name+'.png',Buffer.from(result.data,'base64'));};
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
 try{
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await viewport(1440,900);await navigate('/dashboard');await wait('document.querySelector("#habit-progress").textContent==="1/3"');await wait('document.querySelector("#savings-percentage").textContent==="38%"');await wait('document.querySelector("#universal-streak").textContent==="7"');await wait('document.querySelector("#spending-status").textContent===""');
 await evaluate('document.fonts.ready.then(()=>true)');
 const composition=await evaluate(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};return {progress:rect('.progress-panel'),budget:rect('.budget-panel'),savings:rect('.savings-panel'),habits:rect('.habits-panel'),streak:rect('.universal-streak-panel'),expenses:rect('.activity-panel'),entry:rect('.quick-entry-panel'),spending:rect('.spending-panel')}})()`);
 assert.equal(composition.progress.y,composition.budget.y);assert.equal(composition.savings.y,composition.budget.y);assert.ok(composition.savings.x>composition.budget.x);assert.ok(Math.abs(composition.savings.width-composition.savings.height)<2);
 assert.equal(composition.habits.y,composition.expenses.y);assert.equal(composition.entry.y,composition.expenses.y);assert.ok(composition.streak.y>composition.habits.y);assert.ok(composition.spending.y>composition.entry.y);
 assert.ok(Math.abs(composition.streak.bottom-composition.expenses.bottom)<1);assert.ok(Math.abs(composition.spending.bottom-composition.expenses.bottom)<1);
 assert.equal(await evaluate('document.querySelectorAll(".continuity-grid,.history-menu").length'),0);
 assert.ok(await evaluate('document.querySelectorAll("#recent-expenses .expense-row").length>=5'));
 assert.ok(await evaluate('parseFloat(getComputedStyle(document.querySelector("#spending-bars")).height)>=85'));
 assert.equal(await evaluate('document.querySelector("#spending-inspect").checkVisibility()'),false);
 await screenshot('dashboard-composition-1440x900');
 assert.equal(await evaluate('document.querySelectorAll(".continuity-pair-topline").length'),0);
 const series=await evaluate('Array.from(document.querySelectorAll("#spending-bars button")).map(b=>({date:b.dataset.date,amount:Number(b.dataset.amount),label:b.ariaLabel}))');
 const end=series.at(-1).date;assert.equal(series.length,Number(end.slice(8)));assert.ok(series.every(day=>day.date<=end));assert.ok(series.some(day=>day.amount===0&&day.label.includes('no entries recorded')));
 assert.equal(await evaluate('document.querySelectorAll("#spending-table tr").length'),series.length);
 await evaluate('document.querySelector("#spending-bars button:last-child").focus()');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
 assert.equal(await evaluate('document.querySelector("#spending-inspect").value'),series.at(-2).date);
 await evaluate('document.querySelector("#spending-inspect").value=document.querySelector("#spending-inspect option").value;document.querySelector("#spending-inspect").dispatchEvent(new Event("change"))');
 assert.equal(await evaluate('document.querySelector("#spending-bars [aria-pressed=true]").dataset.date'),series[0].date);
 assert.equal(await evaluate('document.querySelector("#savings-selector").options.length'),2);
 await evaluate('document.querySelector("#savings-selector").value="1";document.querySelector("#savings-selector").dispatchEvent(new Event("change"))');
 assert.equal(await evaluate('document.querySelector("#savings-percentage").textContent'),'100%');
 assert.equal(await evaluate('document.querySelector("#savings-link").getAttribute("href")'),'/savings');
 await evaluate('document.querySelector("#savings-selector").value="0";document.querySelector("#savings-selector").dispatchEvent(new Event("change"))');
 const styles=await evaluate('Object.fromEntries([".header-identity h1","#live-clock","#header-day","#habit-progress","#dashboard-budget"].map(selector=>{const s=getComputedStyle(document.querySelector(selector));return [selector,{family:s.fontFamily,weight:s.fontWeight,synthesis:s.fontSynthesis}]}))');
 assert.ok(styles['#live-clock'].family.includes('Neue Haas Grotesk Display'));assert.equal(styles['#live-clock'].weight,'400');assert.ok(styles['.header-identity h1'].family.includes('Neue Haas Grotesk Text'));
 for(const [family,weight] of [['Text','400'],['Text','500'],['Display','400'],['Display','500']])assert.ok(await evaluate(`Array.from(document.fonts).some(f=>f.family==='Neue Haas Grotesk ${family}' && f.weight==='${weight}' && f.status==='loaded')`));
 assert.ok(Object.values(styles).every(s=>s.synthesis==='none'));assert.ok(fontRequests.length>=4);assert.ok(fontRequests.every(f=>[200,304].includes(f.status)&&/NeueHaasGrot/.test(f.url)));
 assert.equal(await evaluate('!!document.querySelector("#live-clock").closest("[aria-live]")'),false);
 const centered=async()=>assert.ok(await evaluate('(()=>{const h=document.querySelector(".time-header").getBoundingClientRect(),c=document.querySelector("#live-clock").getBoundingClientRect();return Math.abs((h.left+h.right)/2-(c.left+c.right)/2)<1})()'));
 await centered();assert.equal(await evaluate('document.querySelectorAll("#week-strip button").length'),7);assert.equal(await evaluate('document.querySelectorAll("#week-strip [aria-current=date]").length'),1);
 assert.ok(await evaluate('(()=>{const w=Array.from(document.querySelectorAll("#week-strip button")).map(e=>e.getBoundingClientRect().width);return Math.max(...w)-Math.min(...w)<1})()'));
 assert.equal(await evaluate('document.querySelector(".initials-avatar").textContent'),'DU');assert.equal(await evaluate('document.querySelector(".today-badge").parentElement.getAttribute("aria-label")!==null'),true);
 for(const [width,height] of [[1440,900],[1366,768]]){
  await viewport(width,height);const m=await evaluate('({width:innerWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,progressFont:getComputedStyle(document.querySelector("#habit-progress")).fontSize,budgetFont:getComputedStyle(document.querySelector("#dashboard-budget")).fontSize})');measurements.push(m);assert.ok(await evaluate('getComputedStyle(document.body).overflowY!=="hidden"'),JSON.stringify(m));assert.ok(m.scrollWidth<=width,JSON.stringify(m));if(width===1440)assert.ok(m.scrollHeight<=height,JSON.stringify(m));assert.ok(parseFloat(m.progressFont)>=56);assert.ok(parseFloat(m.budgetFont)>=54);await centered();await screenshot('dashboard-'+width+'x'+height);
 }
 // New cards use real preview contracts and retain truthful date context.
 assert.equal(await evaluate('document.querySelector("#spending-table").textContent.includes("Tk")'),true);
 assert.ok(await evaluate('document.querySelector("#spending-range").textContent.includes(" – ")'));
 await evaluate(`document.querySelector('[data-habit-id="102"]').click()`);await wait('document.querySelector("#habit-progress").textContent==="2/3"');await wait('document.querySelector("#universal-streak").textContent==="7"');
 await evaluate(`document.querySelector('[data-habit-id="103"]').click()`);await wait('document.querySelector("#universal-streak").textContent==="8"');await evaluate('document.querySelector("#retry-streak").click()');await wait('document.querySelector("#universal-streak").textContent==="8"');await evaluate(`document.querySelector('[data-habit-id="103"]').click()`);await wait('document.querySelector("#universal-streak").textContent==="7"');
 await evaluate(`document.querySelector('[data-habit-id="102"]').click()`);await wait('document.querySelector("#habit-progress").textContent==="1/3"');
 await evaluate('document.querySelector("#expense-category").value="transport";document.querySelector("#expense-name").value="Browser tea";document.querySelector("#expense-amount").value="12.35";document.querySelector(".expense-form").requestSubmit()');await wait('document.querySelector("#expense-status").textContent==="Expense added."');await wait('!document.querySelector("#spending-chart").hidden');assert.equal(await evaluate('document.querySelector("#recent-expenses li").dataset.category'),'transport');
 const expenseDay=end.slice(0,8)+(end.endsWith('01')?'02':'01');
 assert.equal(await evaluate('document.querySelector("#expense-date").value'),end);
 assert.equal(await evaluate('document.querySelector("#expense-date-note")'),null);
 await evaluate(`document.querySelector('#expense-date').value=${JSON.stringify(expenseDay)};document.querySelector('#expense-name').value='Browser dated expense';document.querySelector('#expense-amount').value='7.65';document.querySelector('.expense-form').requestSubmit()`);
 await wait('document.querySelector("#expense-name").value==="" && !document.querySelector(".primary-action").disabled');
 assert.equal(await evaluate('document.querySelector("#expense-date").value'),end);
 assert.ok(await evaluate(`fetch('/dashboard-history?section=expenses&date='+${JSON.stringify(expenseDay)}).then(r=>r.json()).then(d=>d.expenses.some(e=>e.description==='Browser dated expense'&&e.date===${JSON.stringify(expenseDay)}))`));
 const before=await evaluate('document.querySelector("#live-clock").textContent');await evaluate('import("/js/dashboard.js").then(async m=>{await m.initDashboard();await m.initDashboard()})');assert.equal(await evaluate('document.querySelector("#live-clock").textContent'),before);
 // Week browsing must not select a date or request history.
 const weekStart=await evaluate('document.querySelector("#week-strip button").dataset.date');const historyRequests=()=>requests.filter(url=>url.includes('/dashboard-history')).length;
 const countBefore=historyRequests();await evaluate('document.querySelector("#previous-week").click()');assert.notEqual(await evaluate('document.querySelector("#week-strip button").dataset.date'),weekStart);assert.equal(await evaluate('document.querySelector("#dashboard-grid").hidden'),false);assert.equal(historyRequests(),countBefore);
 await evaluate('document.querySelector("#next-week").click()');assert.equal(await evaluate('document.querySelector("#week-strip button").dataset.date'),weekStart);
 await evaluate('document.querySelector("#browse-dates").click()');await wait('document.querySelector("#date-browser").open');
 assert.equal(await evaluate('document.querySelector("#dashboard-workspace").hidden'),false);assert.equal(await evaluate('document.body.style.overflow'),'hidden');
 const pickerCentered=async()=>{await wait('(()=>{const row=document.querySelector("#date-rows button[aria-pressed=true]").getBoundingClientRect(),list=document.querySelector("#date-rows").getBoundingClientRect();return Math.abs((row.top+row.bottom-list.top-list.bottom)/2)<2})()');assert.ok(await evaluate('(()=>{const row=document.querySelector("#date-rows button[aria-pressed=true]").getBoundingClientRect(),list=document.querySelector("#date-rows").getBoundingClientRect();return Math.abs((row.top+row.bottom-list.top-list.bottom)/2)<2})()'));};
 await pickerCentered();assert.ok(await evaluate('document.activeElement.matches("#date-rows button[aria-pressed=true]")'));
 assert.ok(await evaluate('Math.abs(document.querySelector("#date-browser").getBoundingClientRect().width-document.querySelector(".dashboard-shell").getBoundingClientRect().width)<1'),JSON.stringify(await evaluate('({modal:document.querySelector("#date-browser").getBoundingClientRect().width,content:document.querySelector(".dashboard-shell").getBoundingClientRect().width,max:getComputedStyle(document.querySelector("#date-browser")).maxWidth,font:getComputedStyle(document.querySelector("#date-browser")).fontSize})')));
 assert.equal(await evaluate('document.querySelectorAll("#date-rows small").length'),0);
 assert.notEqual(await evaluate('getComputedStyle(document.querySelector("#date-rows [aria-pressed=true]")).boxShadow'),'none');
 await wait('document.querySelector("#month-status").textContent===""');
 const pageTop=await evaluate('scrollY');await evaluate('document.querySelector("#expense-name").focus()');assert.ok(await evaluate('document.activeElement.closest("#date-browser")!==null'));await evaluate('document.querySelector(".dock-link").focus()');assert.ok(await evaluate('document.activeElement.closest("#date-browser")!==null'));await evaluate('document.querySelector("#date-rows [aria-pressed=true]").focus()');
 const listBeforeWheel=await evaluate('document.querySelector("#date-rows").scrollTop');const listBox=await evaluate('(()=>{const r=document.querySelector("#date-rows").getBoundingClientRect();return {x:r.left+40,y:r.top+80}})()');
 await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:listBox.x,y:listBox.y,deltaY:100,deltaX:0});await new Promise(r=>setTimeout(r,100));assert.ok(await evaluate('document.querySelector("#date-rows").scrollTop')>listBeforeWheel);assert.equal(await evaluate('scrollY'),pageTop);
 await evaluate('document.querySelector("#picker-today").click()');
 // Scroll in both directions across months without selecting or fetching history.
 const firstBefore=await evaluate('document.querySelector("#date-rows button").dataset.date');const beforeScroll=historyRequests(),selectedBefore=await evaluate('document.querySelector("#date-rows [aria-pressed=true]").dataset.date');
 await evaluate('document.querySelector("#date-rows").scrollTop=0');await new Promise(r=>setTimeout(r,100));assert.ok(await evaluate('document.querySelectorAll("#date-rows button").length')<=151);assert.ok(await evaluate('document.querySelector("#date-rows button").dataset.date')<firstBefore);
 assert.equal(await evaluate('document.querySelector("#date-rows [aria-pressed=true]").dataset.date'),selectedBefore);assert.equal(historyRequests(),beforeScroll);
 await evaluate('document.querySelector("#picker-today").click()');await pickerCentered();await screenshot('dashboard-date-browser');
 // Smooth month jumps animate the list without selecting history.
 await evaluate('window.__dateScrollCalls=[];const list=document.querySelector("#date-rows"),nativeScroll=list.scrollTo;list.scrollTo=function(options){window.__dateScrollCalls.push(options);return nativeScroll.call(this,options)}');
 const beforeJump=historyRequests();await evaluate('document.querySelector("#previous-month").click()');assert.equal(await evaluate('window.__dateScrollCalls.at(-1).behavior'),'smooth');
 await wait('Math.abs(document.querySelector("#date-rows").scrollTop-window.__dateScrollCalls.at(-1).top)<2');assert.equal(historyRequests(),beforeJump);
 await evaluate('document.querySelector("#picker-today").click()');await pickerCentered();
 const hoverRow=await evaluate('(()=>{const a=document.querySelector("#date-rows [aria-pressed=true]").parentElement.nextElementSibling.querySelector("button"),r=a.getBoundingClientRect();window.__hoverDate=a.dataset.date;return {x:r.left+40,y:r.top+30}})()');
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:hoverRow.x,y:hoverRow.y});await new Promise(r=>setTimeout(r,220));assert.notEqual(await evaluate('getComputedStyle(Array.from(document.querySelectorAll("#date-rows button")).find(a=>a.dataset.date===window.__hoverDate)).backgroundColor'),'rgba(0, 0, 0, 0)');
 // Keyboard moves focus without selection. Native dialog keeps focus/background contained.
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});assert.notEqual(await evaluate('document.activeElement.dataset.date'),selectedBefore);assert.equal(historyRequests(),beforeScroll);
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait('document.querySelector("#date-browser").hidden');assert.equal(await evaluate('document.activeElement.id'),'browse-dates');assert.equal(await evaluate('document.body.style.overflow'),'');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await wait('document.querySelector("#date-browser").open');
 const originalMonth=await evaluate('document.querySelector("#browser-month").textContent');await evaluate('document.querySelector("#previous-month").click()');assert.notEqual(await evaluate('document.querySelector("#browser-month").textContent'),originalMonth);await evaluate('document.querySelector("#next-month").click()');assert.equal(await evaluate('document.querySelector("#browser-month").textContent'),originalMonth);
 await evaluate('document.querySelector("#picker-today").click()');
 const yesterday=await evaluate('(()=>{const d=new Date();d.setDate(d.getDate()-1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")})()');
 await evaluate(`document.querySelector('#date-rows button[data-date="${yesterday}"]').click()`);await wait('document.querySelector("#date-browser").hidden');await wait('document.querySelector("#history-habits").textContent.includes("Morning walk")');await wait('document.querySelector("#history-spent").textContent==="Tk 240.25"');await wait('document.querySelector("#spending-status").textContent===""');assert.ok(await evaluate('document.querySelector("#spending-range").textContent.includes(" – ")'));assert.ok(await evaluate('Array.from(document.querySelectorAll("[data-today-only]")).every(e=>e.hidden)'));assert.ok(await evaluate('!document.querySelector("#streak-asof").hidden'));
 assert.equal(await evaluate('document.querySelector("#dashboard-grid").hidden'),true);assert.equal(await evaluate('document.querySelector("#history-view").hidden'),false);assert.ok(await evaluate('Array.from(document.querySelectorAll(".expense-form input,#today-habits input")).every(e=>e.disabled)'));assert.ok(await evaluate('document.querySelector("#savings-link").getAttribute("aria-label").includes("current progress")'));await screenshot('dashboard-history');
 await evaluate('document.querySelector("#browse-dates").click()');await pickerCentered();
 assert.equal(await evaluate('document.querySelector("#date-rows [aria-pressed=true]").dataset.date'),yesterday);
 await evaluate('document.querySelector("#close-date-browser").click()');await wait('document.querySelector("#date-browser").hidden');
 await evaluate('document.querySelector("#back-to-today").click()');await wait('document.querySelector("#habit-progress").textContent==="1/3"');assert.equal(await evaluate('document.querySelector("#dashboard-grid").hidden'),false);
 for(const scenario of ['small','many','long','large','longName','emptyName']){
  await navigate('/dashboard?scenario='+scenario);await wait('document.querySelector("#dashboard-budget").textContent!=="—"');await wait('document.querySelector("#savings-status").textContent!=="Loading savings…"');
  for(const [width,height] of [[1440,900],[1366,768],[390,844]]){await viewport(width,height);assert.ok(await evaluate('document.documentElement.scrollWidth')<=width,scenario+' horizontal overflow');if(width>1100){assert.ok(await evaluate('getComputedStyle(document.documentElement).overflowY!=="hidden" && getComputedStyle(document.body).overflowY!=="hidden"'),scenario+' page clipping');await centered();}await screenshot('dashboard-'+scenario+'-'+width);}
  if(scenario==='emptyName')assert.equal(await evaluate('document.querySelector(".initials-avatar").textContent'),'?');
 }
 for(const scenario of ['summaryFailure','failure','historyFailure','savingsFailure','empty','completedGoals','breakdownFailure','continuityFailure','emptyHistory']){
  await navigate('/dashboard?scenario='+scenario);await wait('document.querySelector("#savings-status").textContent!=="Loading savings…"');assert.ok(await evaluate('document.querySelector("#live-clock").textContent!=="—"'));assert.equal(await evaluate('document.querySelectorAll("#week-strip button").length'),7);
  if(scenario==='breakdownFailure'){await wait('!document.querySelector("#retry-spending").hidden');assert.equal(await evaluate('document.querySelector("#spending-table").textContent'),'');}
  if(scenario==='completedGoals'){assert.equal(await evaluate('document.querySelector("#savings-percentage").textContent'),'100%');}
  if(scenario==='empty'){assert.equal(await evaluate('document.querySelector("#savings-goal").hidden'),true);}
  if(scenario==='savingsFailure'){assert.equal(await evaluate('document.querySelector("#savings-goal").hidden'),true);assert.equal(await evaluate('document.querySelector("#retry-savings").hidden'),false);}
  if(scenario==='historyFailure'){
   await evaluate('document.querySelector("#browse-dates").click()');await wait('!document.querySelector("#retry-month").hidden');assert.ok(await evaluate('document.querySelectorAll("#date-rows button").length')>=28);
   await evaluate(`document.querySelector('#date-rows button[data-date="${yesterday}"]').click()`);await wait('!document.querySelector("#retry-history-habits").hidden');assert.equal(await evaluate('document.querySelector("#history-spent").textContent'),'—');
   await evaluate('document.cookie="preview-scenario=populated; path=/";document.querySelector("#retry-history-habits").click();document.querySelector("#retry-history-expenses").click()');await wait('document.querySelector("#history-spent").textContent==="Tk 240.25"');
  }
 }
 await viewport(320,740);await navigate('/dashboard');await wait('document.querySelector("#habit-progress").textContent==="1/3"');assert.ok(await evaluate('document.documentElement.scrollWidth')<=320);await screenshot('dashboard-mobile');
 await evaluate('document.querySelector("#browse-dates").click()');await pickerCentered();await screenshot('dashboard-date-picker-mobile');
 const modalBox=await evaluate('(()=>{const r=document.querySelector("#date-browser").getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}})()');assert.ok(modalBox.w<=320);assert.ok(modalBox.y>=0);
 await evaluate('document.querySelector("#close-date-browser").focus()');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});assert.ok(await evaluate('document.activeElement.dataset.date!==undefined'));
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1});await wait('document.querySelector("#date-browser").hidden');assert.equal(await evaluate('document.activeElement.id'),'browse-dates');assert.equal(await evaluate('document.body.style.overflow'),'');
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await evaluate('document.querySelector("#browse-dates").click()');assert.equal(await evaluate('getComputedStyle(document.querySelector("#date-browser")).animationName'),'none');assert.equal(await evaluate('getComputedStyle(document.querySelector("#date-rows button")).transitionDuration'),'0s');await evaluate('window.__reducedScroll=null;const list=document.querySelector("#date-rows"),nativeScroll=list.scrollTo;list.scrollTo=function(options){window.__reducedScroll=options;return nativeScroll.call(this,options)};document.querySelector("#previous-month").click()');assert.equal(await evaluate('window.__reducedScroll.behavior'),'instant');await evaluate('document.querySelector("#close-date-browser").click()');assert.equal(await evaluate('document.querySelector("#date-browser").hidden'),true);await send('Emulation.setEmulatedMedia',{features:[]});
 // Simulate local time before application initialization; no backend time is changed.
 const injection=await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.__clockNow=new Date(2025,11,31,23,59,30).getTime();const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[window.__clockNow]))}static now(){return window.__clockNow}};'});
 await navigate('/dashboard');await wait('document.querySelector("#live-clock").textContent==="23:59"');assert.equal(await evaluate('document.querySelector("#header-month").textContent'),'DEC');
 await evaluate('window.__clockNow=new Date(2026,0,1,0,0).getTime();document.dispatchEvent(new Event("visibilitychange"))');await wait('document.querySelector("#live-clock").textContent==="00:00"');assert.equal(await evaluate('document.querySelector("#header-month").textContent'),'JAN');assert.ok(await evaluate('document.querySelector("#week-strip [aria-current=date]").getAttribute("aria-label").includes("2026-01-01")'));
 await evaluate('document.querySelector("#browse-dates").click()');await pickerCentered();
 const yearHistoryCount=historyRequests();
 await evaluate('document.querySelector("#date-rows").scrollTop=0');await new Promise(r=>setTimeout(r,80));assert.ok(await evaluate('document.querySelector("#date-rows button").dataset.date.startsWith("2025-")'));assert.equal(historyRequests(),yearHistoryCount);
 await evaluate('document.querySelector("#date-rows").scrollTop=document.querySelector("#date-rows").scrollHeight');await new Promise(r=>setTimeout(r,80));assert.ok(await evaluate('document.querySelector("#date-rows button:last-child")!==null'));assert.ok(await evaluate('document.querySelectorAll("#date-rows button").length')<=151);assert.equal(historyRequests(),yearHistoryCount);
 await evaluate('document.querySelector("#close-date-browser").click()');await wait('document.querySelector("#date-browser").hidden');
 // Select fixture leap day through actual date navigation, not fabricated activity.
 await evaluate('document.querySelector("#browse-dates").click()');
 for(let i=0;i<23;i++)await evaluate('document.querySelector("#previous-month").click()');
 await evaluate(`document.querySelector('#date-rows button[data-date="2024-02-29"]').focus({preventScroll:true})`);
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await wait('document.querySelector("#date-browser").hidden');await wait('document.querySelector("#history-spent").textContent==="Tk 12.35"');
 assert.ok(await evaluate('document.querySelector("#selected-date-label").textContent.includes("February 29, 2024")'));
 await evaluate('document.querySelector("#browse-dates").click()');await pickerCentered();await evaluate('document.querySelector("#close-date-browser").click()');await wait('document.querySelector("#date-browser").hidden');
 await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});await viewport(1440,900);await navigate('/dashboard');await wait('document.querySelector("#habit-progress").textContent==="1/3"');
 const normalColors=await evaluate('({background:getComputedStyle(document.querySelector(".time-header")).backgroundColor,color:getComputedStyle(document.querySelector(".time-header")).color})');
 const luminance=color=>color.match(/\d+/g).slice(0,3).map(Number).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((n,c,i)=>n+c*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};assert.ok(contrast(normalColors.color,normalColors.background)>7);const savingColors=await evaluate('({bg:getComputedStyle(document.querySelector(".savings-panel")).backgroundColor,fg:getComputedStyle(document.querySelector("#savings-link")).color})');assert.ok(contrast(savingColors.fg,savingColors.bg)>=4.5);
 await evaluate('document.documentElement.dataset.theme="dark"');const inverse=await evaluate('({background:getComputedStyle(document.querySelector(".time-header")).backgroundColor,color:getComputedStyle(document.querySelector(".time-header")).color})');assert.equal(inverse.background,'rgb(247, 246, 240)');assert.equal(inverse.color,'rgb(34, 35, 32)');assert.ok(contrast(inverse.color,inverse.background)>7);await evaluate('delete document.documentElement.dataset.theme');
 for(const scenario of ['streakSetup','streakFailure','summaryFailure','empty']){
  await viewport(1440,900);await navigate('/dashboard?scenario='+scenario);await wait('document.querySelector("#streak-status").textContent!=="Loading streak…"');
  if(scenario==='summaryFailure')assert.equal(await evaluate('document.querySelector("#universal-streak").textContent'),'7');
  else if(scenario==='streakFailure')assert.equal(await evaluate('document.querySelector("#universal-streak").textContent'),'—');
  else {assert.equal(await evaluate('document.querySelector("#universal-streak").textContent'),'—');assert.match(await evaluate('document.querySelector("#streak-status").textContent'),/needs setup/);}
  if(scenario==='streakFailure')assert.equal(await evaluate('document.querySelector("#retry-streak").hidden'),false);
  await screenshot('universal-streak-'+scenario);
 }
 assert.equal(requests.filter(url=>url.includes('/dashboard-continuity')).length,0);
 // Shared dock: navigate actual links across authenticated pages, no account writes.
 for(const [width,height] of [[1366,768],[320,740]]){
  await viewport(width,height);await navigate('/dashboard');await wait('document.querySelector("#habit-progress").textContent==="1/3"');
  for(const page of ['dashboard','habits','expenses','savings','profile']){
   if(page!=='dashboard'){await evaluate('Array.from(document.querySelectorAll(".nav-dock a")).find(a=>a.pathname==="/'+page+'").click()');await wait('location.pathname==="/'+page+'" && document.readyState==="complete"');}
   await wait('document.querySelector(".nav-dock a[aria-current=page]")?.pathname==="/'+page+'"');
   assert.equal(await evaluate('document.querySelectorAll(".nav-dock").length'),1);assert.equal(await evaluate('document.querySelectorAll(".site-header,.nav-toggle").length'),0);
   assert.equal(await evaluate('document.querySelectorAll(".nav-dock a").length'),6);assert.equal(await evaluate('Array.from(document.querySelectorAll(".nav-dock a")).filter(a=>a.pathname==="/logout").length'),0);
   assert.ok(await evaluate('Array.from(document.querySelectorAll(".nav-dock a")).every(a=>a.getAttribute("aria-label")&&a.getBoundingClientRect().width>=44&&a.getBoundingClientRect().height>=44)'));
   const dock=await evaluate('(()=>{const d=document.querySelector(".nav-dock"),r=d.getBoundingClientRect(),a=d.querySelector("[aria-current=page]");return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,bg:getComputedStyle(a).backgroundColor,color:getComputedStyle(d).color}})()');assert.ok(dock.left>=0&&dock.right<=width,JSON.stringify({page,width,dock}));assert.ok(dock.width<width-10);assert.equal(dock.bg,dock.color);
   assert.ok(await evaluate('document.documentElement.scrollWidth')<=width);
   await evaluate('scrollTo(0,document.documentElement.scrollHeight)');
   const obscured=await evaluate('(()=>{const top=document.querySelector(".nav-dock").getBoundingClientRect().top;return Array.from(document.querySelectorAll("body a,body button,body input,body select")).filter(n=>!n.closest(".nav-dock,dialog")&&n.checkVisibility()&&getComputedStyle(n).visibility!=="hidden").filter(n=>n.getBoundingClientRect().bottom>top).map(n=>n.outerHTML.slice(0,100))})()');assert.deepEqual(obscured,[],page+' dock covers final controls');
   if(page==='profile'){assert.equal(await evaluate('document.querySelector(".profile-name").textContent'),'Demo User');assert.equal(await evaluate('document.querySelector(".profile-logout").getAttribute("href")'),'/logout');}
   await screenshot('dock-'+page+'-'+width);
  }
 }
 await viewport(1366,768);await navigate('/dashboard');await wait('document.querySelector("#habit-progress").textContent==="1/3"');
 await evaluate('document.querySelector(".dock-brand").focus()');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Overview');assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle'),'solid');await new Promise(r=>setTimeout(r,200));assert.equal(await evaluate('getComputedStyle(document.activeElement.querySelector(".dock-tooltip")).opacity'),'1');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});assert.equal(await evaluate('getComputedStyle(document.activeElement.querySelector(".dock-tooltip")).visibility'),'hidden');
 const hover=await evaluate('(()=>{const r=Array.from(document.querySelectorAll(".dock-link")).find(a=>a.ariaLabel==="Savings").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:hover.x,y:hover.y});await new Promise(r=>setTimeout(r,200));assert.equal(await evaluate('getComputedStyle(Array.from(document.querySelectorAll(".dock-link")).find(a=>a.ariaLabel==="Savings").querySelector(".dock-tooltip")).opacity'),'1');await screenshot('dock-keyboard-tooltip');
 await viewport(390,844);await send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,left:0,right:0,bottom:24}});assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav-dock")).bottom'),'36px');assert.equal(await evaluate('getComputedStyle(document.body).paddingBottom'),'108px');await screenshot('dock-safe-area');await send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,left:0,right:0,bottom:0}});
 await viewport(1440,900);await navigate('/dashboard');await wait('document.querySelector("#habit-progress").textContent==="1/3"');
 console.log(JSON.stringify({passed:true,measurements,fontStyles:styles,fontRequests:[...new Set(fontRequests.map(f=>f.url))],checks:['local clock centered and minute-only','midnight/year rollover and tab resume','initials and long-name layout','desktop/mobile composition, natural scrolling and dock clearance','read-only history and return to today','week navigation separate from selection','bounded cross-year scrolling and leap-day keyboard selection','modal centering, inert background, focus trap and dismissal','scroll lock, wheel scrolling and reduced motion','month navigation and real activity markers','history failure shell and retries','current savings empty/completed/error','Today check-in, uncheck, categorized decimal expense','daily spending series, current/selected-month ranges, keyboard values and table alternative, universal day streak award/revoke/setup states and no contribution requests','theme-ready inverse header','shared dock across five pages, active states, tooltips, keyboard focus and safe areas'],runtimeErrors:errors,failedAssets:assets},null,2));assert.deepEqual(errors,[]);assert.deepEqual(assets,[]);
 }finally{ws.close();}
})().catch(error=>{console.error(error);process.exitCode=1});


