// Explicit, disposable single-account fixtures. Never imported by server.js.
const { habitInput, money, nextPayment } = require("./workspaces");
const { validDate, validMonth } = require("./calendar-date");
const { parseCategory } = require("./expense-category");
function registerPreviewWorkspaces(
  app,
  { habits, expenses, goals, history, today, shift, presets, getBudget, setBudget },
) {
  const categories = [
      { category_id: 1, name: "Movement" },
      { category_id: 2, name: "Learning" },
      { category_id: 3, name: "Wellbeing" },
    ],
    versions = new Map(),
    budgetMonths = new Map(),
    budgetAdditions = [],
    recurring = [];
  let counter = 10000,
    trackingStarted = false;
  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };
  const day = (value) => {
    if (!validDate(value)) fail("Choose a valid calendar date.");
    return value;
  };
  const name = (value) => {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 255)
      fail("Enter a valid name.");
    return value.trim();
  };
  const byId = (items, key, id) => {
    const found = items.find((i) => String(i[key]) === String(id));
    if (!found) fail("Record not found.", 404);
    return found;
  };
  const route = (method, path, run) =>
    app[method](path, async (req, res) => {
      try {
        if (req.scenario === "failure") fail("Demo request failure.", 503);
        res.json(await run(req));
      } catch (e) {
        res.status(e.status || 400).json({ error: e.message });
      }
    });
  const due = (h) =>
    !h.archived_on && h.schedule_days.includes(new Date(today() + "T12:00Z").getUTCDay() || 7);
  const addVersion = (h) => {
    const list = versions.get(h.habit_id) || [];
    versions.set(h.habit_id, [
      ...list.filter((v) => v.effective_on !== today()),
      {
        effective_on: today(),
        schedule_days: [...h.schedule_days],
        target: h.target,
        unit: h.unit,
        archived: !!h.archived_on,
      },
    ]);
  };
  habits.forEach((h, i) => {
    Object.assign(h, {
      description: [
        "A little movement before the day begins.",
        "Make space for a few good pages.",
        "Keep a glass of water close by.",
      ][i],
      icon: ["walk", "book", "water"][i],
      color: ["lavender", "blue", "lime"][i],
      schedule_days: [1, 2, 3, 4, 5, 6, 7],
      created_on: shift(today(), -180),
      archived_on: null,
      target: i === 2 ? 8 : null,
      unit: i === 2 ? "glasses" : null,
      progress_amount: i === 2 ? 3 : null,
    });
    versions.set(h.habit_id, [
      {
        effective_on: h.created_on,
        schedule_days: [1, 2, 3, 4, 5, 6, 7],
        target: h.target,
        unit: h.unit,
        archived: false,
      },
    ]);
  });
  const budgetFor = (month) =>
    month === today().slice(0, 7) ? getBudget() : (budgetMonths.get(month) ?? null);
  recurring.push({
    recurring_id: 801,
    name: "Home internet",
    amount: 1200,
    category: "subscriptions",
    frequency: "monthly",
    starts_on: today().slice(0, 8) + "01",
    next_due: today().slice(0, 8) + "01",
    ends_on: null,
    enabled: true,
  });
  route("get", "/api/habits", async (req) => ({
    today: today(),
    recurrenceReady: false,
    habits: req.scenario === "empty" ? [] : habits.map((h) => ({ ...h, due_today: due(h) })),
    categories,
    presets,
    streak: await fetchStreak(req),
  }));
  async function fetchStreak(req) {
    if (["streakSetup", "empty"].includes(req.scenario) && !trackingStarted)
      return { status: "setup-required", count: null };
    const prior = trackingStarted ? 0 : 7,
      active = habits.filter(due);
    return {
      status: "available",
      count: prior + (active.length && active.every((h) => h.completed) ? 1 : 0),
    };
  }
  route("post", "/api/habits/streak/start", (req) => {
    if (req.body.confirm !== true) fail("Confirm forward tracking.");
    trackingStarted = true;
    return { success: true };
  });
  route("post", "/api/habits/save", (req) => {
    if(req.body.recurrence && !['daily','weekdays'].includes(req.body.recurrence.frequency))fail('Non-daily recurrence requires the authenticated app and reviewed storage; this preview contains daily fixtures only.',503);
    const h = habitInput(req.body);
    let record;
    if (req.body.habit_id) record = byId(habits, "habit_id", req.body.habit_id);
    else {
      record = {
        habit_id: ++counter,
        created_on: today(),
        archived_on: null,
        completed: false,
        progress_amount: null,
      };
      habits.push(record);
    }
    Object.assign(record, {
      habit_name: h.name,
      description: h.description,
      category: h.category,
      icon: h.icon,
      color: h.color,
      schedule_days: h.days,
      target: h.target,
      unit: h.unit,
    });
    if (h.target != null) record.completed = Number(record.progress_amount || 0) >= h.target;
    if (h.category && !categories.some((c) => c.name === h.category))
      categories.push({ category_id: ++counter, name: h.category });
    addVersion(record);
    return { success: true, habit_id: record.habit_id };
  });
  route("post", "/api/habits/archive", (req) => {
    const h = byId(habits, "habit_id", req.body.habit_id);
    h.archived_on = req.body.archived ? today() : null;
    addVersion(h);
    return { success: true };
  });
  route("post", "/api/habits/progress", (req) => {
    const h = byId(habits, "habit_id", req.body.habit_id);
    if (day(req.body.date) !== today() || !due(h))
      fail("Only scheduled progress for today can be changed.");
    if (h.target != null) {
      h.progress_amount = money(req.body.progress, true);
      h.completed = h.progress_amount >= h.target;
    } else {
      if (typeof req.body.completed !== "boolean") fail("Choose a completion state.");
      h.completed = req.body.completed;
    }
    return { success: true };
  });
  route("get", "/api/habits/history", (req) => {
    if (["historyFailure", "continuityFailure"].includes(req.scenario))
      fail("Demo history failure.", 503);
    const h = byId(habits, "habit_id", req.query.habitId),
      start = day(req.query.start),
      end = day(req.query.end),
      records = [];
    if (start > end || new Date(end + "T12:00Z") - new Date(start + "T12:00Z") > 366 * 86400000)
      fail("Choose at most a year.");
    if (req.scenario !== "emptyHistory") {
      for (const [date, entry] of history(req))
        if (
          date >= start &&
          date <= end &&
          entry.completions.some((c) => c.habit_id === h.habit_id)
        )
          records.push({ date, completed_status: true, progress_amount: h.target });
      if (today() >= start && today() <= end && !h.completed && h.progress_amount != null)
        records.push({
          date: today(),
          completed_status: false,
          progress_amount: h.progress_amount,
        });
    }
    return {
      habit: h,
      startDate: start,
      endDate: end,
      today: today(),
      records,
      versions: versions.get(h.habit_id) || [],
    };
  });
  route("post", "/delete-habit", (req) => {
    const h = byId(habits, "habit_id", req.body.habit_id);
    habits.splice(habits.indexOf(h), 1);
    versions.delete(h.habit_id);
    return { success: true };
  });
  route("post", "/api/presets/remove", (req) => {
    const matches = habits.filter((h) => h.habit_name === req.body.name);
    if (matches.length !== 1) fail("Manage matching habits individually.", 409);
    habits.splice(habits.indexOf(matches[0]), 1);
    return { success: true };
  });
  route("post", "/api/habit-categories", (req) => {
    const value = name(req.body.name);
    if (!categories.some((c) => c.name === value))
      categories.push({ category_id: ++counter, name: value });
    return { success: true };
  });
  route("post", "/api/habit-categories/delete", (req) => {
    const c = byId(categories, "category_id", req.body.category_id);
    habits.filter((h) => h.category === c.name).forEach((h) => (h.category = null));
    categories.splice(categories.indexOf(c), 1);
    return { success: true };
  });
  route("get", "/api/expenses", (req) => {
    if (!validMonth(req.query.month)) fail("Choose a valid month.");
    return {
      month: req.query.month,
      today: today(),
      budget: req.scenario === "empty" ? null : budgetFor(req.query.month),
      expenses:
        req.scenario === "empty"
          ? []
          : expenses
              .filter((e) => e.date.startsWith(req.query.month))
              .sort((a, b) => b.date.localeCompare(a.date)),
    };
  });
  route("post", "/api/budget", (req) => {
    if (!validMonth(req.body.month)) fail("Choose a valid month.");
    const value = money(req.body.amount, true);
    if (req.body.month === today().slice(0, 7)) setBudget(value);
    else budgetMonths.set(req.body.month, value);
    return { success: true };
  });
  route("get", "/api/budget/additions", req => {
    if(!validMonth(req.query.month)) fail("Choose a valid month.");
    return {month:req.query.month,additions:budgetAdditions.filter(a=>a.month===req.query.month).slice(-20).reverse()};
  });
  route("post", "/api/budget/additions", req => {
    const month=req.body.month, amount=money(req.body.amount), source=name(req.body.source), date=day(req.body.date), key=req.body.request_key;
    if(!validMonth(month) || date.slice(0,7)!==month) fail("Choose a date within the selected budget month.");
    if(date>today()) fail("Choose today or an earlier date.");
    if(typeof key!=='string' || !/^[a-zA-Z0-9-]{16,64}$/.test(key)) fail("Invalid save request. Reopen Add money and try again.");
    const existing=budgetAdditions.find(a=>a.request_key===key);
    if(existing){
      if(existing.month!==month || existing.amount!==amount || existing.source!==source || existing.date!==date) fail("This save request was already used for different details.",409);
      return {success:true};
    }
    const value=(Math.round(Number(budgetFor(month)||0)*100)+Math.round(amount*100))/100;
    if(value>99999999.99) fail("The resulting budget exceeds Tk 99,999,999.99.");
    if(month===today().slice(0,7)) setBudget(value);
    else budgetMonths.set(month,value);
    budgetAdditions.push({addition_id:++counter,month,amount,source,date,request_key:key});
    return {success:true};
  });
  route("post", "/api/expenses/save", (req) => {
    const description = name(req.body.name),
      amount = money(req.body.amount),
      date = day(req.body.date),
      category = parseCategory(req.body.category);
    if (!category) fail("Choose a category.");
    if (budgetFor(date.slice(0, 7)) === null)
      fail("Set a budget for the selected month first.", 409);
    let e;
    if (req.body.expense_id) e = byId(expenses, "expense_id", req.body.expense_id);
    else {
      e = { expense_id: ++counter };
      expenses.push(e);
    }
    Object.assign(e, { description, amount, date, category });
    return { success: true, expense_id: e.expense_id };
  });
  route("post", "/delete-expense", (req) => {
    const e = byId(expenses, "expense_id", req.body.expense_id);
    expenses.splice(expenses.indexOf(e), 1);
    return { success: true };
  });
  route("get", "/api/recurring", (req) => ({
    today: today(),
    definitions: req.scenario === "empty" ? [] : recurring,
  }));
  route("post", "/api/recurring/save", (req) => {
    const b = req.body,
      description = name(b.name),
      amount = money(b.amount),
      category = parseCategory(b.category),
      start = day(b.starts_on);
    if (!category || !["weekly", "monthly", "yearly"].includes(b.frequency))
      fail("Choose a category and frequency.");
    const end = b.ends_on ? day(b.ends_on) : null;
    if (end && end < start) fail("End must follow start.");
    let r;
    if (b.recurring_id) r = byId(recurring, "recurring_id", b.recurring_id);
    else {
      r = { recurring_id: ++counter, next_due: start };
      recurring.push(r);
    }
    Object.assign(r, {
      name: description,
      amount,
      category,
      starts_on: start,
      ends_on: end,
      frequency: b.frequency,
      enabled: b.enabled !== false,
    });
    return { success: true };
  });
  route("post", "/api/recurring/confirm", (req) => {
    const r = byId(recurring, "recurring_id", req.body.recurring_id),
      date = day(req.body.date);
    if (
      !r.enabled ||
      r.next_due !== req.body.scheduled_for ||
      date > today() ||
      (r.ends_on && r.next_due > r.ends_on)
    )
      fail("Payment disabled, outside its schedule, or already confirmed.", 409);
    if (budgetFor(date.slice(0, 7)) === null) fail("Set a budget for this month first.", 409);
    expenses.push({
      expense_id: ++counter,
      date,
      description: r.name,
      amount: r.amount,
      category: r.category,
      recurring_id: r.recurring_id,
      scheduled_for: r.next_due,
    });
    r.next_due = nextPayment(r.next_due, r.frequency, r.starts_on);
    if (r.ends_on && r.next_due > r.ends_on) r.enabled = false;
    return { success: true };
  });
  route("get", "/api/goals", (req) => {
    if (req.scenario === "savingsFailure") fail("Demo savings failure.", 503);
    return { goals: req.scenario === "empty" ? [] : goals };
  });
  route("post", "/api/goals/save", (req) => {
    const value = name(req.body.name),
      target = money(req.body.target),
      deadline = req.body.deadline ? day(req.body.deadline) : null;
    let g;
    if (req.body.goal_id) g = byId(goals, "goal_id", req.body.goal_id);
    else {
      g = { goal_id: ++counter, saved_amount: 0, archived: false };
      goals.push(g);
    }
    Object.assign(g, { name: value, target_amount: target, deadline });
    return { success: true };
  });
  route("post", "/api/goals/archive", (req) => {
    byId(goals, "goal_id", req.body.goal_id).archived = req.body.archived;
    return { success: true };
  });
  route("post", "/api/goals/contribute", (req) => {
    const g = byId(goals, "goal_id", req.body.goal_id);
    if (g.archived) fail("Goal is archived.", 409);
    g.saved_amount =
      (Math.round(Number(g.saved_amount) * 100) + Math.round(money(req.body.amount) * 100)) / 100;
    return { success: true };
  });
}
module.exports = { registerPreviewWorkspaces };
