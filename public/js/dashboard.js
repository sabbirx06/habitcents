import { categoryIcon } from "./expense-icons.js";
const decimal = new Intl.NumberFormat("en-BD", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const currency = { format: (value) => `Tk ${decimal.format(value)}` };
const LIST_LIMIT = 2;
// Bound list length by both row count and copy length. Full names remain readable.
function compactItems(items, key, characterLimit = 300, limit = LIST_LIMIT) {
  const visible = [];
  let characters = 0;
  for (const item of items.slice(0, limit)) {
    const length = String(item[key] || "").length;
    if (visible.length && characters + length > characterLimit) break;
    visible.push(item);
    characters += length;
  }
  return visible;
}
const $ = (selector) => document.querySelector(selector);
function text(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}
function money(selector, value, context = "") {
  const node = $(selector),
    parts = decimal.formatToParts(value);
  const prefix = document.createElement("span");
  prefix.className = "money-currency";
  prefix.textContent = "Tk ";
  const integer = document.createElement("span");
  integer.className = "money-integer";
  integer.textContent = parts
    .filter((p) => !["decimal", "fraction"].includes(p.type))
    .map((p) => p.value)
    .join("");
  const fraction = parts.find((p) => p.type === "fraction")?.value;
  const children = [prefix, integer];
  if (fraction && fraction !== "00") {
    const cents = document.createElement("span");
    cents.className = "money-decimals";
    cents.textContent = "." + fraction;
    children.push(cents);
  }
  if (context) {
    const label = document.createElement("span");
    label.className = "money-context";
    label.textContent = context;
    children.unshift(label);
  }
  node.replaceChildren(...children);
  node.dataset.size = Math.abs(value) >= 1000000 ? "long" : "normal";
  node.setAttribute("aria-label", context + currency.format(value));
}
function status(selector, message, success = false) {
  text(selector, message);
  if ($(selector)) $(selector).dataset.state = success ? "success" : "error";
}
function localDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(y, m - 1, d);
  date.setHours(12, 0, 0, 0);
  return date;
}
function isoDate(date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function getWeekDays(currentDate) {
  const today = localDate(currentDate);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return {
      iso: isoDate(day),
      date: day.getDate(),
      weekday: new Intl.DateTimeFormat("en", { weekday: "short" }).format(day),
      today: isoDate(day) === currentDate,
    };
  });
}
let readLocalDay = () => isoDate(new Date());
function validCalendarDate(value) {
  return (
    typeof value === "string" &&
    Number(value.slice(0, 4)) >= 1 &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    isoDate(localDate(value)) === value
  );
}
function initializeExpenseDate() {
  const input = $("#expense-date");
  if (input && !input.value) input.value = readLocalDay();
}
function renderWeek(currentDate) {
  $("#week-strip")?.replaceChildren(
    ...getWeekDays(view.week ?? currentDate).map((day) => {
      day.today = day.iso === currentDate;
      const item = document.createElement("li"),
        button = document.createElement("button"),
        label = document.createElement("span"),
        number = document.createElement("strong"),
        badge = document.createElement("span");
      item.className = "week-day" + (day.today ? " today" : "");
      button.type = "button";
      button.dataset.date = day.iso;
      label.textContent = day.weekday;
      number.textContent = day.date;
      badge.textContent = day.today ? "Today" : " ";
      badge.className = "today-badge";
      button.setAttribute(
        "aria-label",
        `${day.weekday}, ${day.iso}${day.today ? ", today" : ""}`,
      );
      if (day.today) {
        button.setAttribute("aria-current", "date");
      }
      button.setAttribute(
        "aria-pressed",
        String(
          (view.mode === "history" ? view.selected : readLocalDay()) ===
            day.iso,
        ),
      );
      button.append(label, number, badge);
      item.append(button);
      return item;
    }),
  );
}
async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15000),
  });
  if (response.redirected)
    throw new Error("Your session may have expired. Reload and sign in again.");
  return response;
}
async function read(url) {
  const response = await request(url);
  if (!response.ok) throw new Error(`${url} failed (HTTP ${response.status}).`);
  return response.json();
}
function setEmpty(list, message) {
  const item = document.createElement("li");
  item.className = "empty-state";
  item.textContent = message;
  list.replaceChildren(item);
}
async function loadOverview() {
  const token = view.generation;
  initializeExpenseDate();
  const data = await read("/dashboard-data");
  if (!isTodayResponse(token)) return;
  if (!data || typeof data !== "object")
    throw new Error("Invalid summary response. Try again.");
  for (const field of [
    "completed",
    "totalHabits",
    "totalBudget",
    "remaining",
  ]) {
    if (
      data[field] === null ||
      data[field] === undefined ||
      data[field] === "" ||
      !Number.isFinite(Number(data[field]))
    )
      throw new Error("Summary response has invalid " + field + ". Try again.");
  }
  if (data.hasBudget === undefined) {
    // Legacy summaries lack the existence flag. Verify against the existing record API:
    // a zero-valued budget is still a budget; amounts alone cannot establish existence.
    const record = await read("/get-budget");
    if (
      !record ||
      typeof record !== "object" ||
      record.total_budget === null ||
      record.total_budget === undefined ||
      record.total_budget === "" ||
      !Number.isFinite(Number(record.total_budget)) ||
      Number(record.total_budget) !== Number(data.totalBudget)
    )
      throw new Error(
        "Budget status could not be verified against the monthly budget record.",
      );
    if (record.budget_id !== undefined) {
      if (!/^[1-9]\d*$/.test(String(record.budget_id)))
        throw new Error("Invalid monthly budget record.");
      data.hasBudget = true;
    } else if (
      Object.keys(record).length === 1 &&
      Number(record.total_budget) === 0
    ) {
      data.hasBudget = false;
    } else
      throw new Error(
        "Monthly budget record does not establish budget status.",
      );
  }
  if (typeof data.hasBudget !== "boolean")
    throw new Error(
      "Summary response has invalid hasBudget; budget status is unavailable.",
    );
  if (!isTodayResponse(token)) return;
  text("#budget-status", "");
  for (const selector of [
    "#habit-progress",
    "#dashboard-budget",
    "#budget-spent",
  ])
    $(selector).dataset.state = "ready";
  const completed = Number(data.completed),
    total = Number(data.totalHabits),
    ratio = total ? Math.min(100, (completed / total) * 100) : 0;
  text("#habit-progress", `${completed}/${total}`);
  $("#habit-progress-bar").style.width = `${ratio}%`;
  $("#habit-progress-bar").parentElement.setAttribute(
    "aria-valuenow",
    Math.round(ratio),
  );
  $("#habit-progress-bar").parentElement.setAttribute(
    "aria-valuetext",
    `${completed} of ${total} habits completed`,
  );
  text(
    "#habit-progress-note",
    total
      ? `${total - completed} remaining`
      : "Add your first habit to start your routine.",
  );
  const budget = Number(data.totalBudget),
    remaining = Number(data.remaining),
    hasBudget = data.hasBudget;
  const remainingRatio =
    budget > 0 ? Math.max(0, Math.min(100, (remaining / budget) * 100)) : 0;
  if (hasBudget) money("#dashboard-budget", remaining);
  else text("#dashboard-budget", "Not set");
  money("#budget-spent", budget - remaining);
  if (hasBudget) money("#budget-total", budget, "of ");
  else text("#budget-total", "No monthly budget");
  text(
    "#budget-percentage",
    hasBudget ? `${Math.round(remainingRatio)}% available` : "Not set",
  );
  $("#budget-bar").style.width = `${remainingRatio}%`;
  $("#budget-bar").parentElement.setAttribute(
    "aria-valuenow",
    Math.round(remainingRatio),
  );
  $("#budget-bar").parentElement.setAttribute(
    "aria-valuetext",
    hasBudget
      ? `${currency.format(remaining)} remaining`
      : "No monthly budget set",
  );
  const warning = !hasBudget
    ? "Set a budget in Expenses before logging an expense."
    : remaining < 0
      ? `Over budget by ${currency.format(-remaining)}`
      : budget > 0 && remainingRatio <= 25
        ? "Your budget is running low."
        : "";
  text("#budget-warning", warning);
  $("#budget-warning").hidden = !warning;
}
async function loadTodayHabits() {
  const token = view.generation;
  const habits = await read("/get-habits"),
    list = $("#today-habits");
  if (!isTodayResponse(token)) return;
  const visibleHabits = compactItems(
    [...habits].sort(
      (a, b) => Number(Boolean(a.completed)) - Number(Boolean(b.completed)),
    ),
    "habit_name",
    300,
    5,
  );
  text(
    "#habits-more",
    habits.length > visibleHabits.length
      ? `${habits.length - visibleHabits.length} more ↗`
      : "↗",
  );
  text("#habits-count", `${habits.length} total`);
  if (!habits.length)
    return setEmpty(list, "No habits yet. Add one in Habits to get started.");
  list.replaceChildren(
    ...visibleHabits.map((habit) => {
      const item = document.createElement("li"),
        label = document.createElement("label"),
        checkbox = document.createElement("input"),
        name = document.createElement("span");
      item.className = `habit-row${habit.completed ? " is-complete" : ""}`;
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(habit.completed);
      checkbox.dataset.habitId = habit.habit_id;
      checkbox.setAttribute("aria-label", `Check in: ${habit.habit_name}`);
      name.className = "habit-name";
      name.textContent = habit.habit_name;
      label.className = "habit-row-content";
      label.append(checkbox, name);
      item.append(label);
      return item;
    }),
  );
}
let recentExpenseRows = null;
async function loadRecentExpenses() {
  const token = view.generation;
  recentExpenseRows = null;
  const expenses = await read("/get-expenses");
  if (!isTodayResponse(token)) return;
  recentExpenseRows = expenses;
  renderRecentExpenses(expenses);
}
function renderRecentExpenses(expenses) {
  const list = $("#recent-expenses");
  const desktop = typeof window !== "undefined" && window.innerWidth > 1100;
  const rowLimit = desktop
    ? Math.max(4, Math.min(12, Math.floor((window.innerHeight - 520) / 46)))
    : 8;
  const visibleExpenses = compactItems(expenses, "description", rowLimit * 90, rowLimit);
  text(
    "#expenses-more",
    expenses.length > visibleExpenses.length
      ? `${expenses.length - visibleExpenses.length} more ↗`
      : "↗",
  );
  if (!expenses.length)
    return setEmpty(
      list,
      "No expenses recorded yet. Your next entry will appear here.",
    );
  list.replaceChildren(
    ...visibleExpenses.map((expense) => {
      const item = document.createElement("li"),
        info = document.createElement("div"),
        description = document.createElement("span"),
        date = document.createElement("span"),
        amount = document.createElement("span");
      item.className = "expense-row";
      decorateExpense(item, expense, info);
      description.className = "expense-description";
      description.textContent = expense.description || "Expense";
      date.className = "expense-date";
      date.textContent = expense.date
        ? new Intl.DateTimeFormat("en", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }).format(localDate(expense.date))
        : "";
      amount.className = "expense-amount";
      amount.textContent = currency.format(Number(expense.amount) || 0);
      info.className = "recent-expense-info";
      description.title = expense.description || "Expense";
      info.append(description, date);
      appendExpenseCategory(info, expense);
      item.append(categoryIcon(expense.category), info, amount);
      return item;
    }),
  );
}
async function refreshDashboard() {
  const token = view.generation;
  const results = await Promise.allSettled([
    loadOverview(),
    loadTodayHabits(),
    loadRecentExpenses(),
    loadSpending(),
    loadContinuityOptions(),
    loadUniversalStreak(),
  ]);
  if (!isTodayResponse(token)) return;
  const failed = results.slice(0, 3).some((r) => r.status === "rejected");
  if (results[0].status === "rejected") {
    for (const selector of [
      "#habit-progress",
      "#dashboard-budget",
      "#budget-spent",
    ])
      $(selector).dataset.state = "unavailable";
    text("#habit-progress", "—");
    text("#dashboard-budget", "—");
    text("#budget-spent", "—");
    text("#budget-total", "");
    text("#budget-percentage", "—");
    text("#budget-status", "Budget summary unavailable. Try again.");
    text("#habit-progress-note", "Progress unavailable. Try again.");
  }
  if (results[0].status === "rejected") {
    for (const selector of ["#habit-progress-bar", "#budget-bar"]) {
      const bar = $(selector);
      bar.style.width = "0%";
      bar.parentElement.setAttribute("aria-valuetext", "Unavailable");
    }
    $("#budget-warning").hidden = true;
  }
  if (results[1].status === "rejected")
    setEmpty($("#today-habits"), "Could not load your habits. Try again.");
  if (results[2].status === "rejected")
    setEmpty(
      $("#recent-expenses"),
      "Could not load recent expenses. Try again.",
    );
  const summaryFailure =
    results[0].status === "rejected" ? results[0].reason.message : "";
  status(
    "#dashboard-status",
    failed ? `Some data could not be loaded. ${summaryFailure} Try again.` : "",
  );
  $("#retry-dashboard").hidden = !failed;
}
async function initializeDashboard({ now } = {}) {
  readLocalDay = () => isoDate(now ?? new Date());
  startHeader(now);
  bindDateBrowser();
  if (typeof window !== "undefined") {
    const syncSharedData = () => {
      if (view.browser) return;
      if (view.mode === "today") refreshDashboard();
      loadSavings();
    };
    window.addEventListener("storage", event => { if (event.key === "habitcents-data-updated") syncSharedData(); });
    window.addEventListener("pageshow", event => { if (event.persisted) syncSharedData(); });
  }
  $("#retry-dashboard")?.addEventListener("click", async () => {
    const button = $("#retry-dashboard");
    button.disabled = true;
    try {
      await refreshDashboard();
    } finally {
      button.disabled = false;
    }
  });
  $("#today-habits")?.addEventListener("change", async (event) => {
    const checkbox = event.target.closest("input[data-habit-id]");
    if (view.mode !== "today" || !checkbox || checkbox.disabled) return;
    checkbox.disabled = true;
    checkbox.dataset.pending = "true";
    status("#habit-status", "Saving check-in…");
    try {
      const response = await request("/toggle-habit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habit_id: checkbox.dataset.habitId }),
      });
      if (!response.ok) throw new Error("Could not save");
      checkbox
        .closest(".habit-row")
        .classList.toggle("is-complete", checkbox.checked);
      status(
        "#habit-status",
        checkbox.checked ? "Habit checked in." : "Check-in removed.",
        true,
      );
      try {
        await loadOverview();
        await loadContinuity();
        await loadUniversalStreak();
      } catch {
        status(
          "#dashboard-status",
          "Check-in saved. Summary could not refresh. Try again.",
        );
        $("#retry-dashboard").hidden = false;
      }
    } catch {
      checkbox.checked = !checkbox.checked;
      status(
        "#habit-status",
        "Could not save your check-in. Please try again.",
      );
    } finally {
      checkbox.dataset.pending = "false";
      checkbox.disabled = view.mode !== "today";
    }
  });
  let submitting = false;
  $(".expense-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting || view.mode !== "today") return;
    const name = $("#expense-name").value.trim(),
      amount = $("#expense-amount").value,
      date = $("#expense-date")?.value || readLocalDay();
    if (!name || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      status(
        "#expense-status",
        "Enter a description and an amount greater than zero.",
      );
      return;
    }
    if (!$(".expense-form").reportValidity()) return;
    if (!validCalendarDate(date)) {
      status("#expense-status", "Choose a valid expense date.");
      return;
    }
    submitting = true;
    $(".primary-action").disabled = true;
    status("#expense-status", "Saving expense…");
    try {
      const response = await request("/add-expense", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name,
          amount,
          date,
          category: $("#expense-category")?.value || "uncategorized",
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success)
        throw new Error(
          data.error || "Could not save your expense. Please try again.",
        );
      $(".expense-form").reset();
      $("#expense-date").value = readLocalDay();
      status("#expense-status", "Expense added.", true);
      await refreshDashboard();
    } catch (error) {
      status(
        "#expense-status",
        error.message === "Failed to fetch"
          ? "Could not save your expense. Check your connection and try again."
          : error.message,
      );
    } finally {
      submitting = false;
      $(".primary-action").disabled = false;
    }
  });
  await Promise.all([refreshDashboard(), loadSavings()]);
}

