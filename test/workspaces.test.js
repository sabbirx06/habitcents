const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const { habitInput, nextPayment, money } = require("../lib/workspaces");
async function workspace(run) {
  const db = new PGlite();
  await db.exec(fs.readFileSync("schema.postgres.sql", "utf8"));
  await db.exec(fs.readFileSync("migrations/002-universal-streak-draft.sql", "utf8"));
  await db.exec(fs.readFileSync("migrations/003-workspaces.sql", "utf8"));
  await db.query("SET TIME ZONE 'Asia/Dhaka'");
  const pool = {
      query: (...a) => db.query(...a),
      connect: async () => ({ query: (...a) => db.query(...a), release() {} }),
    },
    server = require("../server")
      .createApp({ db: pool, sessionSecret: "workspace-local-test" })
      .listen(0, "127.0.0.1");
  await new Promise((r) => server.on("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (url, body, cookie) =>
    fetch(base + url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
      redirect: "manual",
    });
  const get = (url, cookie) =>
    fetch(base + url, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  const login = async (email = "workspace@test") => {
    await post("/signup", { name: "Test", email, password: "secret" });
    return (await post("/login", { email, password: "secret" })).headers
      .get("set-cookie")
      .split(";")[0];
  };
  try {
    await run({ db, pool, base, post, get, login });
  } finally {
    await new Promise((r) => server.close(r));
    await db.close();
  }
}
const habit = (name = "Read") => ({
  name,
  description: "A few pages",
  schedule_days: [1, 2, 3, 4, 5, 6, 7],
  category: "Learning",
  color: "lavender",
  icon: "book",
  target: "30",
  unit: "minutes",
});
test("workspace validation and recurring anchors preserve calendar semantics", () => {
  assert.equal(nextPayment("2024-01-31", "monthly", "2024-01-31"), "2024-02-29");
  assert.equal(nextPayment("2024-02-29", "monthly", "2024-01-31"), "2024-03-31");
  assert.equal(nextPayment("2024-02-29", "yearly", "2024-02-29"), "2025-02-28");
  assert.equal(nextPayment("2024-12-30", "weekly", "2024-12-30"), "2025-01-06");
  for (const value of ["-1", "0", "1.001", "Infinity", "100000000"])
    assert.throws(() => money(value));
  assert.equal(money("0", true), 0);
  assert.equal(habitInput(habit()).target, 30);
  assert.throws(() => habitInput({ ...habit(), schedule_days: [] }));
  assert.throws(() => habitInput({ ...habit(), schedule_days: [1, 1] }));
  assert.throws(() => habitInput({ ...habit(), unit: "" }));
});
test("additive workspace migration preserves legacy records and does not invent creation dates", async () => {
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync("schema.postgres.sql", "utf8"));
    await db.query("INSERT INTO users(name,email,password)VALUES('Old','old@test','unused')");
    await db.query(
      "INSERT INTO habits(user_id,habit_name,difficulty_score,category)VALUES(1,'Old habit',7,'custom')",
    );
    await db.query(
      "INSERT INTO habit_logs(habit_id,date,completed_status)VALUES(1,'2024-02-29',true)",
    );
    await db.query(
      "INSERT INTO savings_goals(user_id,name,saved_amount,target_amount)VALUES(1,'Old goal',12.35,100)",
    );
    await db.exec(fs.readFileSync("migrations/003-workspaces.sql", "utf8"));
    const {
      rows: [h],
    } = await db.query("SELECT * FROM habits");
    assert.equal(h.created_on, null);
    assert.equal(h.difficulty_score, 7);
    assert.equal((await db.query("SELECT * FROM habit_logs")).rows.length, 1);
    assert.equal(
      Number((await db.query("SELECT * FROM savings_goals")).rows[0].saved_amount),
      12.35,
    );
    assert.equal((await db.query("SELECT * FROM habit_schedule_versions")).rows.length, 1);
  } finally {
    await db.close();
  }
});
test("scheduled quantitative habits set daily totals, synchronize dashboard, and earn one universal day", async () =>
  workspace(async ({ db, post, get, login }) => {
    const cookie = await login(),
      today = (await db.query("SELECT CURRENT_DATE::text AS day")).rows[0].day;
    await db.query(
      "INSERT INTO universal_streak_enrollments(user_id,starts_on,empty_day_policy,day_change_policy,policies_confirmed,time_zone,capture_version)VALUES(1,$1,'reset','apply',true,'Asia/Dhaka',1)",
      [today],
    );
    const created = await post("/api/habits/save", habit(), cookie);
    assert.equal(created.status, 200);
    const id = (await created.json()).habit_id;
    let response = await get("/api/habits", cookie),
      body = await response.json();
    assert.equal(body.today, today);
    assert.equal(body.habits[0].due_today, true);
    assert.equal(body.habits[0].icon, 'book');
    assert.equal(body.habits[0].color, 'lavender');
    assert.equal(Number(body.habits[0].target), 30);
    assert.equal(body.habits[0].unit, 'minutes');
    assert.deepEqual(body.habits[0].schedule_days, [1,2,3,4,5,6,7]);
    assert.equal(body.streak.count, 0);
    for (const total of ["10", "20"]) {
      assert.equal(
        (await post("/api/habits/progress", { habit_id: id, date: today, progress: total }, cookie))
          .status,
        200,
      );
      assert.equal((await (await get("/dashboard-data", cookie)).json()).completed, 0);
    }
    await post("/api/habits/progress", { habit_id: id, date: today, progress: "30" }, cookie);
    await post("/api/habits/progress", { habit_id: id, date: today, progress: "30" }, cookie);
    assert.equal((await (await get("/universal-streak", cookie)).json()).count, 1);
    assert.equal((await (await get("/dashboard-data", cookie)).json()).completed, 1);
    const currentWeekday=new Date(today+'T12:00Z').getUTCDay()||7;
    await post('/api/habits/save',{...habit('Rest-day habit'),target:null,unit:null,schedule_days:[currentWeekday===7?1:currentWeekday+1]},cookie);
    assert.equal((await(await get('/universal-streak',cookie)).json()).count,1,'An unscheduled habit does not block a successful day');
    await post("/api/habits/progress", { habit_id: id, date: today, progress: "15" }, cookie);
    assert.equal((await (await get("/universal-streak", cookie)).json()).count, 0);
    assert.equal(
      (
        await post(
          "/api/habits/progress",
          { habit_id: id, date: "2024-02-29", progress: "30" },
          cookie,
        )
      ).status,
      400,
    );
    const weekday = new Date(today + "T12:00Z").getUTCDay() || 7,
      restDay = weekday === 7 ? 1 : weekday + 1;
    await post("/api/habits/save", { ...habit(), habit_id: id, schedule_days: [restDay] }, cookie);
    assert.equal((await (await get("/dashboard-data", cookie)).json()).totalHabits, 0);
    assert.equal((await (await get("/get-habits", cookie)).json()).length, 0);
    assert.equal(
      (await post("/api/habits/progress", { habit_id: id, date: today, progress: "30" }, cookie))
        .status,
      400,
    );
    await post("/api/habits/archive", { habit_id: id, archived: true }, cookie);
    assert.equal((await (await get("/api/habits", cookie)).json()).habits[0].archived_on, today);
    const history = await (
      await get("/api/habits/history?habitId=" + id + "&start=" + today + "&end=" + today, cookie)
    ).json();
    assert.equal(history.records.length, 1);
    assert.equal(history.versions[0].archived, true);
  }));
