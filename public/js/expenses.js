import { categoryIcon } from "./expense-icons.js";
import {
  $,
  node,
  api,
  money,
  amountCents,
  localDay,
  button,
  field,
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
  choiceField,
  calendarField,
  animateValues,
  cancelMetric,
  moneyMetric,
  formData,
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
    calendarField("Date", "date", expense.date || localDay(), { required: "" }),
    choiceField('Category','category',Object.entries(categories).map(([id,c])=>[id,c.name,{render:()=>{const tile=categoryIcon(id);tile.style.setProperty('--category-color',c.color);return tile;}}]),expense.category || 'uncategorized','category-choices'),
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
                await Promise.all([loadExpenses(),expense.recurring_id?loadRecurring():null]);
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
      await Promise.all([loadExpenses(),expense.recurring_id?loadRecurring():null]);
    },
    { extra, submit: expense.expense_id ? 'Save expense' : 'Add expense' },
  );
}
function manageBudget() {
  const selected=month, today=data?.today||localDay();
  let busy=false,requestKey=crypto.randomUUID();
  function budgetForm(title,fields,label){
    const heading=node('div',{class:'budget-form-heading full'},node('h3',{},title)),
      feedback=node('p',{class:'workspace-status full',role:'status'}),
      save=node('button',{type:'submit',class:'workspace-button'},label),
      form=node('form',{class:'workspace-form budget-manager-form'},
        heading,fields,node('div',{class:'actions budget-form-actions'},save),feedback);
    if(title==='Edit budget')heading.append(node('time',{class:'budget-month-pill',datetime:selected},displayDate(selected+'-01',{month:'short',year:'numeric'})));
    return {form,feedback,save};
  }
  const edit=budgetForm('Edit budget',[
      field('Monthly budget · Tk','amount','number',data?.budget??'',{required:'',min:0,max:99999999.99,step:'.01'}),
    ],'Save budget'),
    add=budgetForm('Add money',[
      field('Amount · Tk','amount','number','',{required:'',min:'.01',max:99999999.99,step:'.01'}),
      field('Source','source','text','',{required:'',maxlength:255,placeholder:'e.g. Freelancing'}),
      calendarField('Date','date',selected===today.slice(0,7)?today:selected+'-01',{
        required:'',min:selected+'-01',max:monthDays(selected).at(-1)<today?monthDays(selected).at(-1):today,
      }),
    ],'Add money'),
    content=node('div',{class:'budget-manager'},edit.form,add.form);
  const dialog=modal('Manage budget',content);
  dialog.classList.add('budget-manager-dialog');
  function updateButtons(){edit.save.disabled=busy;add.save.disabled=busy;}
  updateButtons();
  async function save(event,section,adding){
    event.preventDefault();
    if(busy||dialog.classList.contains('closing')||!section.form.reportValidity())return;
    const values=formData(section.form);
    busy=true;updateButtons();status(section.feedback,'Saving…');
    try{
      await api(adding?'/api/budget/additions':'/api/budget',{
        ...values,month:selected,...(adding?{request_key:requestKey}:{}),
      });
      if(adding){requestKey=crypto.randomUUID();section.form.reset();}
      notifyChange();
      await loadExpenses();
      if(!content.isConnected)return;
      if(data?.month===selected)edit.form.querySelector('[name="amount"]').value=data.budget??'';
      status(section.feedback,adding?'Money added.':'Budget saved.');
    }catch(error){if(content.isConnected)status(section.feedback,error.message,true);}
    finally{busy=false;updateButtons();}
  }
  edit.form.addEventListener('submit',event=>save(event,edit,false));
  add.form.addEventListener('submit',event=>save(event,add,true));
}
function renderBudget(total, todayTotal) {
  const budget = data.budget === null ? null : amountCents(data.budget),
    remaining = budget === null ? null : budget - total,
    p = budget ? Math.max(0, Math.min(100, (remaining / budget) * 100)) : 0;
  if (remaining === null) {
    cancelMetric('expense-budget');$('#monthly-budget').textContent='Not set';$('#monthly-budget').removeAttribute('aria-label');
    $('#expense-budget-meter span').style.width='0%';$('#expense-budget-meter').removeAttribute('aria-valuenow');$('#expense-budget-meter').setAttribute('aria-valuetext','No monthly budget set');
  } else {
    $('#monthly-budget').setAttribute('aria-label',money(remaining/100));
    animateValues($('#monthly-budget'),'expense-budget',{remaining:remaining/100,percent:p},frame=>{
      $('#monthly-budget').replaceChildren(moneyFigure(frame.remaining));
      $('#expense-budget-meter span').style.width=frame.percent+'%';
      if(remaining>=0) $('#budget-warning').textContent=Math.round(frame.percent)+'% remaining';
    });
    $('#expense-budget-meter').setAttribute('aria-valuenow',Math.round(p));$('#expense-budget-meter').setAttribute('aria-valuetext',money(remaining/100)+' remaining');
  }
  $("#expense-budget-total").textContent = budget === null ? "Not set" : money(budget / 100);
  if(budget === null || remaining < 0) $("#budget-warning").textContent =
    budget === null
      ? "Set a budget for this month before adding expenses."
      : remaining < 0
        ? "Over budget by " + money(-remaining / 100)
        : Math.round(p) + "% remaining";
  $('#budget-warning').setAttribute('aria-label',budget === null ? 'No monthly budget set' : remaining < 0 ? 'Over budget by '+money(-remaining/100) : Math.round(p)+'% remaining');
  moneyMetric($('#expense-today-spent'),'expense-today',todayTotal/100);
  moneyMetric($('#expense-month-spent'),'expense-month-summary',total/100);
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
  globalThis.HabitMotion?.bars($('#expense-bars'),'expenses-chart:'+month);
  $("#expense-x-axis").replaceChildren(
    ...[...new Set([days[0], days[Math.floor(days.length / 2)], days.at(-1)])]
      .filter(Boolean)
      .map((d) => node("span", {}, displayDate(d, { month: "short", day: "numeric" }))),
  );
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
          behavior: (globalThis.HabitMotionPreference?.reduced() ?? true) ? "instant" : "smooth",
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
    globalThis.HabitMotion?.radial(donut,'category-donut:'+month);
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
        li = node("li", { class: "transaction", "data-category": e.category, 'data-expense': e.expense_id });
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
    let todayTotal = aggregate.byDate.get(data.today) || 0;
    if (selected !== data.today.slice(0, 7)) {
      const current = await api("/api/expenses?month=" + data.today.slice(0, 7));
      if (token !== generation) return;
      if (current.month !== data.today.slice(0, 7) || !Array.isArray(current.expenses))
        throw Error("Today's spending is unavailable.");
      todayTotal = aggregateExpenses(current.expenses).byDate.get(data.today) || 0;
    }
    renderBudget(aggregate.total, todayTotal);
    renderChart(aggregate.byDate);
    renderBreakdown();
    renderTransactions();
    renderCalendar(aggregate.byDate);
    status("#expenses-status", "");
  } catch (e) {
    if (token !== generation) return;
    cancelMetric('expense-budget');cancelMetric('expense-today');cancelMetric('expense-month-summary');
    data = null;
    for (const s of ["#monthly-budget", "#expense-budget-total", "#expense-today-spent", "#expense-month-spent"])
      { $(s).textContent = "—";$(s).removeAttribute('aria-label'); }
    for (const s of [
      "#expense-list",
      "#category-visual",
      "#category-legend",
      "#expense-bars",
      "#expense-y-axis",
      "#expense-x-axis",
      "#spending-calendar",
    ])
      $(s).replaceChildren();
    $("#expense-budget-meter span").style.width = "0%";
    $("#expense-budget-meter").removeAttribute("aria-valuenow");
    $('#expense-budget-meter').setAttribute('aria-valuetext','Unavailable');
    $("#budget-warning").textContent = "";
    $("#transaction-count").textContent = "";
    $("#expense-chart-detail").textContent = "Chart unavailable.";
    status("#expenses-status", e.message, true);
    $("#expenses-retry").hidden = false;
  }
}
function recurringEditor(r = {}) {
  const nameField = field("Name", "name", "text", r.name, { required: "", maxlength: 255 });
  nameField.classList.add('full');
  const remove = r.recurring_id ? button('Delete',()=>confirmAction(
    'Delete recurring expense',
    'Delete “'+r.name+'”? Recorded payments will stay.',
    async()=>{
      await api('/api/recurring/delete',{recurring_id:r.recurring_id});
      notifyChange();
      await loadRecurring();
    },
  ),true) : null;
  remove?.classList.add('danger');
  const {form} = editor(
    r.recurring_id ? "Edit recurring expense" : "New recurring expense",
    [
      nameField,
      field("Amount · Tk", "amount", "number", r.amount, {
        required: "",
        min: ".01",
        max: 99999999.99,
        step: ".01",
      }),
      categoryField(r.category),
      choiceField(
        "Frequency",
        "frequency",
        [
          ["weekly", "Weekly"],
          ["monthly", "Monthly"],
          ["yearly", "Yearly"],
        ],
        r.frequency || "monthly",
      ),
      calendarField("Starts on", "starts_on", r.starts_on || localDay(), { required: "" }),
      calendarField("Ends on (optional)", "ends_on", r.ends_on),
    ],
    async (values) => {
      await api("/api/recurring/save", {
        ...values,
        enabled: r.enabled !== false,
        recurring_id: r.recurring_id,
      });
      await loadRecurring();
    },
    { submit: r.recurring_id ? 'Save recurring expense' : 'Create recurring expense', extra: remove ? [remove] : [] },
  );
  form.classList.add('recurring-editor-form');
}
function recurringDateLabel(date, today) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(String(year) !== today.slice(0, 4) ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
function recurringAction(label, path, action) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    iconPath = document.createElementNS(svg.namespaceURI, "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  iconPath.setAttribute("d", path);
  svg.append(iconPath);
  return node("button", {
    type: "button",
    class: "recurring-icon-action",
    "aria-label": label,
    title: label,
    onclick: action,
  }, svg);
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
        const payable =
          r.enabled && (!r.ends_on || r.next_due <= r.ends_on);
        const dueLabel = recurringDateLabel(r.next_due, response.today),
          actions = node("div", { class: "recurring-actions" },
            recurringAction("Edit " + r.name, "M4 16.5V20h3.5L18 9.5 14.5 6 4 16.5zM13.5 7l3.5 3.5", () => recurringEditor(r)),
            payable
              ? recurringAction("Mark " + r.name + " paid · due " + dueLabel, "M20 6 9 17l-5-5", () =>
                  editor(
                    "Confirm payment",
                    [
                      node(
                        "p",
                        { class: "full" },
                        r.name + " · " + money(r.amount) + " · scheduled " + dueLabel,
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
                    { submit: "Mark paid" },
                  ),
                )
              : null,
          ),
          settled=!!r.last_paid_on&&(!r.enabled||r.next_due>response.today),
          row = node("div", { class: "recurring-row" },
            node("div", { class: "recurring-name" }, node("strong", {}, r.name),
              node('span',{class:'recurring-payment-state','data-paid':String(settled),
                ...(r.last_paid_for?{title:'Payment for '+recurringDateLabel(r.last_paid_for,response.today)}:{}),
              },r.last_paid_on?(settled?'Paid ':'Last paid ')+recurringDateLabel(r.last_paid_on,response.today):'Unpaid')),
            node("span", { class: "recurring-due" }, r.enabled ? "Due " + dueLabel : "Disabled"),
            node("div", { class: "recurring-meta" }, node("strong", {}, money(r.amount))),
            actions,
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
  bindPanel("#calendar-open", "#calendar-panel", "Spending calendar");
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
  $("#budget-edit").addEventListener("click", manageBudget);
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
