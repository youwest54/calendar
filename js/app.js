import { categoryMark } from "./icons.js";
import { cleanFamilyCode, createSync, makeFamilyCode, publishOnce, randomSecret, roomFromCode } from "./sync.js";
import { REMINDER_PUBLIC_KEY, VAPID_PUBLIC_KEY } from "./keys.js";

const STORAGE_KEY = "our-agenda-v1";

const CATEGORIES = [
  { id: "doctor", label: "Doctor", color: "#c4492c", group: "Health" },
  { id: "baby-doctor", label: "Baby doctor", color: "#d56a8a", group: "Health" },
  { id: "dentist", label: "Dentist", color: "#3c6fba", group: "Health" },
  { id: "pharmacy", label: "Pharmacy", color: "#1f8a84", group: "Health" },
  { id: "vaccine", label: "Vaccination", color: "#3d8b7a", group: "Health" },
  { id: "midwife", label: "Midwife", color: "#c46b8a", group: "Health" },
  { id: "ultrasound", label: "Ultrasound", color: "#6a8caf", group: "Health" },
  { id: "baby-coming", label: "Baby coming", color: "#e08aa4", group: "Baby & home" },
  { id: "delivery", label: "Delivery", color: "#2f7d6d", group: "Baby & home" },
  { id: "bag", label: "Hospital bag", color: "#a67c52", group: "Baby & home" },
  { id: "prenatal", label: "Prenatal class", color: "#8b5e83", group: "Baby & home" },
  { id: "playdate", label: "Playdate", color: "#d0893a", group: "Baby & home" },
  { id: "school", label: "School", color: "#5b5ea6", group: "Baby & home" },
  { id: "travel", label: "Travel", color: "#c4842a", group: "Going out" },
  { id: "family", label: "Family visit", color: "#8a6240", group: "Going out" },
  { id: "flight", label: "Flight", color: "#2c6e9b", group: "Going out" },
  { id: "hotel", label: "Hotel", color: "#8a6a4a", group: "Going out" },
  { id: "dinner", label: "Dinner", color: "#b85c38", group: "Going out" },
  { id: "birthday", label: "Birthday", color: "#c8962e", group: "Life" },
  { id: "groceries", label: "Groceries", color: "#5a8f4a", group: "Life" },
  { id: "work", label: "Work", color: "#4e5968", group: "Life" },
  { id: "call", label: "Call", color: "#6b7c4a", group: "Life" },
  { id: "car", label: "Car", color: "#5c6b73", group: "Life" },
  { id: "bills", label: "Bills", color: "#8b6914", group: "Life" },
  { id: "haircut", label: "Haircut", color: "#9a6b8a", group: "Life" },
  { id: "sport", label: "Sport", color: "#2f7d4a", group: "Life" },
  { id: "reminder", label: "Reminder", color: "#8d7b6a", group: "Life" }
];

const QUICK_IDS = ["doctor", "baby-doctor", "baby-coming", "delivery", "dentist", "travel", "family", "groceries", "pharmacy"];
const NOTICE_IDS = ["hour", "day", "3day", "week", "month"];
const COLOR_CHOICES = ["#e10600", "#c4492c", "#d56a8a", "#e08aa4", "#d0893a", "#c8962e", "#5a8f4a", "#1f8a84", "#2c6e9b", "#3c6fba", "#5b5ea6", "#8b5e83"];
const STATUS_TEXT = {
  local: "On this phone",
  connecting: "Connecting you both…",
  online: "Shared · both phones",
  offline: "On this phone · sharing paused"
};

const $ = (id) => document.getElementById(id);
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "long" });
const dowFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });
const fullFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });
const shortFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

const now = new Date();
const view = {
  year: now.getFullYear(),
  month: now.getMonth(),
  selected: iso(now),
  filter: "all"
};

let state = loadState();
let draft = null;
let step = 0;
let typePage = 0;
let returnToDay = false;
let toastTimer = 0;
let statusMode = state.roomId ? "connecting" : "local";

const sync = createSync({
  getDoc: currentDoc,
  onRemote: absorb,
  onReady: () => {
    if (state.events.length || state.names.updatedAt) sync.publish();
  },
  onStatus: setStatus
});

function catById(id) {
  return CATEGORIES.find((cat) => cat.id === id) || null;
}

function cleanEnd(date, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end || "") || end <= date) return "";
  return end;
}

function cleanNotices(event) {
  if (Array.isArray(event.notices)) return NOTICE_IDS.filter((id) => event.notices.includes(id));
  if (event.urgent) return ["day", "week", "month"];
  return [];
}

function eventEnd(event) {
  return event.end && event.end > event.date ? event.end : event.date;
}

function cleanColor(value) {
  const color = String(value || "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : "";
}

function eventColor(event) {
  return cleanColor(event.color) || (catById(event.category)?.color || "#8d7b6a").toLowerCase();
}

function colorOptions(event) {
  const typeColor = (catById(event.category)?.color || "#8d7b6a").toLowerCase();
  return [...new Set([typeColor, ...COLOR_CHOICES])];
}

function blankState() {
  return {
    roomId: null,
    key: null,
    code: null,
    deviceId: null,
    names: { me: "Youyou", partner: "Gepo", baby: "Baby", updatedAt: 0 },
    events: [],
    dismissedWelcome: false
  };
}

function loadState() {
  const blank = blankState();
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw || typeof raw !== "object") {
      blank.deviceId = randomSecret(8);
      return blank;
    }
    return {
      roomId: raw.roomId || null,
      key: raw.key || null,
      code: cleanFamilyCode(raw.code).length === 8 ? cleanFamilyCode(raw.code) : null,
      deviceId: raw.deviceId || randomSecret(8),
      names: adoptNames(raw.names),
      events: Array.isArray(raw.events) ? raw.events.map(normalize).filter(Boolean) : [],
      dismissedWelcome: !!raw.dismissedWelcome
    };
  } catch {
    blank.deviceId = randomSecret(8);
    return blank;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    roomId: state.roomId,
    key: state.key,
    code: state.code,
    deviceId: state.deviceId,
    names: state.names,
    events: state.events,
    dismissedWelcome: state.dismissedWelcome
  }));
}

