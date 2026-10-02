// Encrypted sync over a public MQTT broker. The broker only sees ciphertext.
// The key stays in the link hash and on each phone.

const BROKER = "wss://broker.hivemq.com:8884/mqtt";

export function randomSecret(size = 16) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToB64url(bytes);
}

export function createSync({ getDoc, onRemote, onReady, onStatus }) {
  let ws = null;
  let generation = 0;
  let stopped = true;
  let roomId = "";
  let topic = "";
  let keyPromise = null;
  let buf = new Uint8Array(0);
  let chain = Promise.resolve();
  let pingTimer = null;
  let watchdog = null;
  let connTimer = null;
  let retainTimer = null;
  let retries = 0;
  let lastRx = 0;
  let packetId = 1;
  let seq = 0;
  let queued = false;
  let canSend = false;
  let waitDone = false;

  function setStatus(mode) {
    try {
      onStatus(mode);
    } catch {
      /* ignore UI errors */
    }
  }

  function clearTimers() {
    clearInterval(pingTimer);
    clearInterval(watchdog);
    clearTimeout(connTimer);
    clearTimeout(retainTimer);
    pingTimer = null;
    watchdog = null;
    connTimer = null;
    retainTimer = null;
  }

  function publish() {
    queued = true;
    if (!canSend || !ws || ws.readyState !== WebSocket.OPEN) return;
    queued = false;
    void sendNow();
  }

  async function sendNow() {
    const mine = ++seq;
    try {
      const key = await keyPromise;
      const payload = await encrypt(key, getDoc());
      if (mine !== seq || !ws || ws.readyState !== WebSocket.OPEN) {
        if (mine === seq) queued = true;
        return;
      }
      ws.send(publishPacket(topic, payload));
    } catch {
      if (mine === seq) queued = true;
    }
  }

  function deliver(doc) {
    try {
      onRemote(doc);
    } catch {
      /* ignore UI errors */
    }
  }

  function finishWait(gen, doc) {
    if (gen !== generation) return;
    if (waitDone) {
      if (doc) deliver(doc);
      return;
    }
    waitDone = true;
    canSend = true;
    clearTimeout(retainTimer);
    retainTimer = null;
    if (doc) deliver(doc);
    else {
      try {
        onReady();
      } catch {
        /* ignore UI errors */
      }
    }
    if (queued) {
      queued = false;
      void sendNow();
    }
  }

  function sendSubscribe() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    packetId = (packetId % 65535) + 1;
    ws.send(subscribePacket(topic, packetId));
  }

  function takePacket() {
    if (buf.length < 2) return null;
    let multiplier = 1;
    let value = 0;
    let offset = 1;
    for (let i = 0; i < 4; i += 1) {
      if (offset >= buf.length) return null;
      const byte = buf[offset];
      offset += 1;
      value += (byte & 127) * multiplier;
      multiplier *= 128;
      if ((byte & 128) === 0) {
        if (buf.length < offset + value) return null;
        const type = buf[0] >> 4;
        const flags = buf[0] & 0x0f;
        const payload = buf.slice(offset, offset + value);
        buf = buf.slice(offset + value);
        return { type, flags, payload };
      }
    }
    return null;
  }

  function connect() {
    const gen = ++generation;
    canSend = false;
    waitDone = false;
    buf = new Uint8Array(0);
    clearTimers();
    if (ws) {
      const old = ws;
      ws = null;
      old.onopen = null;
      old.onclose = null;
      old.onerror = null;
      old.onmessage = null;
      try {
        old.close();
      } catch {
          /* ignore */
        }
    }
    setStatus("connecting");
    const socket = new WebSocket(BROKER, "mqtt");
    socket.binaryType = "arraybuffer";
    ws = socket;

    connTimer = setTimeout(() => {
      if (gen === generation) {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }
    }, 8000);

    socket.onopen = () => {
      if (gen !== generation) return;
      lastRx = Date.now();
      socket.send(connectPacket(clientId()));
    };

    socket.onmessage = (ev) => {
      if (gen !== generation) return;
      chain = chain
        .then(async () => {
          const ab = await toArrayBuffer(ev.data);
          if (ab && gen === generation) onData(gen, ab);
        })
        .catch(() => {});
    };

    socket.onerror = () => {};

    socket.onclose = () => {
      if (gen !== generation || stopped) return;
      canSend = false;
      clearTimers();
      setStatus("offline");
      const delay = Math.min(15000, 800 * 2 ** Math.min(retries, 4));
      retries += 1;
      setTimeout(() => {
        if (gen === generation && !stopped) connect();
      }, delay);
    };

    pingTimer = setInterval(() => {
      if (gen === generation && socket.readyState === WebSocket.OPEN) {
        socket.send(new Uint8Array([0xc0, 0x00]));
      }
    }, 20000);

    watchdog = setInterval(() => {
      if (gen !== generation) return;
      if (Date.now() - lastRx > 55000 && socket.readyState === WebSocket.OPEN) {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }
    }, 10000);
  }

  function onData(gen, ab) {
    const chunk = new Uint8Array(ab);
    const next = new Uint8Array(buf.length + chunk.length);
    next.set(buf, 0);
    next.set(chunk, buf.length);
    buf = next;
    while (gen === generation) {
      const pkt = takePacket();
      if (!pkt) break;
      lastRx = Date.now();
      if (pkt.type === 3) {
        const decoded = decodePublish(pkt);
        if (decoded && decoded.qos === 1 && decoded.packetId != null && ws) {
          ws.send(puback(decoded.packetId));
        }
        if (decoded?.text) {
          const text = decoded.text;
          chain = chain.then(() => handleMessage(gen, text)).catch(() => {});
        }
      } else {
        handleControl(gen, pkt);
      }
    }
  }

  function handleControl(gen, pkt) {
    if (pkt.type === 2) {
      clearTimeout(connTimer);
      const code = pkt.payload[1] || 0;
      if (code !== 0) {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
        return;
      }
      sendSubscribe();
      return;
    }
    if (pkt.type === 9) {
      retries = 0;
      setStatus("online");
      if (!waitDone && !retainTimer) {
        retainTimer = setTimeout(() => finishWait(gen, null), 1500);
      }
    }
  }

  async function handleMessage(gen, text) {
    if (gen !== generation) return;
    let doc = null;
    try {
      const key = await keyPromise;
      doc = await decrypt(key, text);
    } catch {
      doc = null;
    }
    if (!doc || gen !== generation) return;
    if (!waitDone) finishWait(gen, doc);
    else deliver(doc);
  }

  async function start(room, keyB64) {
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(room)) throw new Error("Bad room");
    const key = await importKey(keyB64);
    stop();
    stopped = false;
    roomId = room;
    topic = `ag/v1/${room}`;
    keyPromise = Promise.resolve(key);
    queued = false;
    connect();
  }

  function nudge() {
    if (stopped || !roomId) return;
    if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastRx < 12000) {
      waitDone = false;
      canSend = false;
      clearTimeout(retainTimer);
      sendSubscribe();
      retainTimer = setTimeout(() => finishWait(generation, null), 1500);
      return;
    }
    connect();
  }

  function stop() {
    stopped = true;
    generation += 1;
    canSend = false;
    waitDone = false;
    queued = false;
    roomId = "";
    clearTimers();
    if (ws) {
      const old = ws;
      ws = null;
      old.onopen = null;
      old.onclose = null;
      old.onerror = null;
      old.onmessage = null;
      try {
        old.close();
      } catch {
          /* ignore */
        }
    }
  }

  return { start, publish, nudge, stop };
}

