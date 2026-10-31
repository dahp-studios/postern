// One session's mailbox: the relay logic shared by the Cloudflare Worker (Durable Object) and the
// self-hosted Node server, so both behave identically. It only ever holds ciphertext, in memory.
//
// The receiver (laptop, TV, website) waits in one of two ways:
//   - a WebSocket: attachSocket(); it sends "ping" to stay awake and gets "pong"
//   - plain HTTP long polling: wait(), which answers 200 with the message or 204 after WAIT_MS
// The sender (phone) calls deliver(). One message per session, then it ends.
//
// The receiver may reconnect until the session expires. If the sender delivers while the receiver is
// between connections, the message waits here (202) and goes out when it's back. cancel(), or a
// WebSocket closed with code 4001, ends the session for good.

export const SESSION_TTL_MS = 2 * 60 * 1000;
export const WAIT_MS = 25 * 1000; // under the ~30 s idle limit of most proxies
export const CANCELLED = 4001;
export const EXPIRED = 4000;

const reply = (status, body) => ({ status, body });

export class Mailbox {
  /** @param {{ onFirstUse?: () => Promise<void> | void }} hooks  starts the expiry timer */
  constructor({ onFirstUse } = {}) {
    this.onFirstUse = onFirstUse;
    this.socket = null; // { send(text), close(code, reason) }
    this.poller = null; // resolves the open long poll
    this.seen = false; // a receiver has connected, so it may come back
    this.pending = null; // a message that arrived while the receiver was away
    this.closed = false;
  }

  async #markSeen() {
    if (this.seen) return;
    this.seen = true;
    await this.onFirstUse?.();
  }

  /** Whether a receiver could connect now (checked before accepting a WebSocket upgrade). */
  canAttach() {
    return !this.closed && !this.socket && !this.poller;
  }

  /**
   * A receiver's WebSocket has connected. Returns an error reply, or the handlers to call for
   * its messages and its close.
   */
  async attachSocket(socket) {
    if (this.closed || this.socket || this.poller) return { error: reply(409, { error: "session_unavailable" }) };
    this.socket = socket;
    await this.#markSeen();
    if (this.closed) {
      this.socket = null; // cancelled meanwhile
      return { error: reply(410, { error: "session_closed" }) };
    }
    return {
      message: (data) => {
        if (data === "ping") socket.send("pong");
        // The receiver pings as soon as it connects, so a waiting message goes out then.
        if (this.pending && this.socket === socket) this.#hand(this.pending);
      },
      close: (code) => {
        if (this.socket !== socket) return;
        this.socket = null;
        if (code === CANCELLED) this.end(); // gave up, so don't hold messages for it
      },
    };
  }

  /** Long poll: 200 with the message, 204 if nothing came within WAIT_MS, or an error. */
  async wait(waitMs = WAIT_MS) {
    if (this.closed) return reply(410, { error: "session_closed" });
    if (this.socket) return reply(409, { error: "session_unavailable" });
    await this.#markSeen();
    if (this.closed) return reply(410, { error: "session_closed" }); // cancelled meanwhile
    if (this.pending) {
      const message = this.pending;
      this.pending = null;
      this.end();
      return reply(200, message);
    }
    this.poller?.(null); // a newer poll replaces an older one (the client probably lost it)
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(null), waitMs);
      const finish = (message) => {
        clearTimeout(timer);
        if (this.poller === finish) this.poller = null;
        if (message) resolve(reply(200, message));
        else resolve(this.closed ? reply(410, { error: "session_closed" }) : reply(204, null));
      };
      this.poller = finish;
    });
  }

  /** The sender's message (a JSON string of {v, enc, ct}). */
  deliver(message) {
    if (this.closed || this.pending) return reply(410, { error: "session_closed" });
    if (this.socket || this.poller) {
      this.#hand(message);
      return reply(200, { ok: true });
    }
    if (!this.seen) return reply(404, { error: "laptop_not_waiting" });
    this.pending = message;
    return reply(202, { ok: true, queued: true });
  }

  cancel() {
    const wasOpen = !this.closed;
    this.pending = null;
    this.end(CANCELLED, "cancelled");
    return reply(wasOpen ? 200 : 410, wasOpen ? { ok: true } : { error: "session_closed" });
  }

  expire() {
    this.pending = null;
    this.end(EXPIRED, "expired");
  }

  #hand(message) {
    if (this.socket) this.socket.send(message);
    else this.poller?.(message);
    this.pending = null;
    this.end(1000, "delivered");
  }

  end(code = 1000, reason = "") {
    this.closed = true;
    const socket = this.socket;
    this.socket = null;
    this.poller?.(null);
    try {
      socket?.close(code, reason);
    } catch {
      // already closed
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Request checks shared by both servers.

export const MAX_BODY_BYTES = 768 * 1024; // a 256 KB file is about 460 KB once encrypted and base64-encoded
const ROUTE = /^\/api\/s\/([A-Za-z0-9_-]{22})(\/wait)?$/;

/** Which session and action a request is for: { id, action } or null. */
export function route(method, pathname, isUpgrade) {
  const match = pathname.match(ROUTE);
  if (!match) return null;
  const [, id, wait] = match;
  if (wait) return method === "GET" ? { id, action: "wait" } : { id, action: "bad_method" };
  if (isUpgrade) return { id, action: "socket" };
  if (method === "POST") return { id, action: "deliver" };
  if (method === "DELETE") return { id, action: "cancel" };
  if (method === "OPTIONS") return { id, action: "preflight" };
  return { id, action: "bad_method" };
}

/** Validate a sender's POST body. Returns { message } (the JSON to forward) or { error: reply }. */
export function parseDelivery(text) {
  if (text.length > MAX_BODY_BYTES) return { error: reply(413, { error: "too_large" }) };
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return { error: reply(400, { error: "bad_json" }) };
  }
  if (!message || typeof message.enc !== "string" || typeof message.ct !== "string" || typeof message.v !== "number") {
    return { error: reply(400, { error: "bad_message" }) };
  }
  // Forward only the known fields.
  return { message: JSON.stringify({ v: message.v, enc: message.enc, ct: message.ct }) };
}

// The API holds no cookies or credentials, so any website may call it (the npm package runs on
// other sites' pages).
export const API_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
