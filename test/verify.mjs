// `npm run verify`: proves the relay never sees anything readable.
//
// Puts a recording proxy between the client and a running relay (`npm run dev`), so every byte
// the relay receives or sends is captured exactly as the server sees it. It then sends real
// secrets of every type through it and searches the recording for them in every common
// encoding (see leak.mjs), plus the session keys. WebSocket frames are unmasked before
// searching, and decompressed when the connection uses permessage-deflate (Chrome and Node both
// do). A deliberately unencrypted message at the end checks that the search itself works.
//
//   npm run verify                                  # against http://localhost:8787
//   PT_SERVER=http://localhost:8790 npm run verify  # another local relay
//
// The full recording is written to verify-capture.log so you can read it yourself.

import net from "node:net";
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { createReceiver, sealItem, buildLink } from "../shared/protocol.js";
import { findLeaks } from "./leak.mjs";

const target = new URL(process.env.PT_SERVER || "http://localhost:8787");
if (target.protocol !== "http:") {
  console.error("verify needs a local relay over plain http, so the recording shows the bytes as the server sees them.\nStart one with `npm run dev` (with HTTPS, the server is the only place they could be read).");
  process.exit(2);
}

// --- Recording proxy ---------------------------------------------------------------------------

const connections = []; // { id, up: Buffer[], down: Buffer[] }
const proxy = net.createServer((client) => {
  const conn = { id: connections.length + 1, up: [], down: [] };
  connections.push(conn);
  const upstream = net.connect(Number(target.port || 80), target.hostname);
  client.on("data", (d) => {
    conn.up.push(Buffer.from(d));
    upstream.write(d);
  });
  upstream.on("data", (d) => {
    conn.down.push(Buffer.from(d));
    client.write(d);
  });
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${proxy.address().port}`;

/** Inflate permessage-deflate messages in order, sharing one window as RFC 7692 requires. */
async function inflateMessages(payloads) {
  const inflater = zlib.createInflateRaw();
  const out = [];
  for (const payload of payloads) {
    const chunks = [];
    const collect = (c) => chunks.push(c);
    inflater.on("data", collect);
    await new Promise((resolve, reject) => {
      inflater.once("error", reject);
      inflater.write(Buffer.concat([payload, Buffer.from([0x00, 0x00, 0xff, 0xff])]));
      inflater.flush(zlib.constants.Z_SYNC_FLUSH, resolve);
    });
    inflater.off("data", collect);
    out.push(Buffer.concat(chunks));
  }
  inflater.close();
  return out;
}

/** Split a recorded direction into the HTTP part and, after an upgrade, readable WebSocket payloads. */
async function decode(bytes, upgraded) {
  if (!upgraded) return { http: bytes, frames: [] };
  const end = bytes.indexOf("\r\n\r\n") + 4;
  const http = bytes.subarray(0, end);
  const frames = [];
  let i = end;
  while (i + 2 <= bytes.length) {
    const compressed = (bytes[i] & 0x40) !== 0; // RSV1: compressed with permessage-deflate
    let len = bytes[i + 1] & 0x7f;
    const masked = (bytes[i + 1] & 0x80) !== 0;
    let p = i + 2;
    if (len === 126) (len = bytes.readUInt16BE(p)), (p += 2);
    else if (len === 127) (len = Number(bytes.readBigUInt64BE(p))), (p += 8);
    const mask = masked ? bytes.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (p + len > bytes.length) break;
    const payload = Buffer.from(bytes.subarray(p, p + len));
    if (mask) for (let k = 0; k < len; k++) payload[k] ^= mask[k & 3];
    frames.push({ opcode: bytes[i] & 0x0f, compressed, payload });
    i = p + len;
  }
  const compressed = frames.filter((f) => f.compressed);
  const inflated = await inflateMessages(compressed.map((f) => f.payload));
  compressed.forEach((f, k) => (f.payload = inflated[k]));
  return { http, frames };
}

// --- Real transfers through the proxy ----------------------------------------------------------

const secrets = {
  password: "Verify-P@ssw0rd-ünï-🔐-" + crypto.randomUUID().slice(0, 8),
  text: "verify-user-id-" + crypto.randomUUID(),
  url: "https://example.com/reset?token=verify-" + crypto.randomUUID(),
  fileName: "verify-secret-name-" + crypto.randomUUID().slice(0, 8) + ".json",
  fileContent: "verify-api-key-" + crypto.randomUUID(),
};
const items = [
  { type: "password", text: secrets.password },
  { type: "text", text: secrets.text },
  { type: "url", text: secrets.url },
  { type: "file", name: secrets.fileName, mime: "application/json", bytes: new TextEncoder().encode(JSON.stringify({ apiKey: secrets.fileContent })) },
];
const keys = []; // every session's keys: neither may appear on the wire
const noCompression = { "Accept-Encoding": "identity" }; // so response bodies are searchable as-is

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✖"} ${label}${detail ? `  ${detail}` : ""}`);
};

console.log(`Recording everything between the client and ${target.origin}\n`);

