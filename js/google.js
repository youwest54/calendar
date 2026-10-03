const SCOPE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly";
const GOOGLE_COLOR = "#3c6fba";

let tokenClient = null;
let pending = null;
let cached = null;
let inflight = null;

export function loadGoogleScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("load"));
    document.head.append(script);
  });
}

export function clearGoogleToken() {
  cached = null;
}

export function requestGoogleToken(clientId, options = {}) {
  if (!options.fresh && cached && cached.until > Date.now() + 60000) {
    return Promise.resolve(cached.token);
  }
  if (inflight) return inflight;
  inflight = new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error("load"));
      return;
    }
    const timer = setTimeout(() => {
      if (pending) {
        pending = null;
        reject(new Error("timeout"));
      }
    }, 20000);
    pending = {
      resolve: (token) => {
        clearTimeout(timer);
        resolve(token);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      }
    };
    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: (response) => {
          const wait = pending;
          pending = null;
          if (!wait) return;
          if (!response || response.error) wait.reject(new Error(response?.error || "access_denied"));
          else {
            const seconds = Number(response.expires_in) || 3600;
            cached = { token: response.access_token, until: Date.now() + seconds * 1000 };
            wait.resolve(response.access_token);
          }
        }
      });
    }
    tokenClient.requestAccessToken({ prompt: options.silent ? "" : "consent" });
  }).finally(() => {
    inflight = null;
  });
  return inflight;
}

function isoDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function padTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function plusHour(date, time) {
  const [hour, minute] = String(time || "09:00").split(":").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  const when = new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0);
  when.setHours(when.getHours() + 1);
  return { date: isoDate(when), time: padTime(when) };
}

function windowBounds() {
  const start = new Date();
  start.setFullYear(start.getFullYear() - 10);
  const end = new Date();
  end.setFullYear(end.getFullYear() + 10);
  return { from: isoDate(start), to: isoDate(end), timeMin: start.toISOString(), timeMax: end.toISOString() };
}

function inWindow(event, bounds) {
  const finish = event.end && event.end > event.date ? event.end : event.date;
  return finish >= bounds.from && event.date <= bounds.to;
}

async function gfetch(token, url, options = {}) {
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: options.body
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.status || "google");
    err.status = res.status;
    throw err;
  }
  return data;
}

async function listCalendars(token) {
  try {
    const items = [];
    let page = "";
    do {
      const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
      if (page) url.searchParams.set("pageToken", page);
      const data = await gfetch(token, url);
      items.push(...(data.items || []));
      page = data.nextPageToken || "";
    } while (page);
    const visible = items.filter((item) => item.id && item.accessRole && item.accessRole !== "freeBusyReader");
    if (!visible.length) return [{ id: "primary", writable: true, complete: true }];
    return visible.map((item) => ({
      id: item.primary ? "primary" : item.id,
      summary: String(item.summary || ""),
      primary: !!item.primary,
      group: String(item.id || "").includes("group.calendar.google.com"),
      writable: item.accessRole === "owner" || item.accessRole === "writer",
      complete: true
    }));
  } catch {
    return [{ id: "primary", writable: true, complete: true }];
  }
}

async function listEvents(token, calendarId, bounds) {
  const all = [];
  let page = "";
  let complete = true;
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  do {
    const url = new URL(base);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("timeMin", bounds.timeMin);
    url.searchParams.set("timeMax", bounds.timeMax);
    if (page) url.searchParams.set("pageToken", page);
    const data = await gfetch(token, url);
    for (const item of data.items || []) item.calendarId = calendarId;
    all.push(...(data.items || []));
    page = data.nextPageToken || "";
    if (page && all.length >= 4000) {
      complete = false;
      break;
    }
  } while (page);
  return { items: all, complete };
}

function toGoogle(event, zone) {
  const extra = {
    familyId: event.id,
    category: event.category || "reminder",
    who: event.who || "both",
    color: event.color || ""
  };
  const body = {
    summary: event.title || "Plan",
    description: event.note || "",
    extendedProperties: { private: extra }
  };
  if (event.time) {
    const finish = event.end && event.end > event.date ? event.end : event.date;
    const end = plusHour(finish, event.time);
    body.start = { dateTime: `${event.date}T${event.time}:00`, timeZone: zone };
    body.end = { dateTime: `${end.date}T${end.time}:00`, timeZone: zone };
  } else {
    const finish = event.end && event.end > event.date ? event.end : event.date;
    body.start = { date: event.date };
    body.end = { date: addDays(finish, 1) };
  }
  return body;
}

function planKey(date, time, title) {
  return `${date}|${time || ""}|${String(title || "").trim().toLowerCase()}`;
}