function currentDoc() {
  return {
    v: 1,
    names: { ...state.names },
    events: state.events
      .map((event) => ({ ...event }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  };
}

function commit() {
  saveState();
  render();
  sync.publish();
  scheduleAlerts();
}

function clipName(value, fallback) {
  const text = String(value || "").trim().slice(0, 24);
  return text || fallback;
}

function personName(value, role) {
  const fallback = role === "me" ? "Youyou" : "Gepo";
  const text = clipName(value, fallback);
  if (role === "me" && text === "Me") return "Youyou";
  if (role === "partner" && text === "Wife") return "Gepo";
  return text;
}

function adoptNames(raw) {
  const me = personName(raw?.me, "me");
  const partner = personName(raw?.partner, "partner");
  const previousMe = String(raw?.me || "").trim();
  const previousPartner = String(raw?.partner || "").trim();
  const renamed = previousMe === "Me" || previousPartner === "Wife";
  return {
    me,
    partner,
    baby: clipName(raw?.baby, "Baby"),
    updatedAt: renamed ? Date.now() : (Number(raw?.updatedAt) || 0)
  };
}

function normalize(event) {
  if (!event || typeof event !== "object") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date || "")) return null;
  const category = catById(event.category) ? event.category : "reminder";
  const who = ["me", "partner", "both", "baby"].includes(event.who) ? event.who : "both";
  return {
    id: String(event.id || randomSecret(10)),
    date: event.date,
    time: /^\d{2}:\d{2}$/.test(event.time || "") ? event.time : "",
    title: String(event.title || "Plan").slice(0, 80),
    category,
    who,
    note: String(event.note || "").slice(0, 500),
    color: cleanColor(event.color),
    end: cleanEnd(event.date, event.end),
    notices: cleanNotices(event),
    noticeAt: Number(event.noticeAt) || (!Array.isArray(event.notices) && event.urgent ? (Number(event.urgentAt) || Number(event.updatedAt) || 0) : 0),
    urgent: !!event.urgent,
    urgentAt: event.urgent ? (Number(event.urgentAt) || Number(event.updatedAt) || 0) : 0,
    updatedAt: Number(event.updatedAt) || 0,
    deleted: !!event.deleted
  };
}

function eventSig(list) {
  return list
    .map((event) => [event.id, event.updatedAt, event.deleted ? 1 : 0, event.urgent ? 1 : 0, event.urgentAt || 0, event.noticeAt || 0, (event.notices || []).join(","), event.date, event.end || "", event.time, event.title, event.category, event.who, event.note, event.color].join("|"))
    .sort()
    .join("\n");
}

function mergeEvents(local, remote) {
  const map = new Map();
  for (const event of [...local, ...remote]) {
    const prev = map.get(event.id);
    if (!prev || event.updatedAt > prev.updatedAt || (event.updatedAt === prev.updatedAt && event.deleted && !prev.deleted)) {
      map.set(event.id, event);
    }
  }
  return [...map.values()];
}

function absorb(doc) {
  if (!doc || typeof doc !== "object") return;
  let remoteEvents = Array.isArray(doc.events) ? doc.events.map(normalize).filter(Boolean) : [];
  if (remoteEvents.length > 1000) {
    remoteEvents = remoteEvents.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 1000);
  }
  const merged = mergeEvents(state.events, remoteEvents);
  const remoteNamesAt = Number(doc.names?.updatedAt) || 0;
  const localNamesAt = Number(state.names.updatedAt) || 0;
  if (doc.names && remoteNamesAt > localNamesAt) {
    state.names = {
      me: personName(doc.names.me, "me"),
      partner: personName(doc.names.partner, "partner"),
      baby: clipName(doc.names.baby, "Baby"),
      updatedAt: remoteNamesAt
    };
  }
  const changed = eventSig(merged) !== eventSig(remoteEvents) || localNamesAt > remoteNamesAt;
  state.events = merged;
  saveState();
  render();
  if (changed) sync.publish();
  void checkReminders();
  scheduleAlerts();
}

function setStatus(mode) {
  statusMode = mode;
  const node = $("syncStatus");
  if (!node) return;
  node.dataset.state = mode;
  node.querySelector("span").textContent = STATUS_TEXT[mode] || STATUS_TEXT.local;
  paintShare();
}

