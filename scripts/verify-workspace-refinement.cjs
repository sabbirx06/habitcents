const assert = require("node:assert/strict"),
  fs = require("node:fs");
const base = "http://127.0.0.1:3001";
(async () => {
  const tabs = await (await fetch("http://127.0.0.1:9223/json/list")).json(),
    ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map(),
    errors = [],
    fonts = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      m.error ? p.reject(m.error) : p.resolve(m.result);
      pending.delete(m.id);
    }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
    if (m.method === "Network.responseReceived" && m.params.response.url.includes("/fonts/"))
      fonts.push({ url: m.params.response.url, status: m.params.response.status });
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const wait = async (expression) => {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 80));
    }
    throw Error("Timed out " + expression);
  };
  const viewport = async (width, height) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700,
    });
    await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))");
  };
  const go = async (path) => {
    await send("Page.navigate", { url: base + path });
    await wait('document.readyState==="complete"');
  };
  const click = (selector) =>
    evaluate("document.querySelector(" + JSON.stringify(selector) + ").click()");
  const fill = (values) =>
    evaluate(
      "Object.entries(" +
        JSON.stringify(values) +
        ').forEach(([name,value])=>{const i=document.querySelector("dialog [name="+name+"]");i.value=value;i.dispatchEvent(new Event("input",{bubbles:true}));})',
    );
  const submit = async () => {
    await evaluate('document.querySelector("dialog form").requestSubmit()');
    await wait('!document.querySelector("dialog")');
  };
  const screenshot = async (name) => {
    await evaluate("document.fonts.ready.then(()=>true)");
    const r = await send("Page.captureScreenshot", {
      captureBeyondViewport: true,
      clip: await evaluate(
        "({x:0,y:0,width:innerWidth,height:document.documentElement.scrollHeight,scale:1})",
      ),
    });
    fs.mkdirSync("artifacts", { recursive: true });
    fs.writeFileSync("artifacts/" + name + ".png", Buffer.from(r.data, "base64"));
  };
  const dialogButton = (label) =>
    evaluate(
      'Array.from(document.querySelectorAll("dialog button")).find(b=>b.textContent===' +
        JSON.stringify(label) +
        ").click()",
    );
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });

  try {
    const measurements = [];
    for (const page of ["habits", "expenses", "savings"]) {
      await viewport(1440, 900);
      await go("/" + page + "?scenario=populated");
      await wait('document.querySelector("#' + page + '-status").textContent===""');
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".workspace-header h1")).fontWeight'), "400");
      assert.ok(await evaluate('getComputedStyle(document.querySelector(".workspace-header h1")).fontFamily.includes("Neue Haas Grotesk Display")'));
      if (page === "habits")
        await wait(
          '!document.querySelector(".habit-history .workspace-status").textContent.includes("Loading")',
        );
      assert.equal(
        await evaluate(
          '[...document.querySelectorAll("main select")].filter(n=>n.getClientRects().length>0).length',
        ),
        0,
      );
      if (page === "habits") {
        assert.equal(
          await evaluate('document.querySelectorAll("main .history-inspection").length'),
          0,
        );
        assert.equal(await evaluate('document.querySelectorAll(".habit-summaries > section").length'), 2);
        await evaluate('document.querySelector("main .heat-cell[data-state=completed]").focus()');
        const date = await evaluate("document.activeElement.dataset.date");
        await evaluate("document.activeElement.click()");
        assert.equal(
          await evaluate('document.querySelector("dialog input[name=inspect]").value'),
          date,
        );
        await wait(
          'document.querySelector("dialog output").textContent.toLowerCase().includes("completed")',
        );
        assert.equal(await evaluate('document.querySelector(".nav-dock").inert'), true);
        await send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        });
        await wait('!document.querySelector("dialog")');
        assert.equal(await evaluate("document.activeElement.dataset.date"), date);
        await click("#habit-options");
        assert.ok(await evaluate('!!document.querySelector("dialog #habit-filter")'));
        await click("#habit-categories");
        assert.equal(await evaluate('document.querySelector("#habit-controls").hidden'), true);
        assert.equal(
          await evaluate('document.querySelector("#habit-controls").parentElement.tagName'),
          "MAIN",
        );
        await send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        });
        await wait('!document.querySelector("dialog")');
        assert.equal(await evaluate("document.body.style.overflow"), "");
      } else if (page === "expenses") {
        assert.equal(await evaluate('getComputedStyle(document.querySelector("#expense-new")).position'), "fixed");
        await evaluate('document.querySelector("#expense-new").focus();document.querySelector("#expense-new").click()');
        assert.ok(await evaluate('!!document.querySelector("dialog input[name=amount]")'));
        await send("Input.dispatchKeyEvent", {type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
        await wait('!document.querySelector("dialog")');
        assert.equal(await evaluate('document.activeElement.id'), "expense-new");
        assert.equal(await evaluate('document.querySelector("#expense-chart-detail").textContent'), "");
        await evaluate('document.querySelector("#spending-help-button").focus()');
        assert.equal(await evaluate('document.querySelector("#spending-help-text").hidden'), false);
        await send("Input.dispatchKeyEvent", {type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
        assert.equal(await evaluate('document.querySelector("#spending-help-text").hidden'), true);
        assert.equal(await evaluate('document.activeElement.id'), "spending-help-button");
        await evaluate('document.querySelector("#expense-bars button").focus()');
        assert.ok(await evaluate('document.querySelector("#expense-chart-detail").textContent.includes("Tk")'));
        assert.ok(await evaluate('Math.abs(document.querySelector(".expense-trend").getBoundingClientRect().bottom-document.querySelector(".expense-breakdown").getBoundingClientRect().bottom)<1'));
        assert.ok(await evaluate('Math.abs(document.querySelector(".expense-trend h2").getBoundingClientRect().top-document.querySelector(".expense-breakdown h2").getBoundingClientRect().top)<1'));
        assert.ok(await evaluate('!!document.querySelector(".expense-budget #budget-edit")'));
        assert.ok(await evaluate('document.querySelector("#category-legend").getBoundingClientRect().left >= document.querySelector("#category-visual").getBoundingClientRect().right'));
        await click("#transaction-options");
        await evaluate(
          '{const input=document.querySelector("#transaction-search");input.value="Demo";input.dispatchEvent(new Event("input"))}',
        );
        await dialogButton("Done");
        await wait('!document.querySelector("dialog")');
        await click("#transaction-options");
        assert.equal(
          await evaluate('document.querySelector("dialog #transaction-search").value'),
          "Demo",
        );
        await evaluate(
          '{const input=document.querySelector("#transaction-search");input.value="";input.dispatchEvent(new Event("input"))}',
        );
        await dialogButton("Done");
        await wait('!document.querySelector("dialog")');
        await click("#category-options");
        await click("#breakdown-bar");
        await dialogButton("Done");
        await wait('!document.querySelector("dialog")');
        assert.ok(await evaluate('!!document.querySelector(".category-bar")'));
      } else {
        await click('#goals-filter [data-value="completed"]');
        assert.ok(
          await evaluate(
            '[...document.querySelectorAll(".goal-ring")].every(n=>n.getAttribute("aria-valuenow")==="100")',
          ),
        );
        await click('#goals-filter [data-value="active"]');
      }
      await screenshot("refined-" + page + "-desktop");
      measurements.push(
        await evaluate(
          "({page:" +
            JSON.stringify(page) +
            ',width:innerWidth,scrollWidth:document.documentElement.scrollWidth,titleSize:getComputedStyle(document.querySelector("h1")).fontSize,cards:document.querySelectorAll(".workspace-card").length})',
        ),
      );
      for (const [width, height] of [
        [1366, 768],
        [650, 900],
        [390, 844],
        [320, 740],
      ]) {
        await viewport(width, height);
        await new Promise((r) => setTimeout(r, 250));
        assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"));
        if (page === "expenses") assert.ok(await evaluate('(()=>{const f=document.querySelector("#expense-new").getBoundingClientRect(),d=document.querySelector(".nav-dock").getBoundingClientRect();return f.right<=innerWidth&&f.bottom<=innerHeight&&(f.right<=d.left||f.left>=d.right||f.bottom<=d.top||f.top>=d.bottom)})()'));
        if (page === "habits")
          assert.ok(
            await evaluate(
              '[...document.querySelectorAll("main .habit-heatmap")].every(n=>n.getBoundingClientRect().right<=n.closest("article").getBoundingClientRect().right)',
            ),
          );
        await evaluate("scrollTo(0,document.documentElement.scrollHeight)");
        assert.ok(
          await evaluate(
            'document.querySelector("main").getBoundingClientRect().bottom<=document.querySelector(".nav-dock").getBoundingClientRect().top',
          ),
        );
        await evaluate("scrollTo(0,0)");
        if (width === 390) await screenshot("refined-" + page + "-mobile");
      }
      // Presentation-only stress fixture; no API mutations or database writes.
      await evaluate(`document.querySelectorAll('main article h2').forEach(n=>n.textContent='LongHabitOrGoalName'.repeat(5));document.querySelectorAll('main .transaction-title').forEach(n=>n.textContent='LongDescription'.repeat(6));document.querySelectorAll('main .goal-amount,main .transaction-amount,main #monthly-budget,main #expense-budget-spent').forEach(n=>n.textContent='Tk 98,765,432.10')`);
      assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"));
      await screenshot("refined-" + page + "-stress-mobile");
    }
    console.log(JSON.stringify(measurements, null, 2));
    assert.deepEqual(errors, []);
    await viewport(1440, 900);
    await go("/habits?scenario=populated");
  } finally {
    ws.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