function importedColor(remote) {
  const extra = remote.extendedProperties?.private || {};
  if (/^#[0-9a-f]{6}$/i.test(extra.color || "")) return extra.color.toLowerCase();
  if (extra.familyId) return "";
  return GOOGLE_COLOR;
}

function fromRemote(remote) {
  const start = remote.start || {};
  const end = remote.end || {};
  let date = "";
  let time = "";
  let finish = "";
  if (start.date) {
    date = start.date;
    if (end.date && end.date > start.date) {
      const last = addDays(end.date, -1);
      if (last > date) finish = last;
    }
  } else if (start.dateTime) {
    const when = new Date(start.dateTime);
    if (Number.isNaN(when.getTime())) return null;
    date = isoDate(when);
    time = padTime(when);
    if (end.dateTime) {
      const until = new Date(end.dateTime);
      const endDate = isoDate(until);
      if (endDate > date) finish = endDate;
    }
  } else {
    return null;
  }
  const extra = remote.extendedProperties?.private || {};
  const now = Date.now();
  const who = ["me", "partner", "both", "baby"].includes(extra.who) ? extra.who : "both";
  const color = importedColor(remote);
  const id = String(extra.familyId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48)
    || `g${String(remote.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`;
  return {
    id,
    date,
    end: finish,
    time,
    title: String(remote.summary || "Plan").slice(0, 80),
    category: extra.category || "reminder",
    who,
    note: String(remote.description || "").slice(0, 500),
    color,
    notices: [],
    noticeAt: 0,
    urgent: false,
    urgentAt: 0,
    gcalId: remote.id,
    gcalCal: remote.calendarId || "primary",
    gcalAt: now,
    updatedAt: now,
    deleted: false
  };
}

function applyRemote(event, remote) {
  const incoming = fromRemote(remote);
  if (!incoming) return;
  const extra = remote.extendedProperties?.private || {};
  event.date = incoming.date;
  event.end = incoming.end;
  event.time = incoming.time;
  event.title = incoming.title;
  event.note = incoming.note;
  if (incoming.category) event.category = incoming.category;
  if (incoming.who) event.who = incoming.who;
  const explicit = /^#[0-9a-f]{6}$/i.test(extra.color || "") ? extra.color.toLowerCase() : "";
  if (explicit) event.color = explicit;
  else if (!event.color && !extra.familyId) event.color = GOOGLE_COLOR;
  event.gcalId = remote.id;
  event.gcalCal = remote.calendarId || event.gcalCal || "primary";
  event.updatedAt = Date.now();
  event.gcalAt = event.updatedAt;
  event.deleted = false;
}

function pickFamilyCalendar(calendars) {
  const writable = calendars.filter((item) => item.writable && !item.primary);
  const named = (item) => /family|famille/i.test(item.summary || "");
  const groups = writable.filter((item) => item.group);
  return writable.find((item) => item.group && named(item))
    || writable.find(named)
    || (groups.length === 1 ? groups[0] : null)
    || null;
}

function eventUrl(calendarId, eventId) {
  const calendar = encodeURIComponent(calendarId || "primary");
  if (!eventId) return `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`;
  return `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${encodeURIComponent(eventId)}`;
}

export async function syncGoogle(token, events) {
  const bounds = windowBounds();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const calendars = await listCalendars(token);
  const home = pickFamilyCalendar(calendars);
  const googleEvents = [];
  const completeCals = new Set();
  const writable = new Set();
  for (const calendar of calendars) {
    if (calendar.writable) writable.add(calendar.id);
    try {
      const listed = await listEvents(token, calendar.id, bounds);
      googleEvents.push(...listed.items);
      if (listed.complete) completeCals.add(calendar.id);
    } catch {
      /* a calendar we cannot read stays out of the delete check */
    }
  }
  const byId = new Map();
  const byFamily = new Map();
  const byPlan = new Map();
  for (const item of googleEvents) {
    const key = `${item.calendarId || "primary"}/${item.id}`;
    byId.set(key, item);
    byId.set(item.id, byId.get(item.id) || item);
    const familyId = item.extendedProperties?.private?.familyId;
    if (familyId && !byFamily.has(familyId)) byFamily.set(familyId, item);
    const incoming = fromRemote(item);
    if (incoming) {
      const plan = planKey(incoming.date, incoming.time, incoming.title);
      if (!byPlan.has(plan)) byPlan.set(plan, item);
    }
  }
  const liveIds = new Set(googleEvents.map((item) => `${item.calendarId || "primary"}/${item.id}`));
  const next = events.map((event) => ({ ...event }));
  let added = 0;
  let pushed = 0;
  let changed = 0;

  for (const event of next) {
    const cal = event.gcalCal || "primary";
    const liveKey = event.gcalId ? `${cal}/${event.gcalId}` : "";
    if (event.deleted) {
      if (event.gcalId && liveIds.has(liveKey) && (writable.has(cal) || cal === "primary")) {
        try {
          await gfetch(token, eventUrl(cal, event.gcalId), { method: "DELETE" });
          liveIds.delete(liveKey);
          pushed += 1;
        } catch {
          /* read-only calendar */
        }
      }
      continue;
    }
    const remote = (event.gcalId && (byId.get(liveKey) || byId.get(event.gcalId))) || byFamily.get(event.id) || byPlan.get(planKey(event.date, event.time, event.title)) || null;
    if (!remote) {
      if (!home) continue;
      const created = await gfetch(token, eventUrl(home.id), { method: "POST", body: JSON.stringify(toGoogle(event, zone)) });
      created.calendarId = home.id;
      event.gcalId = created.id;
      event.gcalCal = home.id;
      event.gcalAt = Date.now();
      liveIds.add(`${home.id}/${created.id}`);
      byPlan.set(planKey(event.date, event.time, event.title), created);
      pushed += 1;
      continue;
    }
    const ownedOnPrimary = remote.extendedProperties?.private?.familyId === event.id
      && (!remote.calendarId || remote.calendarId === "primary");
    if (home && ownedOnPrimary && home.id !== "primary") {
      const created = await gfetch(token, eventUrl(home.id), { method: "POST", body: JSON.stringify(toGoogle(event, zone)) });
      created.calendarId = home.id;
      try {
        await gfetch(token, eventUrl("primary", remote.id), { method: "DELETE" });
        liveIds.delete(`primary/${remote.id}`);
      } catch {
        /* the family copy is already there */
      }
      event.gcalId = created.id;
      event.gcalCal = home.id;
      event.gcalAt = Date.now();
      liveIds.add(`${home.id}/${created.id}`);
      pushed += 1;
      continue;
    }
    event.gcalId = remote.id;
    event.gcalCal = remote.calendarId || "primary";
    const remoteAt = Date.parse(remote.updated) || 0;
    const localDirty = (event.updatedAt || 0) > (event.gcalAt || 0);
    const remoteDirty = remoteAt > (event.gcalAt || 0);
    const canWrite = writable.has(event.gcalCal) || event.gcalCal === "primary";
    if (remoteDirty && (!localDirty || remoteAt >= (event.updatedAt || 0))) {
      applyRemote(event, remote);
      changed += 1;
    } else if (localDirty && canWrite) {
      try {
        await gfetch(token, eventUrl(event.gcalCal, remote.id), {
          method: "PATCH",
          body: JSON.stringify(toGoogle(event, zone))
        });
        event.gcalAt = Date.now();
        pushed += 1;
      } catch {
        event.gcalAt = Date.now();
      }
    } else if (!event.gcalAt) {
      event.gcalAt = Date.now();
    }
  }

  const knownIds = new Set(next.map((event) => event.gcalId).filter(Boolean));
  const knownFamily = new Set(next.map((event) => event.id));
  const knownPlans = new Set(next.filter((event) => !event.deleted).map((event) => planKey(event.date, event.time, event.title)));
  for (const remote of googleEvents) {
    const familyId = remote.extendedProperties?.private?.familyId || "";
    const incoming = fromRemote(remote);
    if (!incoming) continue;
    const plan = planKey(incoming.date, incoming.time, incoming.title);
    if (knownIds.has(remote.id) || (familyId && knownFamily.has(familyId)) || knownPlans.has(plan)) continue;
    next.push(incoming);
    knownIds.add(remote.id);
    knownPlans.add(plan);
    added += 1;
  }

  for (const event of next) {
    const cal = event.gcalCal || "primary";
    if (event.deleted || !event.gcalId || !completeCals.has(cal) || !inWindow(event, bounds)) continue;
    if (!liveIds.has(`${cal}/${event.gcalId}`)) {
      event.deleted = true;
      event.updatedAt = Date.now();
      event.gcalAt = event.updatedAt;
      changed += 1;
    }
  }

  const stamped = Date.now();
  for (const event of next) {
    if (event.deleted || event.color || !String(event.id || "").startsWith("g")) continue;
    event.color = GOOGLE_COLOR;
    event.updatedAt = stamped;
    event.gcalAt = stamped;
    changed += 1;
  }

  return { events: next, added, pushed, changed, calendarName: home ? home.summary : "" };
}