function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function cleanTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function parseISO(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function todayIso() {
  return iso(new Date());
}

function whoLabel(who) {
  if (who === "me") return state.names.me || "Youyou";
  if (who === "partner") return state.names.partner || "Gepo";
  if (who === "baby") return state.names.baby || "Baby";
  return "Both";
}

function passes(event) {
  if (view.filter === "all") return true;
  if (view.filter === "baby") return event.who === "baby";
  if (view.filter === "me") return event.who === "me" || event.who === "both";
  if (view.filter === "partner") return event.who === "partner" || event.who === "both";
  return true;
}

function timeKey(event) {
  if (!event.time) return -1;
  const [hour, minute] = event.time.split(":").map(Number);
  return hour * 60 + minute;
}

function sortPlans(list) {
  return [...list].sort((a, b) => Number(b.urgent) - Number(a.urgent) || timeKey(a) - timeKey(b) || a.title.localeCompare(b.title));
}

function plansOn(date) {
  return sortPlans(state.events.filter((event) => !event.deleted && event.date <= date && eventEnd(event) >= date && passes(event)));
}

function render() {
  const monthName = monthFmt.format(new Date(view.year, view.month, 1));
  $("monthLabel").textContent = monthName;
  $("yearLabel").textContent = String(view.year);
  document.title = `${monthName} ${view.year} · Family Calendar`;
  const prefix = `${view.year}-${String(view.month + 1).padStart(2, "0")}`;
  const monthStart = `${prefix}-01`;
  const monthEnd = iso(new Date(view.year, view.month + 1, 0));
  const count = state.events.filter((event) => !event.deleted && passes(event) && event.date <= monthEnd && eventEnd(event) >= monthStart).length;
  const plans = count === 0 ? "No plans yet" : count === 1 ? "1 plan" : `${count} plans`;
  $("monthCount").textContent = plans;
  renderFilters();
  renderGrid();
  renderDay();
  renderUpcoming();
  if ($("daySheet").classList.contains("open")) fillDaySheet();
  setStatus(statusMode);
}

function renderFilters() {
  const items = [
    ["all", "All"],
    ["me", state.names.me || "Youyou"],
    ["partner", state.names.partner || "Gepo"],
    ["baby", state.names.baby || "Baby"]
  ];
  $("filters").replaceChildren(...items.map(([id, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter${view.filter === id ? " on" : ""}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", view.filter === id ? "true" : "false");
    button.textContent = label;
    button.addEventListener("click", () => {
      view.filter = id;
      render();
    });
    return button;
  }));
}

function renderGrid() {
  const first = new Date(view.year, view.month, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const total = weeks * 7;
  $("grid").classList.toggle("weeks-6", weeks > 5);
  const start = new Date(view.year, view.month, 1 - lead);
  const today = todayIso();
  const cells = [];
  for (let i = 0; i < total; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const id = iso(date);
    const events = plansOn(id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cell";
    if (date.getMonth() !== view.month) button.classList.add("outside");
    if (id === today) button.classList.add("today");
    if (id === view.selected) button.classList.add("selected");
    if (id < today) button.classList.add("past");
    if (events.length) button.classList.add("has");
    if (events.some((event) => event.urgent)) button.classList.add("urgent");
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = String(date.getDate());
    const dots = document.createElement("span");
    dots.className = "dots";
    const colors = [];
    for (const event of events) {
      const color = eventColor(event);
      if (!colors.includes(color)) colors.push(color);
      if (colors.length === 3) break;
    }
    for (const color of colors) {
      const dot = document.createElement("i");
      dot.style.background = color;
      dots.append(dot);
    }
    const col = i % 7;
    events.filter((event) => eventEnd(event) > event.date).slice(0, 2).forEach((event, index) => {
      const end = eventEnd(event);
      const bar = document.createElement("span");
      bar.className = "span-bar";
      if (index) bar.classList.add("n1");
      bar.style.background = eventColor(event);
      if (col === 0 || event.date === id) bar.classList.add("cap-left");
      else bar.classList.add("to-left");
      if (col === 6 || end === id) bar.classList.add("cap-right");
      else bar.classList.add("to-right");
      button.append(bar);
    });
    button.append(num, dots);
    const names = events.slice(0, 3).map((event) => event.title).join(", ");
    const urgentText = events.some((event) => event.urgent) ? ", urgent" : "";
    const planText = events.length
      ? `${urgentText}, ${events.length} ${events.length === 1 ? "plan" : "plans"}: ${names}`
      : ", nothing planned";
    button.setAttribute("aria-label", `${fullFmt.format(date)}${planText}`);
    button.setAttribute("aria-pressed", id === view.selected ? "true" : "false");
    if (id === today) button.setAttribute("aria-current", "date");
    button.addEventListener("click", () => {
      view.selected = id;
      view.year = date.getFullYear();
      view.month = date.getMonth();
      render();
      openDay();
    });
    cells.push(button);
  }
  $("grid").replaceChildren(...cells);
}

function renderDay() {
  const date = parseISO(view.selected);
  $("dayDow").textContent = dowFmt.format(date);
  $("dayTitle").textContent = dayFmt.format(date);
  const events = plansOn(view.selected);
  const box = $("dayEvents");
  box.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nothing this day.";
    box.append(empty);
    return;
  }
  const more = document.createElement("button");
  more.type = "button";
  more.className = "more-day";
  if (events.some((event) => event.urgent)) more.classList.add("urgent");
  const count = events.length === 1 ? "1 plan this day" : `${events.length} plans this day`;
  more.textContent = events.some((event) => event.urgent) ? `Urgent · ${count}` : count;
  more.addEventListener("click", openDay);
  box.append(more);
}

function welcomeCard() {
  const card = document.createElement("div");
  card.className = "welcome";
  const text = document.createElement("p");
  text.textContent = "Tap a shortcut — Doctor, Baby doctor, Delivery, Dentist, Travel — and that day gets a mark. Then share it so Gepo sees the same agenda.";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Got it";
  button.addEventListener("click", () => {
    state.dismissedWelcome = true;
    saveState();
    render();
  });
  card.append(text, button);
  return card;
}

function eventButton(event) {
  const cat = catById(event.category) || { id: "reminder", color: "#8d7b6a" };
  const color = eventColor(event);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "event";
  button.style.setProperty("--c", color);
  const bar = document.createElement("i");
  bar.style.background = color;
  const body = document.createElement("span");
  body.className = "event-body";
  const title = document.createElement("strong");
  title.className = "event-title";
  title.append(categoryMark(cat.id), document.createTextNode(event.title));
  if (event.urgent) {
    const badge = document.createElement("span");
    badge.className = "urgent-badge";
    badge.textContent = "Urgent";
    title.append(badge);
  }
  const meta = document.createElement("span");
  meta.className = "meta";
  const until = eventEnd(event) !== event.date ? `Until ${dayFmt.format(parseISO(eventEnd(event)))}` : "";
  meta.textContent = [event.time, until, whoLabel(event.who)].filter(Boolean).join(" · ");
  body.append(title, meta);
  if (event.note) {
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = event.note;
    body.append(note);
  }
  button.append(bar, body);
  button.addEventListener("click", () => openEditor(event));
  return button;
}

function planActions(event) {
  const actions = document.createElement("div");
  actions.className = "plan-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "plan-act edit-act";
  edit.textContent = "Edit";
  edit.addEventListener("click", () => openEditor(event));
  const color = document.createElement("button");
  color.type = "button";
  color.className = "plan-act color-act";
  const dot = document.createElement("i");
  dot.style.background = eventColor(event);
  color.append(dot, document.createTextNode("Color"));
  color.addEventListener("click", () => openColorPicker(event));
  const urgent = document.createElement("button");
  urgent.type = "button";
  urgent.className = "plan-act urgent-act";
  urgent.textContent = event.urgent ? "Urgent" : "Make urgent";
  urgent.setAttribute("aria-pressed", event.urgent ? "true" : "false");
  urgent.addEventListener("click", () => toggleUrgent(event.id));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "plan-act remove-act";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    if (remove.dataset.armed !== "1") {
      remove.dataset.armed = "1";
      remove.textContent = "Sure?";
      return;
    }
    removePlan(event.id);
  });
  actions.append(edit, color, urgent, remove);
  return actions;
}

function openColorPicker(event) {
  returnToDay = $("daySheet").classList.contains("open");
  const box = $("colorChoices");
  const current = eventColor(event);
  box.replaceChildren(...colorOptions(event).map((choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    if (choice === current) button.classList.add("on");
    button.style.background = choice;
    button.setAttribute("aria-label", choice === current ? "Current color" : "Choose this color");
    button.addEventListener("click", () => setEventColor(event.id, choice));
    return button;
  }));
  openSheet($("colorSheet"));
}

function setEventColor(id, color) {
  const event = state.events.find((item) => item.id === id && !item.deleted);
  if (!event) return;
  const typeColor = (catById(event.category)?.color || "#8d7b6a").toLowerCase();
  event.color = color === typeColor ? "" : color;
  event.updatedAt = Date.now();
  const backToDay = returnToDay;
  returnToDay = false;
  commit();
  if (backToDay) openDay();
  else closeSheets();
}

function planRow(event, open) {
  const row = document.createElement("div");
  row.className = "plan-row";
  if (event.urgent) row.classList.add("urgent");
  const button = open;
  row.append(button, planActions(event));
  return row;
}

function toggleUrgent(id) {
  const event = state.events.find((item) => item.id === id && !item.deleted);
  if (!event) return;
  event.urgent = !event.urgent;
  event.urgentAt = event.urgent ? Date.now() : 0;
  event.updatedAt = Date.now();
  if (event.urgent) askNotification();
  commit();
  if ($("daySheet").classList.contains("open")) fillDaySheet();
  void checkReminders();
}

const REMINDER_KEY = "our-agenda-reminders-v1";
const REMINDER_KINDS = [
  { id: "hour", label: "1 hour before" },
  { id: "day", label: "24 hours before" },
  { id: "3day", label: "3 days before" },
  { id: "week", label: "1 week before" },
  { id: "month", label: "1 month before" }
];

function eventNotices(event) {
  return REMINDER_KINDS.filter((kind) => (event.notices || []).includes(kind.id));
}

function askNotification() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    void Notification.requestPermission().then((result) => {
      if (result === "granted") void enableAlerts();
    });
    return;
  }
  if (Notification.permission === "granted") void enableAlerts();
}