test("expense edits, historical budgets, and category totals preserve precise owned transactions", async () =>
  workspace(async ({ post, get, login, db }) => {
    const cookie = await login();
    await post("/api/budget", { month: "2024-02", amount: "100" }, cookie);
    await post("/api/budget", { month: "2024-03", amount: "200" }, cookie);
    const save = await post(
      "/api/expenses/save",
      { name: "Tea <script>", amount: "12.35", date: "2024-02-29", category: "food" },
      cookie,
    );
    assert.equal(save.status, 200);
    const id = (await save.json()).expense_id;
    await post("/api/budget", { month: "2024-02", amount: "300" }, cookie);
    let body = await (await get("/api/expenses?month=2024-02", cookie)).json();
    assert.equal(body.expenses.length, 1);
    assert.equal(Number(body.budget), 300);
    assert.equal(
      (
        await post(
          "/api/expenses/save",
          {
            expense_id: id,
            name: "Changed",
            amount: "0.20",
            date: "2024-03-01",
            category: "transport",
          },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await (await get("/api/expenses?month=2024-02", cookie)).json()).expenses.length,
      0,
    );
    body = await (await get("/api/expenses?month=2024-03", cookie)).json();
    assert.equal(body.expenses[0].category, "transport");
    assert.equal(Number(body.expenses[0].amount), 0.2);
    for (const amount of ["-1", "0", "1.001", "Infinity"])
      assert.equal(
        (
          await post(
            "/api/expenses/save",
            { name: "Bad", amount, date: "2024-03-01", category: "food" },
            cookie,
          )
        ).status,
        400,
      );
    assert.equal(
      (
        await post(
          "/api/expenses/save",
          { name: "Bad date", amount: "1", date: "2023-02-29", category: "food" },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/api/expenses/save",
          { name: "No budget", amount: "1", date: "2024-04-01", category: "food" },
          cookie,
        )
      ).status,
      409,
    );
    await get("/reset-budget", cookie);
    assert.equal((await db.query("SELECT * FROM expenses")).rows.length, 1);
    await post("/delete-expense", { expense_id: id }, cookie);
    assert.equal((await db.query("SELECT * FROM expenses")).rows.length, 0);
  }));
test("recurring definitions do not create payments and repeat confirmation cannot duplicate transactions", async () =>
  workspace(async ({ post, get, login, db }) => {
    const cookie = await login(),
      today = (await db.query("SELECT CURRENT_DATE::text AS d")).rows[0].d;
    await post("/api/budget", { month: today.slice(0, 7), amount: "1000" }, cookie);
    await post(
      "/api/recurring/save",
      {
        name: "Internet",
        amount: "100.25",
        category: "subscriptions",
        frequency: "monthly",
        starts_on: today,
      },
      cookie,
    );
    assert.equal((await db.query("SELECT * FROM expenses")).rows.length, 0);
    const { definitions } = await (await get("/api/recurring", cookie)).json(),
      r = definitions[0];
    const body = { recurring_id: r.recurring_id, scheduled_for: today, date: today };
    assert.equal((await post("/api/recurring/confirm", body, cookie)).status, 200);
    assert.equal((await post("/api/recurring/confirm", body, cookie)).status, 409);
    assert.equal((await db.query("SELECT * FROM expenses")).rows.length, 1);
    await post("/api/recurring/save", { ...r, name: "Internet", enabled: false }, cookie);
    assert.equal(
      (await (await get("/api/recurring", cookie)).json()).definitions[0].enabled,
      false,
    );
  }));
test("goal contributions are atomic positive amounts and archive/edit preserve balances", async () =>
  workspace(async ({ post, get, login, db }) => {
    const cookie = await login();
    assert.equal(
      (
        await post(
          "/api/goals/save",
          { name: "Trip", target: "100", deadline: "2024-02-29" },
          cookie,
        )
      ).status,
      200,
    );
    let goal = (await (await get("/api/goals", cookie)).json()).goals[0];
    assert.equal(goal.deadline, '2024-02-29');
    for (const amount of ["-1", "0", "0.001"])
      assert.equal(
        (await post("/api/goals/contribute", { goal_id: goal.goal_id, amount }, cookie)).status,
        400,
      );
    await post("/api/goals/contribute", { goal_id: goal.goal_id, amount: "25.50" }, cookie);
    await post("/api/goals/contribute", { goal_id: goal.goal_id, amount: "0.10" }, cookie);
    await post(
      "/api/goals/save",
      { goal_id: goal.goal_id, name: "Trip renamed", target: "20", deadline: "" },
      cookie,
    );
    goal = (await (await get("/api/goals", cookie)).json()).goals[0];
    assert.equal(Number(goal.saved_amount), 25.6);
    assert.equal(goal.deadline, null);
    await post("/api/goals/archive", { goal_id: goal.goal_id, archived: true }, cookie);
    assert.equal((await (await get("/savings-data", cookie)).json()).length, 0);
    assert.equal(
      (await post("/api/goals/contribute", { goal_id: goal.goal_id, amount: "1" }, cookie)).status,
      409,
    );
    assert.equal(
      (await post("/add-saving", { goal_id: goal.goal_id, amount: "1" }, cookie)).status,
      404,
    );
    await post("/api/goals/archive", { goal_id: goal.goal_id, archived: false }, cookie);
    assert.equal(
      Number((await db.query("SELECT saved_amount FROM savings_goals")).rows[0].saved_amount),
      25.6,
    );
  }));
test("every workspace record mutation and history query stays scoped to the signed-in user", async () =>
  workspace(async ({ post, get, login, db }) => {
    const owner = await login(),
      other = await login("other-workspace@test"),
      today = (await db.query("SELECT CURRENT_DATE::text AS d")).rows[0].d;
    const h = (await (await post("/api/habits/save", habit(), owner)).json()).habit_id;
    await post("/api/goals/save", { name: "Owned", target: "100" }, owner);
    const g = (await (await get("/api/goals", owner)).json()).goals[0].goal_id;
    await post("/api/budget", { month: today.slice(0, 7), amount: "100" }, owner);
    const e = (
      await (
        await post(
          "/api/expenses/save",
          { name: "Owned", amount: "1", date: today, category: "food" },
          owner,
        )
      ).json()
    ).expense_id;
    for (const [url, body] of [
      ["/api/habits/save", { ...habit(), habit_id: h }],
      ["/api/habits/archive", { habit_id: h, archived: true }],
      ["/api/habits/progress", { habit_id: h, date: today, progress: "30" }],
      ["/api/goals/save", { goal_id: g, name: "Stolen", target: "1" }],
      ["/api/goals/archive", { goal_id: g, archived: true }],
      [
        "/api/expenses/save",
        { expense_id: e, name: "Stolen", amount: "1", date: today, category: "food" },
      ],
      ["/delete-expense", { expense_id: e }],
    ])
      assert.equal((await post(url, body, other)).status, 404, url);
    assert.equal(
      (await post("/api/goals/contribute", { goal_id: g, amount: "1" }, other)).status,
      409,
    );
    assert.equal(
      (await get("/api/habits/history?habitId=" + h + "&start=" + today + "&end=" + today, other))
        .status,
      404,
    );
    assert.equal((await get("/api/goals")).status, 302);
    assert.equal(
      (await (await get("/api/expenses?month=" + today.slice(0, 7), other)).json()).expenses.length,
      0,
    );
  }));
test("persistent sessions expire and destroy safely without storing credentials", async () => {
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync("migrations/004-sessions.sql", "utf8"));
    const store = new (require("../lib/session-store").PostgresSessionStore)(db),
      call = (method, ...args) =>
        new Promise((resolve, reject) =>
          store[method](...args, (e, v) => (e ? reject(e) : resolve(v))),
        );
    await call("set", "test", {
      cookie: { expires: new Date(Date.now() + 60000).toISOString() },
      user: { user_id: 1, name: "A" },
    });
    assert.equal((await call("get", "test")).user.name, "A");
    await call("touch", "test", { cookie: { expires: new Date(Date.now() - 1000).toISOString() } });
    assert.equal(await call("get", "test"), null);
    await call("destroy", "test");
    assert.equal((await db.query("SELECT * FROM app_sessions")).rows.length, 0);
  } finally {
    await db.close();
  }
});
test("streak enrollment is explicit, starts today, and never replaces existing evidence", async () =>
  workspace(async ({ db, post, get, login }) => {
    const cookie = await login();
    await post("/api/habits/save", { ...habit(), target: null, unit: null }, cookie);
    assert.equal((await (await get("/universal-streak", cookie)).json()).status, "setup-required");
    assert.equal((await post("/api/habits/streak/start", { confirm: false }, cookie)).status, 400);
    assert.equal((await post("/api/habits/streak/start", { confirm: true }, cookie)).status, 200);
    const before = (await db.query("SELECT * FROM universal_streak_enrollments")).rows[0];
    assert.equal(before.time_zone, "Asia/Dhaka");
    assert.equal((await (await get("/universal-streak", cookie)).json()).count, 0);
    assert.equal((await post("/api/habits/streak/start", { confirm: true }, cookie)).status, 409);
    assert.equal((await db.query("SELECT * FROM universal_streak_enrollments")).rows.length, 1);
    const h = (await (await get("/get-habits", cookie)).json())[0];
    await post(
      "/api/habits/progress",
      {
        habit_id: h.habit_id,
        date: (await db.query("SELECT CURRENT_DATE::text AS d")).rows[0].d,
        completed: false,
      },
      cookie,
    );
    await post("/toggle-habit", { habit_id: h.habit_id }, cookie);
    assert.equal((await (await get("/dashboard-data", cookie)).json()).completed, 1);
  }));
