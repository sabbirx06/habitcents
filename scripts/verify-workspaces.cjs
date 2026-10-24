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
  try {
    await viewport(1440, 900);
    await go("/habits?scenario=populated");
    await wait('document.querySelectorAll(".habit-card").length===3');
    await wait(
      'Array.from(document.querySelectorAll(".habit-history .workspace-status")).every(n=>!n.textContent.includes("Loading"))',
    );
    assert.equal(await evaluate('document.querySelector("#habit-summary").textContent'), "1/3");
    assert.ok(
      await evaluate('document.querySelectorAll(".heat-cell[data-state=completed]").length>0'),
    );
    await screenshot("workspaces-habits-desktop");
    await click('[data-habit="101"] .habit-complete');
    await wait('document.querySelector("#habit-summary").textContent==="0/3"');
    await click('[data-habit="101"] .habit-complete');
    await wait('document.querySelector("#habit-summary").textContent==="1/3"');
    await click('[data-habit="103"] .habit-complete');
    await fill({ progress: "8" });
    await submit();
    await wait('document.querySelector("#habit-summary").textContent==="2/3"');
    await click('[data-habit="102"] .habit-complete');
    await wait('document.querySelector("#habit-streak").textContent==="8"');
    await click('[data-habit="102"] .habit-complete');
    await wait('document.querySelector("#habit-streak").textContent==="7"');
    await click('[data-habit="103"] .habit-complete');
    await fill({ progress: "3" });
    await submit();
    await wait('document.querySelector("#habit-summary").textContent==="1/3"');
    await evaluate('document.querySelector(".heat-cell").focus()');
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "ArrowRight",
      code: "ArrowRight",
      windowsVirtualKeyCode: 39,
    });
    assert.ok(await evaluate('document.activeElement.classList.contains("heat-cell")'));
    await evaluate(
      'Array.from(document.querySelector(".habit-card").querySelectorAll("button")).find(b=>b.textContent==="View history ↗").click()',
    );
    await wait('document.querySelector("dialog .heat-cell")');
    assert.equal(await evaluate('document.querySelectorAll("dialog .heat-cell").length'), 364);
    assert.equal(await evaluate('document.querySelector(".nav-dock").inert'), true);
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await wait('!document.querySelector("dialog")');
    assert.equal(await evaluate("document.body.style.overflow"), "");
    await click("#habit-new");
    await fill({ name: "Browser <script>habit</script>", description: "Safe literal text" });
    await submit();
    await wait('document.querySelectorAll(".habit-card").length===4');
    assert.equal(await evaluate('document.querySelectorAll("#habit-list script").length'), 0);
    assert.ok(
      await evaluate(
        'document.querySelector("#habit-list").textContent.includes("<script>habit</script>")',
      ),
    );
    await evaluate(
      'Array.from(document.querySelectorAll(".habit-card")).find(c=>c.textContent.includes("Browser <script>")).querySelector(".habit-details").click()',
    );
    await dialogButton("Edit habit");
    await fill({ name: "Browser renamed habit" });
    await submit();
    await wait(
      'document.querySelector("#habit-list").textContent.includes("Browser renamed habit")',
    );
    await evaluate(
      'Array.from(document.querySelectorAll(".habit-card")).find(c=>c.textContent.includes("Browser renamed")).querySelector(".habit-details").click()',
    );
    await dialogButton("Archive");
    await submit();
    await wait('document.querySelectorAll(".habit-card").length===3');
    await evaluate(
      'document.querySelector("#habit-filter").value="archived";document.querySelector("#habit-filter").dispatchEvent(new Event("change"))',
    );
    assert.equal(await evaluate('document.querySelectorAll(".habit-card").length'), 1);
    await evaluate('document.querySelector(".habit-card .habit-details").click()');
    await dialogButton("Delete");
    await submit();
    await wait('document.querySelectorAll(".habit-card").length===0');
    await go("/expenses?scenario=populated");
    await wait('document.querySelector("#expenses-status").textContent===""');
    await wait(
      'document.querySelector("#recurring-status").textContent!=="Loading recurring expenses…"',
    );
    assert.ok(
      await evaluate(
        '!!document.querySelector(".category-bar")||!!document.querySelector(".category-donut")',
      ),
    );
    await click("#category-options");
    await click("#breakdown-bar");
    await dialogButton("Done");
    await wait('!document.querySelector("dialog")');
    assert.ok(await evaluate('!!document.querySelector(".category-bar")'));
    await go("/expenses");
    await wait('document.querySelector("#expenses-status").textContent===""');
    assert.ok(await evaluate('!!document.querySelector(".category-bar")'));
    await click("#category-options");
    await click("#breakdown-circle");
    await dialogButton("Done");
    await wait('!document.querySelector("dialog")');
    await screenshot("workspaces-expenses-desktop");
    await click("#expense-new");
    await fill({ name: "Browser workspace groceries", amount: "3.40", category: "food" });
    await submit();
    await wait(
      'document.querySelector("#expense-list").textContent.includes("Browser workspace groceries")',
    );
    await evaluate(
      'document.querySelector("#transaction-search").value="Browser workspace";document.querySelector("#transaction-search").dispatchEvent(new Event("input"))',
    );
    assert.equal(await evaluate('document.querySelectorAll(".transaction").length'), 1);
    await click(".transaction button");
    await fill({ amount: "4.50" });
    await submit();
    assert.ok(
      await evaluate('document.querySelector("#expense-list").textContent.includes("4.50")'),
    );
    await click(".transaction button");
    await dialogButton("Delete");
    await submit();
    await wait(
      '!document.querySelector("#expense-list").textContent.includes("Browser workspace groceries")',
    );
    await evaluate(
      'document.querySelector("#transaction-search").value="";document.querySelector("#transaction-search").dispatchEvent(new Event("input"))',
    );
    await click("#month-previous");
    await wait('document.querySelector("#expenses-status").textContent===""');
    await click("#budget-edit");
    await fill({ amount: "20000" });
    await submit();
    await click("#expense-new");
    await fill({ name: "Historical browser expense", amount: "1.25" });
    await submit();
    await wait(
      'document.querySelector("#expense-list").textContent.includes("Historical browser expense")',
    );
    await click("#month-next");
    await wait('document.querySelector("#expenses-status").textContent===""');
    await click("#recurring-new");
    await fill({ name: "Browser subscription", amount: "50.25", frequency: "monthly" });
    await submit();
    await wait(
      'document.querySelector("#recurring-list").textContent.includes("Browser subscription")',
    );
    await evaluate(
      'Array.from(document.querySelectorAll(".recurring-row")).find(r=>r.textContent.includes("Browser subscription")).querySelector("[aria-label^=\\\"Record payment due\\\"]").click()',
    );
    await submit();
    await wait('document.querySelector("#recurring-list").textContent.includes("Due ")');
    await go("/savings?scenario=populated");
    await wait('document.querySelectorAll(".goal-card").length===2');
    await screenshot("workspaces-savings-desktop");
    await click("#goal-new");
    await fill({ name: "Browser goal", target: "100", deadline: "2027-02-28" });
    await submit();
    await wait('document.querySelectorAll(".goal-card").length===3');
    await evaluate(
      'Array.from(document.querySelectorAll(".goal-card")).find(c=>c.textContent.includes("Browser goal")).querySelector(".recurring-actions button").click()',
    );
    await fill({ amount: "12.35" });
    await submit();
    assert.ok(
      await evaluate(
        'Array.from(document.querySelectorAll(".goal-card")).find(c=>c.textContent.includes("Browser goal")).textContent.includes("12.35")',
      ),
    );
    await evaluate(
      'Array.from(document.querySelectorAll(".goal-card")).find(c=>c.textContent.includes("Browser goal")).querySelector(".workspace-icon-button").click()',
    );
    await dialogButton("Edit");
    await fill({ target: "10" });
    await submit();
    assert.equal(
      await evaluate(
        'Array.from(document.querySelectorAll(".goal-card")).find(c=>c.textContent.includes("Browser goal")).querySelector("[role=progressbar]").getAttribute("aria-valuenow")',
      ),
      "100",
    );
    await evaluate(
      'Array.from(document.querySelectorAll(".goal-card")).find(c=>c.textContent.includes("Browser goal")).querySelector(".workspace-icon-button").click()',
    );
    await dialogButton("Archive");
    await submit();
    await wait('document.querySelectorAll(".goal-card").length===2');
    await evaluate(
      `document.querySelector('#goals-filter [data-value="archived"]').click()`,
    );
    assert.ok(
      await evaluate('document.querySelector("#goals-list").textContent.includes("12.35")'),
    );
    for (const page of ["habits", "expenses", "savings"])
      for (const [width, height] of [
        [1366, 768],
        [390, 844],
        [320, 740],
      ]) {
        await viewport(width, height);
        await go("/" + page + "?scenario=populated");
        const statusId = { habits: "habits", expenses: "expenses", savings: "savings" }[page];
        await wait(
          '!document.querySelector("#' + statusId + '-status").textContent.startsWith("Loading")',
        );
        await evaluate("document.fonts.ready.then(()=>true)");
        assert.ok(
          await evaluate("document.documentElement.scrollWidth<=innerWidth"),
          page + " width " + width,
        );
        await evaluate("scrollTo(0,document.documentElement.scrollHeight)");
        assert.ok(
          await evaluate(
            'document.querySelector("main").getBoundingClientRect().bottom<=document.querySelector(".nav-dock").getBoundingClientRect().top',
          ),
          page + " dock",
        );
        await evaluate("scrollTo(0,0)");
        await screenshot("workspaces-" + page + "-" + width);
      }
    for (const page of ["habits", "expenses", "savings"])
      for (const scenario of ["empty", "failure"]) {
        await viewport(390, 844);
        await go("/" + page + "?scenario=" + scenario);
        await wait(
          '!document.querySelector("#' + page + '-status").textContent.startsWith("Loading")',
        );
        assert.ok(await evaluate('!!document.querySelector(".workspace-header h1")'));
        assert.equal(await evaluate('document.querySelectorAll("[aria-current=page]").length'), 1);
        if (scenario === "failure")
          assert.ok(
            await evaluate(
              'document.querySelector("#' + page + '-status").textContent.includes("failure")',
            ),
          );
        await screenshot("workspaces-" + page + "-" + scenario);
      }
    await go("/habits?scenario=historyFailure");
    await wait('document.querySelectorAll(".habit-card").length===3');
    await wait(
      'document.querySelector(".habit-history .workspace-status").textContent.includes("unavailable")',
    );
    assert.ok(await evaluate('document.querySelectorAll(".heat-cell").length>0'));
    assert.equal(
      await evaluate(
        'document.querySelectorAll(".heat-cell[data-state=missed],.heat-cell[data-state=completed]").length',
      ),
      0,
    );
    await screenshot("workspaces-history-failure");
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await click("#habit-new");
    assert.equal(
      await evaluate('getComputedStyle(document.querySelector("dialog")).animationName'),
      "none",
    );
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await wait('!document.querySelector("dialog")');
    assert.equal(await evaluate('document.querySelector(".nav-dock").inert'), false);
    assert.deepEqual(errors, []);
    assert.ok(fonts.some((f) => f.url.includes("NeueHaasGrotText-55Roman")));
    assert.ok(fonts.every((f) => [200, 304].includes(f.status)));
    assert.ok(
      await evaluate(
        'getComputedStyle(document.querySelector("main")).fontFamily.includes("Neue Haas Grotesk Text")',
      ),
    );
    assert.ok(
      await evaluate(
        'getComputedStyle(document.querySelector(".workspace-header h1")).fontFamily.includes("Neue Haas Grotesk Display")',
      ),
    );
    assert.equal(
      await evaluate('getComputedStyle(document.querySelector("main")).fontSynthesis'),
      "none",
    );
    console.log(
      JSON.stringify(
        {
          passed: true,
          errors,
          fontRequests: [...new Set(fonts.map((f) => f.url))],
          checks: [
            "habit totals, check/uncheck, quantitative target, one universal day",
            "safe names, creation, editing, archive and delete",
            "neutral failed history and keyboard cell inspection",
            "extended read-only history and modal focus/inert/scroll lock",
            "month navigation and non-destructive budget edits",
            "expense CRUD and search",
            "donut/bar persistence and identical distributions",
            "explicit recurring payment confirmation",
            "goal create/contribute/edit/archive, clamped progress",
            "1366 desktop and 390/320 mobile overflow and dock clearance",
            "empty/failure states, reduced motion and font requests",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await send("Emulation.setEmulatedMedia", { features: [] });
    await send("Network.setCacheDisabled", { cacheDisabled: false });
    await viewport(1440, 900);
    ws.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