function urlBase64ToUint8Array(value) {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let bin = "";
  const chunk = 0x4000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function collectJobs() {
  const now = Date.now();
  const jobs = [];
  for (const event of state.events) {
    const kinds = eventNotices(event);
    if (!kinds.length) continue;
    const when = eventWhen(event);
    if (when.getTime() <= now) continue;
    const marked = Number(event.noticeAt) || Number(event.urgentAt) || 0;
    for (const kind of kinds) {
      const fire = reminderAt(when, kind.id).getTime();
      if (fire < now - 48 * 60 * 60 * 1000 || fire >= when.getTime()) continue;
      if (marked && fire < marked) continue;
      const whenText = `${dayFmt.format(when)}${event.time ? ` · ${event.time}` : ""}`;
      jobs.push({
        tag: `urgent-${event.id}-${kind.id}`,
        at: new Date(fire).toISOString(),
        title: event.title,
        body: `${kind.label} · ${whenText}`
      });
    }
  }
  return jobs.slice(0, 100);
}

async function encryptForServer(obj) {
  const publicKey = await crypto.subtle.importKey(
    "spki",
    Uint8Array.from(atob(REMINDER_PUBLIC_KEY), (char) => char.charCodeAt(0)),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const rawAes = new Uint8Array(await crypto.subtle.exportKey("raw", aes));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aes,
    new TextEncoder().encode(JSON.stringify(obj))
  ));
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawAes));
  const joined = new Uint8Array(iv.length + cipher.length);
  joined.set(iv, 0);
  joined.set(cipher, iv.length);
  return `p1.${bytesToB64url(wrapped)}.${bytesToB64url(joined)}`;
}

let alertBusy = false;
let alertAgain = false;
let alertTimer = 0;

function scheduleAlerts() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => { void enableAlerts(); }, 1200);
}

async function enableAlerts() {
  if (alertBusy) {
    alertAgain = true;
    return false;
  }
  alertBusy = true;
  try {
    do {
      alertAgain = false;
      if (!window.isSecureContext || !("Notification" in window) || Notification.permission !== "granted") return false;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000))
      ]);
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }
      const message = await encryptForServer({
        kind: "device",
        subscription: sub.toJSON(),
        jobs: collectJobs()
      });
      await publishOnce(`ag/push/${state.deviceId}`, message);
    } while (alertAgain);
    return true;
  } catch {
    return false;
  } finally {
    alertBusy = false;
  }
}

function eventWhen(event) {
  const when = parseISO(event.date);
  if (/^\d{2}:\d{2}$/.test(event.time || "")) {
    const [hour, minute] = event.time.split(":").map(Number);
    when.setHours(hour, minute, 0, 0);
  } else {
    when.setHours(9, 0, 0, 0);
  }
  return when;
}

