import { createCipheriv, createDecipheriv, constants, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import mqtt from "mqtt";
import webpush from "web-push";

const privatePem = process.env.REMINDER_PRIVATE_KEY || "";
const vapidPrivate = process.env.VAPID_PRIVATE_KEY || "";
if (!privatePem || !vapidPrivate) {
  console.log("missing keys");
  process.exit(1);
}

const keysJs = readFileSync(new URL("../js/keys.js", import.meta.url), "utf8");
const vapidPublic = keysJs.match(/VAPID_PUBLIC_KEY = "([^"]+)"/)[1];
const reminderPublicB64 = keysJs.match(/REMINDER_PUBLIC_KEY = "([^"]+)"/)[1];
const reminderPublicPem = derToPem(Buffer.from(reminderPublicB64, "base64"), "PUBLIC KEY");

webpush.setVapidDetails("https://youwest54.github.io/calendar/", vapidPublic, vapidPrivate);

function derToPem(der, label) {
  const body = der.toString("base64").match(/.{1,64}/g).join("\n");
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function b64urlToBuf(text) {
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  return Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function bufToB64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decrypt(message) {
  if (typeof message !== "string" || !message.startsWith("p1.")) return null;
  const parts = message.slice(3).split(".");
  if (parts.length !== 2) return null;
  try {
    const aes = privateDecrypt(
      { key: privatePem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      b64urlToBuf(parts[0])
    );
    const data = b64urlToBuf(parts[1]);
    if (data.length < 12 + 16) return null;
    const iv = data.subarray(0, 12);
    const tag = data.subarray(data.length - 16);
    const cipher = data.subarray(12, data.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", aes, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(cipher), decipher.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

function encrypt(obj) {
  const aes = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aes, iv);
  const text = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final(), cipher.getAuthTag()]);
  const joined = Buffer.concat([iv, text]);
  const wrapped = publicEncrypt(
    { key: reminderPublicPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    aes
  );
  return `p1.${bufToB64url(wrapped)}.${bufToB64url(joined)}`;
}

function listen(ms) {
  const messages = new Map();
  const client = mqtt.connect("wss://broker.hivemq.com:8884/mqtt", {
    clientId: `agjob${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 0,
    connectTimeout: 8000
  });
  client.on("message", (topic, payload) => {
    messages.set(topic, payload.toString("utf8"));
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.end(true);
      reject(new Error("connect"));
    }, 10000);
    client.on("error", () => {});
    client.on("connect", () => {
      client.subscribe("ag/push/#", { qos: 0 }, (err) => {
        if (err) {
          clearTimeout(timer);
          client.end(true);
          reject(err);
          return;
        }
        setTimeout(() => resolve({ client, messages }), ms);
        clearTimeout(timer);
      });
    });
  });
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase().slice(0, 80);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

async function sendMail(email, subject, text) {
  const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(email)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      name: "Family Calendar",
      _subject: String(subject || "Family Calendar").slice(0, 120),
      _captcha: "false",
      _template: "box",
      message: String(text || "").slice(0, 1000)
    })
  });
  if (!res.ok) {
    const err = new Error("mail");
    err.statusCode = res.status;
    throw err;
  }
}

const { client, messages } = await listen(6000);
let sent = { kind: "sent", items: [] };
const devices = [];
for (const [topic, raw] of messages) {
  const data = decrypt(raw);
  if (!data || typeof data !== "object") continue;
  if (topic === "ag/push/sent" && data.kind === "sent" && Array.isArray(data.items)) sent = data;
  else if (data.kind === "device" && Array.isArray(data.jobs)) devices.push(data);
}

const now = Date.now();
const seen = new Set(sent.items.map((item) => `${item.endpoint}|${item.tag}`));
let sentCount = 0;
let failCount = 0;
let mailCount = 0;
let mailFail = 0;
for (const device of devices) {
  const endpoint = typeof device.subscription?.endpoint === "string" ? device.subscription.endpoint : "";
  const email = cleanEmail(device.email);
  if (!endpoint && !email) continue;
  for (const job of device.jobs.slice(0, 100)) {
    if (!job || typeof job.tag !== "string" || typeof job.at !== "string") continue;
    const at = Date.parse(job.at);
    if (!Number.isFinite(at) || at > now || at < now - 48 * 60 * 60 * 1000) continue;
    const title = String(job.title || "Family Calendar").slice(0, 80);
    const body = String(job.body || "A plan is coming up.").slice(0, 180);
    if (endpoint) {
      const key = `${endpoint}|${job.tag}`;
      if (!seen.has(key)) {
        seen.add(key);
        try {
          await webpush.sendNotification(device.subscription, JSON.stringify({
            title,
            body,
            tag: job.tag.slice(0, 80)
          }), { TTL: 60 * 60 * 24, urgency: "high" });
          sent.items.push({ tag: job.tag, at: job.at, endpoint });
          sentCount += 1;
        } catch (err) {
          seen.delete(key);
          failCount += 1;
          console.log("send", err.statusCode || "fail");
        }
      }
    }
    if (email) {
      const key = `mail:${email}|${job.tag}`;
      if (!seen.has(key)) {
        seen.add(key);
        try {
          await sendMail(email, `Family Calendar: ${title}`, `${body}\n\nhttps://youwest54.github.io/calendar/`);
          sent.items.push({ tag: job.tag, at: job.at, endpoint: `mail:${email}` });
          mailCount += 1;
        } catch (err) {
          seen.delete(key);
          mailFail += 1;
          console.log("mail", err.statusCode || "fail");
        }
      }
    }
  }
}
sent.items = sent.items.filter((item) => Date.parse(item.at) > now - 14 * 24 * 60 * 60 * 1000);
client.publish("ag/push/sent", encrypt(sent), { retain: true, qos: 0 });
await new Promise((resolve) => setTimeout(resolve, 500));
client.end(true);
console.log(`devices ${devices.length} sent ${sentCount} fail ${failCount} mail ${mailCount} mailfail ${mailFail}`);
