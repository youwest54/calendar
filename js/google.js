const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

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
  start.setDate(start.getDate() - 60);
  const end = new Date();
  end.setDate(end.getDate() + 400);
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

async function listEvents(token, bounds) {
  const all = [];
  let page = "";
  do {
    const url = new URL(API);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("timeMin", bounds.timeMin);
    url.searchParams.set("timeMax", bounds.timeMax);
    if (page) url.searchParams.set("pageToken", page);
    const data = await gfetch(token, url);
    all.push(...(data.items || []));
    page = data.nextPageToken || "";
  } while (page && all.length < 1000);
  return all;
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
  const color = /^#[0-9a-f]{6}$/i.test(extra.color || "") ? extra.color.toLowerCase() : "";
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
    gcalAt: now,
    updatedAt: now,
    deleted: false
  };
}

function applyRemote(event, remote) {
  const incoming = fromRemote(remote);
  if (!incoming) return;
  event.date = incoming.date;
  event.end = incoming.end;
  event.time = incoming.time;
  event.title = incoming.title;
  event.note = incoming.note;
  if (incoming.category) event.category = incoming.category;
  if (incoming.who) event.who = incoming.who;
  if (incoming.color) event.color = incoming.color;
  event.gcalId = remote.id;
  event.updatedAt = Date.now();
  event.gcalAt = event.updatedAt;
  event.deleted = false;
}

export async function syncGoogle(token, events) {
  const bounds = windowBounds();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const googleEvents = await listEvents(token, bounds);
  const byId = new Map(googleEvents.map((item) => [item.id, item]));
  const byFamily = new Map();
  for (const item of googleEvents) {
    const familyId = item.extendedProperties?.private?.familyId;
    if (familyId) byFamily.set(familyId, item);
  }
  const liveIds = new Set(googleEvents.map((item) => item.id));
  const next = events.map((event) => ({ ...event }));
  let added = 0;
  let pushed = 0;
  let changed = 0;

  for (const event of next) {
    if (event.deleted) {
      if (event.gcalId && liveIds.has(event.gcalId)) {
        await gfetch(token, `${API}/${encodeURIComponent(event.gcalId)}`, { method: "DELETE" });
        liveIds.delete(event.gcalId);
        pushed += 1;
      }
      continue;
    }
    const remote = (event.gcalId && byId.get(event.gcalId)) || byFamily.get(event.id) || null;
    if (!remote) {
      if (!inWindow(event, bounds)) continue;
      const created = await gfetch(token, API, { method: "POST", body: JSON.stringify(toGoogle(event, zone)) });
      event.gcalId = created.id;
      event.gcalAt = Date.now();
      liveIds.add(created.id);
      pushed += 1;
      continue;
    }
    event.gcalId = remote.id;
    const remoteAt = Date.parse(remote.updated) || 0;
    const localDirty = (event.updatedAt || 0) > (event.gcalAt || 0);
    const remoteDirty = remoteAt > (event.gcalAt || 0);
    if (remoteDirty && (!localDirty || remoteAt >= (event.updatedAt || 0))) {
      applyRemote(event, remote);
      changed += 1;
    } else if (localDirty) {
      await gfetch(token, `${API}/${encodeURIComponent(remote.id)}`, {
        method: "PATCH",
        body: JSON.stringify(toGoogle(event, zone))
      });
      event.gcalAt = Date.now();
      pushed += 1;
    } else if (!event.gcalAt) {
      event.gcalAt = Date.now();
    }
  }

  const knownIds = new Set(next.map((event) => event.gcalId).filter(Boolean));
  const knownFamily = new Set(next.map((event) => event.id));
  for (const remote of googleEvents) {
    const familyId = remote.extendedProperties?.private?.familyId || "";
    if (knownIds.has(remote.id) || (familyId && knownFamily.has(familyId))) continue;
    const local = fromRemote(remote);
    if (!local) continue;
    next.push(local);
    knownIds.add(remote.id);
    added += 1;
  }

  for (const event of next) {
    if (event.deleted || !event.gcalId || !inWindow(event, bounds)) continue;
    if (!liveIds.has(event.gcalId)) {
      event.deleted = true;
      event.updatedAt = Date.now();
      event.gcalAt = event.updatedAt;
      changed += 1;
    }
  }

  return { events: next, added, pushed, changed };
}