function reminderAt(when, id) {
  const fire = new Date(when);
  if (id === "month") {
    const day = fire.getDate();
    fire.setDate(1);
    fire.setMonth(fire.getMonth() - 1);
    const last = new Date(fire.getFullYear(), fire.getMonth() + 1, 0).getDate();
    fire.setDate(Math.min(day, last));
  } else if (id === "week") {
    fire.setDate(fire.getDate() - 7);
  } else if (id === "3day") {
    fire.setDate(fire.getDate() - 3);
  } else if (id === "hour") {
    fire.setHours(fire.getHours() - 1);
  } else {
    fire.setHours(fire.getHours() - 24);
  }
  return fire;
}

function loadReminders() {
  try {
    const raw = JSON.parse(localStorage.getItem(REMINDER_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveReminders(map) {
  localStorage.setItem(REMINDER_KEY, JSON.stringify(map));
}

async function showReminder(title, body, tag) {
  if ("Notification" in window && Notification.permission === "granted" && "serviceWorker" in navigator) {
    try {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500))
      ]);
      await reg.showNotification(title, {
        body,
        tag,
        renotify: true,
        icon: "./icons/calendar-180.png"
      });
      return true;
    } catch {
      /* show it in the app instead */
    }
  }
  return false;
}

let reminderLock = false;

async function checkReminders() {
  if (reminderLock) return;
  reminderLock = true;
  try {
    const now = Date.now();
    const sent = loadReminders();
    const live = new Set();
    const lines = [];
    for (const event of state.events) {
      const chosen = eventNotices(event);
      if (!event.deleted && chosen.length) live.add(event.id);
      if (event.deleted || !chosen.length) continue;
      const when = eventWhen(event);
      if (when.getTime() <= now) continue;
      const marked = Number(event.noticeAt) || Number(event.urgentAt) || 0;
      const done = new Set(Array.isArray(sent[event.id]) ? sent[event.id] : []);
      for (const kind of chosen) {
        if (done.has(kind.id)) continue;
        const fire = reminderAt(when, kind.id).getTime();
        if (fire > now || (marked && fire < marked)) continue;
        done.add(kind.id);
        sent[event.id] = [...done];
        saveReminders(sent);
        const whenText = `${dayFmt.format(when)}${event.time ? ` · ${event.time}` : ""}`;
        const body = `${kind.label} · ${whenText}`;
        const shown = await showReminder(event.title, body, `urgent-${event.id}-${kind.id}`);
        if (!shown) lines.push(`${event.title}. ${body}`);
      }
    }
    if (lines.length) showToast(lines.join(" · "));
    for (const id of Object.keys(sent)) {
      if (!live.has(id)) delete sent[id];
    }
    saveReminders(sent);
  } finally {
    reminderLock = false;
  }
}

function removePlan(id) {
  const event = state.events.find((item) => item.id === id && !item.deleted);
  if (!event) return;
  event.deleted = true;
  event.updatedAt = Date.now();
  commit();
  if ($("daySheet").classList.contains("open")) fillDaySheet();
  showToast("Removed", [{
    label: "Undo",
    onClick: () => {
      event.deleted = false;
      event.updatedAt = Date.now();
      hideToast();
      commit();
      if ($("daySheet").classList.contains("open")) fillDaySheet();
    }
  }]);
}

function renderUpcoming() {
  const today = todayIso();
  const list = state.events
    .filter((event) => !event.deleted && passes(event) && eventEnd(event) >= today)
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.date < b.date ? -1 : a.date > b.date ? 1 : timeKey(a) - timeKey(b)));
  $("comingCount").textContent = list.length ? String(list.length) : "";
  const box = $("upcoming");
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nothing coming up.";
    box.replaceChildren(empty);
    return;
  }
  box.replaceChildren(...list.map((event) => {
    const cat = catById(event.category) || { id: "reminder", color: "#8d7b6a" };
    const button = document.createElement("button");
    button.type = "button";
    button.className = "up";
    button.style.setProperty("--c", eventColor(event));
    const text = document.createElement("span");
    text.className = "up-copy";
    const when = document.createElement("strong");
    const finish = eventEnd(event);
    when.textContent = finish === event.date
      ? dayFmt.format(parseISO(event.date))
      : `${dayFmt.format(parseISO(event.date))} – ${dayFmt.format(parseISO(finish))}`;
    const detail = document.createElement("span");
    const dayName = dowFmt.format(parseISO(event.date));
    detail.textContent = `${event.urgent ? "Urgent · " : ""}${dayName}${event.time ? ` · ${event.time}` : ""} · ${event.title}`;
    text.append(when, detail);
    button.append(categoryMark(cat.id), text);
    button.addEventListener("click", () => {
      const date = parseISO(event.date);
      view.selected = event.date;
      view.year = date.getFullYear();
      view.month = date.getMonth();
      closeComing();
      render();
      openDay();
    });
    return planRow(event, button);
  }));
}

function openComing() {
  $("comingPage").hidden = false;
  document.querySelector("main").inert = true;
}

function closeComing() {
  $("comingPage").hidden = true;
  document.querySelector("main").inert = false;
}

function buildQuick() {
  const row = $("quick");
  for (const id of QUICK_IDS) {
    const cat = catById(id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.style.setProperty("--c", cat.color);
    const label = document.createElement("span");
    label.textContent = cat.label;
    button.append(categoryMark(cat.id), label);
    button.addEventListener("click", () => quickAdd(id));
    row.append(button);
  }
  const more = document.createElement("button");
  more.type = "button";
  more.className = "chip more";
  more.style.setProperty("--c", "#8d7b6a");
  const moreLabel = document.createElement("span");
  moreLabel.textContent = "More";
  more.append(categoryMark("more"), moreLabel);
  more.addEventListener("click", () => openEditor(null));
  row.append(more);
}

function typePages() {
  const ordered = [
    ...QUICK_IDS.map((id) => catById(id)),
    ...CATEGORIES.filter((cat) => !QUICK_IDS.includes(cat.id))
  ];
  const pages = [];
  for (let i = 0; i < ordered.length; i += 8) pages.push(ordered.slice(i, i + 8));
  return pages;
}

function renderTypes() {
  const pages = typePages();
  if (typePage >= pages.length) typePage = 0;
  const box = $("categories");
  box.replaceChildren();
  const grid = document.createElement("div");
  grid.className = "cat-grid";
  for (const cat of pages[typePage]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cat";
    if (draft && draft.category === cat.id) button.classList.add("on");
    button.dataset.id = cat.id;
    button.style.setProperty("--c", cat.color);
    const label = document.createElement("span");
    label.textContent = cat.label;
    button.append(categoryMark(cat.id), label);
    button.addEventListener("click", () => chooseCategory(cat.id));
    grid.append(button);
  }
  box.append(grid);
  if (pages.length > 1) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "more-types";
    more.textContent = typePage < pages.length - 1 ? "More types" : "Main types";
    more.addEventListener("click", () => {
      typePage = typePage < pages.length - 1 ? typePage + 1 : 0;
      renderTypes();
    });
    box.append(more);
  }
}

