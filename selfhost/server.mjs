// Self-hosted Postern relay: the same API and phone page as postern.dahp.io, on your own server.
// The session logic is the shared relay/src/mailbox.js, so it behaves exactly like the Cloudflare one.
//
//   node server.mjs                     # http://0.0.0.0:8790
//
// Settings (environment variables):
//   PORT=8790          HOST=0.0.0.0
//   RATE_LIMIT=30      API requests per minute per IP; 0 turns it off
//   TRUST_PROXY=1      take the client IP from X-Forwarded-For (only behind your own proxy)
//   PUBLIC_DIR=…       the built phone page (default ../relay/public; `npm run build` makes it)
//
// Put it behind HTTPS (a reverse proxy such as Caddy or nginx): phones only run the encryption on
// https pages. It keeps everything in memory; nothing is written to disk.

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { API_HEADERS, MAX_BODY_BYTES, Mailbox, SESSION_TTL_MS, parseDelivery, route } from "../relay/src/mailbox.js";

const PORT = Number(process.env.PORT ?? 8790);
const HOST = process.env.HOST ?? "0.0.0.0";
const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 30);
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const PUBLIC_DIR = normalize(process.env.PUBLIC_DIR ?? fileURLToPath(new URL("../relay/public/", import.meta.url)));

// --- Sessions ----------------------------------------------------------------------------------

const sessions = new Map(); // id → Mailbox

function session(id) {
  let box = sessions.get(id);
  if (!box) {
    box = new Mailbox({ onFirstUse: () => setTimeout(() => box.expire(), SESSION_TTL_MS).unref() });
    sessions.set(id, box);
    // Forget it after its lifetime, used or not.
    setTimeout(() => sessions.delete(id), SESSION_TTL_MS + 10_000).unref();
  }
  return box;
}

// --- Rate limit: fixed one-minute window per IP --------------------------------------------------

const hits = new Map(); // ip → { count, start }
setInterval(() => {
  const now = Date.now();
  for (const [ip, h] of hits) if (now - h.start > 60_000) hits.delete(ip);
}, 60_000).unref();

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return String(forwarded).split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

function allowed(req) {
  if (!RATE_LIMIT) return true;
  const ip = clientIp(req);
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > 60_000) {
    hits.set(ip, { count: 1, start: now });
    return true;
  }
  h.count += 1;
  return h.count <= RATE_LIMIT;
}

// --- Static files (the phone page) ---------------------------------------------------------------

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};

// The same security headers Cloudflare applies, read from the build's _headers file ("/*" block).
async function loadHeaders() {
  try {
    const text = await readFile(join(PUBLIC_DIR, "_headers"), "utf8");
    const headers = {};
    for (const line of text.split("\n")) {
      const m = line.match(/^\s+([\w-]+):\s*(.+)$/);
      if (m) headers[m[1]] = m[2].trim();
    }
    return headers;
  } catch {
    return {};
  }
}
const pageHeaders = await loadHeaders();

async function serveStatic(req, res, pathname) {
  // Pages are served without ".html", as on Cloudflare.
  if (pathname.endsWith(".html")) {
    const pretty = pathname === "/index.html" ? "/" : pathname.slice(0, -5);
    res.writeHead(307, { Location: pretty });
    return res.end();
  }
  const candidates = pathname === "/" ? ["index.html"] : [pathname.slice(1), `${pathname.slice(1)}.html`];
  for (const name of candidates) {
    const file = normalize(join(PUBLIC_DIR, name));
    if (!file.startsWith(PUBLIC_DIR) || name.startsWith("_")) continue;
    try {
      if (!(await stat(file)).isFile()) continue;
      const body = await readFile(file);
      res.writeHead(200, { ...pageHeaders, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
      return res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      // try the next candidate
    }
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

// --- API ---------------------------------------------------------------------------------------

function send(res, { status, body }) {
  res.writeHead(status, API_HEADERS);
  res.end(body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body));
}

/** The request body, or null if it's over the size limit (the rest is read and dropped). */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://relay");
  if (pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }
  if (!pathname.startsWith("/api/")) return serveStatic(req, res, pathname);

  const target = route(req.method, pathname, false);
  if (!target) return send(res, { status: 404, body: { error: "not_found" } });
  if (target.action === "preflight") return send(res, { status: 204, body: null });
  if (target.action === "bad_method") return send(res, { status: 405, body: { error: "method_not_allowed" } });
  if (!allowed(req)) return send(res, { status: 429, body: { error: "rate_limited" } });

  if (target.action === "wait") {
    const box = session(target.id);
    req.on("close", () => {
      // The receiver gave up on this poll; let it count as gone, not as waiting.
      if (!res.writableEnded && box.poller) box.poller(null);
    });
    return send(res, await box.wait());
  }
  if (target.action === "cancel") return send(res, session(target.id).cancel());
  if (target.action === "deliver") {
    const text = await readBody(req);
    if (text === null) return send(res, { status: 413, body: { error: "too_large" } });
    const parsed = parseDelivery(text);
    if (parsed.error) return send(res, parsed.error);
    const box = sessions.get(target.id);
    return send(res, box ? box.deliver(parsed.message) : { status: 404, body: { error: "laptop_not_waiting" } });
  }
  send(res, { status: 400, body: { error: "websocket_expected" } });
});

// WebSocket receivers
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://relay");
  const target = route("GET", pathname, true);
  const refuse = (status, text) => {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n`);
  };
  if (!target || target.action !== "socket") return refuse(404, "Not Found");
  if (!allowed(req)) return refuse(429, "Too Many Requests");
  const box = session(target.id);
  if (!box.canAttach()) return refuse(409, "Conflict");

  wss.handleUpgrade(req, socket, head, async (ws) => {
    const handlers = await box.attachSocket({ send: (m) => ws.send(m), close: (code, reason) => ws.close(code, reason) });
    if (handlers.error) return ws.close(1013, "unavailable");
    ws.on("message", (data, isBinary) => handlers.message(isBinary ? null : data.toString()));
    ws.on("close", (code) => handlers.close(code));
    ws.on("error", () => handlers.close());
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Postern relay on http://${HOST}:${PORT} (rate limit ${RATE_LIMIT || "off"}${TRUST_PROXY ? ", trusting X-Forwarded-For" : ""})`);
  console.log(`Phone page from ${PUBLIC_DIR}`);
});
