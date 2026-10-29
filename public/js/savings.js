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
  status,
  notifyChange,
  bindWorkspaceRefresh,
  localDay,
  iconButton,
  modal,
  optionalDateField,
  animateValues,
  cancelMetric,
  replaceList,
} from "./workspace.js";
let goals = [],
  request = 0,
  initialized = false,
  goalFilter = "active";
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
      optionalDateField("Target date", "deadline", goal.deadline),
    ],
    async (values) => {
      await api("/api/goals/save", { ...values, goal_id: goal.goal_id });
      notifyChange();
      await loadSavings();
    },
    { submit: goal.goal_id ? 'Save goal' : 'Create goal' },
  );
}
function contribute(goal) {
  editor(
    "Add savings · " + goal.name,
    [
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
    { submit: "Add savings" },
  );
}
function goalVisualization(goal) {
  const percent = Math.min(100, Math.max(0, amountCents(goal.saved_amount) / amountCents(goal.target_amount) * 100));
  const track = node('span', {class:'workspace-meter', 'aria-hidden':'true'}, node('span'));
  track.firstChild.style.width = percent + '%';
  return node('div', {
    class:'goal-linear', role:'progressbar',
    'aria-label':goal.name + ' savings progress',
    'aria-valuemin':0, 'aria-valuemax':100, 'aria-valuenow':Math.round(percent),
  }, node('strong', {}, Math.round(percent) + '%'), track);
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
  const totalFormat = value => 'Tk '+new Intl.NumberFormat('en-BD',{maximumFractionDigits:0}).format(value);
  $('#savings-total').setAttribute('aria-label',totalFormat(summary.totalCents/100));
  animateValues($('#savings-total'),'savings-total',{value:summary.totalCents/100},frame=>$('#savings-total').textContent=totalFormat(frame.value));
  const items = goals.filter((g) =>
    filter === "archived"
      ? g.archived
      : !g.archived &&
        (filter !== "completed" || amountCents(g.saved_amount) >= amountCents(g.target_amount)),
  );
  replaceList($("#goals-list"), items.map((goal, index) => {
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
          { class: "goal-details" },
          node("h2", {}, goal.name),
          node("p", { class: "goal-amount" }, node('span',{class:'goal-saved-amount'},money(goal.saved_amount)), " ",
            node("span", { class: "workspace-muted" }, "of " + money(goal.target_amount))),
        ),
        goalVisualization(goal),
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
        node(
          "div",
          { class: "goal-actions" },
          !goal.archived
            ? button("+ Add savings", () => contribute(goal))
            : button("Restore goal", () => archive.click(), true),
        ),
      );
      return card;
    }), 'data-goal',
  );
  items.forEach(goal=>{
    const card=$('#goals-list').querySelector('[data-goal="'+goal.goal_id+'"]'), saved=Number(goal.saved_amount),percent=Math.min(100,saved/Number(goal.target_amount)*100);
    const savedNode=card.querySelector('.goal-saved-amount'),percentage=card.querySelector('.goal-linear strong'),fill=card.querySelector('.workspace-meter>span');
    savedNode.setAttribute('aria-label',money(saved));
    animateValues(card,'goal:'+goal.goal_id,{saved,percent},frame=>{
      savedNode.textContent=money(frame.saved);
      percentage.textContent=Math.round(frame.percent)+'%';
      fill.style.width=frame.percent+'%';
    });
  });
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
    cancelMetric('savings-total');goals.forEach(goal=>cancelMetric('goal:'+goal.goal_id));goals=[];
    $('#savings-total').removeAttribute('aria-label');
    $("#savings-total").textContent = "—";
    $("#goals-list").replaceChildren();
    status("#savings-status", e.message, true);
    $("#savings-retry").hidden = false;
  }
}
export function initSavings() {
  if (initialized) return;
  initialized = true;
  bindSegments("#goals-filter", () => goalFilter, value => { goalFilter = value; });
  bindWorkspaceRefresh(loadSavings, localDay);
  $("#goal-new").addEventListener("click", () => editGoal());
  $("#savings-retry").addEventListener("click", loadSavings);
  loadSavings();
}
