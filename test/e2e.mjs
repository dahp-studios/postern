// End-to-end against a running relay: `npm run dev` in one terminal, then `npm run test:e2e`.
//   PT_SERVER=https://... npm run test:e2e   to test a deployed relay.

import assert from "node:assert/strict";
import { createReceiver, sealItem, buildLink, parseLinkFragment } from "../shared/protocol.js";

const server = (process.env.PT_SERVER || "http://localhost:8787").replace(/\/+$/, "");
const wsBase = server.replace(/^http/, "ws");

function waitForMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener("message", (e) => resolve(e.data), { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
}

function opened(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error(`WebSocket failed: ${ws.url}`)), { once: true });
  });
}

const post = (id, body) =>
  fetch(`${server}/api/s/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });

async function step(name, fn) {
  await fn();
  console.log(`✔ ${name}`);
}

await step("phone page is served with a CSP", async () => {
  const res = await fetch(`${server}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Send to your laptop/);
  assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);
});

await step("full transfer: laptop waits, phone sends, laptop decrypts", async () => {
  const laptop = await createReceiver();
  const ws = new WebSocket(`${wsBase}/api/s/${laptop.sessionId}`);
  await opened(ws);
  const incoming = waitForMessage(ws);

  // Phone side: parse the QR link exactly as the page does.
  const session = parseLinkFragment(new URL(buildLink(server, laptop)).hash);
  const { message, code } = await sealItem({ ...session, item: { type: "password", text: "hunter2-but-longer!" } });
  const res = await post(session.sessionId, JSON.stringify(message));
  assert.equal(res.status, 200);

  const result = await laptop.open(JSON.parse(await incoming));
  assert.deepEqual(result.item, { type: "password", text: "hunter2-but-longer!" });
  assert.equal(result.code, code);

  // Session is one-time.
  const again = await post(session.sessionId, JSON.stringify(message));
  assert.equal(again.status, 410);
});

await step("a 256 KB file makes it through the relay", async () => {
  const laptop = await createReceiver();
  const ws = new WebSocket(`${wsBase}/api/s/${laptop.sessionId}`);
  await opened(ws);
  const incoming = waitForMessage(ws);
  const bytes = new Uint8Array(256 * 1024);
  for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536));
  const { message } = await sealItem({ ...laptop, item: { type: "file", name: "big.bin", mime: "application/octet-stream", bytes } });
  assert.equal((await post(laptop.sessionId, JSON.stringify(message))).status, 200);
  const { item } = await laptop.open(JSON.parse(await incoming));
  assert.equal(item.name, "big.bin");
  assert.deepEqual(item.bytes, bytes);
});

await step("posting when no laptop is waiting fails", async () => {
  const laptop = await createReceiver();
  const { message } = await sealItem({ ...laptop, item: { type: "text", text: "x" } });
  const res = await post(laptop.sessionId, JSON.stringify(message));
  assert.equal(res.status, 404);
});

await step("second laptop connection to the same session is refused", async () => {
  const laptop = await createReceiver();
  const ws = new WebSocket(`${wsBase}/api/s/${laptop.sessionId}`);
  await opened(ws);
  const ws2 = new WebSocket(`${wsBase}/api/s/${laptop.sessionId}`);
  await assert.rejects(opened(ws2));
  ws.close();
});

await step("bad input is rejected", async () => {
  const laptop = await createReceiver();
  assert.equal((await post("short", "{}")).status, 404);
  assert.equal((await post(laptop.sessionId, "not json")).status, 400);
  assert.equal((await post(laptop.sessionId, '{"v":1}')).status, 400);
  assert.equal((await post(laptop.sessionId, "x".repeat(800 * 1024))).status, 413);
});

console.log("\nAll end-to-end checks passed.");
process.exit(0);
