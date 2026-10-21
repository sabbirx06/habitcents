const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  ejs = require("ejs");
const uri = (source) => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const shared = uri(fs.readFileSync("public/js/workspace.js", "utf8")),
  dashboard = uri(fs.readFileSync('public/js/dashboard.js','utf8').replace('./expense-icons.js', 'data:text/javascript;base64,'+Buffer.from(fs.readFileSync('public/js/expense-icons.js','utf8')).toString('base64')));
const load = (name) =>
  import(
    uri(
      fs
        .readFileSync("public/js/" + name + ".js", "utf8")
        .replace('./expense-icons.js', uri(fs.readFileSync('public/js/expense-icons.js','utf8')))
        .replace(/(['"])\.\/workspace\.js\1/g, () => JSON.stringify(shared))
        .replace(/(['"])\.\/dashboard\.js\1/g, () => JSON.stringify(dashboard)),
    )
  );
test("workspace templates share the dashboard typography and dock without point scoring or unsafe inline handlers", async () => {
  for (const [page, title] of [
    ["habits", "Your habits."],
    ["expenses", "Your money."],
    ["savings", "Your goals."],
  ]) {
    const html = await ejs.renderFile("views/" + page + ".ejs", {
      page,
      user: { name: "Test" },
      demo: true,
    });
    assert.ok(html.includes(title));
    assert.ok(html.includes("workspaces.css"));
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
    assert.ok(html.includes("fonts-authenticated.css"));
    assert.match(html, /Demo preview/);
    assert.doesNotMatch(html, /Total Streak Points|difficulty-input|onclick=/);
  }
});
test("heatmaps align seven weekdays and keep unknown, scheduled, partial, rest and future dates distinct", async () => {
  const { heatmapDates, habitCells } = await load("habits"),
    dates = heatmapDates("2024-03-01", 20);
  assert.equal(dates.length, 140);
  assert.equal(new Date(dates[0] + "T12:00Z").getUTCDay(), 1);
  assert.ok(dates.includes("2024-02-29"));
  assert.equal(new Date(dates.at(-1) + "T12:00Z").getUTCDay(), 0);
  let cells = habitCells({ dates, today: "2024-03-01" });
  assert.equal(cells.find((c) => c.date === "2024-02-29").state, "unknown");
  assert.equal(cells.find((c) => c.date === "2024-03-02").state, "future");
  cells = habitCells({
    dates,
    today: "2024-03-01",
    createdOn: "2024-02-25",
    available: true,
    versions: [
      { effective_on: "2024-02-25", schedule_days: [1, 2, 3, 4, 5], target: 30, unit: "minutes" },
    ],
    records: [
      { date: "2024-02-26", completed_status: true },
      { date: "2024-02-27", completed_status: false, progress_amount: "10" },
    ],
  });
  const state = (day) => cells.find((c) => c.date === day).state;
  assert.equal(state("2024-02-24"), "before-creation");
  assert.equal(state("2024-02-25"), "rest");
  assert.equal(state("2024-02-26"), "completed");
  assert.equal(state("2024-02-27"), "partial");
  assert.equal(state("2024-02-28"), "missed");
  assert.equal(state("2024-03-01"), "unknown");
  assert.equal(
    habitCells({
      dates,
      today: "2024-03-01",
      records: [{ date: "2024-02-26", completed_status: true }],
      available: false,
    }).find((c) => c.date === "2024-02-26").state,
    "unknown",
  );
});

test("habit and expense controls retain filters with separate habit summaries", async () => {
  const render = (page) =>
    ejs.renderFile("views/" + page + ".ejs", { page, user: { name: "Test" }, demo: true });
  const habits = await render("habits");
  assert.match(habits, /habit-progress-card/);
  assert.match(habits, /habit-streak-card/);
  assert.doesNotMatch(habits, /id="habit-presets"/);
  assert.match(habits, /id="habit-new" class="workspace-button workspace-fab"/);
  assert.doesNotMatch(habits, /workspace-streak/);
  assert.match(habits, /id="habit-options"[^>]*aria-label="Filter and manage habits"/);
  assert.match(habits, /id="habit-controls"[^>]*hidden/);
  const expenses = await render("expenses");
  assert.match(
    expenses,
    /id="transaction-options"[^>]*aria-label="Search and filter transactions"/,
  );
  assert.match(expenses, /id="transaction-controls"[^>]*hidden/);
  assert.match(expenses, /id="category-controls"[^>]*hidden/);
  assert.match(expenses, /expense-spent/);
  assert.match(expenses, /expense-recurring/);
  assert.match(expenses, /id="calendar-open"/);
  assert.match(expenses, /id="expense-new" class="workspace-button workspace-fab"/);
});

test("savings uses a list without visualization options and shares the primary header action", async () => {
  const savings = await ejs.renderFile("views/savings.ejs", { page: "savings", user: { name: "Test" }, demo: true });
  assert.match(savings, /id="goals-filter" class="segmented-control"/);
  assert.doesNotMatch(savings, /id="goals-view"|Circular|Goal visualization/);
  assert.match(savings, /id="goals-list" class="savings-list"/);
  assert.match(savings, /id="goal-new" class="page-header-action header-primary-action"/);
  assert.doesNotMatch(savings, /id="goal-options"|<select/);
  assert.doesNotMatch(savings, /workspace-card lime/);
});
test("expense aggregation reconciles precise daily and category totals without inferring categories", async () => {
  const { aggregateExpenses } = await load("expenses");
  const totals = aggregateExpenses([
    { date: "2024-02-29", amount: "0.10", category: "food" },
    { date: "2024-02-29", amount: "0.20", category: "food" },
    { date: "2024-03-01", amount: "12.35", category: "unknown" },
  ]);
  assert.equal(totals.total, 1265);
  assert.equal(totals.byDate.get("2024-02-29"), 30);
  assert.equal(totals.byCategory.get("food"), 30);
  assert.equal(totals.byCategory.get("uncategorized"), 1235);
  assert.equal(aggregateExpenses([]).total, 0);
  assert.throws(() => aggregateExpenses([{ amount: "invalid" }]));
});
test("savings summary excludes archived balances and preserves completed goals until explicitly archived", async () => {
  const { summarizeGoals } = await load("savings");
  assert.deepEqual(
    summarizeGoals([
      { saved_amount: "0.10", archived: false },
      { saved_amount: "0.20", archived: false },
      { saved_amount: "100", archived: true },
    ]),
    { totalCents: 30, count: 2 },
  );
  assert.deepEqual(summarizeGoals([]), { totalCents: 0, count: 0 });
  assert.throws(() => summarizeGoals([{ saved_amount: "unavailable", archived: false }]));
});

test('habit accents preserve saved custom colors and vary missing colors by stable ID',async()=>{
 const {habitAccent}=await load('habits');
 for(const color of ['lavender','blue','lime','peach','pink']) assert.equal(habitAccent({color}),color);
 const existing=Array.from({length:6},(_,i)=>({habit_id:String(101+i),habit_name:'[Demo] Existing '+i,color:i===0?'invalid':null}));
 assert.equal(new Set(existing.map(habit=>habitAccent(habit))).size,5);
 assert.deepEqual([...existing].reverse().map(habit=>habitAccent(habit)).reverse(),existing.map(habit=>habitAccent(habit)));
 assert.equal(habitAccent({habit_id:101}),habitAccent({habit_id:'101'}));
 assert.equal(habitAccent({habit_id:'9007199254740993'}),'lavender');
 assert.equal(habitAccent({category:'Movement',color:'lavender'},[{name:'Movement',color:'blue'}]),'lavender');
 assert.equal(habitAccent({category:'Movement'},[{name:'Movement',color:'blue'}]),'blue');
});
