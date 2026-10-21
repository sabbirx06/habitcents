import {
  $,
  node,
  api,
  localDay,
  button,
  field,
  selectField,
  editor,
  confirmAction,
  modal,
  status,
  displayDate,
  notifyChange,
  bindWorkspaceRefresh,
  moneyFigure,
  bindPanel,
} from "./workspace.js";
let state = null,
  generation = 0,
  initialized = false,
  resizeTimer;
const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function shiftDay(day, count) {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function heatmapDates(end, weeks) {
  const offset = (new Date(end + "T12:00:00Z").getUTCDay() + 6) % 7,
    last = shiftDay(end, 6 - offset),
    start = shiftDay(last, -weeks * 7 + 1);
  return Array.from({ length: weeks * 7 }, (_, i) => shiftDay(start, i));
}
export function historyRangeLabel(today, weeks) {
  const dates = heatmapDates(today, weeks);
  return displayDate(dates[0], { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' – ' + displayDate(dates.at(-1), { day: 'numeric', month: 'short', year: 'numeric' });
}
export function habitCells({
  dates,
  today,
  createdOn = null,
  records = [],
  versions = [],
  available = false,
}) {
  const recorded = new Map(records.map((r) => [r.date, r]));
  return dates.map((day) => {
    let state = "unknown";
    const record = recorded.get(day),
      version = versions.filter((v) => v.effective_on <= day).at(-1),
      weekday = new Date(day + "T12:00:00Z").getUTCDay() || 7;
    if (day > today) state = "future";
    else if (createdOn && day < createdOn) state = "before-creation";
    else if (available && record?.completed_status) state = "completed";
    else if (available && Number(record?.progress_amount) > 0) state = "partial";
    else if (available && version && (version.archived || !version.schedule_days.includes(weekday)))
      state = "rest";
    else if (available && version && day < today) state = "missed";
    return { date: day, state, record, target: version?.target, unit: version?.unit };
  });
}
function habitIcon(icon) {
  const paths = {
    check: "M5 12l4 4L19 6",
    book: "M4 4h7l1 2 1-2h7v15h-7l-1 1-1-1H4zM12 6v14",
    walk: "M12 3h1M10 7l3 2 3 1M12 8l-3 5-4 2M11 13l3 3 1 5M9 14l-2 7",
    water: "M12 3s-7 8-7 12a7 7 0 0014 0c0-4-7-12-7-12z",
    leaf: "M4 20C2 8 10 3 21 3c0 12-6 18-17 17zM4 20L16 8",
    focus: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M12 8v8M8 12h8",
  };
  const box = node("span", { class: "habit-icon", "aria-hidden": "true" }),
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    path = document.createElementNS(svg.namespaceURI, "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  path.setAttribute("d", paths[icon] || paths.check);
  svg.append(path);
  box.append(svg);
  return box;
}
function scheduleLabel(h) {
  const days = h.schedule_days || [1, 2, 3, 4, 5, 6, 7];
  return days.length === 7 ? "Every day" : days.map((d) => names[d - 1]).join(", ");
}
function progressEditor(h) {
  editor(
    "Record today’s progress",
    [
      node("p", { class: "full" }, h.habit_name + " · Target " + h.target + " " + h.unit),
      field("Total achieved today · " + h.unit, "progress", "number", h.progress_amount ?? 0, {
        required: "",
        min: 0,
        max: 99999999.99,
        step: ".01",
      }),
      node(
        "p",
        { class: "workspace-muted full" },
        "This sets today’s total. It does not add another increment.",
      ),
    ],
    async (values) => {
      await api("/api/habits/progress", {
        habit_id: h.habit_id,
        date: state.today,
        progress: values.progress,
      });
      notifyChange();
      await loadHabits();
    },
  );
}
async function toggle(h, control) {
  if (h.target != null) return progressEditor(h);
  const before = h.completed;
  control.disabled = true;
  control.setAttribute("aria-pressed", !before);
  try {
    await api("/api/habits/progress", {
      habit_id: h.habit_id,
      date: state.today,
      completed: !before,
    });
    notifyChange();
    await loadHabits();
  } catch (e) {
    control.setAttribute("aria-pressed", before);
    status("#habits-status", e.message, true);
  } finally {
    control.disabled = false;
  }
}
// Honor saved category metadata when present, then the habit's saved palette.
export function habitAccent(habit, categories = []) {
  const palette = ['lime', 'blue', 'pink', 'lavender', 'peach'];
  const saved = [habit.color, categories.find(category => category.name === habit.category)?.color]
    .find(color => palette.includes(color));
  if (saved) return saved;
  // IDs may be PostgreSQL BIGINT strings: do not lose precision through Number.
  const id = String(habit.habit_id ?? '');
  if (/^\d+$/.test(id)) return palette[Number(BigInt(id) % BigInt(palette.length))];
  const index = Array.from(id).reduce((value, character) =>
    (value * 31 + character.codePointAt(0)) % palette.length, 0);
  return palette[index];
}
function habitEditor(h = {}) {
  const name = field("Habit name", "name", "text", h.habit_name || h.name, {
      required: "",
      maxlength: 255,
    }),
    description = field("Description (optional)", "description", "text", h.description, {
      maxlength: 1000,
    }),
    category = field("Category (optional)", "category", "text", h.category, { maxlength: 50 }),
    icon = selectField(
      "Icon",
      "icon",
      [
        ["check", "Check"],
        ["book", "Book"],
        ["walk", "Movement"],
        ["water", "Water"],
        ["leaf", "Nature"],
        ["focus", "Focus"],
      ],
      h.icon || "check",
    ),
    color = selectField(
      "Color",
      "color",
      [
        ["lavender", "Lavender"],
        ["blue", "Powder blue"],
        ["lime", "Pale lime"],
        ["peach", "Peach"],
        ["pink", "Lavender pink"],
      ],
      habitAccent(h, state?.categories),
    );
  const days = node(
      "fieldset",
      { class: "full" },
      node("legend", { class: "workspace-label" }, "Scheduled days"),
    ),
    choices = node("div", { class: "weekday-choices" }),
    selected = h.schedule_days || [1, 2, 3, 4, 5, 6, 7];
  for (let i = 1; i <= 7; i++)
    choices.append(
      node(
        "label",
        {},
        node("input", {
          type: "checkbox",
          name: "weekday",
          value: i,
          ...(selected.includes(i) ? { checked: "" } : {}),
        }),
        names[i - 1],
      ),
    );
  days.append(
    button(
      "All days",
      () => choices.querySelectorAll("input").forEach((i) => (i.checked = true)),
      true,
    ),
    choices,
  );
  const target = field("Daily target (optional)", "target", "number", h.target, {
      min: ".01",
      max: 99999999.99,
      step: ".01",
    }),
    unit = field("Target unit (e.g. minutes)", "unit", "text", h.unit, { maxlength: 40 });
  editor(
    h.habit_id ? "Edit habit" : "New habit",
    [
      ...(!h.habit_id ? [state ? button("Choose a preset", presets, true) : node("p", {class:"workspace-muted full"}, "Presets are unavailable until habits load. You can still create a custom habit.")] : []),
      name,
      description,
      category,
      icon,
      color,
      days,
      target,
      unit,
      node(
        "p",
        { class: "workspace-muted full" },
        "Schedule and target changes apply today, preserving the rules recorded for earlier days. Leave target empty for a check/uncheck habit.",
      ),
    ],
    async (values, form) => {
      await api("/api/habits/save", {
        ...values,
        habit_id: h.habit_id,
        schedule_days: [...form.querySelectorAll("[name=weekday]:checked")].map((n) =>
          Number(n.value),
        ),
      });
      notifyChange();
      await loadHabits();
    },
  );
}
function cellDescription(c) {
  return (
    displayDate(c.date) +
    ": " +
    ({
      unknown: "No check-in recorded or insufficient history",
      completed: "Completed",
      missed: "Scheduled day with no completed check-in",
      partial: "Partial progress",
      rest: "Not scheduled",
      future: "Future date",
      "before-creation": "Before known habit creation",
    }[c.state] || c.state) +
    (c.record?.progress_amount != null
      ? " · " + c.record.progress_amount + (c.unit ? " " + c.unit : "")
      : "")
  );
}
function history(h, weeks = 20, detail = false, selected = state.today) {
  const shell = node("div", { class: "habit-history" }),
    dates = heatmapDates(state.today, weeks),
    months = node("div", { class: "heatmap-months", "aria-hidden": "true" }),
    layout = node("div", { class: "heatmap-layout" }),
    weekdays = node(
      "div",
      { class: "heatmap-weekdays", "aria-hidden": "true" },
      names.map((n, i) => node("span", {}, i % 2 === 0 ? n[0] : "")),
    ),
    grid = node("div", {
      class: "habit-heatmap",
      role: "group",
      "aria-label": h.habit_name + " completion dates. Use arrow keys.",
    }),
    feedback = node("p", { class: "workspace-status", role: "status" }),
    retry = button("Retry history", () => load(), true),
    output = node("output", { class: detail ? "workspace-muted" : "workspace-sr-only" }),
    inspector = field("Inspect a date", "inspect", "date", selected, {
      min: dates[0],
      max: dates.at(-1),
    });
  let cells = [];
  retry.hidden = true;
  layout.append(weekdays, grid);
  shell.append(
    months,
    layout,
    detail
      ? node(
          "div",
          { class: "history-inspection" },
          inspector,
          button("Inspect", () => inspect(inspector.querySelector("input").value), true),
        )
      : document.createTextNode(""),
    output,
    feedback,
    retry,
  );
  function inspect(day) {
    const c = cells.find((c) => c.date === day);
    if (c) output.textContent = cellDescription(c);
  }
  function paint(records = [], versions = [], available = false) {
    cells = habitCells({
      dates,
      today: state.today,
      createdOn: h.created_on,
      records,
      versions,
      available,
    });
    let previous = "";
    months.replaceChildren();
    for (let i = 0; i < dates.length; i += 7) {
      const m = dates[i].slice(0, 7),
        label = node("span", {});
      if (m !== previous) {
        label.textContent = displayDate(dates[i], { month: "short" });
        previous = m;
      }
      months.append(label);
    }
    grid.replaceChildren(
      ...cells.map((c, i) => {
        const label = cellDescription(c),
          b = node("button", {
            type: "button",
            class: "heat-cell",
            "data-state": c.state,
            "data-date": c.date,
            tabindex: i === dates.indexOf(state.today) ? 0 : -1,
            "aria-label": label,
            title: label,
            onfocus: () => {
              output.textContent = label;
            },
            onclick: () => {
              if (!detail) return details(h, c.date);
              inspector.querySelector("input").value = c.date;
              output.textContent = label;
            },
          });
        return b;
      }),
    );
    if (detail) inspect(inspector.querySelector("input").value);
  }
  grid.addEventListener("keydown", (e) => {
    const offsets = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    if (!(e.key in offsets)) return;
    const list = [...grid.querySelectorAll("button")],
      index = list.indexOf(e.target),
      next = list[index + offsets[e.key]];
    if (next) {
      e.preventDefault();
      list.forEach((n) => (n.tabIndex = -1));
      next.tabIndex = 0;
      next.focus();
    }
  });
  const help = node(
    "details",
    {},
    node("summary", {}, "Cell states"),
    node(
      "p",
      { class: "workspace-muted" },
      "Filled: completed. Muted fill: partial. Outline: known scheduled day without completion. Dashed: rest day. Dotted: unknown or future. Legacy dates stay unknown unless a completion is recorded. History is read-only.",
    ),
  );
  if (detail) shell.append(help);
  paint();
  let request = 0;
  async function load() {
    const token = ++request,
      current = generation;
    status(feedback, "Loading history…");
    retry.hidden = true;
    try {
      const result = await api(
        "/api/habits/history?habitId=" + h.habit_id + "&start=" + dates[0] + "&end=" + state.today,
      );
      if (token !== request || current !== generation || !shell.isConnected) return;
      if (
        result.habit.habit_id != h.habit_id ||
        result.startDate !== dates[0] ||
        result.endDate !== state.today
      )
        throw Error("History date mismatch.");
      paint(result.records, result.versions, true);
      status(feedback, result.records.length ? "" : "No check-ins recorded.");
    } catch (e) {
      if (token !== request || current !== generation || !shell.isConnected) return;
      paint();
      status(feedback, "History unavailable. " + e.message);
      retry.hidden = false;
    }
  }
  queueMicrotask(load);
  return shell;
}
function details(h, selected = state.today) {
  const box = node(
      "div",
      {},
      node(
        "p",
        { class: "workspace-muted" },
        scheduleLabel(h) + (h.target ? " · " + h.target + " " + h.unit + " per scheduled day" : ""),
      ),
      node("p", {}, h.description || ""),
    ),
    scroll = node("div", { class: "heatmap-detail" });
  scroll.append(history(h, 52, true, selected));
  box.append(
    scroll,
    node(
      "p",
      { class: "workspace-muted" },
      "Historical check-ins are read-only. Editing a habit changes today and future requirements.",
    ),
    node(
      "div",
      { class: "recurring-actions" },
      button("Edit habit", () => habitEditor(h)),
      button(
        h.archived_on ? "Restore" : "Archive",
        () =>
          confirmAction(
            h.archived_on ? "Restore habit" : "Archive habit",
            "Recorded history is preserved. Today’s requirements will update.",
            async () => {
              await api("/api/habits/archive", { habit_id: h.habit_id, archived: !h.archived_on });
              notifyChange();
              await loadHabits();
            },
          ),
        true,
      ),
      button(
        "Delete",
        () =>
          confirmAction(
            "Delete habit",
            "This permanently deletes the habit and its check-in records. Closed universal streak snapshots remain unchanged. Archive instead to preserve the habit history.",
            async () => {
              await api("/delete-habit", { habit_id: h.habit_id });
              notifyChange();
              await loadHabits();
            },
          ),
        true,
      ),
    ),
  );
  box.classList.add("habit-card");
  box.dataset.color = habitAccent(h, state?.categories);
  modal(h.habit_name, box);
}
function renderHabits() {
  if (!state) return;
  $("#streak-start").hidden =
    state.streak.status === "available" || state.streak.reason === "timezone-review-required";
  const due = state.habits.filter((h) => h.due_today && !h.archived_on),
    completed = due.filter((h) => h.completed);
  $("#habit-summary").textContent = completed.length + "/" + due.length;
  $("#habit-summary-context").textContent = due.length - completed.length + " remaining today";
  const p = due.length ? (completed.length / due.length) * 100 : 0;
  $("#habit-completion-rate").textContent = due.length ? Math.round(p) + "%" : "Unavailable";
  $("#habit-completion-rate").dataset.state = due.length ? "ready" : "unavailable";
  $("#habit-summary-meter span").style.width = p + "%";
  $("#habit-summary-meter").setAttribute("aria-valuenow", Math.round(p));
  $("#habit-summary-meter").removeAttribute("aria-valuetext");
  $("#habit-streak").textContent = state.streak.status === "available" ? state.streak.count : "—";
  $("#habit-streak").dataset.state = state.streak.status === "available" ? "ready" : "unavailable";
  $("#habit-streak-context").textContent =
    state.streak.status === "available"
      ? ""
      : state.streak.reason === "timezone-review-required"
        ? "Streak tracking needs a timezone review before it can continue."
        : "Start tracking from today without changing earlier records.";
  const items = state.habits.filter((h) => !h.archived_on);
  const width = $("#habit-list").clientWidth,
    cardWidth = innerWidth > 860 ? (width - 14) / 2 : width,
    weeks = Math.max(8, Math.min(20, Math.floor((cardWidth - 56) / 19))),
    cellSize = Math.max(10, Math.min(28, Math.floor((cardWidth - 56 - (weeks - 1) * 3) / weeks)));
  $("#habit-list").replaceChildren(
    ...items.map((h) => {
      const card = node("article", {
          class: "workspace-card habit-card",
          "data-color": habitAccent(h, state.categories),
          "data-habit": h.habit_id,
        }),
        control = node(
          "button",
          {
            class: "habit-complete",
            type: "button",
            "aria-label": h.target
              ? "Record progress for " + h.habit_name
              : "Complete or undo " + h.habit_name,
            "aria-pressed": !!h.completed,
            onclick: () => toggle(h, control),
          },
          h.completed ? "✓" : h.target ? "+" : "○",
        );
      control.disabled = !h.due_today || !!h.archived_on;
      card.style.setProperty("--heat-cell", cellSize + "px");
      card.append(
        ...[
          node(
            "div",
            { class: "workspace-topline" },
            node(
              "div",
              { class: "habit-title" },
              habitIcon(h.icon),
              node(
                "div",
                {},
                node("h2", {}, h.habit_name),
                h.description ? node("p", { class: "workspace-muted" }, h.description) : null,
              ),
            ),
            control,
          ),
          h.target
            ? node(
                "p",
                { class: "workspace-muted" },
                (h.progress_amount ?? 0) + " / " + h.target + " " + h.unit + " today",
              )
            : null,
          history(h, weeks),
          node(
            "div",
            { class: "habit-card-footer" },
            node(
              "span",
              { class: "habit-schedule", title: h.category || "Uncategorized" },
              scheduleLabel(h),
            ),
            node(
              "button",
              {
                type: "button",
                class: "workspace-button secondary habit-details",
                onclick: () => details(h),
              },
              "View history ↗",
            ),
          ),
        ].filter(Boolean),
      );
      return card;
    }),
  );
  if (!items.length)
    $("#habit-list").append(
      node(
        "p",
        { class: "workspace-empty" },
        "No habits in this view. Create a habit or explore the preset library.",
      ),
    );
}
function presets() {
  if (!state) return;
  const box = node("div");
  for (const [category, presets] of Object.entries(state.presets)) {
    box.append(node("h3", {}, category));
    for (const preset of presets) {
      const matching = state.habits.filter((h) => h.habit_name === preset.name),
        saved = matching.length > 0,
        action = button(
          saved ? "Remove" : "Add",
          () => {
            if (saved)
              confirmAction(
                "Remove preset habit",
                "Remove this saved preset and its check-ins? Archive from habit details to keep history.",
                async () => {
                  await api("/api/presets/remove", { name: preset.name });
                  notifyChange();
                  await loadHabits();
                },
              );
            else habitEditor({ name: preset.name, category });
          },
          true,
        );
      box.append(
        node(
          "div",
          { class: "recurring-row" },
          node("span", {}, preset.displayName || preset.name),
          action,
        ),
      );
    }
  }
  modal("Explore presets", box);
}
export async function loadHabits() {
  const token = ++generation;
  status("#habits-status", "Loading habits…");
  $("#habits-retry").hidden = true;
  try {
    const result = await api("/api/habits");
    if (token !== generation) return;
    if (!Array.isArray(result.habits) || !result.today) throw Error("Invalid habits response.");
    state = result;
    renderHabits();
    status("#habits-status", "");
  } catch (e) {
    if (token !== generation) return;
    $("#habit-list").replaceChildren();
    $("#habit-summary").textContent = "—";
    $("#habit-streak").textContent = "—";
    $("#habit-summary-context").textContent = "Progress unavailable.";
    $("#habit-streak-context").textContent = "Streak unavailable.";
    $("#habit-summary-meter span").style.width = "0%";
    $("#habit-summary-meter").removeAttribute("aria-valuenow");
    $("#habit-summary-meter").setAttribute("aria-valuetext", "Unavailable");
    status("#habits-status", e.message, true);
    $("#habits-retry").hidden = false;
  }
}
export function initHabits() {
  if (initialized) return;
  initialized = true;
  const streakInfoButton = $("#habit-streak-info-button"),
    streakInfoText = $("#habit-streak-info-text");
  const showStreakInfo = () => { streakInfoText.hidden = false; };
  const hideStreakInfo = () => { streakInfoText.hidden = true; };
  streakInfoButton.addEventListener("focus", showStreakInfo);
  streakInfoButton.addEventListener("blur", hideStreakInfo);
  streakInfoButton.addEventListener("click", showStreakInfo);
  streakInfoButton.parentElement.addEventListener("mouseenter", showStreakInfo);
  streakInfoButton.parentElement.addEventListener("mouseleave", () => {
    if (document.activeElement !== streakInfoButton) hideStreakInfo();
  });
  streakInfoButton.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { hideStreakInfo(); event.stopPropagation(); }
  });
  bindWorkspaceRefresh(loadHabits, localDay);
  $("#streak-start").addEventListener("click", () =>
    confirmAction(
      "Start universal streak tracking",
      "Track from today in Asia/Dhaka. A completed scheduled day earns one day; an incomplete closed day or a day with no required habits resets the streak. Old records will not be reconstructed.",
      async () => {
        await api("/api/habits/streak/start", { confirm: true });
        notifyChange();
        await loadHabits();
      },
    ),
  );
  $("#habit-new").addEventListener("click", () => habitEditor());
  $("#habits-retry").addEventListener("click", loadHabits);
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!document.querySelector(".workspace-dialog")) renderHabits();
    }, 200);
  });
  window.addEventListener("focus", () => {
    if (!document.querySelector(".workspace-dialog")) loadHabits();
  });
  loadHabits();
}