function fillDaySheet() {
  const date = parseISO(view.selected);
  $("daySheetDow").textContent = dowFmt.format(date);
  $("daySheetTitle").textContent = dayFmt.format(date);
  const events = plansOn(view.selected);
  const box = $("daySheetList");
  box.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nothing coming this day.";
    box.append(empty);
    return;
  }
  for (const event of events) box.append(planRow(event, eventButton(event)));
}

function openDay() {
  fillDaySheet();
  openSheet($("daySheet"));
}

function quickAdd(id) {
  const cat = catById(id);
  const event = {
    id: crypto.randomUUID ? crypto.randomUUID() : randomSecret(12),
    date: view.selected,
    time: "",
    title: cat.label,
    category: cat.id,
    who: "both",
    note: "",
    updatedAt: Date.now(),
    deleted: false
  };
  state.events.push(event);
  commit();
  showToast(`${cat.label} added`, [
    { label: "Undo", onClick: () => undo(event.id) },
    {
      label: "Add time",
      onClick: () => {
        hideToast();
        const found = state.events.find((item) => item.id === event.id && !item.deleted);
        if (found) openEditor(found);
      }
    }
  ]);
}

function undo(id) {
  const event = state.events.find((item) => item.id === id);
  if (!event) return;
  event.deleted = true;
  event.updatedAt = Date.now();
  hideToast();
  commit();
}

function openEditor(event) {
  returnToDay = $("daySheet").classList.contains("open");
  draft = event
    ? { ...event, titleTouched: true }
    : {
      id: null,
      date: view.selected,
      time: "",
      title: "",
      category: "",
      who: "both",
      note: "",
      color: "",
      end: "",
      notices: [],
      urgent: false,
      titleTouched: false
    };
  typePage = 0;
  fillEditor();
  renderTypes();
  showStep(0);
  openSheet($("editor"));
}

function showStep(index) {
  step = index;
  document.querySelectorAll("#editor .step").forEach((el) => {
    el.hidden = Number(el.dataset.step) !== index;
  });
  $("stepBack").hidden = index === 0;
  $("stepNext").hidden = index === 3;
  $("saveBtn").hidden = index !== 3;
  $("deleteBtn").hidden = index !== 3 || !draft.id;
  document.querySelectorAll(".step-dot").forEach((dot, i) => {
    dot.classList.toggle("on", i === index);
    dot.classList.toggle("done", i < index);
  });
}

function goNext() {
  if (step === 0 && !draft.category) {
    showToast("Choose a type.");
    return;
  }
  if (step === 1) {
    const title = $("titleInput").value.trim();
    const date = $("dateInput").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      showToast("Choose a day.");
      return;
    }
    const end = $("endInput").value;
    if (end && end < date) {
      showToast("Until has to be the same day or later.");
      return;
    }
    draft.date = date;
    draft.end = end && end > date ? end : "";
    draft.title = title || catById(draft.category)?.label || "Plan";
    $("titleInput").value = draft.title;
  }
  if (step === 2) draft.time = cleanTime($("timeInput").value);
  showStep(Math.min(step + 1, 3));
}

function fillEditor() {
  $("editorTitle").textContent = draft.id ? "Edit plan" : "New plan";
  $("titleInput").value = draft.title || "";
  $("dateInput").value = draft.date;
  $("endInput").value = draft.end || draft.date;
  $("noteInput").value = draft.note || "";
  $("timeInput").value = draft.time || "";
  const remove = $("deleteBtn");
  remove.hidden = !draft.id;
  remove.dataset.armed = "";
  remove.textContent = "Delete";
  document.querySelectorAll("#categories .cat").forEach((button) => {
    button.classList.toggle("on", button.dataset.id === draft.category);
  });
  document.querySelectorAll("#who .who-btn").forEach((button) => {
    button.classList.toggle("on", button.dataset.who === draft.who);
    button.textContent = button.dataset.who === "both" ? "Both" : whoLabel(button.dataset.who);
  });
  document.querySelectorAll("#timePresets button").forEach((button) => {
    button.classList.toggle("on", button.dataset.time === (draft.time || ""));
  });
  document.querySelectorAll("#notices button").forEach((button) => {
    button.classList.toggle("on", (draft.notices || []).includes(button.dataset.notice));
  });
}

function chooseCategory(id) {
  const cat = catById(id);
  draft.category = id;
  if (!draft.titleTouched) {
    draft.title = cat.label;
    $("titleInput").value = cat.label;
  }
  document.querySelectorAll("#categories .cat").forEach((button) => {
    button.classList.toggle("on", button.dataset.id === id);
  });
}

function chooseTime(value) {
  draft.time = cleanTime(value);
  $("timeInput").value = draft.time;
  markTime();
}

function markTime() {
  document.querySelectorAll("#timePresets button").forEach((button) => {
    button.classList.toggle("on", button.dataset.time === (draft.time || ""));
  });
}

