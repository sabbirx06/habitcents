import {
  $,
  node,
  api,
  money,
  amountCents,
  button,
  field,
  editor,
  confirmAction,
  ring,
  status,
  notifyChange,
  bindWorkspaceRefresh,
  moneyFigure,
  localDay,
  iconButton,
  modal,
} from "./workspace.js";
let goals = [],
  request = 0,
  initialized = false,
  goalFilter = "active",
  goalView = "circular";
try { goalView = localStorage.getItem("habitcents-goal-view") === "linear" ? "linear" : "circular"; } catch {}
export function summarizeGoals(items) {
  const active = items.filter((g) => !g.archived);
  return {
    totalCents: active.reduce((sum, g) => sum + amountCents(g.saved_amount), 0),
    count: active.length,
  };
}
function editGoal(goal = {}) {
  editor(
    goal.goal_id ? "Edit goal" : "New goal",
    [
      field("Goal name", "name", "text", goal.name, { required: "", maxlength: 100 }),
      field("Target · Tk", "target", "number", goal.target_amount, {
        required: "",
        min: ".01",
        step: ".01",
        max: 99999999.99,
      }),
      field("Deadline (optional)", "deadline", "date", goal.deadline),
    ],
    async (values) => {
      await api("/api/goals/save", { ...values, goal_id: goal.goal_id });
      notifyChange();
      await loadSavings();
    },
  );
}
function contribute(goal) {
  editor(
    "Add savings",
    [
      node("p", { class: "full" }, "Contribution to ", node("strong", {}, goal.name)),
      field("Amount · Tk", "amount", "number", "", {
        required: "",
        min: ".01",
        step: ".01",
        max: 99999999.99,
      }),
    ],
    async (values) => {
      await api("/api/goals/contribute", { goal_id: goal.goal_id, amount: values.amount });
      notifyChange();
      await loadSavings();
    },
    { submit: "Confirm contribution" },
  );
}
function goalVisualization(goal) {
  const progress = ring(goal.saved_amount, goal.target_amount, goal.name);
  if (goalView === 'linear') {
    progress.className = 'goal-linear';
    const percent = parseFloat(progress.querySelector('.arc').style.strokeDasharray);
    progress.querySelector('svg').remove();
    const track = node('span', {class:'workspace-meter', 'aria-hidden':'true'}, node('span'));
    track.firstChild.style.width = percent + '%';
    progress.append(track);
  }
  return progress;
}
function bindSegments(selector, current, change) {
  const controls = [...$(selector).querySelectorAll('button')];
  const select = value => {
    change(value);
    controls.forEach(control => control.setAttribute('aria-pressed', String(control.dataset.value === current())));
    render();
  };
  controls.forEach((control,index) => {
    control.setAttribute('aria-pressed', String(control.dataset.value === current()));
    control.addEventListener('click', () => select(control.dataset.value));
    control.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % controls.length;
      if (event.key === 'ArrowLeft') next = (index + controls.length - 1) % controls.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = controls.length - 1;
      if (next === undefined) return;
      event.preventDefault(); controls[next].focus(); select(controls[next].dataset.value);
    });
  });
}
function render() {
  const filter = goalFilter,
    summary = summarizeGoals(goals);
  $("#savings-total").replaceChildren(moneyFigure(summary.totalCents / 100));
  $("#savings-count").textContent =
    summary.count + " active goal" + (summary.count === 1 ? "" : "s");
  $("#savings-count").title = "Completed goals remain active until archived";
  const items = goals.filter((g) =>
    filter === "archived"
      ? g.archived
      : !g.archived &&
        (filter !== "completed" || amountCents(g.saved_amount) >= amountCents(g.target_amount)),
  );
  $("#goals-list").replaceChildren(
    ...items.map((goal, index) => {
      const complete = amountCents(goal.saved_amount) >= amountCents(goal.target_amount),
        card = node("article", { class: "workspace-card goal-card", "data-goal": goal.goal_id });
      card.dataset.color = ["blue", "pink", "lime"][index % 3];
      const archive = button(
        goal.archived ? "Restore" : "Archive",
        () =>
          confirmAction(
            goal.archived ? "Restore goal" : "Archive goal",
            "Your saved amount will be preserved.",
            async () => {
              await api("/api/goals/archive", { goal_id: goal.goal_id, archived: !goal.archived });
              notifyChange();
              await loadSavings();
            },
          ),
        true,
      );
      card.append(
        node(
          "div",
          { class: "workspace-topline" },
          node("h2", {}, goal.name),
          iconButton("Manage " + goal.name, () =>
            modal(
              goal.name,
              node(
                "div",
                { class: "goal-management" },
                node(
                  "p",
                  { class: "workspace-muted" },
                  goal.archived ? "Archived" : complete ? "Completed" : "Active",
                ),
                goal.deadline ? node("p", {}, "Deadline: " + goal.deadline) : null,
                button("Edit", () => editGoal(goal), true),
                archive,
              ),
            ),
          ),
        ),
        goalVisualization(goal),
        node(
          "div",
          { class: "goal-main" },
          node(
            "div",
            {},
            node("p", { class: "goal-amount" }, money(goal.saved_amount)),
            node("p", { class: "workspace-muted" }, "of " + money(goal.target_amount)),
          ),
        ),
        node(
          "div",
          { class: "recurring-actions" },
          !goal.archived
            ? button("+ Add savings", () => contribute(goal))
            : button("Restore goal", () => archive.click(), true),
        ),
      );
      return card;
    }),
  );
  if (!items.length)
    $("#goals-list").append(
      node(
        "p",
        { class: "workspace-empty" },
        filter === "archived"
          ? "No archived goals."
          : filter === "completed"
            ? "No completed goals yet."
            : "No goals yet. Create your first goal.",
      ),
    );
}
export async function loadSavings() {
  const token = ++request;
  status("#savings-status", "Loading goals…");
  $("#savings-retry").hidden = true;
  try {
    const data = await api("/api/goals");
    if (token !== request) return;
    if (!Array.isArray(data.goals)) throw Error("Invalid goals response.");
    for (const g of data.goals) {
      amountCents(g.saved_amount);
      if (amountCents(g.target_amount) <= 0) throw Error("Goal target unavailable.");
    }
    goals = data.goals;
    render();
    status("#savings-status", "");
  } catch (e) {
    if (token !== request) return;
    $("#savings-total").textContent = "—";
    $("#savings-count").textContent = "";
    $("#goals-list").replaceChildren();
    status("#savings-status", e.message, true);
    $("#savings-retry").hidden = false;
  }
}
export function initSavings() {
  if (initialized) return;
  initialized = true;
  bindSegments("#goals-filter", () => goalFilter, value => { goalFilter = value; });
  bindSegments("#goals-view", () => goalView, value => {
    goalView = value;
    try { localStorage.setItem("habitcents-goal-view", value); } catch {}
  });
  bindWorkspaceRefresh(loadSavings, localDay);
  $("#goal-new").addEventListener("click", () => editGoal());
  $("#savings-retry").addEventListener("click", loadSavings);
  window.addEventListener("focus", () => {
    if (!document.querySelector(".workspace-dialog")) loadSavings();
  });
  loadSavings();
}
