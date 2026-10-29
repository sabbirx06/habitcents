// Run against the debug WebView after adb forward tcp:9348 localabstract:webview_devtools_remote_<app PID>.
// Requires a signed-in local test account; exports that account's JSON to the phone's Downloads.
const assert=require('node:assert/strict');
const fs=require('node:fs');

(async()=>{
  const targets=await(await fetch('http://127.0.0.1:9348/json')).json();
  const target=targets.find(t=>t.url.startsWith('http://127.0.0.1:3000/'));
  assert.ok(target,'HabitCents local debug WebView is connected');
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve=>ws.addEventListener('open',resolve));
  let id=0;const pending=new Map(),errors=[];
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);message.error?request.reject(message.error):request.resolve(message.result);}}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
    if(message.method==='Network.responseReceived'&&message.params.response.status>=400)errors.push(message.params.response.status+' '+message.params.response.url);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const serial=++id;pending.set(serial,{resolve,reject});ws.send(JSON.stringify({id:serial,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;};
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const checks=[];
  try{
    await send('Runtime.enable');await send('Network.enable');await send('Page.enable');
    for(const route of ['/dashboard','/habits','/expenses','/savings','/profile']){
      await send('Page.navigate',{url:'http://127.0.0.1:3000'+route});
      let page;
      for(let i=0;i<60;i++){
        await pause(100);
        page=await evaluate('({path:location.pathname,ready:document.readyState,text:document.body?.innerText,width:innerWidth,scroll:document.documentElement?.scrollWidth,nav:!!document.querySelector(".nav-dock")})');
        if(page.path===route&&page.ready==='complete')break;
      }
      assert.equal(page.path,route,'authenticated route '+route);assert.ok(page.nav,'navigation on '+route);
      assert.ok(page.scroll<=page.width+1,'no horizontal page overflow on '+route);
      await pause(700);
      checks.push({route,width:page.width,noOverflow:true});
    }
    assert.ok(await evaluate('navigator.userAgent.includes("HabitCentsAndroid/")'),'native export detection');
    await evaluate('document.querySelector("[data-export=json]").click()');
    await pause(1200);
    assert.deepEqual(errors,[],'no runtime exceptions or failed HTTP resources');
    fs.mkdirSync('.cache/android-review',{recursive:true});
    fs.writeFileSync('.cache/android-review/results.json',JSON.stringify({device:'Nothing A001',checks,errors,exportRequested:true},null,2));
    console.log(JSON.stringify({checks,errors,exportRequested:true},null,2));
  }finally{ws.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

