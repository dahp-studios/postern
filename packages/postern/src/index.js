// @dahp/postern: receive a password, text, link or file from a phone, end-to-end encrypted.
//
//   import { receive } from "@dahp/postern";
//   const session = await receive();            // show session.link as a QR code
//   const { item, code } = await session.result; // after the phone sends
//
// Works in any JavaScript runtime with WebCrypto and fetch: browsers, smart-TV web apps (Tizen,
// webOS), Node 20+, Deno, Electron. It uses a WebSocket where there is one and plain HTTP long
// polling otherwise. Protocol: https://postern.dahp.io/developers

import {
  ITEM_TYPES,
  LIMITS,
  SESSION_TTL_MS,
  buildLink,
  createReceiver,
  decodeOfflinePayload,
  fileAsText,
  isSafeUrl,
  withoutTrailingSlash,
} from "../../../shared/protocol.js";

export { ITEM_TYPES, LIMITS, fileAsText, isSafeUrl };
export { drawQr } from "../../../shared/qr.js";

export const DEFAULT_SERVER = "https://postern.dahp.io";
const PING_MS = 20_000;
const RETRY_MS = 2_000;
const MAX_RETRY_MS = 15_000;
const CANCELLED = 4001; // tells the relay to end the session rather than wait for a reconnect

/** Errors from a session, with a `code` you can branch on. */
export class PosternError extends Error {
  /** @param {"expired" | "cancelled" | "decrypt_failed" | "wrong_session"} code */
  constructor(code, message) {
    super(message);
    this.name = "PosternError";
    this.code = code;
  }
}

/**
 * Start a session and wait for the phone.
 *
 * @param {object} [options]
 * @param {string} [options.server]  relay address (default https://postern.dahp.io; or your self-hosted relay)
 * @param {string[]} [options.types]  what the phone may send: "password", "text", "url", "file" (default all)
 * @param {"auto" | "websocket" | "poll"} [options.transport]
 * @param {(status: "connecting" | "waiting" | "offline") => void} [options.onStatus]
 * @param {AbortSignal} [options.signal]  aborting cancels the session
 */
export async function receive({ server = DEFAULT_SERVER, types, transport = "auto", onStatus, signal } = {}) {
  if (typeof server !== "string" || !/^https?:\/\/[^/?#]+/.test(server)) throw new TypeError("server must be an http(s) URL");
  server = withoutTrailingSlash(server);
  const receiver = await createReceiver();
  const { sessionId } = receiver;
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const api = `${server}/api/s/${sessionId}`;

  let finished = false;
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  result.catch(() => {}); // callers that never await it shouldn't see unhandled rejections

  let socket = null;
  let pingTimer = null;
  let pollAbort = null;
  let status = null;
  const setStatus = (next) => {
    if (next !== status && !finished) onStatus?.((status = next));
  };

  const stop = () => {
    finished = true;
    clearTimeout(expiryTimer);
    clearInterval(pingTimer);
    pollAbort?.abort();
    signal?.removeEventListener("abort", onAbort);
  };

  async function accept(message, fromSessionId) {
    if (finished) return;
    if (fromSessionId && fromSessionId !== sessionId) {
      throw new PosternError("wrong_session", "That code belongs to a different QR code.");
    }
    stop();
    socket?.close(1000);
    try {
      resolveResult(await receiver.open(message));
    } catch {
      rejectResult(new PosternError("decrypt_failed", "Received data couldn't be decrypted, so it was discarded."));
    }
  }

  function fail(error) {
    if (finished) return;
    stop();
    rejectResult(error);
  }

  const expiryTimer = setTimeout(() => {
    fail(new PosternError("expired", "The QR code expired."));
    socket?.close(1000);
  }, SESSION_TTL_MS);

  function cancel() {
    if (finished) return;
    if (socket) socket.close(CANCELLED, "cancelled");
    else fetch(api, { method: "DELETE" }).catch(() => {});
    fail(new PosternError("cancelled", "Cancelled."));
  }
  const onAbort = () => cancel();
  signal?.addEventListener("abort", onAbort);

  // --- WebSocket transport -----------------------------------------------------------------
  function connectSocket(onNeverOpened) {
    setStatus("connecting");
    const ws = new WebSocket(`${api.replace(/^http/, "ws")}`);
    socket = ws;
    let opened = false;
    ws.addEventListener("open", () => {
      opened = true;
      ws.send("ping"); // also asks the relay for anything that arrived while reconnecting
      pingTimer = setInterval(() => ws.readyState === 1 && ws.send("ping"), PING_MS);
      setStatus("waiting");
    });
    ws.addEventListener("message", (event) => {
      if (event.data === "pong") return;
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch {
        // accept() reports it as undecryptable
      }
      accept(message);
    });
    ws.addEventListener("close", (event) => {
      clearInterval(pingTimer);
      if (socket === ws) socket = null;
      if (finished) return;
      if (event.code === 4000) return fail(new PosternError("expired", "The QR code expired."));
      if (!opened) return onNeverOpened();
      // Dropped (sleep, network blip): the relay keeps the session, so connect again.
      setStatus("connecting");
      setTimeout(() => !finished && connectSocket(onNeverOpened), RETRY_MS);
    });
  }

  // --- Long-polling transport (devices without WebSocket) ----------------------------------
  async function poll() {
    let retryMs = RETRY_MS;
    // Wait before asking again, longer each time, so a busy or refusing relay isn't flooded.
    const backOff = async () => {
      await new Promise((r) => setTimeout(r, retryMs));
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    };
    while (!finished && Date.now() < expiresAt) {
      pollAbort = new AbortController();
      try {
        const request = fetch(`${api}/wait`, { signal: pollAbort.signal, cache: "no-store" });
        // A poll only answers when it ends; while it's open, the relay counts us as waiting.
        // An unreachable server fails it quickly instead.
        setTimeout(() => !finished && status !== "offline" && setStatus("waiting"), 300);
        const res = await request;
        if (res.status === 200) return accept(await res.json());
        if (res.status === 410) return fail(new PosternError("expired", "The QR code expired."));
        if (res.status === 204) {
          setStatus("waiting"); // nothing yet, ask again
          retryMs = RETRY_MS;
          continue;
        }
        // 429 (too many requests), 409, 5xx…: the relay is refusing for now.
        await backOff();
      } catch {
        if (finished) return;
        setStatus("offline"); // the phone can still send by showing a QR code (acceptOffline)
        await backOff();
      }
    }
  }

  const canSocket = transport !== "poll" && typeof WebSocket === "function";
  if (canSocket) {
    // If the WebSocket can't connect at all (blocked by a proxy, for example), fall back to polling.
    connectSocket(() => (transport === "websocket" ? setStatus("offline") : poll()));
  } else {
    setStatus("connecting");
    poll();
  }

  return {
    /** The link to show as a QR code. It carries the one-time public key after "#". */
    link: buildLink(server, receiver, { types }),
    sessionId,
    expiresAt,
    /** Resolves with { item, code } when the phone sends; rejects with a PosternError. */
    result,
    cancel,
    /**
     * Offline mode: the text of the phone's QR code ("PT1.…"), read with your own camera scanner.
     * Resolves like `result`.
     */
    async acceptOffline(text) {
      const payload = decodeOfflinePayload(text);
      if (!payload) throw new PosternError("wrong_session", "That isn't a Postern code.");
      await accept(payload.message, payload.sessionId);
      return result;
    },
  };
}

/**
 * Put a value into an input or textarea the way typing would, so frameworks (React, Vue, Angular)
 * see the change.
 */
export function fill(field, value) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}