function saveDraft(event) {
  event.preventDefault();
  if (step < 3) {
    goNext();
    return;
  }
  if ((draft.notices || []).length) askNotification();
  const chosen = catById(draft.category);
  const title = $("titleInput").value.trim() || chosen?.label || "Plan";
  const date = $("dateInput").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const endValue = $("endInput").value;
  if (endValue && endValue < date) return;
  const notices = NOTICE_IDS.filter((id) => (draft.notices || []).includes(id));
  const previous = draft.id ? state.events.find((item) => item.id === draft.id) : null;
  const sameNotices = previous && (previous.notices || []).join() === notices.join();
  const next = {
    id: draft.id || (crypto.randomUUID ? crypto.randomUUID() : randomSecret(12)),
    date,
    end: endValue && endValue > date ? endValue : "",
    time: cleanTime($("timeInput").value),
    title: title.slice(0, 80),
    category: chosen ? chosen.id : "reminder",
    who: draft.who || "both",
    note: $("noteInput").value.trim().slice(0, 500),
    color: cleanColor(draft.color),
    notices,
    noticeAt: notices.length ? (sameNotices ? (Number(previous.noticeAt) || Date.now()) : Date.now()) : 0,
    urgent: !!draft.urgent,
    urgentAt: draft.urgent ? (Number(draft.urgentAt) || Date.now()) : 0,
    updatedAt: Date.now(),
    deleted: false
  };
  const index = state.events.findIndex((item) => item.id === next.id);
  if (index >= 0) state.events[index] = next;
  else state.events.push(next);
  const parsed = parseISO(date);
  view.selected = date;
  view.year = parsed.getFullYear();
  view.month = parsed.getMonth();
  returnToDay = false;
  closeSheets();
  closeComing();
  commit();
}

function deleteDraft() {
  const button = $("deleteBtn");
  if (button.dataset.armed !== "1") {
    button.dataset.armed = "1";
    button.textContent = "Tap again to delete";
    return;
  }
  const event = state.events.find((item) => item.id === draft.id);
  if (event) {
    event.deleted = true;
    event.updatedAt = Date.now();
  }
  returnToDay = false;
  closeSheets();
  commit();
  openDay();
}

function sheets() {
  return [$("editor"), $("shareSheet"), $("daySheet"), $("colorSheet")];
}

function openSheet(sheet) {
  hideToast();
  for (const node of sheets()) {
    node.classList.remove("open");
    node.inert = true;
    node.setAttribute("aria-hidden", "true");
  }
  $("backdrop").classList.add("open");
  sheet.classList.add("open");
  sheet.inert = false;
  sheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("lock");
  sheet.focus();
}

function closeSheets() {
  $("backdrop").classList.remove("open");
  for (const node of sheets()) {
    node.classList.remove("open");
    node.inert = true;
    node.setAttribute("aria-hidden", "true");
  }
  document.body.classList.remove("lock");
}

function requestClose() {
  if (($("editor").classList.contains("open") || $("colorSheet").classList.contains("open")) && returnToDay) {
    returnToDay = false;
    openDay();
    return;
  }
  const sheetOpen = sheets().some((node) => node.classList.contains("open"));
  returnToDay = false;
  closeSheets();
  if (!sheetOpen) closeComing();
}

function showToast(text, actions) {
  const toast = $("toast");
  toast.replaceChildren();
  const label = document.createElement("span");
  label.textContent = text;
  toast.append(label);
  for (const action of actions || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", action.onClick);
    toast.append(button);
  }
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actions?.length ? 5200 : 2600);
}

function hideToast() {
  $("toast").classList.remove("show");
}

