import {
  $,
  node,
  api,
  localDay,
  button,
  field,
  editor,
  confirmAction,
  modal,
  status,
  displayDate,
  notifyChange,
  bindWorkspaceRefresh,
  choiceField,
  selectField,
  durationField,
  disclosure,
  animateValues,
  cancelMetric,
  replaceList,
} from "./workspace.js";
let state = null,
  generation = 0,
  initialized = false,
  resizeTimer;
const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const names = () => globalThis.HabitCentsPreferences?.get().week === 'sunday' ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : weekdayNames;
export function shiftDay(day, count) {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function heatmapDates(end, weeks) {
  const weekday = new Date(end + "T12:00:00Z").getUTCDay(),
    offset = globalThis.HabitCentsPreferences?.get().week === 'sunday' ? weekday : (weekday + 6) % 7,
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
    else if (available && createdOn && versions.length && day < versions[0].effective_on) state = 'not-started';
    else if (available && version?.recurrence?.mode === 'quota') state = record?.completed_status || Number(record?.progress_amount)>0 ? 'activity' : 'rest';
    else if (available && record?.completed_status) state = "completed";
    else if (available && Number(record?.progress_amount) > 0) state = "partial";
    else if (available && version && (version.archived || (version.recurrence ? !globalThis.HabitRecurrence?.due(version,day) : !version.schedule_days.includes(weekday))))
      state = "rest";
    else if (available && version && day < today) state = "missed";
    return { date: day, state, record, target: version?.target, unit: version?.unit };
  });
}
function habitIcon(icon) {
  if (globalThis.HabitIcons) return globalThis.HabitIcons.tile(icon);
  const paths = {
    check: "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
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
  path.setAttribute("d", paths[icon] || paths.focus);
  svg.append(path);
  box.append(svg);
  return box;
}
function scheduleLabel(h) {
  if(h.recurrence)return globalThis.HabitRecurrence?.label(h)||h.recurrence.frequency;
  const days = h.schedule_days || [1, 2, 3, 4, 5, 6, 7];
  return days.length === 7 ? "Every day" : days.map((d) => weekdayNames[d - 1]).join(", ");
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
        step: h.tracking === 'count' ? '1' : '.01',
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
    { submit: 'Record progress' },
  );
}
async function toggle(h, control) {
  if (h.tracking !== 'checkoff' && h.target != null) return progressEditor(h);
  const before = h.completed;
  const restoreFocus = document.activeElement === control;
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
    const replacement=document.querySelector('[data-habit="'+h.habit_id+'"] .habit-complete');
    if(restoreFocus)replacement?.focus();
    if(!before) globalThis.HabitMotion?.pop(replacement);
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
  const original = h;
  h = h.pending ? {...h,...h.pending,habit_id:h.habit_id,habit_name:h.habit_name} : h;
  const name = field("Habit name", "name", "text", h.habit_name || h.name, {
      required: "",
      maxlength: 255,
    }),
    description = field("Description (optional)", "description", "text", h.description, {
      maxlength: 1000,
    }),
    category = field("Category (optional)", "category", "text", h.category, { maxlength: 50 }),
    icon = choiceField(
      "Icon",
      "icon",
      [
        ["check", "Spark", { icon: "check" }],
        ["book", "Book", { icon: "book" }],
        ["walk", "Movement", { icon: "walk" }],
        ["water", "Water", { icon: "water" }],
        ["leaf", "Nature", { icon: "leaf" }],
        ["focus", "Focus", { icon: "focus" }],
      ],
      h.icon || "focus",
      'icon-choices',
    ),
    color = choiceField(
      "Color",
      "color",
      [
        ["lavender", "Lavender", { color: '#e0cfe0' }],
        ["blue", "Blue", { color: '#c5d4e7' }],
        ["lime", "Lime", { color: '#d6df9c' }],
        ["peach", "Peach", { color: '#ead4c3' }],
        ["pink", "Pink", { color: '#e5cde2' }],
      ],
      habitAccent(h, state?.categories),
      'color-choices',
    );
  const days = node(
      "fieldset",
      { class: "full schedule-days" },
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
        weekdayNames[i - 1],
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
  const R=globalThis.HabitRecurrence;
  const target = field('Daily target','target','number',h.target||1,{min:'.01',max:99999999.99,step:'.01',required:''});
  const unit = field('Unit','unit','text',h.unit||'times',{maxlength:40,required:''});
  const tracking = choiceField('Track by','tracking',[['checkoff','Check-off'],['count','Count'],['measure','Measure']],h.tracking||(h.target==null?'checkoff':'measure'));
  const frequency=h.recurrence?.frequency||(selected.length===7?'daily':'weekdays');
  const repeat=choiceField('Repeat','repeat',[['daily','Every day'],['weekdays','Selected weekdays'],['weekly','Weekly'],['monthly','Monthly'],['yearly','Yearly']],frequency);
  const mode=choiceField('Schedule','schedule_mode',[['quota','Within the period'],['scheduled','On a specific day/date']],h.recurrence?.mode||'quota');
  const weekday=selectField('Due weekday','due_weekday',weekdayNames.map((name,i)=>[i+1,name]),h.recurrence?.weekday||7);
  const anchorDay=field('Day of month','anchor_day','number',h.recurrence?.day||1,{min:1,max:31,step:1,required:''});
  const anchorMonth=selectField('Month','anchor_month',Array.from({length:12},(_,i)=>[i+1,new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2024,i,1)))]),h.recurrence?.month||1);
  const start=choiceField('First quota period','start_choice',[['this','Start this period'],['next','Start next period']],R.activation(state.today,frequency)===state.today?'this':'next');
  const unitKind=selectField('Measure unit','measure_unit',[['minutes','Minutes'],['hours','Hours'],['litres','Litres'],['kilometres','Kilometres'],['custom','Other unit']],!h.unit?'minutes':['minutes','hours','litres','kilometres'].includes(h.unit)?h.unit:'custom');
  const duration=durationField(h.unit==='minutes'?h.target:20,'duration_target');
  const adjustments=node('div',{class:'duration-presets'},button('−',()=>adjust(-1),true),button('+',()=>adjust(1),true));
  function adjust(delta){const input=target.querySelector('input');input.value=String(Math.max(input.min==='1'?1:.01,Math.round((Number(input.value||0)+delta)*100)/100));form.dispatchEvent(new Event('change'));}
  const quantityFields=node('div',{class:'tracking-fields full'},target,adjustments,unit);
  const summary=node('p',{class:'workspace-muted full',role:'status'}),activationNote=node('p',{class:'workspace-muted full'});
  const preview=node('div',{class:'habit-editor-preview full','aria-hidden':'true'});name.classList.add('full');
  const {form}=editor(h.habit_id?'Edit habit':'New habit',[
    name,preview,tracking,unitKind,quantityFields,duration,repeat,mode,days,weekday,anchorDay,anchorMonth,start,activationNote,summary,icon,color,
    disclosure('Description and category',[description,category],!!(h.description||h.category)),
    ...(!h.habit_id&&state?[node('div',{class:'form-preset-row full'},button('Choose a preset',presets,true))]:[]),
  ],async(values,form)=>{
    const frequency=values.repeat,nonDaily=['weekly','monthly','yearly'].includes(frequency),scheduleMode=nonDaily?values.schedule_mode:'scheduled';
    const schedule=frequency==='weekdays'?[...form.querySelectorAll('[name=weekday]:checked')].map(n=>Number(n.value)):[1,2,3,4,5,6,7];
    const measured=values.tracking==='measure',measureUnit=values.measure_unit==='custom'?values.unit:values.measure_unit;
    const payload={...values,habit_id:h.habit_id,schedule_days:schedule,
      target:values.tracking==='checkoff'?'':measured&&measureUnit==='minutes'?values.duration_target:values.target,
      unit:values.tracking==='checkoff'?'':measured?measureUnit:values.unit,
      recurrence:{frequency,mode:scheduleMode,...(scheduleMode==='scheduled'&&frequency==='weekly'?{weekday:Number(values.due_weekday)}:{}),...(scheduleMode==='scheduled'&&['monthly','yearly'].includes(frequency)?{day:Number(values.anchor_day)}:{}),...(scheduleMode==='scheduled'&&frequency==='yearly'?{month:Number(values.anchor_month)}:{})},
    };
    if(state.recurrenceReady===false){delete payload.recurrence;delete payload.tracking;}
    await api('/api/habits/save',payload);notifyChange();await loadHabits();
  },{submit:h.habit_id?'Save habit':'Create habit'});
  const value=name=>form.querySelector('[name="'+name+'"]:checked')?.value||form.querySelector('[name="'+name+'"]')?.value;
  const show=(container,visible)=>{container.hidden=!visible;container.querySelectorAll('input,select').forEach(input=>input.disabled=!visible);};
  let previousFrequency=frequency;
  function sync(){
    const track=value('tracking'),freq=value('repeat'),nonDaily=['weekly','monthly','yearly'].includes(freq),quota=nonDaily&&value('schedule_mode')==='quota';
    const measure=track==='measure',minutes=measure&&value('measure_unit')==='minutes';
    show(unitKind,measure);show(quantityFields,track!=='checkoff'&&!minutes);show(duration,minutes);
    show(unit,track==='count'||measure&&value('measure_unit')==='custom');
    target.querySelector('input').min=track==='count'?'1':'.01';target.querySelector('input').step=track==='count'?'1':'.01';
    target.querySelector('.workspace-label').textContent=({daily:'Daily',weekdays:'Daily',weekly:'Weekly',monthly:'Monthly',yearly:'Yearly'}[freq])+' target';
    show(mode,nonDaily);show(days,freq==='weekdays');show(weekday,nonDaily&&!quota&&freq==='weekly');show(anchorDay,nonDaily&&!quota&&freq!=='weekly');show(anchorMonth,nonDaily&&!quota&&freq==='yearly');show(start,!h.habit_id&&quota);
    anchorDay.querySelector('input').max=freq==='yearly'?R.monthEnd(2024,Number(value('anchor_month'))):31;
    if(!h.habit_id&&quota&&freq!==previousFrequency){form.querySelector('[name=start_choice][value="'+(R.activation(state.today,freq)===state.today?'this':'next')+'"]').checked=true;}previousFrequency=freq;
    const r={frequency:freq,mode:quota?'quota':'scheduled',weekday:Number(value('due_weekday')),day:Number(value('anchor_day')),month:Number(value('anchor_month'))};
    const schedule_days=freq==='weekdays'?[...choices.querySelectorAll('input:checked')].map(n=>Number(n.value)):[1,2,3,4,5,6,7];
    const selectedUnit=measure?(value('measure_unit')==='custom'?value('unit'):value('measure_unit')):value('unit');
    const amount=track==='checkoff'?'once':(minutes?value('duration_target'):value('target'))+' '+(selectedUnit||'units');
    summary.textContent=(name.querySelector('input').value||'Your habit')+' · '+amount+' · '+R.label({recurrence:r,schedule_days})+'. '+(quota?'Flexible quota; excluded from Today’s percentage and the universal streak.':'Participates in Today’s percentage and the universal streak when due.');
    if(quota||h.habit_id&&(R.quota(original)||R.quota(original.pending))){const effective=h.habit_id?R.period(state.today,R.quota(original)?original.recurrence.frequency:freq).next:R.activation(state.today,freq,value('start_choice'));
      activationNote.textContent=(h.habit_id?'Change effective ':'Starts ')+effective+' · deadline '+R.period(effective,freq).end+'. '+(h.habit_id?'The current period’s rule and progress stay unchanged.':effective===state.today?'Full target applies to the remaining period; it is not prorated.':'No requirement or missed status before the start date.');
    }else activationNote.textContent=h.habit_id?'Changes take effect today; closed history keeps its rules.':'Scheduled occurrences begin on or after '+state.today+'.';
    const selectedIcon=value('icon'),selectedColor=value('color');preview.style.setProperty('--habit-tone',{lavender:'#e0cfe0',blue:'#c5d4e7',lime:'#d6df9c',peach:'#ead4c3',pink:'#e5cde2'}[selectedColor]);preview.replaceChildren(habitIcon(selectedIcon),node('span',{},name.querySelector('input').value||'Your habit'));
  }
  if(state.recurrenceReady===false){
    repeat.querySelectorAll('input').forEach(input=>{if(['weekly','monthly','yearly'].includes(input.value))input.disabled=true;});
    tracking.querySelector('[value="count"]').disabled=true;
    form.prepend(node('p',{class:'workspace-muted full'},'Non-daily recurrence and Count tracking require reviewed recurrence storage. Existing daily/weekday settings remain available.'));
  }
  form.addEventListener('change',sync);form.addEventListener('input',sync);sync();
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
      activity: "Recorded quota activity (period fulfilment is shown separately)",
      'not-started': 'Quota has not started; no requirement',
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
      names().map((n, i) => node("span", {}, i % 2 === 0 ? n[0] : "")),
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
      if(detail&&result.periods?.length){
        shell.querySelector('.quota-history')?.remove();
        shell.append(node('div',{class:'quota-history'},node('h3',{},'Quota periods'),...result.periods.map(p=>node('p',{class:'workspace-muted'},p.start+' – '+p.end+' · '+p.achieved+' / '+p.target+' '+(p.unit||'occurrences')+' · '+p.status))));
      }
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
      "Historical check-ins are read-only. Quota edits take effect next period; daily/scheduled edits apply today.",
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
  $('#habit-summary').setAttribute('aria-label',completed.length+' of '+due.length+' habits completed');
  $("#habit-summary-context").textContent = due.length - completed.length + " remaining today";
  const p = due.length ? (completed.length / due.length) * 100 : 0;
  $('#habit-completion-rate').setAttribute('aria-label',due.length ? Math.round(p)+'%' : 'Unavailable');
  animateValues($('#habit-summary'),'habit-summary',{count:completed.length,total:due.length,percent:p},frame=>{
    $('#habit-summary').textContent=Math.round(frame.count)+'/'+Math.round(frame.total);
    $('#habit-summary-meter span').style.width=frame.percent+'%';
    $('#habit-completion-rate').textContent=due.length ? Math.round(frame.percent)+'%' : 'Unavailable';
  },{initial:{total:due.length}});
  $("#habit-completion-rate").dataset.state = due.length ? "ready" : "unavailable";
  $("#habit-summary-meter").setAttribute("aria-valuenow", Math.round(p));
  $("#habit-summary-meter").removeAttribute("aria-valuetext");
  if(state.streak.status === 'available'){
    $('#habit-streak').setAttribute('aria-label',state.streak.count+' days');
    animateValues($('#habit-streak'),'habit-streak',{count:state.streak.count},frame=>$('#habit-streak').textContent=Math.round(frame.count));
  }else{cancelMetric('habit-streak');$('#habit-streak').textContent='—';$('#habit-streak').removeAttribute('aria-label');}
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
  replaceList($("#habit-list"), items.map((h) => {
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
        );
      const completionIcon=globalThis.HabitIcons?.completion();
      if(completionIcon)control.append(completionIcon);
      const icon = habitIcon(h.icon);
      control.disabled = !(h.can_record ?? h.due_today) || !!h.archived_on;
      card.style.setProperty("--heat-cell", cellSize + "px");
      card.append(
        ...[
          node(
            "div",
            { class: "workspace-topline" },
            node(
              "div",
              { class: "habit-title" },
              icon,
              node(
                "div",
                {},
                node("h2", {}, h.habit_name),
                h.description ? node("p", { class: "workspace-muted" }, h.description) : null,
              ),
            ),
            h.period
              ? node('span',{class:'habit-state'},h.period.status === 'complete' ? 'Quota fulfilled' : 'Period quota')
              : h.status === 'not-started'
              ? node('span',{class:'habit-state'},'Not started')
              : h.due_today && h.target
              ? node('span', { class: 'habit-state' }, 'Record progress')
              : !h.due_today
                ? node('span', { class: 'habit-state' }, 'Rest day')
                : null,
            control,
          ),
          h.period
            ? node('p',{class:'workspace-muted'},h.period.achieved+' / '+h.period.target+' '+(h.unit||'occurrences')+' · '+h.period.remaining+' remaining · deadline '+h.period.end)
            : h.target
            ? node(
                "p",
                { class: "workspace-muted" },
                (h.progress_amount ?? 0) + " / " + h.target + " " + h.unit + " today",
              )
            : null,
          h.pending ? node('p',{class:'workspace-muted'},'Pending: '+(h.pending.target??'Check-off')+' '+(h.pending.unit||'')+' · '+scheduleLabel(h.pending)+' · effective '+h.pending.effective_on) : null,
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
    }), 'data-habit',
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
    cancelMetric('habit-summary');cancelMetric('habit-streak');
    state=null;
    $('#habit-completion-rate').textContent='Unavailable';$('#habit-completion-rate').dataset.state='unavailable';$('#habit-completion-rate').setAttribute('aria-label','Unavailable');
    $('#habit-summary').removeAttribute('aria-label');$('#habit-streak').removeAttribute('aria-label');
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