// One local-time lifecycle per document. Retry paths never create timers/listeners.
const instances = new WeakMap();
let view = {
  mode: "today",
  selected: null,
  month: null,
  browser: false,
  generation: 0,
  monthGeneration: 0,
  week: null,
};
let currentClock = null;
function isTodayResponse(token) {
  return view.mode === "today" && view.generation === token;
}
export function createLocalClock({
  now = () => new Date(),
  onTick,
  doc = document,
  win = typeof window === "undefined" ? null : window,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let timer = null,
    running = false;
  const refresh = () => {
    if (!running) return;
    if (timer !== null) cancel(timer);
    timer = null;
    const date = now();
    onTick(date);
    if (!doc.hidden) {
      timer = schedule(
        refresh,
        60000 - date.getSeconds() * 1000 - date.getMilliseconds(),
      );
      timer?.unref?.();
    }
  };
  const resume = () => refresh();
  return {
    start() {
      if (running) return;
      running = true;
      doc.addEventListener("visibilitychange", resume);
      win?.addEventListener("pageshow", resume);
      refresh();
    },
    stop() {
      running = false;
      if (timer !== null) cancel(timer);
      timer = null;
      doc.removeEventListener("visibilitychange", resume);
      win?.removeEventListener("pageshow", resume);
    },
    refresh,
  };
}
export function getMonthDays(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1)
    throw new Error("Invalid month");
  const first = localDate(month + "-01"),
    days = [];
  for (
    let d = new Date(first);
    d.getMonth() === first.getMonth() &&
    d.getFullYear() === first.getFullYear();
    d.setDate(d.getDate() + 1)
  )
    days.push({
      iso: isoDate(d),
      date: d.getDate(),
      weekday: new Intl.DateTimeFormat("en", { weekday: "long" }).format(d),
    });
  return days;
}
export function shiftMonth(month, offset) {
  const d = localDate(month + "-01");
  d.setMonth(d.getMonth() + offset);
  return d.getFullYear() < 1 || d.getFullYear() > 9999
    ? month
    : isoDate(d).slice(0, 7);
}
function startHeader(fixedNow) {
  let priorDay = null;
  const now = () =>
    typeof fixedNow === "function" ? fixedNow() : (fixedNow ?? new Date());
  readLocalDay = () => isoDate(now());
  const tick = (date) => {
    const day = isoDate(date);
    initializeExpenseDate();
    text(
      "#live-clock",
      new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(date),
    );
    $("#live-clock")?.setAttribute(
      "datetime",
      `${day}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
    );
    text("#header-day", String(date.getDate()).padStart(2, "0"));
    text(
      "#header-weekday",
      new Intl.DateTimeFormat("en", { weekday: "short" })
        .format(date)
        .toUpperCase(),
    );
    text(
      "#header-month",
      new Intl.DateTimeFormat("en", { month: "short" })
        .format(date)
        .toUpperCase(),
    );
    $("#browse-dates").setAttribute(
      "aria-label",
      "Browse dates, " +
        new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(date),
    );
    if (day !== priorDay) {
      if (
        priorDay &&
        view.mode === "today" &&
        getWeekDays(view.week ?? priorDay).some((d) => d.iso === priorDay)
      )
        view.week = null;
      renderWeek(day);
      if (priorDay) {
        if (view.mode === "today") refreshDashboard();
        if (view.browser) renderDateRange();
      }
    }
    priorDay = day;
  };
  currentClock?.stop();
  tick(now());
  if (document.addEventListener) {
    currentClock = createLocalClock({ now, onTick: tick });
    currentClock.start();
  }
}
export function initDashboard(options = {}) {
  const existing = instances.get(document);
  if (existing) return existing.ready;
  view = {
    mode: "today",
    selected: null,
    month: null,
    browser: false,
    generation: 0,
    monthGeneration: 0,
  };
  resetDashboardModules();
  const instance = { ready: null };
  instances.set(document, instance);
  instance.ready = initializeDashboard(options);
  return instance.ready;
}
function cents(value) {
  const raw = String(value);
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw))
    throw new Error("Invalid savings amount");
  const negative = raw.startsWith("-"),
    [whole, fraction = ""] = raw.replace("-", "").split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new Error("Invalid savings amount");
  return negative ? -amount : amount;
}
function centsString(amount) {
  return `${amount < 0 ? "-" : ""}${Math.floor(Math.abs(amount) / 100)}.${String(Math.abs(amount) % 100).padStart(2, "0")}`;
}
export function summarizeSavings(goals) {
  if (!Array.isArray(goals)) throw new Error("Invalid savings data");
  let total = 0;
  const normalized = goals.map((goal) => {
    const saved = cents(goal.saved_amount),
      target = cents(goal.target_amount);
    total += saved;
    if (!Number.isSafeInteger(total)) throw new Error("Invalid savings total");
    return {
      ...goal,
      saved,
      target,
      progress:
        target > 0 ? Math.max(0, Math.min(100, (saved / target) * 100)) : null,
    };
  });
  const unfinished = normalized.filter((g) => g.saved < g.target);
  return {
    goals: normalized,
    total: centsString(total),
    count: normalized.length,
    belowTarget: unfinished.length,
    goal: unfinished[0] ?? normalized[0] ?? null,
  };
}
let savingsGoals = [];
function renderSavingsGoal(index) {
  const goal = savingsGoals[index];
  if (!goal) return;
  const progress = goal.progress,
    available = Number.isFinite(progress);
  [...$("#savings-selector").children].forEach((dot, dotIndex) => {
    dot.setAttribute("aria-pressed", String(dotIndex === index));
  });
  text("#savings-goal-name", goal.name);
  $("#savings-goal-name").title = goal.name;
  text("#savings-percentage", available ? Math.round(progress) + "%" : "—");
  $("#savings-arc").style.strokeDasharray = available
    ? progress + " 100"
    : "0 100";
  $("#savings-arc").style.opacity = available && progress > 0 ? "1" : "0";
  const ring = $("#savings-progress");
  if (available)
    ring.setAttribute("aria-valuenow", String(Math.round(progress)));
  else ring.removeAttribute("aria-valuenow");
  ring.setAttribute(
    "aria-valuetext",
    available
      ? Math.round(progress) + "% of target"
      : "Progress unavailable: target must be positive",
  );
  ring.setAttribute("aria-label", goal.name + " — current savings progress");
  $("#savings-link").setAttribute(
    "aria-label",
    "View " +
      goal.name +
      " in Savings — current progress " +
      (available ? Math.round(progress) + "%" : "unavailable"),
  );
  status("#savings-status", available ? "" : "Progress unavailable.");
}
async function loadSavings() {
  const retry = $("#retry-savings");
  if (retry) retry.disabled = true;
  $("#savings-goal").hidden = true;
  $("#savings-empty-link").hidden = true;
  status("#savings-status", "Loading savings…");
  try {
    const summary = summarizeSavings(await read("/savings-data"));
    savingsGoals = summary.goals;
    const selector = $("#savings-selector");
    selector.replaceChildren();
    savingsGoals.forEach((goal, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "savings-dot";
      dot.setAttribute("aria-label", "Show " + goal.name);
      dot.setAttribute("aria-pressed", "false");
      dot.title = goal.name;
      dot.addEventListener("click", () => renderSavingsGoal(index));
      dot.addEventListener("keydown", event => {
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % savingsGoals.length;
        if (event.key === "ArrowLeft") next = (index + savingsGoals.length - 1) % savingsGoals.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = savingsGoals.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        selector.children[next].focus();
        renderSavingsGoal(next);
      });
      selector.append(dot);
    });
    selector.hidden = savingsGoals.length < 2;
    const selected = Math.max(0, savingsGoals.indexOf(summary.goal));
    $("#savings-goal").hidden = !summary.goal;
    if (summary.goal) renderSavingsGoal(selected);
    else status("#savings-status", "No savings goals yet.", true);
    $("#savings-empty-link").hidden = !!summary.goal;
    retry.hidden = true;
  } catch {
    savingsGoals = [];
    $("#savings-goal").hidden = true;
    status("#savings-status", "Savings unavailable.");
    retry.hidden = false;
    $("#savings-empty-link").hidden = false;
  } finally {
    if (retry) retry.disabled = false;
  }
}
function updateMode() {
  const history = view.mode === "history";
  $("#dashboard-grid").hidden = history;
  $("#history-view").hidden = !history;
  for (const node of document.querySelectorAll?.("[data-today-only]") ?? [])
    node.hidden = history;
  $("#dashboard-workspace").dataset.mode = view.mode;
  $("#dashboard-workspace").hidden = false;
  $("#history-context").hidden = !history;
  $("#browse-dates").setAttribute("aria-expanded", String(view.browser));
  for (const node of document.querySelectorAll?.(
    "#today-habits input,.expense-form input,.expense-form select,.expense-form button",
  ) ?? [])
    node.disabled = history || node.dataset.pending === "true";
  if (history)
    text(
      "#selected-date-label",
      new Intl.DateTimeFormat("en", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(localDate(view.selected)),
    );
  renderWeek(readLocalDay());
}
async function selectDate(date) {
  if (!validCalendarDate(date)) return;
  if (view.browser) closeDateBrowser();
  view.generation++;
  view.selected = date;
  view.week = date;
  view.mode = date === readLocalDay() ? "today" : "history";
  view.monthGeneration++;
  updateMode();
  status("#dashboard-status", "");
  $("#retry-dashboard").hidden = true;
  if (view.mode === "today") {
    await refreshDashboard();
  } else {
    text("#history-spent", "—");
    await Promise.all([
      loadHistory("habits"),
      loadHistory("expenses"),
      loadSpending(),
      loadContinuityOptions(),
      loadUniversalStreak(),
    ]);
  }
}
async function loadHistory(section) {
  const date = view.selected,
    token = view.generation,
    list = $(section === "habits" ? "#history-habits" : "#history-expenses"),
    retry = $("#retry-history-" + section);
  retry.disabled = true;
  retry.hidden = true;
  status(
    "#history-" + section + "-status",
    "Loading recorded " +
      (section === "habits" ? "completions" : "expenses") +
      "…",
  );
  list.replaceChildren();
  if (section === "expenses") text("#history-spent", "—");
  try {
    const data = await read(
      `/dashboard-history?date=${date}&section=${section}`,
    );
    if (token !== view.generation || view.mode !== "history") return;
    if (data.date !== date) throw new Error("Date mismatch");
    const items = section === "habits" ? data.completions : data.expenses;
    if (!Array.isArray(items)) throw new Error("Invalid history");
    if (section === "expenses") {
      if (
        data.spent === null ||
        data.spent === undefined ||
        data.spent === "" ||
        !Number.isFinite(Number(data.spent))
      )
        throw new Error("Invalid recorded spending");
      money("#history-spent", Number(data.spent));
    }
    if (!items.length)
      setEmpty(
        list,
        section === "habits"
          ? "No completions recorded."
          : "No expenses recorded.",
      );
    else
      list.replaceChildren(
        ...items.map((item) => {
          const li = document.createElement("li");
          if (section === "habits") {
            li.textContent = item.habit_name;
            li.className = "recorded-habit";
          } else {
            li.className = "expense-row";
            const description = document.createElement("div"),
              name = document.createElement("span"),
              when = document.createElement("span"),
              amount = document.createElement("span");
            name.className = "expense-description";
            name.textContent = item.description || "Expense";
            when.className = "expense-date";
            when.textContent = date;
            amount.className = "expense-amount";
            amount.textContent = currency.format(Number(item.amount));
            description.append(name, when);
            decorateExpense(li, item, description);
            appendExpenseCategory(description, item);
            li.append(description, amount);
          }
          return li;
        }),
      );
    status("#history-" + section + "-status", "");
  } catch {
    if (token !== view.generation || view.mode !== "history") return;
    list.replaceChildren();
    status(
      "#history-" + section + "-status",
      section === "habits"
        ? "Recorded completions could not be loaded."
        : "Recorded expenses could not be loaded.",
    );
    retry.hidden = false;
  } finally {
    if (token === view.generation) retry.disabled = false;
  }
}
export function shiftDate(date, days) {
  const value = localDate(date);
  value.setDate(value.getDate() + days);
  return value.getFullYear() < 1
    ? "0001-01-01"
    : value.getFullYear() > 9999
      ? "9999-12-31"
      : isoDate(value);
}
export function dateRange(center, before = 45, after = 45) {
  const dates = [],
    end = shiftDate(center, after);
  let day = shiftDate(center, -before);
  while (day <= end && dates.length < 151) {
    dates.push(day);
    const next = shiftDate(day, 1);
    if (next === day) break;
    day = next;
  }
  return dates;
}
let pickerDates = [],
  markerRecords = new Map(),
  markerMonths = new Map(),
  closeTimer = null,
  scrollLock = null,
  extending = false;
function rowFor(date) {
  return document.querySelector('#date-rows button[data-date="' + date + '"]');
}
function setPickerMonth(date) {
  view.month = date.slice(0, 7);
  text(
    "#browser-month",
    new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(
      localDate(date),
    ),
  );
  $("#previous-month").disabled = view.month === "0001-01";
  $("#next-month").disabled = view.month === "9999-12";
}
function paintMarkers() {
  for (const button of document.querySelectorAll?.("#date-rows button") ?? []) {
    button.querySelector(".activity-dots")?.remove();
    const record = markerRecords.get(button.dataset.date);
    if (!record || !(record.completions > 0 || record.expenses > 0)) continue;
    const dots = document.createElement("span");
    dots.className = "activity-dots";
    dots.setAttribute(
      "aria-label",
      record.completions +
        " completions, " +
        record.expenses +
        " expenses recorded",
    );
    for (const [count, kind] of [
      [record.completions, "habit"],
      [record.expenses, "expense"],
    ])
      if (count > 0) {
        const dot = document.createElement("i");
        dot.className = "activity-dot " + kind + "-dot";
        dots.append(dot);
      }
    button.firstElementChild.append(dots);
  }
}
function renderDateRange() {
  const selected = view.mode === "history" ? view.selected : readLocalDay();
  const focused =
    document.activeElement?.closest?.("#date-rows button")?.dataset.date;
  const tabDate = pickerDates.includes(focused)
    ? focused
    : pickerDates.includes(selected)
      ? selected
      : pickerDates[Math.floor(pickerDates.length / 2)];
  $("#date-rows").replaceChildren(
    ...pickerDates.map((date) => {
      const li = document.createElement("li"),
        button = document.createElement("button"),
        name = document.createElement("span"),
        number = document.createElement("strong");
      button.type = "button";
      button.dataset.date = date;
      button.tabIndex = date === tabDate ? 0 : -1;
      button.setAttribute("aria-pressed", String(date === selected));
      if (date === readLocalDay()) button.setAttribute("aria-current", "date");
      const day = localDate(date);
      name.textContent =
        new Intl.DateTimeFormat("en", { weekday: "long" }).format(day) +
        (date === readLocalDay() ? " · Today" : "");
      button.setAttribute(
        "aria-label",
        new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(day) +
          (date === readLocalDay() ? ", Today" : ""),
      );
      number.textContent = day.getDate();
      button.append(name, number);
      li.append(button);
      return li;
    }),
  );
  paintMarkers();
  if (focused) rowFor(tabDate)?.focus?.({ preventScroll: true });
}
async function loadRangeMarkers() {
  const token = view.monthGeneration,
    months = [...new Set(pickerDates.map((day) => day.slice(0, 7)))];
  const missing = months.filter((month) => !markerMonths.has(month));
  missing.forEach((month) => markerMonths.set(month, "loading"));
  await Promise.all(
    missing.map(async (month) => {
      try {
        const data = await read("/dashboard-activity?month=" + month);
        if (token !== view.monthGeneration || !view.browser) return;
        if (data.month !== month || !Array.isArray(data.days))
          throw new Error("Invalid activity");
        for (const record of data.days)
          if (
            validCalendarDate(record.date) &&
            record.date.startsWith(month) &&
            Number.isInteger(record.completions) &&
            Number.isInteger(record.expenses) &&
            record.completions >= 0 &&
            record.expenses >= 0
          )
            markerRecords.set(record.date, record);
        markerMonths.set(month, "loaded");
      } catch {
        if (token === view.monthGeneration && view.browser)
          markerMonths.set(month, "failed");
      }
    }),
  );
  if (token !== view.monthGeneration || !view.browser) return;
  paintMarkers();
  const failed = [...markerMonths.values()].includes("failed");
  status("#month-status", failed ? "Activity markers unavailable." : "");
  $("#retry-month").hidden = !failed;
}
function dateScrollBehavior(smooth = true) {
  return smooth &&
    !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "smooth"
    : "instant";
}
let pickerScrollTarget = null;
function centerPicker(date, focus = true, smooth = false) {
  const rebuild = !smooth || !pickerDates.includes(date);
  let anchor = null,
    offset = 0;
  const list = $("#date-rows");
  if (smooth && rebuild) {
    anchor = [...(list.querySelectorAll?.("button") ?? [])].find(
      (row) =>
        row.getBoundingClientRect().bottom >= list.getBoundingClientRect().top,
    )?.dataset.date;
    if (anchor)
      offset =
        rowFor(anchor).getBoundingClientRect().top -
        list.getBoundingClientRect().top;
  }
  if (rebuild) {
    pickerDates = dateRange(date);
    renderDateRange();
    if (anchor && pickerDates.includes(anchor))
      list.scrollTop +=
        rowFor(anchor).getBoundingClientRect().top -
        list.getBoundingClientRect().top -
        offset;
    else smooth = false;
  }
  setPickerMonth(date);
  const row = rowFor(date);
  if (row) {
    for (const item of document.querySelectorAll?.("#date-rows button") ?? [])
      item.tabIndex = -1;
    row.tabIndex = 0;
    row.focus?.({ preventScroll: true });
    const r = row.getBoundingClientRect(),
      l = list.getBoundingClientRect(),
      top = list.scrollTop + (r.top + r.bottom - (l.top + l.bottom)) / 2;
    pickerScrollTarget = smooth ? date : null;
    if (list.scrollTo)
      list.scrollTo({ top, behavior: dateScrollBehavior(smooth) });
    else list.scrollTop = top;
    if (!focus) $("#picker-today").focus?.({ preventScroll: true });
  }
  loadRangeMarkers();
}
function syncDateBrowserWidth() {
  const bounds = $(".dashboard-shell")?.getBoundingClientRect?.();
  if (bounds) {
    $("#date-browser").style.width = bounds.width + "px";
    $("#date-browser").style.marginLeft = bounds.left + "px";
  }
}
function openDateBrowser() {
  if (view.browser) return;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
    finishDateBrowser();
  }
  view.browser = true;
  view.monthGeneration++;
  markerRecords = new Map();
  markerMonths = new Map();
  const dialog = $("#date-browser");
  dialog.hidden = false;
  dialog.classList.remove?.("closing");
  if (document.body) {
    scrollLock = {
      overflow: document.body.style.overflow,
      paddingRight: document.body.style.paddingRight,
    };
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = gap + "px";
  }
  syncDateBrowserWidth();
  dialog.showModal?.();
  $("#browse-dates").setAttribute("aria-expanded", "true");
  centerPicker(view.mode === "history" ? view.selected : readLocalDay());
}
function finishDateBrowser() {
  const dialog = $("#date-browser");
  dialog.close?.();
  dialog.hidden = true;
  dialog.classList.remove?.("closing");
  if (scrollLock && document.body) {
    document.body.style.overflow = scrollLock.overflow;
    document.body.style.paddingRight = scrollLock.paddingRight;
  }
  scrollLock = null;
  closeTimer = null;
  $("#browse-dates")?.focus?.({ preventScroll: true });
}
function closeDateBrowser() {
  if (!view.browser) return;
  view.browser = false;
  view.monthGeneration++;
  $("#browse-dates").setAttribute("aria-expanded", "false");
  const dialog = $("#date-browser");
  dialog.classList.add?.("closing");
  if (
    !dialog.open ||
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  )
    finishDateBrowser();
  else closeTimer = setTimeout(finishDateBrowser, 200);
}
function extendPicker() {
  if (!view.browser || extending) return;
  const list = $("#date-rows");
  const direction =
    list.scrollTop < 150
      ? -1
      : list.scrollHeight - list.clientHeight - list.scrollTop < 150
        ? 1
        : 0;
  const rows = [...(list.querySelectorAll?.("button") ?? [])];
  const middle = rows.find(
    (row) =>
      row.getBoundingClientRect().top + row.offsetHeight / 2 >=
      list.getBoundingClientRect().top + list.clientHeight / 2,
  );
  if (pickerScrollTarget) {
    const target = rowFor(pickerScrollTarget),
      r = target?.getBoundingClientRect(),
      l = list.getBoundingClientRect();
    if (!r || Math.abs((r.top + r.bottom - l.top - l.bottom) / 2) < 2)
      pickerScrollTarget = null;
  }
  if (middle && !pickerScrollTarget) setPickerMonth(middle.dataset.date);
  if (!direction) return;
  extending = true;
  const anchor =
      rows.find(
        (row) =>
          row.getBoundingClientRect().top >= list.getBoundingClientRect().top,
      ) ?? rows[0],
    date = anchor?.dataset.date,
    offset = anchor
      ? anchor.getBoundingClientRect().top - list.getBoundingClientRect().top
      : 0;
  const start =
      direction < 0
        ? shiftDate(pickerDates[0], -30)
        : shiftDate(pickerDates.at(-1), 1),
    extra = dateRange(start, 0, 29);
  pickerDates = [
    ...new Set(
      direction < 0 ? [...extra, ...pickerDates] : [...pickerDates, ...extra],
    ),
  ];
  if (pickerDates.length > 151)
    pickerDates =
      direction < 0 ? pickerDates.slice(0, 151) : pickerDates.slice(-151);
  renderDateRange();
  const replacement = date && rowFor(date);
  if (replacement)
    list.scrollTop +=
      replacement.getBoundingClientRect().top -
      list.getBoundingClientRect().top -
      offset;
  loadRangeMarkers();
  extending = false;
}
function bindDateBrowser() {
  if (typeof window !== "undefined")
    window.addEventListener("resize", () => {
      if (view.browser) syncDateBrowserWidth();
      if (recentExpenseRows && view.mode !== "history") renderRecentExpenses(recentExpenseRows);
      if (!$("#spending-chart")?.hidden) updateSpendingScale();
    });
  $("#week-strip")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-date]");
    return button ? selectDate(button.dataset.date) : undefined;
  });
  $("#previous-week")?.addEventListener("click", () => {
    view.week = shiftDate(view.week ?? readLocalDay(), -7);
    renderWeek(readLocalDay());
  });
  $("#next-week")?.addEventListener("click", () => {
    view.week = shiftDate(view.week ?? readLocalDay(), 7);
    renderWeek(readLocalDay());
  });
  $("#week-today")?.addEventListener("click", () => selectDate(readLocalDay()));
  $("#date-rows")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-date]");
    if (button) selectDate(button.dataset.date);
  });
  $("#date-rows")?.addEventListener("scroll", extendPicker, { passive: true });
  for (const event of ["wheel", "touchstart", "pointerdown"])
    $("#date-rows")?.addEventListener(
      event,
      () => {
        pickerScrollTarget = null;
      },
      { passive: true },
    );
  $("#date-rows")?.addEventListener("keydown", (event) => {
    const button = event.target.closest("button[data-date]");
    if (!button) return;
    let date = button.dataset.date;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectDate(date);
      return;
    }
    const offsets = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 };
    if (event.key in offsets) date = shiftDate(date, offsets[event.key]);
    else if (event.key === "PageUp" || event.key === "PageDown") {
      const month = shiftMonth(
        date.slice(0, 7),
        event.key === "PageUp" ? -1 : 1,
      );
      date =
        month +
        "-" +
        String(
          Math.min(Number(date.slice(8)), getMonthDays(month).length),
        ).padStart(2, "0");
    } else if (event.key === "Home") date = date.slice(0, 7) + "-01";
    else if (event.key === "End")
      date = getMonthDays(date.slice(0, 7)).at(-1).iso;
    else return;
    event.preventDefault();
    if (!pickerDates.includes(date)) centerPicker(date, true, true);
    for (const row of document.querySelectorAll?.("#date-rows button") ?? [])
      row.tabIndex = -1;
    const row = rowFor(date);
    if (row) {
      row.tabIndex = 0;
      row.focus?.({ preventScroll: true });
      row.scrollIntoView?.({
        block: "nearest",
        behavior: dateScrollBehavior(),
      });
    }
  });
  $("#browse-dates")?.addEventListener("click", openDateBrowser);
  $("#close-date-browser")?.addEventListener("click", closeDateBrowser);
  $("#date-browser")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDateBrowser();
  });
  $("#date-browser")?.addEventListener("click", (event) => {
    if (event.target === $("#date-browser")) {
      const r = event.target.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        closeDateBrowser();
    }
  });
  for (const [id, offset] of [
    ["#previous-month", -1],
    ["#next-month", 1],
  ])
    $(id)?.addEventListener("click", () =>
      centerPicker(shiftMonth(view.month, offset) + "-01", true, true),
    );
  $("#picker-today")?.addEventListener("click", () =>
    centerPicker(readLocalDay(), true, true),
  );
  $("#back-to-today")?.addEventListener("click", () =>
    selectDate(readLocalDay()),
  );
  $("#retry-month")?.addEventListener("click", () => {
    for (const [month, state] of markerMonths)
      if (state === "failed") markerMonths.delete(month);
    loadRangeMarkers();
  });
  for (const index of [0, 1]) {
    continuityNode("#continuity-habit", index)?.addEventListener(
      "change",
      (event) => {
        const card = continuityCards[index];
        card.selected = String(event.target.value) || null;
        const habit = continuityHabits.find(
          (h) => String(h.habit_id) === card.selected,
        );
        card.name = habit?.habit_name || null;
        card.createdDate = validCalendarDate(habit?.createdDate)
          ? habit.createdDate
          : null;
        return loadContinuity(index);
      },
    );
    continuityNode("#continuity-inspect", index)?.addEventListener(
      "change",
      (event) =>
        text(
          "#continuity-note" + (index ? "-2" : ""),
          event.target.selectedOptions?.[0]?.textContent || "",
        ),
    );
    continuityNode("#continuity-open", index)?.addEventListener("click", () => {
      const date = continuityNode("#continuity-inspect", index).value;
      if (validCalendarDate(date)) return selectDate(date);
    });
    continuityNode("#retry-continuity", index)?.addEventListener("click", () =>
      continuityCards[index].selected
        ? loadContinuity(index)
        : loadContinuityOptions(),
    );
    continuityNode("#continuity-grid", index)?.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest("button[data-date]");
        if (button && !button.disabled) return selectDate(button.dataset.date);
      },
    );
    continuityNode("#continuity-grid", index)?.addEventListener(
      "focusin",
      (event) => {
        const button = event.target.closest("button[data-date]");
        if (button)
          text(
            "#continuity-detail" + (index ? "-2" : ""),
            button.getAttribute?.("aria-label") || "",
          );
      },
    );
    continuityNode("#continuity-grid", index)?.addEventListener(
      "keydown",
      (event) => {
        const offsets = {
          ArrowUp: -1,
          ArrowDown: 1,
          ArrowLeft: -7,
          ArrowRight: 7,
        };
        if (!(event.key in offsets)) return;
        event.preventDefault();
        const cells = [
            ...continuityNode("#continuity-grid", index).querySelectorAll(
              "button",
            ),
          ],
          position = cells.indexOf(event.target),
          next = cells[position + offsets[event.key]];
        if (next && !next.disabled) {
          for (const cell of cells) cell.tabIndex = -1;
          next.tabIndex = 0;
          next.focus();
        }
      },
    );
  }
  $("#retry-streak")?.addEventListener("click", () => loadUniversalStreak());
  $("#retry-spending")?.addEventListener("click", () => loadSpending());
  $("#spending-inspect")?.addEventListener("change", (event) => {
    for (const bar of document.querySelectorAll?.("#spending-bars button") ??
      []) {
      bar.setAttribute(
        "aria-pressed",
        String(bar.dataset.date === event.target.value),
      );
      if (bar.dataset.date === event.target.value) inspectSpendingBar(bar);
    }
  });
  $("#spending-bars")?.addEventListener("focusin", (event) =>
    inspectSpendingBar(event.target),
  );
  $("#spending-bars")?.addEventListener("click", (event) => {
    const bar = event.target.closest("button[data-date]");
    if (bar) inspectSpendingBar(bar);
  });
  $("#spending-bars")?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const bars = [...$("#spending-bars").querySelectorAll("button")],
      index = bars.indexOf(event.target),
      next =
        bars[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? bars.length - 1
              : index + (event.key === "ArrowLeft" ? -1 : 1)
        ];
    if (next) {
      for (const bar of bars) bar.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    }
  });
  $("#retry-savings")?.addEventListener("click", () => loadSavings());
  for (const section of ["habits", "expenses"])
    $("#retry-history-" + section)?.addEventListener("click", () =>
      loadHistory(section),
    );
  document.addEventListener?.("keydown", (event) => {
    if (!view.browser) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDateBrowser();
    }
    if (event.key === "Tab") {
      const nodes = [
        ...$("#date-browser").querySelectorAll(
          'button:not([disabled]),select,[href],[tabindex="0"]',
        ),
      ].filter(
        (node) =>
          !node.hidden && node.tabIndex >= 0 && node.getClientRects().length,
      );
      const first = nodes[0],
        last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
}

// The same explicit categories drive both expense rows and the spending legend.
export const EXPENSE_CATEGORIES = {
  transport: "Transport",
  food: "Food",
  subscriptions: "Subscriptions",
  shopping: "Shopping",
  uncategorized: "Uncategorized",
};
function expenseCategory(value) {
  return Object.hasOwn(EXPENSE_CATEGORIES, value) ? value : "uncategorized";
}
function decorateExpense(row, expense) {
  row.dataset.category = expenseCategory(expense.category);
}
function appendExpenseCategory(info, expense) {
  const category = document.createElement("span");
  category.className = "expense-category";
  category.textContent = EXPENSE_CATEGORIES[expenseCategory(expense.category)];
  info.append(category);
}
function localRangeLabel(start, end) {
  const format = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return start === end
    ? format.format(localDate(start))
    : format.format(localDate(start)) + " – " + format.format(localDate(end));
}
export function validateBreakdown(data) {
  if (
    !data ||
    !data.range ||
    !validCalendarDate(data.range.startDate) ||
    !validCalendarDate(data.range.endDate) ||
    data.range.startDate > data.range.endDate ||
    !["month", "day"].includes(data.range.kind) ||
    !Array.isArray(data.categories)
  )
    throw new Error("Invalid spending range");
  const totalCents = cents(data.total);
  if (totalCents < 0) throw new Error("Invalid spending total");
  const seen = new Set();
  const categories = data.categories.map((category) => {
    if (
      !Object.hasOwn(EXPENSE_CATEGORIES, category.category) ||
      seen.has(category.category)
    )
      throw new Error("Invalid expense category");
    seen.add(category.category);
    const amount = cents(category.amount);
    if (amount < 0) throw new Error("Invalid category amount");
    return { ...category, cents: amount };
  });
  if (
    categories.reduce((sum, category) => sum + category.cents, 0) !== totalCents
  )
    throw new Error("Spending total does not reconcile");
  return { ...data, totalCents, categories };
}
export function buildContinuityCells(data, historical = false) {
  if (
    !data ||
    !validCalendarDate(data.startDate) ||
    !validCalendarDate(data.endDate) ||
    !validCalendarDate(data.currentDate) ||
    data.startDate > data.endDate ||
    !Array.isArray(data.completedDates)
  )
    throw new Error("Invalid continuity dates");
  const created = data.habit?.createdDate;
  if (created !== null && created !== undefined && !validCalendarDate(created))
    throw new Error("Invalid creation date");
  const recorded = new Set(data.completedDates);
  for (const date of recorded)
    if (
      !validCalendarDate(date) ||
      date < data.startDate ||
      date > data.endDate ||
      date > data.currentDate ||
      (created && date < created)
    )
      throw new Error("Invalid completion date");
  const first = localDate(data.startDate),
    last = localDate(data.endDate),
    end = shiftDate(data.endDate, 6 - ((last.getDay() + 6) % 7)),
    cells = [];
  if ((first.getDay() + 6) % 7 !== 0)
    throw new Error("Continuity range must start on Monday");
  for (let date = data.startDate; date <= end; date = shiftDate(date, 1)) {
    if (cells.length >= 182) throw new Error("Continuity range is too large");
    const outside = date > data.endDate && historical;
    const state = outside
      ? "outside-range"
      : date > data.currentDate
        ? "future"
        : created && date < created
          ? "before-creation"
          : recorded.has(date)
            ? "completed"
            : "unrecorded";
    cells.push({ date: outside ? null : date, state });
    if (date === "9999-12-31") break;
  }
  return cells;
}
let streakRequest = 0,
  spendingRequest = 0,
  continuityOptionsRequest = 0,
  continuityHabits = [];
const newContinuityCards = () =>
  [0, 1].map(() => ({
    selected: null,
    name: null,
    createdDate: null,
    request: 0,
  }));
let continuityCards = newContinuityCards();
function resetDashboardModules() {
  streakRequest++;
  spendingRequest++;
  continuityOptionsRequest++;
  continuityHabits = [];
  continuityCards = newContinuityCards();
}
export function buildDailySpending(data) {
  if (
    !data?.range ||
    !validCalendarDate(data.range.endDate) ||
    data.range.startDate !== data.range.endDate.slice(0, 7) + "-01" ||
    !Array.isArray(data.days)
  )
    throw new Error("Invalid spending period");
  const totalCents = cents(data.total);
  if (totalCents < 0) throw new Error("Invalid spending total");
  const recorded = new Map();
  let sum = 0;
  for (const day of data.days) {
    if (
      !validCalendarDate(day.date) ||
      day.date < data.range.startDate ||
      day.date > data.range.endDate ||
      recorded.has(day.date) ||
      !Number.isSafeInteger(day.count) ||
      day.count < 1
    )
      throw new Error("Invalid recorded day");
    const amount = cents(day.amount);
    if (amount < 0) throw new Error("Invalid daily amount");
    sum += amount;
    recorded.set(day.date, { cents: amount, count: day.count });
  }
  if (!Number.isSafeInteger(sum) || sum !== totalCents)
    throw new Error("Spending total does not reconcile");
  return getMonthDays(data.range.endDate.slice(0, 7))
    .filter((day) => day.iso <= data.range.endDate)
    .map((day) => ({
      date: day.iso,
      ...(recorded.get(day.iso) || { cents: 0, count: 0 }),
    }));
}
function dailySpendingLabel(day) {
  return (
    localRangeLabel(day.date, day.date) +
    " · " +
    currency.format(day.cents / 100) +
    (day.count
      ? " · " +
        day.count +
        " recorded " +
        (day.count === 1 ? "entry" : "entries")
      : " · no entries recorded")
  );
}
function showSpendingDay(day) {
  text(
    "#spending-detail",
    new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
      localDate(day.date),
    ) +
      " · " +
      currency.format(day.cents / 100),
  );
  $("#spending-detail")?.setAttribute("aria-label", dailySpendingLabel(day));
}
function inspectSpendingBar(bar) {
  if (!bar?.dataset?.date) return;
  $("#spending-inspect").value = bar.dataset.date;
  showSpendingDay({
    date: bar.dataset.date,
    cents: Number(bar.dataset.amount),
    count: Number(bar.dataset.count),
  });
}
export function spendingScale(peakCents, plotHeight = 120) {
  const peak = Number.isFinite(peakCents) ? Math.max(0, peakCents) : 0;
  const preferredIntervals = plotHeight < 115 ? 3 : 4;
  const required = Math.max(100, peak * 1.08);
  const exponent = Math.floor(Math.log10(required / 4));
  let best;
  // Whole-taka steps only. Compare four/five-label scales, favoring modest
  // headroom and using the extra label when the plotting area has room.
  for (let power = exponent - 1; power <= exponent + 2; power++) {
    for (const multiple of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
      const step = multiple * 10 ** power;
      if (step < 100 || Math.abs(step / 100 - Math.round(step / 100)) > 1e-8) continue;
      for (const intervals of [3, 4]) {
        const max = step * intervals;
        if (max < required) continue;
        const score = (max - required) / required + (intervals === preferredIntervals ? 0 : 0.08);
        if (!best || score < best.score) best = { max, step, intervals, score };
      }
    }
  }
  const { max, step, intervals } = best;
  return { max, step, ticks: Array.from({ length: intervals + 1 }, (_, i) => max - i * step) };
}
function updateSpendingScale() {
  const plot = $("#spending-bars");
  if (!plot?.children.length) return;
  const bars = Array.from(plot.children);
  const { max, step, ticks } = spendingScale(
    Math.max(0, ...bars.map(bar => Number(bar.dataset.amount))),
    plot.getBoundingClientRect?.().height || 120,
  );
  $("#spending-y-axis").replaceChildren(...ticks.map(value => {
    const label = document.createElement("span");
    label.textContent = "Tk " + new Intl.NumberFormat("en", value >= 10000000
      ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: 0 }).format(value / 100);
    return label;
  }));
  plot.style.setProperty("--spending-interval", (step / max) * 100 + "%");
  for (const bar of bars) bar.style.height = (Number(bar.dataset.amount) / max) * 100 + "%";
}
async function loadSpending() {
  const token = ++spendingRequest,
    generation = view.generation,
    date = view.mode === "history" ? view.selected : readLocalDay(),
    today = readLocalDay(),
    start = date.slice(0, 7) + "-01",
    end = date < today ? date : today;
  text(
    "#spending-range",
    start > end
      ? "No elapsed dates in " +
          new Intl.DateTimeFormat("en", {
            month: "long",
            year: "numeric",
          }).format(localDate(start))
      : localRangeLabel(start, end),
  );
  $("#spending-chart").hidden = true;
  $("#spending-bars").replaceChildren();
  $("#spending-table").replaceChildren();
  $("#spending-inspect").replaceChildren();
  $("#spending-inspect").disabled = true;
  text("#spending-detail", "");
  $("#spending-detail").removeAttribute("aria-label");
  status("#spending-status", "Loading spending…");
  $("#retry-spending").hidden = true;
  if (start > end) {
    status("#spending-status", "No elapsed dates in this month.", true);
    return;
  }
  try {
    const data = await read("/dashboard-spending?end=" + end);
    if (token !== spendingRequest || generation !== view.generation) return;
    if (data?.range?.startDate !== start || data?.range?.endDate !== end)
      throw new Error("Spending period mismatch");
    const days = buildDailySpending(data),
      selector = $("#spending-inspect");
    $("#spending-bars").replaceChildren(
      ...days.map((day, index) => {
        const bar = document.createElement("button");
        bar.type = "button";
        bar.className = "spending-bar";
        bar.dataset.date = day.date;
        bar.dataset.amount = String(day.cents);
        bar.dataset.count = String(day.count);
        bar.tabIndex = index === days.length - 1 ? 0 : -1;
        bar.setAttribute("aria-label", dailySpendingLabel(day));
        bar.title = dailySpendingLabel(day);
        return bar;
      }),
    );
    selector.replaceChildren(
      ...days.map((day) => {
        const option = document.createElement("option");
        option.value = day.date;
        option.textContent = dailySpendingLabel(day);
        return option;
      }),
    );
    selector.value = end;
    selector.disabled = false;
    showSpendingDay(days.at(-1));
    $("#spending-table").replaceChildren(
      ...days.map((day) => {
        const row = document.createElement("tr");
        for (const value of [
          day.date,
          currency.format(day.cents / 100),
          day.count ? String(day.count) : "No entries recorded",
        ]) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(cell);
        }
        return row;
      }),
    );
    $("#spending-x-axis").replaceChildren(
      ...[
        ...new Set([
          days[0],
          days[Math.floor((days.length - 1) / 2)],
          days.at(-1),
        ]),
      ].map((day) => {
        const label = document.createElement("span");
        label.textContent = new Intl.DateTimeFormat("en", {
          month: "short",
          day: "numeric",
        }).format(localDate(day.date));
        return label;
      }),
    );
    $("#spending-chart").hidden = false;
    updateSpendingScale();
    status(
      "#spending-status",
      data.days.length ? "" : "No expenses recorded in this period.",
      true,
    );
  } catch {
    if (token !== spendingRequest || generation !== view.generation) return;
    status("#spending-status", "Spending unavailable.");
    $("#retry-spending").hidden = false;
  }
}
function continuityNode(selector, index) {
  return $(selector + (index ? "-2" : ""));
}
function localContinuityData(card, recorded = []) {
  const end = view.mode === "history" ? view.selected : readLocalDay();
  return {
    habit: { createdDate: card.createdDate },
    startDate: shiftDate(getWeekDays(end)[0].iso, -175),
    endDate: end,
    currentDate: readLocalDay(),
    completedDates: recorded.filter((date) => date <= readLocalDay()),
  };
}
function renderContinuityCard(index, phase, recorded = []) {
  const card = continuityCards[index],
    data = localContinuityData(card, recorded),
    historical = view.mode === "history",
    cells = buildContinuityCells(data, historical),
    grid = continuityNode("#continuity-grid", index);
  text("#continuity-name" + (index ? "-2" : ""), card.name || "Habit history");
  continuityNode("#continuity-change", index).hidden =
    continuityHabits.length < 2;
  grid.dataset.phase = phase;
  grid.setAttribute("aria-busy", String(phase === "loading"));
  grid.setAttribute(
    "aria-label",
    (card.name ? card.name + " · " : "") +
      "Habit calendar, " +
      localRangeLabel(data.startDate, data.endDate),
  );
  text(
    "#continuity-range" + (index ? "-2" : ""),
    localRangeLabel(data.startDate, data.endDate) +
      (historical ? " · as of selected day" : ""),
  );
  text("#continuity-detail" + (index ? "-2" : ""), "");
  const unknown = ["loading", "unavailable"].includes(phase);
  for (const cell of cells)
    if (cell.state === "unrecorded" && unknown) cell.state = "unknown";
  const tabDate = cells
    .filter((c) => ["completed", "unrecorded", "unknown"].includes(c.state))
    .at(-1)?.date;
  const descriptions = {
    completed: "Completion recorded",
    unrecorded:
      phase === "no-habit"
        ? "No habit selected; unrecorded"
        : "No completion recorded; not a confirmed miss",
    unknown:
      phase === "loading"
        ? "Completion data loading; not a confirmed miss"
        : "Completion data unavailable; not a confirmed miss",
    future: "Future date",
    "before-creation": "Before known habit creation",
  };
  grid.replaceChildren(
    ...cells.map((cell) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "continuity-cell";
      button.dataset.state = cell.state;
      if (!cell.date) {
        button.disabled = true;
        button.tabIndex = -1;
        button.setAttribute("aria-hidden", "true");
        return button;
      }
      button.dataset.date = cell.date;
      button.disabled = !["completed", "unrecorded", "unknown"].includes(
        cell.state,
      );
      button.tabIndex = cell.date === tabDate ? 0 : -1;
      const label =
        localRangeLabel(cell.date, cell.date) +
        " · " +
        descriptions[cell.state];
      button.setAttribute("aria-label", label);
      button.title = label;
      if (cell.date === readLocalDay())
        button.setAttribute("aria-current", "date");
      return button;
    }),
  );
  continuityNode("#continuity-add", index).hidden = phase !== "no-habit";
  const inspector = continuityNode("#continuity-inspect", index);
  inspector.replaceChildren(
    ...cells
      .filter((cell) => cell.date)
      .map((cell) => {
        const option = document.createElement("option");
        option.value = cell.date;
        option.textContent =
          localRangeLabel(cell.date, cell.date) +
          " · " +
          descriptions[cell.state];
        option.disabled = !["completed", "unrecorded", "unknown"].includes(
          cell.state,
        );
        return option;
      }),
  );
  inspector.value = tabDate || "";
  continuityNode("#continuity-open", index).disabled = !tabDate;
  text(
    "#continuity-note" + (index ? "-2" : ""),
    "Choose a date to inspect recorded activity.",
  );
}
async function loadContinuityOptions() {
  if (!$("#continuity-grid")) return;
  const token = ++continuityOptionsRequest,
    generation = view.generation;
  for (const index of [0, 1]) {
    continuityCards[index].request++;
    renderContinuityCard(index, "loading");
    status("#continuity-status" + (index ? "-2" : ""), "Loading habits…");
    continuityNode("#retry-continuity", index).hidden = true;
  }
  try {
    const habits = await read("/get-habits");
    if (token !== continuityOptionsRequest || generation !== view.generation)
      return;
    if (
      !Array.isArray(habits) ||
      habits.some((h) => !h || !/^[1-9]\d*$/.test(String(h.habit_id)))
    )
      throw new Error("Invalid habits");
    continuityHabits = habits;
    for (const index of [0, 1]) {
      const card = continuityCards[index],
        selector = continuityNode("#continuity-habit", index);
      selector.replaceChildren();
      selector.disabled = !habits.length;
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = habits.length
        ? "Choose a habit"
        : "No habits yet";
      selector.append(placeholder);
      for (const habit of habits) {
        const option = document.createElement("option");
        option.value = String(habit.habit_id);
        option.textContent = habit.habit_name;
        selector.append(option);
      }
      if (!habits.some((h) => String(h.habit_id) === card.selected)) {
        card.selected = habits[index] ? String(habits[index].habit_id) : null;
        card.createdDate = null;
      }
      const habit = habits.find((h) => String(h.habit_id) === card.selected);
      card.name = habit?.habit_name || null;
      card.createdDate = validCalendarDate(habit?.createdDate)
        ? habit.createdDate
        : card.createdDate;
      selector.value = card.selected || "";
    }
    await loadContinuity();
  } catch {
    if (token !== continuityOptionsRequest || generation !== view.generation)
      return;
    for (const index of [0, 1]) {
      renderContinuityCard(index, "unavailable");
      continuityNode("#continuity-habit", index).disabled =
        !continuityHabits.length;
      status("#continuity-status" + (index ? "-2" : ""), "Habits unavailable.");
      continuityNode("#retry-continuity", index).hidden = false;
    }
  }
}
async function loadContinuity(index) {
  if (!$("#continuity-grid")) return;
  if (index === undefined)
    return Promise.all([loadContinuity(0), loadContinuity(1)]);
  const card = continuityCards[index],
    token = ++card.request,
    generation = view.generation,
    habit = card.selected,
    end = view.mode === "history" ? view.selected : readLocalDay(),
    suffix = index ? "-2" : "";
  continuityNode("#retry-continuity", index).hidden = true;
  if (!habit) {
    renderContinuityCard(index, "no-habit");
    status(
      "#continuity-status" + suffix,
      continuityHabits.length
        ? "Choose a habit or add another."
        : "No habits yet.",
      true,
    );
    return;
  }
  renderContinuityCard(index, "loading");
  status("#continuity-status" + suffix, "Loading history…");
  const current = () =>
    card === continuityCards[index] &&
    token === card.request &&
    generation === view.generation &&
    habit === card.selected;
  try {
    const data = await read(
      "/dashboard-continuity?habitId=" + habit + "&end=" + end,
    );
    if (!current()) return;
    if (
      data.endDate !== end ||
      data.startDate !== localContinuityData(card).startDate ||
      String(data.habit?.id) !== habit
    )
      throw new Error("Continuity context mismatch");
    buildContinuityCells(data, view.mode === "history");
    card.createdDate = validCalendarDate(data.habit?.createdDate)
      ? data.habit.createdDate
      : null;
    renderContinuityCard(
      index,
      data.completedDates.length ? "recorded" : "empty",
      data.completedDates,
    );
    status(
      "#continuity-status" + suffix,
      data.completedDates.length ? "" : "No completions recorded.",
      true,
    );
  } catch {
    if (!current()) return;
    renderContinuityCard(index, "unavailable");
    status("#continuity-status" + suffix, "History unavailable.");
    continuityNode("#retry-continuity", index).hidden = false;
  }
}

async function loadUniversalStreak() {
  if (!$("#universal-streak")) return;
  const token = ++streakRequest,
    generation = view.generation,
    history = view.mode === "history",
    date = history ? view.selected : null;
  text("#universal-streak", "—");
  $("#universal-streak").removeAttribute("aria-label");
  $("#universal-streak").dataset.state = "unavailable";
  status("#streak-status", "Loading streak…");
  $("#retry-streak").hidden = true;
  text("#streak-asof", history ? "As of " + localRangeLabel(date, date) : "");
  $("#streak-asof").hidden = !history;
  try {
    const data = await read(
      "/universal-streak" + (history ? "?date=" + date : ""),
    );
    if (token !== streakRequest || generation !== view.generation) return;
    if (
      !data ||
      !validCalendarDate(data.asOfDate) ||
      !validCalendarDate(data.currentDate) ||
      (history ? data.asOfDate !== date : data.asOfDate !== data.currentDate)
    )
      throw new Error("Invalid streak context");
    if (data.status === "available") {
      if (!Number.isSafeInteger(data.count) || data.count < 0)
        throw new Error("Invalid streak count");
      text("#universal-streak", data.count);
      $("#universal-streak").dataset.state = "ready";
      $("#universal-streak").setAttribute(
        "aria-label",
        data.count + " day streak as of " + data.asOfDate,
      );
      status("#streak-status", "", true);
    } else if (data.status === "setup-required" && data.count === null) {
      if (!history) {
        status("#streak-status", "Streak tracking needs setup.");
        return;
      }
      status(
        "#streak-status",
        data.reason === "not-tracked"
          ? "No streak recorded for this date."
          : "",
        true,
      );
    } else throw new Error("Invalid streak status");
  } catch {
    if (token !== streakRequest || generation !== view.generation) return;
    status("#streak-status", "Streak unavailable.");
    $("#retry-streak").hidden = false;
  }
}
