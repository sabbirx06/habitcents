export const $ = (s) => document.querySelector(s);
export function animateValues(owner, key, target, paint, options) {
  if (globalThis.HabitMotion) globalThis.HabitMotion.values(owner, key, target, paint, options);
  else paint(target);
}
export function cancelMetric(key) { globalThis.HabitMotion?.cancel(key); }
export function replaceList(container, children, attribute) {
  if (globalThis.HabitMotion) globalThis.HabitMotion.replace(container, children, attribute);
  else container.replaceChildren(...children);
}
export function moneyMetric(owner, key, value) {
  owner.setAttribute('aria-label', money(value));
  animateValues(owner, key, { value }, frame => owner.replaceChildren(moneyFigure(frame.value)));
}
export const money = (value) =>
  "Tk " +
  new Intl.NumberFormat("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(value),
  );
export function moneyFigure(value) {
  const [integer, decimals] = new Intl.NumberFormat("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(Number(value))
    .split(".");
  return node(
    "span",
    { class: "workspace-money" },
    node("span", { class: "figure-currency" }, "Tk "),
    node("span", {}, integer),
    node("span", { class: "figure-decimals" }, "." + decimals),
  );
}
export function amountCents(value) {
  const raw = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw Error("Invalid financial data.");
  const [a, b = ""] = raw.split("."),
    v = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(v)) throw Error("Financial amount is out of range.");
  return v;
}
export const localDay = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function node(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") n.className = value;
    else if (key.startsWith("on")) n.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) n.setAttribute(key, String(value));
  }
  for (const child of children.flat())
    if (child != null)
      n.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return n;
}
export async function api(url, body) {
  const r = await fetch(
    url,
    body === undefined
      ? { headers: { Accept: "application/json" } }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (r.redirected) throw Error("Your session has expired. Sign in again.");
  let data;
  try {
    data = await r.json();
  } catch {
    throw Error("The server did not return valid data.");
  }
  if (!r.ok) throw Error(data.error || "Request failed. Please try again.");
  return data;
}
export function status(target, message, error = false) {
  const n = typeof target === "string" ? $(target) : target;
  if (!n) return;
  n.textContent = message;
  n.classList.toggle("error", error);
}
export const button = (label, action, secondary = false) =>
  node(
    "button",
    {
      type: "button",
      class: "workspace-button" + (secondary ? " secondary" : ""),
      onclick: action,
    },
    label,
  );
export function field(label, name, type = "text", value = "", attrs = {}) {
  const input = node("input", { name, type, value: value ?? "", ...attrs });
  return node("label", {}, node("span", { class: "workspace-label" }, label), input);
}
export function selectField(label, name, options, value) {
  const select = node("select", { name });
  for (const [key, title] of options)
    select.append(
      node(
        "option",
        { value: key, ...(String(key) === String(value) ? { selected: "" } : {}) },
        title,
      ),
    );
  return node("label", {}, node("span", { class: "workspace-label" }, label), select);
}
// Native radio groups keep browser keyboard behavior and persist through FormData.
export function choiceField(label, name, options, value, variant = 'segments') {
  return node('fieldset', { class: 'choice-field full ' + variant },
    node('legend', { class: 'workspace-label' }, label),
    node('div', { class: 'choice-options' }, options.map(([key, title, visual]) => {
      const input = node('input', { type: 'radio', name, value: key, ...(String(key) === String(value) ? { checked: '' } : {}) });
      const decoration = visual?.render ? visual.render() : visual?.icon ? globalThis.HabitIcons?.svg(visual.icon) : null;
      const swatch = visual?.color ? node('span', { class: 'color-swatch', 'aria-hidden': 'true' }) : null;
      if (swatch) swatch.style.background = visual.color;
      return node('label', {}, input, decoration, swatch, node('span', {}, title));
    })));
}
let calendarSerial = 0;
export function calendarField(label, name, value = '', attrs = {}) {
  const id = 'form-calendar-' + ++calendarSerial;
  const input = node('input', { type: 'date', name, value: value || '', ...attrs });
  input.id=id+'-input';
  const trigger = button('▦', () => open(), true);
  trigger.className = 'calendar-trigger';
  const calendarIcon=document.createElementNS('http://www.w3.org/2000/svg','svg'),calendarPath=document.createElementNS('http://www.w3.org/2000/svg','path');
  calendarIcon.setAttribute('viewBox','0 0 24 24');calendarIcon.setAttribute('aria-hidden','true');calendarIcon.setAttribute('focusable','false');calendarPath.setAttribute('d','M5 5h14a1 1 0 011 1v14H4V6a1 1 0 011-1zM4 10h16M8 3v4m8-4v4');calendarIcon.append(calendarPath);trigger.replaceChildren(calendarIcon);
  trigger.setAttribute('aria-label', 'Choose ' + label.toLowerCase()); trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', id);
  const popup = node('div', { id, class: 'date-popover', popover: 'auto', role: 'dialog', 'aria-label': label + ' calendar' });
  const heading = node('strong', { id: id + '-month', 'aria-live': 'polite' });
  const grid = node('div', { class: 'calendar-grid', role: 'grid', 'aria-labelledby': id + '-month' });
  let focused = value || localDay();
  const addDays = (day, count) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0,10); };
  const monthMove = count => { const d = new Date(focused + 'T12:00:00Z'), date = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + count); const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1,0)).getUTCDate(); d.setUTCDate(Math.min(date,end)); focused = d.toISOString().slice(0,10); draw(true); };
  const hide = () => { popup.hidePopover?.(); trigger.setAttribute('aria-expanded','false'); trigger.focus(); };
  const choose = date => { input.value = date; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); hide(); };
  function draw(focus = false) {
    const first = focused.slice(0,7) + '-01', offset = (new Date(first + 'T12:00Z').getUTCDay()+6)%7, start = addDays(first,-offset);
    heading.textContent = displayDate(first,{month:'long',year:'numeric'});
    const rows = [node('div',{class:'calendar-weekdays',role:'row'},['M','T','W','T','F','S','S'].map((day,i)=>node('span',{role:'columnheader','aria-label':['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]},day)))];
    for(let week=0;week<6;week++) rows.push(node('div',{role:'row'},Array.from({length:7},(_,i)=>{
      const day = addDays(start,week*7+i), control = node('button',{type:'button',role:'gridcell','data-calendar-date':day,tabindex:day===focused?0:-1,'aria-label':displayDate(day),'aria-selected':day===input.value,'data-outside':day.slice(0,7)!==focused.slice(0,7),...(day===localDay()?{'aria-current':'date'}:{}),onclick:()=>choose(day)},Number(day.slice(-2)));
      control.disabled = !!(attrs.min && day < attrs.min || attrs.max && day > attrs.max);
      return control;
    })));
    grid.replaceChildren(...rows);
    if(focus) grid.querySelector('[data-calendar-date="'+focused+'"]')?.focus();
  }
  popup.append(node('div',{class:'calendar-heading'},button('←',()=>monthMove(-1),true),heading,button('→',()=>monthMove(1),true)),grid,node('div',{class:'calendar-actions'},button('Today',()=>choose(localDay()),true),...(!attrs.required?[button('Clear',()=>choose(''),true)]:[])));
  popup.querySelector('.calendar-heading button').setAttribute('aria-label','Previous month');
  popup.querySelector('.calendar-heading button:last-child').setAttribute('aria-label','Next month');
  grid.addEventListener('keydown',event=>{
    if(event.key==='Enter'||event.key===' '){
      const day=event.target.closest('button[data-calendar-date]');
      if(day&&!day.disabled){event.preventDefault();choose(day.dataset.calendarDate);}return;
    }
    const steps={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
    if(event.key in steps) focused=addDays(focused,steps[event.key]);
    else if(event.key==='Home') focused=addDays(focused,-((new Date(focused+'T12:00Z').getUTCDay()+6)%7));
    else if(event.key==='End') focused=addDays(focused,6-(new Date(focused+'T12:00Z').getUTCDay()+6)%7);
    else if(event.key==='PageUp'||event.key==='PageDown'){event.preventDefault();monthMove(event.key==='PageUp'?-1:1);return;}
    else return;
    if(attrs.min && focused<attrs.min)focused=attrs.min;
    if(attrs.max && focused>attrs.max)focused=attrs.max;
    event.preventDefault(); draw(true);
  });
  popup.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide();}});
  const position = () => { const r = trigger.getBoundingClientRect(); popup.style.left = Math.max(8,Math.min(r.right-310,innerWidth-318))+'px';popup.style.top = Math.max(8,Math.min(r.bottom+6,innerHeight-popup.offsetHeight-8))+'px'; };
  popup.addEventListener('toggle',event=>{const isOpen=event.newState==='open';trigger.setAttribute('aria-expanded',isOpen);if(isOpen){position();window.addEventListener('resize',position);}else window.removeEventListener('resize',position);});
  function open() { if(!popup.showPopover){try{input.showPicker?.();}catch{input.focus();}return;} focused=input.value||localDay();draw();popup.showPopover();position();grid.querySelector('[tabindex="0"]')?.focus(); }
  input.addEventListener('keydown',event=>{if(event.altKey&&event.key==='ArrowDown'){event.preventDefault();open();}});
  return node('div',{class:'calendar-field'},node('label',{for:input.id},node('span',{class:'workspace-label'},label)),node('span',{class:'date-control'},input,trigger),popup);
}
export function optionalDateField(label, name, value) {
  const calendar = calendarField(label,name,value), input=calendar.querySelector('input'), checkbox=node('input',{type:'checkbox',...(value?{checked:''}:{})});
  const sync=()=>{calendar.hidden=!checkbox.checked;input.disabled=!checkbox.checked;};
  checkbox.addEventListener('change',sync);sync();
  return node('div',{class:'optional-field full'},node('label',{class:'toggle-label'},checkbox,'Set a target date'),calendar);
}
export const categories = {
  transport: { name: "Transport", color: "#9ebbd7" },
  food: { name: "Food", color: "#d3a386" },
  subscriptions: { name: "Subscriptions", color: "#b9a3ca" },
  shopping: { name: "Shopping", color: "#a6bda3" },
  uncategorized: { name: "Uncategorized", color: "#b8b6aa" },
};
export const categoryField = (value) =>
  selectField(
    "Category",
    "category",
    Object.entries(categories).map(([id, c]) => [id, c.name]),
    value || "uncategorized",
  );
export function formData(form) {
  return Object.fromEntries(new FormData(form));
}
let activeDialog = null;
export function modal(title, content, { onClose } = {}) {
  if (activeDialog) activeDialog.dispose();
  const opener = document.activeElement,
    prior = document.body.style.overflow,
    priorPadding = document.body.style.paddingRight;
  const originCard=opener?.closest?.('[data-habit],[data-goal],[data-expense]');
  const originKey=originCard ? ['data-habit','data-goal','data-expense'].find(key=>originCard.hasAttribute(key)) : null;
  const originValue=originKey ? originCard.getAttribute(originKey) : null;
  const originIndex=originCard ? [...originCard.querySelectorAll('button')].indexOf(opener) : -1;
  const dialog = node("dialog", {
      class: "workspace-dialog",
      "aria-labelledby": "workspace-dialog-title",
    }),
    close = button("", () => dialog.close(), true);
  close.className = "workspace-dialog-close";
  close.setAttribute("aria-label", "Close");
  const closeIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  closeIcon.setAttribute("viewBox", "0 0 24 24");
  closeIcon.setAttribute("aria-hidden", "true");
  const closePath = document.createElementNS(closeIcon.namespaceURI, "path");
  closePath.setAttribute("d", "M6 6l12 12M6 18L18 6");
  closeIcon.append(closePath);
  close.append(closeIcon);
  dialog.append(
    node(
      "div",
      { class: "workspace-topline" },
      node("h2", { id: "workspace-dialog-title" }, title),
      close,
    ),
    content,
  );
  document.body.append(dialog);
  activeDialog = dialog;
  const dock = $(".nav-dock"),
    oldInert = dock?.inert;
  if (dock) dock.inert = true;
  document.body.style.overflow = "hidden";
  const scrollbar=innerWidth-document.documentElement.clientWidth;
  if(scrollbar>0)document.body.style.paddingRight=scrollbar+'px';
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        dialog.close();
    }
  });
  let disposed = false,
    closeTimer;
  const nativeClose = dialog.close.bind(dialog),
    cleanup = () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(closeTimer);
      globalThis.removeEventListener?.('habitmotionchange', settleClose);
      document.body.style.overflow = prior;
      document.body.style.paddingRight = priorPadding;
      if (dock) dock.inert = oldInert;
      onClose?.();
      for(const popup of dialog.querySelectorAll('[popover]'))if(popup.matches(':popover-open'))popup.hidePopover();
      dialog.remove();
      if (activeDialog === dialog) activeDialog = null;
      const replacement=originKey ? document.querySelector('['+originKey+'="'+originValue+'"]')?.querySelectorAll('button')[originIndex] : null;
      (opener?.isConnected ? opener : replacement || document.querySelector(".workspace-fab, .page-header button, .workspace-header button"))?.focus();
    };
  dialog.close = () => {
    if (disposed || closeTimer) return;
    dialog.classList.add("closing");
    const finish = () => { nativeClose(); cleanup(); };
    if ((globalThis.HabitMotionPreference?.reduced() ?? true)) finish();
    else closeTimer = setTimeout(finish, globalThis.HabitMotion?.timings.layout ?? 220);
  };
  const settleClose = () => {
    if (closeTimer && (globalThis.HabitMotionPreference?.reduced() ?? true)) { nativeClose(); cleanup(); }
  };
  globalThis.addEventListener?.('habitmotionchange', settleClose);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    dialog.close();
  });
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...dialog.querySelectorAll('button,input,select,textarea,summary,a[href],[tabindex]')].filter(control=>{
      if(control.disabled||control.tabIndex<0||!control.getClientRects().length||control.closest('[hidden],[inert]'))return false;
      const closed=control.closest('details:not([open])');
      if(closed&&control!==closed.querySelector('summary'))return false;
      return !control.closest('[popover]:not(:popover-open)');
    });
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  dialog.dispose = () => {
    nativeClose();
    cleanup();
  };
  dialog.addEventListener("close", cleanup, { once: true });
  dialog.showModal();
  (content.querySelector('input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea') || content.querySelector('button'))?.focus();
  return dialog;
}
// Move the existing controls, preserving their values and listeners, into a
// native dialog. Restore them even when another editor replaces that dialog.
export function bindPanel(trigger, selector, title) {
  const panel = $(selector);
  if (!panel || !$(trigger)) return;
  const home = panel.parentNode;
  $(trigger).addEventListener("click", () => {
    panel.hidden = false;
    const content = node("div", { class: "workspace-control-panel" });
    content.append(panel);
    const dialog = modal(title, content, {
      onClose: () => {
        panel.hidden = true;
        home.append(panel);
      },
    });
    content.append(button("Done", () => dialog.close()));
  });
}
export function iconButton(label, action) {
  const control = button("", action, true);
  control.className = "workspace-icon-button";
  control.setAttribute("aria-label", label);
  control.title = label;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const cx of [5, 12, 19]) {
    const dot = document.createElementNS(svg.namespaceURI, "circle");
    for (const [key, value] of Object.entries({ cx, cy: 12, r: 1, fill: "currentColor" }))
      dot.setAttribute(key, value);
    svg.append(dot);
  }
  control.append(svg);
  return control;
}
export function editor(title, fields, onSave, { submit = "Save", extra = [] } = {}) {
  const feedback = node("p", { class: "workspace-status full", role: "status" }),
    save = node("button", { type: "submit", class: "workspace-button" }, submit),
    form = node(
      "form",
      { class: "workspace-form" },
      fields,
      feedback,
      node("div", { class: "full actions" }, extra, save),
    );
  const dialog = modal(title, form);
  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || dialog.classList.contains("closing") || !form.reportValidity()) return;
    busy = true;
    save.disabled = true;
    status(feedback, "Saving…");
    try {
      await onSave(formData(form), form);
      dialog.close();
    } catch (error) {
      status(feedback, error.message, true);
    } finally {
      busy = false;
      save.disabled = dialog.classList.contains("closing");
    }
  });
  return { dialog, form };
}
export function confirmAction(title, message, action) {
  editor(title, [node("p", { class: "full" }, message)], action, { submit: "Confirm" });
}
export function ring(saved, target, name) {
  const valid =
      saved != null &&
      target != null &&
      saved !== "" &&
      target !== "" &&
      Number(saved) >= 0 &&
      Number.isFinite(Number(saved)) &&
      Number.isFinite(Number(target)) &&
      Number(target) > 0,
    percent = valid ? Math.min(100, Math.max(0, (Number(saved) / Number(target)) * 100)) : null;
  const box = node("div", {
    class: "goal-ring",
    role: "progressbar",
    "aria-label": name + " savings progress",
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    ...(valid ? { "aria-valuenow": Math.round(percent) } : { "aria-valuetext": "Unavailable" }),
  });
  const ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  for (const cls of ["track", "arc"]) {
    const c = document.createElementNS(ns, "circle");
    for (const [k, v] of Object.entries({ cx: 50, cy: 50, r: 43, class: cls, pathLength: 100 }))
      c.setAttribute(k, v);
    if (cls === "arc") c.style.strokeDasharray = (percent ?? 0) + " 100";
    svg.append(c);
  }
  box.append(svg, node("strong", {}, valid ? Math.round(percent) + "%" : "—"));
  return box;
}
export function monthShift(month, offset) {
  const [y, m] = month.split("-").map(Number),
    d = new Date(Date.UTC(y, m - 1 + offset, 1, 12));
  return d.toISOString().slice(0, 7);
}
export function monthDays(month) {
  const [y, m] = month.split("-").map(Number),
    last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => month + "-" + String(i + 1).padStart(2, "0"));
}
export function displayDate(day, options = { month: "short", day: "numeric", year: "numeric" }) {
  return new Intl.DateTimeFormat("en", options).format(new Date(day + "T12:00:00"));
}
export function notifyChange() {
  try {
    localStorage.setItem("habitcents-data-updated", String(Date.now()));
  } catch {}
}
export function bindWorkspaceRefresh(refresh, day) {
  let last = day(), timer;
  const safe = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!document.querySelector(".workspace-dialog")) refresh();
    }, 50);
  };
  window.addEventListener("focus", safe);
  window.addEventListener("storage", (e) => {
    if (e.key === "habitcents-data-updated") safe();
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) safe();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") safe();
  });
  setInterval(() => {
    const current = day();
    if (current !== last) {
      last = current;
      safe();
    }
  }, 60000);
}
