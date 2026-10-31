// Relay on Cloudflare Workers: a one-time mailbox per session (a Durable Object), holding only
// ciphertext. The session logic is in mailbox.js, shared with the self-hosted server.
//
//   Receiver: GET    /api/s/:id       WebSocket upgrade; waits for the message ("ping" → "pong")
//             GET    /api/s/:id/wait  or plain HTTP long polling: 200 message | 204 try again
//             DELETE /api/s/:id       cancel
//   Sender:   POST   /api/s/:id       {v, enc, ct}; delivered, then the session ends
//
// Anything else is served from ./public (the phone page). Protocol: docs/PROTOCOL.md.

import { DurableObject } from "cloudflare:workers";
import { API_HEADERS, Mailbox, SESSION_TTL_MS, parseDelivery, route } from "./mailbox.js";

const respond = ({ status, body }) => new Response(body == null ? null : typeof body === "string" ? body : JSON.stringify(body), { status, headers: API_HEADERS });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const isUpgrade = request.headers.get("Upgrade") === "websocket";
    const target = route(request.method, url.pathname, isUpgrade);
    if (!target) return respond({ status: 404, body: { error: "not_found" } });
    if (target.action === "preflight") return new Response(null, { status: 204, headers: API_HEADERS });
    if (target.action === "bad_method") return respond({ status: 405, body: { error: "method_not_allowed" } });

    // Per-IP limit on session opens and sends. `npm run dev` turns it off for local testing.
    if (env.LIMITER && env.RATE_LIMIT !== "off") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return respond({ status: 429, body: { error: "rate_limited" } });
    }

    const stub = env.SESSIONS.get(env.SESSIONS.idFromName(target.id));
    switch (target.action) {
      case "socket":
        return stub.fetch(request);
      case "wait":
        return respond(await stub.wait());
      case "cancel":
        return respond(await stub.cancel());
      case "deliver": {
        const parsed = parseDelivery(await request.text());
        return respond(parsed.error ?? (await stub.deliver(parsed.message)));
      }
    }
  },
};

export class Session extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // In memory only; nothing is written to storage except the expiry alarm.
    this.box = new Mailbox({
      onFirstUse: async () => {
        if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SESSION_TTL_MS);
      },
    });
  }

  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    const handlers = await this.box.attachSocket(server);
    if (handlers.error) return respond(handlers.error);
    server.accept();
    server.addEventListener("message", (event) => handlers.message(event.data));
    server.addEventListener("close", (event) => handlers.close(event.code));
    server.addEventListener("error", () => handlers.close());
    return new Response(null, { status: 101, webSocket: client });
  }

  wait() {
    return this.box.wait();
  }

  deliver(message) {
    return this.box.deliver(message);
  }

  cancel() {
    return this.box.cancel();
  }

  async alarm() {
    this.box.expire();
  }
}
