import {
  $,
  node,
  api,
  money,
  amountCents,
  localDay,
  button,
  field,
  selectField,
  categoryField,
  categories,
  editor,
  confirmAction,
  modal,
  status,
  monthShift,
  monthDays,
  displayDate,
  notifyChange,
  bindWorkspaceRefresh,
  moneyFigure,
  bindPanel,
} from "./workspace.js";
import { spendingScale } from "./dashboard.js";
let data = null,
  month = localDay().slice(0, 7),
  generation = 0,
  recurringGeneration = 0,
  initialized = false,
  chartView = "bar";
try {
  chartView = localStorage.getItem("habitcents-category-chart") === "circle" ? "circle" : "bar";
} catch {}
export function aggregateExpenses(expenses) {
  const byDate = new Map(),
    byCategory = new Map();
  let total = 0;
  for (const e of expenses) {
    const amount = amountCents(e.amount),
      category = categories[e.category] ? e.category : "uncategorized";
    total += amount;
    byDate.set(e.date, (byDate.get(e.date) || 0) + amount);
    byCategory.set(category, (byCategory.get(category) || 0) + amount);
  }
  return { total, byDate, byCategory };
}
function editExpense(expense = {}) {
  const fields = [
    field("Description", "name", "text", expense.description, { required: "", maxlength: 255 }),
    field("Amount · Tk", "amount", "number", expense.amount, {
      required: "",
      min: ".01",
      max: 99999999.99,
      step: ".01",
    }),
    field("Date", "date", "date", expense.date || localDay(), { required: "" }),
    categoryField(expense.category),
  ];
  const extra = expense.expense_id
    ? [
        button(
          "Delete",
          () =>
            confirmAction(
              "Delete expense",
              "Permanently delete this recorded transaction?",
              async () => {
                await api("/delete-expense", { expense_id: expense.expense_id });
                notifyChange();
                await loadExpenses();
              },
            ),
          true,
        ),
      ]
    : [];
  editor(
    expense.expense_id ? "Edit expense" : "Add expense",
    fields,
    async (values) => {
      await api("/api/expenses/save", { ...values, expense_id: expense.expense_id });
      notifyChange();
      await loadExpenses();
    },
    { extra },
  );
}
function editBudget() {
  editor(
    "Monthly budget",
    [
      node(
        "p",
        { class: "full" },
        "Budget for " + month + ". Existing transactions will be preserved.",
      ),
      field("Budget · Tk", "amount", "number", data?.budget ?? "", {
        required: "",
        min: 0,
        max: 99999999.99,
        step: ".01",
      }),
    ],
    async (values) => {
      await api("/api/budget", { month, amount: values.amount });
      notifyChange();
      await loadExpenses();
    },
  );
}
function renderBudget(total) {
  const budget = data.budget === null ? null : amountCents(data.budget),
    remaining = budget === null ? null : budget - total,
    p = budget ? Math.max(0, Math.min(100, (remaining / budget) * 100)) : 0;
  if (remaining === null) $("#monthly-budget").textContent = "Not set";
  else $("#monthly-budget").replaceChildren(moneyFigure(remaining / 100));
  $("#expense-budget-total").textContent = budget === null ? "Not set" : money(budget / 100);
  $("#expense-budget-spent").replaceChildren(moneyFigure(total / 100));
  $("#expense-budget-meter span").style.width = p + "%";
  $("#expense-budget-meter").setAttribute("aria-valuenow", Math.round(p));
  $("#budget-warning").textContent =
    budget === null
      ? "Set a budget for this month before adding expenses."
      : remaining < 0
        ? "Over budget by " + money(-remaining / 100)
        : Math.round(p) + "% remaining";
}
function renderChart(series) {
  const days = monthDays(month).filter((d) => d <= data.today),
    peak = Math.max(0, ...days.map((d) => series.get(d) || 0)),
    scale = spendingScale(peak, $("#expense-bars").getBoundingClientRect?.().height || 180);
  $("#expense-period").textContent = days.length
    ? displayDate(days[0]) + " – " + displayDate(days.at(-1))
    : "No elapsed dates in this month.";
  $("#expense-y-axis").replaceChildren(
    ...scale.ticks.map((t) =>
      node(
        "span",
        {},
        t >= 10000000
          ? "Tk " + new Intl.NumberFormat("en", { notation: "compact" }).format(t / 100)
          : money(t / 100).replace(".00", ""),
      ),
    ),
  );
  $("#expense-bars").style.setProperty("--chart-step", (scale.step / scale.max) * 100 + "%");
  const label = (d) =>
    displayDate(d) +
    ": " +
    money((series.get(d) || 0) / 100) +
    (!series.has(d) ? " · no entries recorded" : " recorded");
  const bars = days.map((d, i) => {
    const b = node("button", {
      type: "button",
      "aria-label": label(d),
      "data-date": d,
      "data-zero": !series.get(d),
      tabindex: i === days.length - 1 ? 0 : -1,
      title: label(d),
      onfocus: () => {
        $("#expense-chart-detail").textContent = label(d);
      },
      onclick: () => {
        $("#expense-chart-detail").textContent = label(d);
      },
    });
    b.style.height = ((series.get(d) || 0) / scale.max) * 100 + "%";
    return b;
  });
  $("#expense-bars").replaceChildren(...bars);
  $("#expense-x-axis").replaceChildren(
    ...[...new Set([days[0], days[Math.floor(days.length / 2)], days.at(-1)])]
      .filter(Boolean)
      .map((d) => node("span", {}, displayDate(d, { month: "short", day: "numeric" }))),
  );
  const table = node(
    "table",
    { class: "workspace-table" },
    node("caption", {}, "Daily recorded spending; zero means no entries recorded."),
    node(
      "thead",
      {},
      node("tr", {}, node("th", { scope: "col" }, "Date"), node("th", { scope: "col" }, "Amount")),
    ),
    node(
      "tbody",
      {},
      days.map((d) =>
        node("tr", {}, node("td", {}, d), node("td", {}, money((series.get(d) || 0) / 100))),
      ),
    ),
  );
  $("#daily-values").replaceChildren(table);
  $("#expense-chart-detail").textContent = !days.length
    ? "Future dates are not plotted."
    : !series.size
      ? "No expenses recorded for the elapsed dates."
      : "";
}
function renderBreakdown() {
  if (!data) return;
  const { total, byCategory } = aggregateExpenses(data.expenses);
  $("#breakdown-circle").setAttribute("aria-pressed", chartView === "circle");
  $("#breakdown-bar").setAttribute("aria-pressed", chartView === "bar");
  const visual = $("#category-visual");
  visual.replaceChildren();
  $("#category-legend").replaceChildren();
  if (!total) {
    visual.append(node("p", { class: "workspace-empty" }, "No expenses recorded for this month."));
    return;
  }
  let offset = 0;
  const segments = [];
  const bar = node("div", {
    class: "category-bar",
    role: "img",
    "aria-label": "Category shares; exact amounts follow in the legend",
  });
  for (const [id, amount] of byCategory) {
    const c = categories[id],
      percent = (amount / total) * 100;
    segments.push(c.color + " " + offset + "% " + (offset + percent) + "%");
    offset += percent;
    const segment = node("span", { title: c.name + ": " + money(amount / 100) });
    segment.style.width = percent + "%";
    segment.style.background = c.color;
    bar.append(segment);
    const marker = node("span", { class: "category-marker", "aria-hidden": "true" });
    marker.style.setProperty("--category-color", c.color);
    const row = button(
      "",
      () => {
        $("#transaction-category").value = id;
        renderTransactions();
        $("#expense-list").scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
          block: "center",
        });
      },
      true,
    );
    row.className = "";
    row.append(
      marker,
      node("span", {}, c.name),
      node("span", {}, percent.toFixed(1) + "%"),
      node("span", {}, money(amount / 100)),
    );
    $("#category-legend").append(node("li", {}, row));
  }
  if (chartView === "bar") visual.append(bar);
  else {
    const donut = node("div", {
      class: "category-donut",
      role: "img",
      "aria-label": "Recorded spending " + money(total / 100) + " by category; exact values follow",
    });
    donut.style.background = "conic-gradient(" + segments.join(",") + ")";
    donut.append(node("div", { class: "donut-center", "aria-hidden": "true" }));
    visual.append(donut);
  }
}
function renderTransactions() {
  if (!data) return;
  const search = $("#transaction-search").value.toLowerCase(),
    category = $("#transaction-category").value,
    from = $("#transaction-from").value,
    through = $("#transaction-through").value,
    sort = $("#transaction-sort").value;
  const items = data.expenses
    .filter(
      (e) =>
        (e.description || "").toLowerCase().includes(search) &&
        (category === "all" || e.category === category) &&
        (!from || e.date >= from) &&
        (!through || e.date <= through),
    )
    .sort((a, b) =>
      sort === "largest"
        ? amountCents(b.amount) - amountCents(a.amount)
        : sort === "smallest"
          ? amountCents(a.amount) - amountCents(b.amount)
          : sort === "oldest"
            ? a.date.localeCompare(b.date)
            : b.date.localeCompare(a.date),
    );
  $("#transaction-count").textContent = items.length + " of " + data.expenses.length + " entries";
  $("#expense-list").replaceChildren(
    ...items.map((e) => {
      const c = categories[e.category] || categories.uncategorized,
        li = node("li", { class: "transaction", "data-category": e.category });
      li.style.setProperty("--category-color", c.color);
      li.append(
        button("", () => editExpense(e), true),
        node("span", { class: "transaction-amount" }, money(e.amount)),
      );
      const open = li.firstChild;
      open.className = "";
      open.append(
        categoryIcon(e.category),
        node(
          "span",
          {},
          node("span", { class: "transaction-title" }, e.description),
          node("small", {}, displayDate(e.date) + " · " + c.name),
        ),
      );
      open.setAttribute(
        "aria-label",
        "Edit " + e.description + ", " + money(e.amount) + ", " + e.date,
      );
      return li;
    }),
  );
  if (!items.length)
    $("#expense-list").append(
      node("li", { class: "workspace-empty" }, "No transactions match these filters."),
    );
}
function categoryIcon(category) {
  const paths = {
    transport: "M5 16V5h14v11zM8 19v-3m8 3v-3M5 10h14M8 13h1m6 0h1",
    food: "M5 3v6m3-6v6M5 6h3M6.5 9v12M17 3v18m0-18c-5 2-5 9 0 9",
    shopping: "M5 7h14l1 14H4zM9 8V5a3 3 0 016 0v3",
    subscriptions: "M4 5h16v14H4zM8 10l3-2v8l-3-2m6-4h3m-3 4h3",
    uncategorized: "M5 5h14v14H5zM9 12h6M12 9v6",
  };
  const tile = node("span", { class: "transaction-icon", "aria-hidden": "true" }),
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    path = document.createElementNS(svg.namespaceURI, "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  path.setAttribute("d", paths[category] || paths.uncategorized);
  svg.append(path);
  tile.append(svg);
  return tile;
}
function renderCalendar(series) {
  const calendar = $("#spending-calendar");
  calendar.replaceChildren(
    ...["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => node("span", {}, d)),
  );
  const days = monthDays(month),
    offset = (new Date(days[0] + "T12:00Z").getUTCDay() + 6) % 7;
  for (let i = 0; i < offset; i++) calendar.append(node("span", { "aria-hidden": "true" }));
  for (const d of days) {
    const value = series.get(d) || 0,
      b = node(
        "button",
        {
          type: "button",
          class: "calendar-day",
          "aria-label":
            displayDate(d) +
            ", " +
            money(value / 100) +
            (series.has(d) ? " recorded" : " no entries recorded"),
          ...(d === data.today ? { "aria-current": "date" } : {}),
          onclick: () => {
            const items = data.expenses.filter((e) => e.date === d),
              box = node(
                "div",
                {},
                node("p", {}, displayDate(d)),
                node("p", { class: "goal-amount" }, money(value / 100) + " recorded"),
                items.length
                  ? node(
                      "ul",
                      { class: "transactions" },
                      items.map((e) =>
                        node("li", { class: "transaction" }, e.description, money(e.amount)),
                      ),
                    )
                  : node("p", { class: "workspace-muted" }, "No expenses recorded."),
              );
            modal("Recorded spending", box);
          },
        },
        String(Number(d.slice(8))),
        node("small", {}, value ? money(value / 100) : "—"),
      );
    calendar.append(b);
  }
}
export async function loadExpenses() {
  const token = ++generation,
    selected = month;
  status("#expenses-status", "Loading " + selected + "…");
  $("#expenses-retry").hidden = true;
  try {
    const result = await api("/api/expenses?month=" + selected);
    if (token !== generation) return;
    if (result.month !== selected || !Array.isArray(result.expenses))
      throw Error("Invalid monthly response.");
    data = result;
    const aggregate = aggregateExpenses(data.expenses);
    renderBudget(aggregate.total);
    renderChart(aggregate.byDate);
    renderBreakdown();
    renderTransactions();
    renderCalendar(aggregate.byDate);
    status("#expenses-status", "");
  } catch (e) {
    if (token !== generation) return;
    data = null;
    for (const s of ["#monthly-budget", "#expense-budget-total", "#expense-budget-spent"])
      $(s).textContent = "—";
    for (const s of [
      "#expense-list",
      "#category-visual",
      "#category-legend",
      "#expense-bars",
      "#expense-y-axis",
      "#expense-x-axis",
      "#daily-values",
      "#spending-calendar",
    ])
      $(s).replaceChildren();
    $("#expense-budget-meter span").style.width = "0%";
    $("#expense-budget-meter").removeAttribute("aria-valuenow");
    $("#budget-warning").textContent = "";
    $("#transaction-count").textContent = "";
    $("#expense-chart-detail").textContent = "Chart unavailable.";
    status("#expenses-status", e.message, true);
    $("#expenses-retry").hidden = false;
  }
}
function recurringEditor(r = {}) {
  editor(
    r.recurring_id ? "Edit recurring expense" : "New recurring expense",
    [
      field("Description", "name", "text", r.name, { required: "", maxlength: 255 }),
      field("Amount · Tk", "amount", "number", r.amount, {
        required: "",
        min: ".01",
        max: 99999999.99,
        step: ".01",
      }),
      categoryField(r.category),
      selectField(
        "Frequency",
        "frequency",
        [
          ["weekly", "Weekly"],
          ["monthly", "Monthly"],
          ["yearly", "Yearly"],
        ],
        r.frequency || "monthly",
      ),
      field("Starts on", "starts_on", "date", r.starts_on || localDay(), { required: "" }),
      field("Ends on (optional)", "ends_on", "date", r.ends_on),
      selectField(
        "Status",
        "enabled",
        [
          ["true", "Enabled"],
          ["false", "Disabled"],
        ],
        r.enabled === false ? "false" : "true",
      ),
      node(
        "p",
        { class: "workspace-muted full" },
        "Monthly payments keep the starting day, clamped to the last day of shorter months. No transaction is created until you confirm payment.",
      ),
    ],
    async (values) => {
      await api("/api/recurring/save", {
        ...values,
        enabled: values.enabled === "true",
        recurring_id: r.recurring_id,
      });
      await loadRecurring();
    },
  );
}
async function loadRecurring() {
  const token = ++recurringGeneration;
  status("#recurring-status", "Loading recurring expenses…");
  $("#recurring-retry").hidden = true;
  try {
    const response = await api("/api/recurring");
    if (token !== recurringGeneration) return;
    $("#recurring-list").replaceChildren(
      ...response.definitions.map((r) => {
        const due =
          r.enabled && r.next_due <= response.today && (!r.ends_on || r.next_due <= r.ends_on);
        const row = node(
          "div",
          { class: "recurring-row" },
          node(
            "div",
            {},
            node("strong", {}, r.name),
            node(
              "p",
              { class: "workspace-muted" },
              money(r.amount) +
                " · " +
                r.frequency +
                " · " +
                (r.enabled ? "Next due " + r.next_due : "Disabled"),
            ),
          ),
          node(
            "div",
            { class: "recurring-actions" },
            button("Edit", () => recurringEditor(r), true),
            due
              ? button("Confirm payment", () =>
                  editor(
                    "Confirm payment",
                    [
                      node(
                        "p",
                        { class: "full" },
                        r.name + " · " + money(r.amount) + " · scheduled " + r.next_due,
                      ),
                      field("Actual payment date", "date", "date", response.today, {
                        required: "",
                        max: response.today,
                      }),
                    ],
                    async (values) => {
                      await api("/api/recurring/confirm", {
                        recurring_id: r.recurring_id,
                        scheduled_for: r.next_due,
                        date: values.date,
                      });
                      notifyChange();
                      await Promise.all([loadExpenses(), loadRecurring()]);
                    },
                    { submit: "Record payment" },
                  ),
                )
              : null,
          ),
        );
        return row;
      }),
    );
    status("#recurring-status", response.definitions.length ? "" : "No recurring expenses yet.");
  } catch (e) {
    if (token !== recurringGeneration) return;
    $("#recurring-list").replaceChildren();
    status("#recurring-status", e.message, true);
    $("#recurring-retry").hidden = false;
  }
}
export function initExpenses() {
  if (initialized) return;
  initialized = true;
  bindPanel("#transaction-options", "#transaction-controls", "Search and filter transactions");
  bindPanel("#category-options", "#category-controls", "Category chart style");
  const helpButton = $("#spending-help-button"), helpText = $("#spending-help-text");
  const showHelp = () => { helpText.hidden = false; };
  const hideHelp = () => { helpText.hidden = true; };
  helpButton.addEventListener("focus", showHelp);
  helpButton.addEventListener("blur", hideHelp);
  helpButton.addEventListener("click", showHelp);
  helpButton.parentElement.addEventListener("mouseenter", showHelp);
  helpButton.parentElement.addEventListener("mouseleave", () => {
    if (document.activeElement !== helpButton) hideHelp();
  });
  helpButton.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { hideHelp(); event.stopPropagation(); }
  });
  bindWorkspaceRefresh(() => {
    loadExpenses();
    loadRecurring();
  }, localDay);
  $("#expense-month").value = month;
  const changeMonth = (value) => {
    if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value)) return;
    month = value;
    $("#expense-month").value = value;
    $("#transaction-from").value = "";
    $("#transaction-through").value = "";
    loadExpenses();
  };
  $("#month-previous").addEventListener("click", () => changeMonth(monthShift(month, -1)));
  $("#month-next").addEventListener("click", () => changeMonth(monthShift(month, 1)));
  $("#expense-month").addEventListener("change", (e) => changeMonth(e.target.value));
  $("#expense-new").addEventListener("click", () =>
    editExpense({ date: month === localDay().slice(0, 7) ? localDay() : month + "-01" }),
  );
  $("#budget-edit").addEventListener("click", editBudget);
  $("#expenses-retry").addEventListener("click", loadExpenses);
  $("#recurring-new").addEventListener("click", () => recurringEditor());
  $("#recurring-retry").addEventListener("click", loadRecurring);
  for (const s of [
    "#transaction-search",
    "#transaction-category",
    "#transaction-from",
    "#transaction-through",
    "#transaction-sort",
  ])
    $(s).addEventListener("input", renderTransactions);
  for (const view of ["circle", "bar"])
    $("#breakdown-" + view).addEventListener("click", () => {
      chartView = view;
      try {
        localStorage.setItem("habitcents-category-chart", view);
      } catch {}
      renderBreakdown();
    });
  $("#expense-bars").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const bars = [...$("#expense-bars").querySelectorAll("button")],
      index = bars.indexOf(document.activeElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? bars.length - 1
          : index + (e.key === "ArrowLeft" ? -1 : 1);
    if (bars[next]) {
      e.preventDefault();
      bars.forEach((b) => (b.tabIndex = -1));
      bars[next].tabIndex = 0;
      bars[next].focus();
    }
  });
  window.addEventListener("focus", () => {
    if (!document.querySelector(".workspace-dialog")) {
      loadExpenses();
      loadRecurring();
    }
  });
  loadExpenses();
  loadRecurring();
}