test("pre-upgrade workspace reads preserve legacy records and do not manufacture missed history", async () => {
  const db = new PGlite();
  await db.exec(fs.readFileSync("schema.postgres.sql", "utf8"));
  await db.query("SET TIME ZONE 'Asia/Dhaka'");
  const pool = {
      query: (...a) => db.query(...a),
      connect: async () => ({ query: (...a) => db.query(...a), release() {} }),
    },
    server = require("../server")
      .createApp({ db: pool, sessionSecret: "legacy-workspace-test" })
      .listen(0, "127.0.0.1");
  await new Promise((r) => server.on("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  let cookie;
  const post = (url, body) =>
    fetch(base + url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
      redirect: "manual",
    });
  const get = (url) => fetch(base + url, { headers: { cookie } });
  try {
    await post("/signup", { name: "Legacy", email: "before-upgrade@test", password: "secret" });
    cookie = (await post("/login", { email: "before-upgrade@test", password: "secret" })).headers
      .get("set-cookie")
      .split(";")[0];
    await post("/add-habit", { name: "Legacy habit", difficulty: 7, category: "custom" });
    let data = await (await get("/api/habits")).json();
    assert.equal(data.habits.length, 1);
    assert.equal(data.habits[0].created_on, null);
    const today = data.today,
      id = data.habits[0].habit_id;
    assert.equal(
      (await post("/api/habits/progress", { habit_id: id, date: today, completed: true })).status,
      200,
    );
    data = await (
      await get("/api/habits/history?habitId=" + id + "&start=" + today + "&end=" + today)
    ).json();
    assert.equal(data.records[0].completed_status, true);
    assert.deepEqual(data.versions, []);
    await post("/add-goal", { name: "Legacy goal", target: "100" });
    data = await (await get("/api/goals")).json();
    assert.equal(data.goals.length, 1);
    assert.equal(data.goals[0].archived, false);
    assert.equal(
      (await post("/api/goals/contribute", { goal_id: data.goals[0].goal_id, amount: "12.35" }))
        .status,
      200,
    );
    assert.equal((await post("/api/habits/save", habit())).status, 503);
  } finally {
    await new Promise((r) => server.close(r));
    await db.close();
  }
});
