export const $ = (s) => document.querySelector(s);
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
    prior = document.body.style.overflow;
  const dialog = node("dialog", {
      class: "workspace-dialog",
      "aria-labelledby": "workspace-dialog-title",
    }),
    close = button("Close ×", () => dialog.close(), true);
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
      document.body.style.overflow = prior;
      if (dock) dock.inert = oldInert;
      onClose?.();
      dialog.remove();
      if (activeDialog === dialog) activeDialog = null;
      (opener?.isConnected ? opener : document.querySelector(".workspace-header button"))?.focus();
    };
  dialog.close = () => {
    if (disposed || closeTimer) return;
    dialog.classList.add("closing");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) nativeClose();
    else closeTimer = setTimeout(nativeClose, 180);
  };
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    dialog.close();
  });
  dialog.dispose = () => {
    nativeClose();
    cleanup();
  };
  dialog.addEventListener("close", cleanup, { once: true });
  dialog.showModal();
  content.querySelector("input,select,button")?.focus();
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
  let last = day();
  const safe = () => {
    if (!document.querySelector(".workspace-dialog")) refresh();
  };
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