function clientId() {
  return `ag${Math.random().toString(16).slice(2, 12)}`;
}

function encodeRemaining(length) {
  const out = [];
  let n = length;
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}

function strField(str) {
  const bytes = new TextEncoder().encode(str);
  const out = new Uint8Array(2 + bytes.length);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function packet(header, parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const rl = encodeRemaining(size);
  const out = new Uint8Array(1 + rl.length + size);
  out[0] = header;
  out.set(rl, 1);
  let offset = 1 + rl.length;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function connectPacket(id) {
  const proto = strField("MQTT");
  const flags = new Uint8Array(4);
  flags[0] = 4;
  flags[1] = 0x02;
  flags[2] = 0;
  flags[3] = 45;
  return packet(0x10, [proto, flags, strField(id)]);
}

function subscribePacket(topic, id) {
  const head = new Uint8Array([(id >> 8) & 0xff, id & 0xff]);
  return packet(0x82, [head, strField(topic), new Uint8Array([0])]);
}

function publishPacket(topic, message) {
  return packet(0x31, [strField(topic), new TextEncoder().encode(message)]);
}

function puback(id) {
  return new Uint8Array([0x40, 0x02, (id >> 8) & 0xff, id & 0xff]);
}

function decodePublish(pkt) {
  const payload = pkt.payload;
  if (payload.length < 2) return null;
  const topicLength = (payload[0] << 8) | payload[1];
  let offset = 2 + topicLength;
  if (payload.length < offset) return null;
  const qos = (pkt.flags >> 1) & 0x03;
  let id = null;
  if (qos > 0) {
    if (payload.length < offset + 2) return null;
    id = (payload[offset] << 8) | payload[offset + 1];
    offset += 2;
  }
  return {
    text: new TextDecoder().decode(payload.slice(offset)),
    qos,
    packetId: id
  };
}

function bytesToB64url(bytes) {
  let bin = "";
  const chunk = 0x4000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(text) {
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(b64) {
  const raw = b64urlToBytes(b64);
  if (raw.length !== 16) throw new Error("Bad key");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const joined = new Uint8Array(iv.length + cipher.length);
  joined.set(iv, 0);
  joined.set(cipher, iv.length);
  return `v1.${bytesToB64url(joined)}`;
}

async function decrypt(key, message) {
  if (typeof message !== "string" || !message.startsWith("v1.")) return null;
  const bytes = b64urlToBytes(message.slice(3));
  if (bytes.length < 13) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      key,
      bytes.slice(12)
    );
    const data = JSON.parse(new TextDecoder().decode(plain));
    if (!data || typeof data !== "object" || !Array.isArray(data.events)) return null;
    return data;
  } catch {
    return null;
  }
}

async function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.arrayBuffer();
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return null;
}
