// Relay: a one-time mailbox per session. It only ever holds ciphertext.
//
//   Laptop: GET  /api/s/:id  (WebSocket upgrade) - waits for the message, sending "ping" to stay awake
//   Phone:  POST /api/s/:id  {v, enc, ct}         - delivered to the laptop, then the session ends
//
// The laptop may reconnect until the session expires. If the phone sends while it is
// reconnecting, the message waits in memory and goes out when the laptop is back. The laptop
// closes with code 4001 when it cancels, which ends the session for good.
//
// Anything else is served from ./public (the phone page).

import { DurableObject } from "cloudflare:workers";

const SESSION_TTL_MS = 2 * 60 * 1000;
const MAX_BODY_BYTES = 768 * 1024; // a 256 KB file is about 460 KB once encrypted and base64-encoded
const CANCELLED = 4001; // close code the laptop sends when it gives up on a session
const ROUTE = /^\/api\/s\/([A-Za-z0-9_-]{22})$/;

const NO_STORE = { "Cache-Control": "no-store" };

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const match = url.pathname.match(ROUTE);
    if (!match) return json(404, { error: "not_found" });

    // Per-IP limit on session opens and sends. `npm run dev` turns it off for local testing.
    if (env.LIMITER && env.RATE_LIMIT !== "off") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return json(429, { error: "rate_limited" });
    }

    const stub = env.SESSIONS.get(env.SESSIONS.idFromName(match[1]));

    if (request.headers.get("Upgrade") === "websocket") return stub.fetch(request);

    if (request.method === "POST") {
      const body = await request.text();
      if (body.length > MAX_BODY_BYTES) return json(413, { error: "too_large" });
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        return json(400, { error: "bad_json" });
      }
      if (!message || typeof message.enc !== "string" || typeof message.ct !== "string" || typeof message.v !== "number") {
        return json(400, { error: "bad_message" });
      }
      // Forward only the known fields.
      return stub.deliver(JSON.stringify({ v: message.v, enc: message.enc, ct: message.ct }));
    }

    return json(405, { error: "method_not_allowed" });
  },
};

export class Session extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // In memory only; nothing is written to storage except the expiry alarm.
    this.laptop = null;
    this.seen = false; // a laptop has connected, so it may come back
    this.pending = null; // a message that arrived while the laptop was reconnecting
    this.closed = false;
  }

  async fetch() {
    if (this.laptop || this.closed) return json(409, { error: "session_unavailable" });

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.laptop = server;
    this.seen = true;
    server.addEventListener("message", (event) => {
      if (event.data === "ping") server.send("pong");
      // The laptop pings as soon as it connects, so a waiting message goes out then.
      if (this.pending && this.laptop === server) this.send(this.pending);
    });
    const gone = (event) => {
      if (this.laptop !== server) return;
      this.laptop = null;
      // The laptop cancelled (or moved on to a new QR code), so don't hold messages for it.
      if (event?.code === CANCELLED) this.end();
    };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SESSION_TTL_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  async deliver(payload) {
    if (this.closed || this.pending) return json(410, { error: "session_closed" });
    if (this.laptop) {
      this.send(payload);
      return json(200, { ok: true });
    }
    if (!this.seen) return json(404, { error: "laptop_not_waiting" });
    this.pending = payload;
    return json(202, { ok: true, queued: true });
  }

  send(payload) {
    this.laptop.send(payload);
    this.pending = null;
    this.end(1000, "delivered");
  }

  async alarm() {
    this.pending = null;
    this.end(4000, "expired");
  }

  end(code = 1000, reason = "") {
    this.closed = true;
    const ws = this.laptop;
    this.laptop = null;
    try {
      ws?.close(code, reason);
    } catch {
      // already closed
    }
  }
}