for (const item of items) {
  const laptop = await createReceiver();
  const saved = await laptop.save();
  keys.push(saved.privateKey, saved.publicKey);
  const link = buildLink(base, laptop);

  // Phone: opens the QR link exactly as a browser would (fetch drops the #fragment, as browsers do).
  const page = await fetch(link, { headers: noCompression, cache: "no-store" });
  await page.text();

  // Laptop: waits on the WebSocket.
  const ws = new WebSocket(`${base.replace("http", "ws")}/api/s/${laptop.sessionId}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error(`Can't reach the relay at ${target.origin}. Is \`npm run dev\` running?`)), { once: true });
  });
  const incoming = new Promise((resolve) => ws.addEventListener("message", (e) => e.data !== "pong" && resolve(e.data)));
  ws.send("ping");

  // Phone: seals and sends.
  const { message, code } = await sealItem({ ...laptop, item });
  const res = await fetch(`${base}/api/s/${laptop.sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...noCompression },
    body: JSON.stringify(message),
  });
  await res.text();

  // Laptop: decrypts. The transfer has to actually work for the recording to mean anything.
  const opened = await laptop.open(JSON.parse(await incoming));
  const same = item.type === "file" ? opened.item.name === item.name && Buffer.from(opened.item.bytes).equals(Buffer.from(item.bytes)) : opened.item.text === item.text;
  check(`${item.type}: sent through the relay and decrypted correctly on the laptop`, res.ok && same && opened.code === code, `(HTTP ${res.status}, code ${code})`);
  ws.close();
}

// Control: an unencrypted message must be caught, or the search proves nothing.
const canary = "verify-canary-UNENCRYPTED-" + crypto.randomUUID();
await (await fetch(`${base}/api/s/${"A".repeat(22)}`, { method: "POST", headers: noCompression, body: JSON.stringify({ v: 1, enc: "x", ct: canary }) })).text();

await new Promise((r) => setTimeout(r, 300));
proxy.close();

// --- Search the recording ----------------------------------------------------------------------

const streams = []; // { label, bytes }
const decoded = []; // per connection, for the log
let compressedFrames = 0;
let frameCount = 0;
const frameTexts = [];
for (const conn of connections) {
  const up = Buffer.concat(conn.up);
  const down = Buffer.concat(conn.down);
  const upgraded = /^HTTP\/1\.1 101/.test(down.toString("latin1", 0, 12));
  const u = await decode(up, upgraded);
  const d = await decode(down, upgraded);
  decoded.push({ conn, u, d });
  streams.push({ label: `connection ${conn.id} → relay`, bytes: up }, { label: `connection ${conn.id} ← relay`, bytes: down });
  for (const f of [...u.frames, ...d.frames]) {
    frameCount++;
    if (f.compressed) compressedFrames++;
    frameTexts.push(f.payload.toString("latin1"));
    streams.push({ label: `connection ${conn.id} WebSocket frame`, bytes: f.payload });
  }
}
const totalBytes = connections.reduce((n, c) => n + Buffer.concat([...c.up, ...c.down]).length, 0);
console.log(`\nRecorded ${totalBytes.toLocaleString()} bytes in ${connections.length} connections (${frameCount} WebSocket frames).\n`);

// Compressed frames were inflated; seeing the known ping, pong and message shapes proves it worked.
const readable = frameTexts.includes("ping") && frameTexts.includes("pong") && frameTexts.filter((t) => t.startsWith('{"v":1,"enc":')).length === items.length;
check("every WebSocket frame was read (compressed ones decompressed)", readable, `(${frameCount} frames, ${compressedFrames} compressed)`);

const searchAll = (needles) => streams.flatMap((s) => findLeaks(s.bytes, needles).map((l) => ({ ...l, where: s.label })));

for (const [name, secret] of Object.entries(secrets)) {
  const leaks = searchAll([secret]);
  check(`${name} never appears, in any encoding`, leaks.length === 0, leaks.map((l) => `(${l.encoding} in ${l.where})`).join(" "));
}
const keyLeaks = searchAll(keys);
check("no session key appears (the public key travels only after the # in the link)", keyLeaks.length === 0, keyLeaks.map((l) => `(${l.where})`).join(" "));

const requestLines = streams
  .filter((s) => s.label.endsWith("→ relay"))
  // Not anchored to line starts: on a kept-alive connection a request follows the previous body directly.
  .flatMap((s) => s.bytes.toString("latin1").match(/(GET|POST) \/\S* HTTP\/1\.1/g) ?? []);
const pageRequests = requestLines.filter((l) => /^GET \/[?# ]/.test(l));
check(
  "the phone page request carries no key or session data",
  pageRequests.length === items.length && pageRequests.every((l) => l === "GET / HTTP/1.1"),
  `(${pageRequests.length} page loads, sent as: ${[...new Set(pageRequests)].map((l) => `"${l}"`).join(", ")})`,
);

const canaryFound = searchAll([canary]).length > 0;
check("control: the deliberately unencrypted message IS found (the search works)", canaryFound);

// --- Write the recording for inspection --------------------------------------------------------

const printable = (b) => b.toString("latin1").replace(/[^\x20-\x7e\r\n]/g, "·");
const log = decoded
  .map(({ conn, u, d }) => {
    const frames = (fs, dir) => fs.map((f) => `  [WebSocket ${dir}${f.compressed ? ", decompressed" : ""}] ${printable(f.payload).slice(0, 400)}${f.payload.length > 400 ? "…" : ""}`).join("\n");
    const body = (b) => printable(b).slice(0, 20000) + (b.length > 20000 ? `\n… (${b.length.toLocaleString()} bytes in total)` : "");
    return [`=== Connection ${conn.id} ===`, "--- client → relay ---", body(u.http), frames(u.frames, "laptop → relay"), "--- relay → client ---", body(d.http), frames(d.frames, "relay → laptop")].filter(Boolean).join("\n");
  })
  .join("\n\n");
writeFileSync(new URL("../verify-capture.log", import.meta.url), `Postern verify: everything the relay received and sent\nSecrets that were sent (none should appear below): ${JSON.stringify(secrets, null, 2)}\n\n${log}\n`);

console.log(`\nFull recording: verify-capture.log`);
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nVerified: the relay only ever saw ciphertext.");
process.exit(failures ? 1 : 0);