function hashKey(url) {
  const raw = url.hash.replace(/^#/, "");
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function validKey(key) {
  try {
    const pad = key.length % 4 === 0 ? "" : "=".repeat(4 - (key.length % 4));
    const b64 = key.replace(/-/g, "+").replace(/_/g, "/") + pad;
    return atob(b64).length === 16;
  } catch {
    return false;
  }
}

function readLink(value) {
  try {
    const url = new URL(value, location.href);
    const home = url.searchParams.get("home");
    const key = hashKey(url);
    if (home && /^[A-Za-z0-9_-]{8,80}$/.test(home) && validKey(key)) return { home, key };
  } catch {
    /* ignore bad links */
  }
  return null;
}

function prettyCode(code) {
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}

function inFamily() {
  return !!(state.roomId && state.key && validKey(state.key));
}

function paintShare() {
  const pill = $("sharePill");
  const local = $("shareLocal");
  const family = $("shareFamily");
  if (!pill || !local || !family) return;
  const shared = inFamily() && !!state.code;
  local.hidden = shared;
  family.hidden = !shared;
  if (!shared) {
    pill.textContent = inFamily() ? "Shared" : "This phone only";
    pill.dataset.state = inFamily() && statusMode === "online" ? "online" : "local";
    return;
  }
  const labels = {
    connecting: "Connecting",
    online: "Shared",
    offline: "On this phone"
  };
  pill.textContent = labels[statusMode] || "Shared";
  pill.dataset.state = statusMode === "online" ? "online" : "local";
  const code = $("familyCode");
  const copy = $("copyCode");
  const blurb = $("familyCopy");
  if (state.code) {
    code.hidden = false;
    copy.hidden = false;
    code.textContent = prettyCode(state.code);
    blurb.textContent = "Tell Gepo this code. The plans already on this phone come along.";
  } else {
    code.hidden = true;
    copy.hidden = true;
    blurb.textContent = "Both phones already share this calendar.";
  }
}

function showShareWarning() {
  const note = $("shareNote");
  if (window.isSecureContext) {
    note.hidden = true;
    return true;
  }
  note.hidden = false;
  note.textContent = "Open https://youwest54.github.io/calendar/ on both iPhones to share.";
  return false;
}

async function startFamily() {
  if (!showShareWarning()) return;
  const button = $("startFamily");
  button.disabled = true;
  try {
    const room = await roomFromCode(makeFamilyCode());
    state.code = room.code;
    state.roomId = room.home;
    state.key = room.key;
    saveState();
    await sync.start(state.roomId, state.key);
    if (state.events.length || state.names.updatedAt) sync.publish();
    paintShare();
    showToast("Tell Gepo this code.");
  } catch {
    showToast("Could not start the family. Check your internet and try again.");
  } finally {
    button.disabled = false;
  }
}

async function copyCode() {
  if (!state.code) return;
  try {
    await navigator.clipboard.writeText(state.code);
    showToast("Code copied. Send it to Gepo.");
  } catch {
    showToast(`Tell Gepo this code: ${prettyCode(state.code)}`);
  }
}

function openShare() {
  $("yourName").value = state.names.me;
  $("partnerName").value = state.names.partner;
  $("babyName").value = state.names.baby;
  showShareWarning();
  paintShare();
  openSheet($("shareSheet"));
}

function saveNames() {
  state.names = {
    me: personName($("yourName").value, "me"),
    partner: personName($("partnerName").value, "partner"),
    baby: clipName($("babyName").value, "Baby"),
    updatedAt: Date.now()
  };
  $("yourName").value = state.names.me;
  $("partnerName").value = state.names.partner;
  $("babyName").value = state.names.baby;
  commit();
}

async function joinFromInput() {
  if (!showShareWarning()) return;
  const code = cleanFamilyCode($("joinCode").value);
  if (code.length !== 8) {
    showToast("That code needs 8 characters.");
    return;
  }
  const button = $("joinBtn");
  button.disabled = true;
  try {
    const room = await roomFromCode(code);
    state.code = room.code;
    state.roomId = room.home;
    state.key = room.key;
    saveState();
    await sync.start(state.roomId, state.key);
    paintShare();
    showToast("Joined. Plans will show in a moment.");
  } catch {
    showToast("Could not join that code.");
  } finally {
    button.disabled = false;
  }
}

function shiftMonth(delta) {
  const next = new Date(view.year, view.month + delta, 1);
  view.year = next.getFullYear();
  view.month = next.getMonth();
  const day = Math.min(parseISO(view.selected).getDate(), new Date(view.year, view.month + 1, 0).getDate());
  view.selected = iso(new Date(view.year, view.month, day));
  render();
}

function goToday() {
  const date = new Date();
  view.year = date.getFullYear();
  view.month = date.getMonth();
  view.selected = iso(date);
  render();
}

function bind() {
  $("prevMonth").addEventListener("click", () => shiftMonth(-1));
  $("nextMonth").addEventListener("click", () => shiftMonth(1));
  $("todayBtn").addEventListener("click", goToday);
  $("addBtn").addEventListener("click", () => openEditor(null));
  $("dayAdd").addEventListener("click", () => openEditor(null));
  $("stepNext").addEventListener("click", goNext);
  $("stepBack").addEventListener("click", () => showStep(Math.max(step - 1, 0)));
  $("shareBtn").addEventListener("click", openShare);
  $("editor").addEventListener("submit", saveDraft);
  $("deleteBtn").addEventListener("click", deleteDraft);
  $("startFamily").addEventListener("click", () => { void startFamily(); });
  $("copyCode").addEventListener("click", () => { void copyCode(); });
  $("joinBtn").addEventListener("click", () => { void joinFromInput(); });
  $("joinCode").addEventListener("input", () => {
    const clean = cleanFamilyCode($("joinCode").value);
    $("joinCode").value = clean.length > 4 ? `${clean.slice(0, 4)} ${clean.slice(4)}` : clean;
  });
  for (const id of ["yourName", "partnerName", "babyName"]) {
    $(id).addEventListener("change", saveNames);
  }
  $("titleInput").addEventListener("input", () => {
    draft.titleTouched = true;
    draft.title = $("titleInput").value;
  });
  $("timeInput").addEventListener("input", () => {
    draft.time = cleanTime($("timeInput").value);
    markTime();
  });
  $("timePresets").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    chooseTime(button.dataset.time || "");
  });
  $("notices").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const id = button.dataset.notice;
    const set = new Set(draft.notices || []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    draft.notices = NOTICE_IDS.filter((item) => set.has(item));
    button.classList.toggle("on", set.has(id));
  });
  $("who").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    draft.who = button.dataset.who;
    document.querySelectorAll("#who .who-btn").forEach((item) => {
      item.classList.toggle("on", item === button);
    });
  });
  document.querySelectorAll(".close-sheet").forEach((button) => {
    button.addEventListener("click", requestClose);
  });
  $("backdrop").addEventListener("click", requestClose);
  $("comingBtn").addEventListener("click", openComing);
  $("comingBack").addEventListener("click", closeComing);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") requestClose();
    if (event.target.closest("input, textarea")) return;
    if (event.key === "ArrowLeft") shiftMonth(-1);
    if (event.key === "ArrowRight") shiftMonth(1);
  });

  let startX = 0;
  let startY = 0;
  $("cal").addEventListener("touchstart", (event) => {
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  }, { passive: true });
  $("cal").addEventListener("touchend", (event) => {
    const dx = event.changedTouches[0].clientX - startX;
    const dy = event.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.3) shiftMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
}

function claimLink() {
  if (!location.search.includes("home=")) return;
  const joined = readLink(location.href);
  if (!joined) return;
  state.roomId = joined.home;
  state.key = joined.key;
  saveState();
  const url = new URL(location.href);
  url.searchParams.delete("home");
  url.hash = "";
  history.replaceState({}, "", `${url.pathname}${url.search}`);
}

async function boot() {
  claimLink();
  bind();
  render();
  if (state.roomId && state.key && validKey(state.key)) {
    try {
      await sync.start(state.roomId, state.key);
    } catch {
      setStatus("offline");
    }
  } else {
    setStatus("local");
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      sync.nudge();
      void checkReminders();
    }
  });
  void checkReminders();
  setInterval(() => { void checkReminders(); }, 60000);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) sync.nudge();
  });
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./sw.js").then(() => enableAlerts()).catch(() => {});
  }
}

void boot();
