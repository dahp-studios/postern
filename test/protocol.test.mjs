import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createReceiver,
  sealItem,
  buildLink,
  parseLinkFragment,
  fromBase64Url,
  toBase64Url,
  cleanFileName,
  fileAsText,
  isSafeUrl,
  encodeOfflinePayload,
  decodeOfflinePayload,
  MAX_OFFLINE_PAYLOAD,
} from "../shared/protocol.js";

async function roundTrip(item) {
  const rx = await createReceiver();
  const { message, code } = await sealItem({ sessionId: rx.sessionId, publicKey: rx.publicKey, item });
  const opened = await rx.open(message);
  assert.equal(opened.code, code);
  assert.match(code, /^\d{4}$/);
  return { ...opened, message };
}

test("password round trip keeps it exactly, including spaces", async () => {
  const text = "  c0rrect horse battery staple – ünïcødé 🔐 ";
  const { item } = await roundTrip({ type: "password", text });
  assert.deepEqual(item, { type: "password", text });
});

test("text round trip trims surrounding whitespace", async () => {
  const { item } = await roundTrip({ type: "text", text: "  user-42@example.com\n" });
  assert.deepEqual(item, { type: "text", text: "user-42@example.com" });
});

test("url round trip", async () => {
  const { item } = await roundTrip({ type: "url", text: "https://example.com/reset?token=abc" });
  assert.deepEqual(item, { type: "url", text: "https://example.com/reset?token=abc" });
});

test("file round trip, 256 KB at the limit", async () => {
  const bytes = new Uint8Array(256 * 1024);
  for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536));
  const { item } = await roundTrip({ type: "file", name: "backup.bin", mime: "application/octet-stream", bytes });
  assert.equal(item.type, "file");
  assert.equal(item.name, "backup.bin");
  assert.deepEqual(item.bytes, bytes);
});

test("JSON file can be read as text", async () => {
  const json = JSON.stringify({ apiKey: "k-123", nested: { ok: true } });
  const { item } = await roundTrip({ type: "file", name: "config.json", mime: "application/json", bytes: new TextEncoder().encode(json) });
  assert.equal(fileAsText(item), json);
  assert.equal(fileAsText({ type: "file", name: "photo.png", mime: "image/png", bytes: new Uint8Array([1]) }), null);
});

test("receiver key is single-use", async () => {
  const rx = await createReceiver();
  const { message } = await sealItem({ ...rx, item: { type: "text", text: "x" } });
  await rx.open(message);
  await assert.rejects(rx.open(message), /already used/);
});

test("tampered ciphertext is rejected", async () => {
  const rx = await createReceiver();
  const { message } = await sealItem({ ...rx, item: { type: "password", text: "secret" } });
  const ct = fromBase64Url(message.ct);
  ct[0] ^= 1;
  await assert.rejects(rx.open({ ...message, ct: toBase64Url(ct) }));
});

test("message bound to its session id (no cross-session replay)", async () => {
  const rx = await createReceiver();
  const { message } = await sealItem({ sessionId: "A".repeat(22), publicKey: rx.publicKey, item: { type: "text", text: "x" } });
  await assert.rejects(rx.open(message));
});

test("another laptop's key cannot decrypt", async () => {
  const rx = await createReceiver();
  const eve = await createReceiver();
  const { message } = await sealItem({ sessionId: eve.sessionId, publicKey: rx.publicKey, item: { type: "text", text: "x" } });
  await assert.rejects(eve.open(message));
});

test("injected message from someone else yields a different code", async () => {
  const rx = await createReceiver();
  const phone = await sealItem({ ...rx, item: { type: "password", text: "real" } });
  const attacker = await sealItem({ ...rx, item: { type: "password", text: "fake" } });
  // A 1-in-10000 collision is possible; skip rather than flake.
  if (phone.code === attacker.code) return;
  const opened = await rx.open(attacker.message);
  assert.notEqual(opened.code, phone.code);
});

test("ciphertext length hides password length within a 128-byte block", async () => {
  const rx = await createReceiver();
  const a = await sealItem({ ...rx, item: { type: "password", text: "a" } });
  const b = await sealItem({ ...rx, item: { type: "password", text: "a".repeat(80) } });
  assert.equal(a.message.ct.length, b.message.ct.length);
});

test("validation: limits, empty values, unsafe links", async () => {
  const rx = await createReceiver();
  const seal = (item) => sealItem({ ...rx, item });
  await assert.rejects(seal({ type: "password", text: "" }), /empty/);
  await assert.rejects(seal({ type: "password", text: "x".repeat(1025) }), /too long/);
  await assert.rejects(seal({ type: "text", text: "   " }), /empty/);
  await assert.rejects(seal({ type: "text", text: "x".repeat(10001) }), /too long/);
  await assert.rejects(seal({ type: "url", text: "javascript:alert(1)" }), /https/);
  await assert.rejects(seal({ type: "url", text: "not a url" }), /https/);
  await assert.rejects(seal({ type: "file", name: "a", bytes: new Uint8Array(256 * 1024 + 1) }), /256 KB/);
  await assert.rejects(seal({ type: "file", name: "a", bytes: new Uint8Array(0) }), /empty/);
  await assert.rejects(seal({ type: "exe", text: "x" }), /Unknown/);
  await assert.rejects(sealItem({ ...rx, sessionId: "bad", item: { type: "text", text: "x" } }), /session/);
  await assert.rejects(sealItem({ ...rx, publicKey: "bad", item: { type: "text", text: "x" } }), /key/);
});

test("unsafe file names are cleaned", () => {
  assert.equal(cleanFileName("../../etc/passwd"), "passwd");
  assert.equal(cleanFileName("C:\\Users\\me\\.ssh\\id_rsa"), "id_rsa");
  assert.equal(cleanFileName(".hidden"), "hidden");
  assert.equal(cleanFileName('a<b>:"c|?*.json'), "abc.json");
  assert.equal(cleanFileName(""), "file");
  assert.equal(cleanFileName("x".repeat(300)).length, 200);
});

test("isSafeUrl", () => {
  assert.ok(isSafeUrl("https://a.example/"));
  assert.ok(isSafeUrl("http://localhost:8787/x"));
  for (const bad of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "ftp://x", "example.com"]) {
    assert.equal(isSafeUrl(bad), false, bad);
  }
});

test("link build and parse", async () => {
  const rx = await createReceiver();
  const link = buildLink("https://postern.example.com/", rx);
  const url = new URL(link);
  assert.equal(url.pathname, "/");
  assert.deepEqual(parseLinkFragment(url.hash), { sessionId: rx.sessionId, publicKey: rx.publicKey });
  assert.equal(parseLinkFragment("#v=2&id=x&k=y"), null);
  assert.equal(parseLinkFragment(""), null);
});

test("a saved receiver can be restored and decrypts", async () => {
  const rx = await createReceiver();
  const saved = await rx.save();
  assert.match(saved.privateKey, /^[A-Za-z0-9_-]{43}$/);
  const restored = await createReceiver(saved);
  assert.equal(restored.sessionId, rx.sessionId);
  assert.equal(restored.publicKey, rx.publicKey);
  const { message, code } = await sealItem({ ...rx, item: { type: "password", text: "restored" } });
  const opened = await restored.open(message);
  assert.equal(opened.code, code);
  assert.equal(opened.item.text, "restored");
  await assert.rejects(createReceiver({ ...saved, sessionId: "bad" }));
});

test("offline QR payload round trip and limits", async () => {
  const rx = await createReceiver();
  const { message, code } = await sealItem({ ...rx, item: { type: "password", text: "offline-Pass!" } });
  const text = encodeOfflinePayload(rx.sessionId, message);
  assert.ok(text.length < 300, `password payload is ${text.length} chars`);
  const decoded = decodeOfflinePayload(text);
  assert.equal(decoded.sessionId, rx.sessionId);
  const opened = await rx.open(decoded.message);
  assert.equal(opened.code, code);
  assert.equal(opened.item.text, "offline-Pass!");

  // About 600 characters of text fits; 2,000 doesn't.
  const fits = await sealItem({ ...rx, item: { type: "text", text: "x".repeat(600) } });
  assert.ok(encodeOfflinePayload(rx.sessionId, fits.message).length <= MAX_OFFLINE_PAYLOAD);
  const big = await sealItem({ ...rx, item: { type: "text", text: "x".repeat(2000) } });
  assert.throws(() => encodeOfflinePayload(rx.sessionId, big.message), /Too large/);

  for (const bad of ["", "https://example.com", "PT1.short.a.b", `PT2.${rx.sessionId}.${message.enc}.${message.ct}`, `PT1.${rx.sessionId}.${message.enc}.<script>`]) {
    assert.equal(decodeOfflinePayload(bad), null, bad);
  }
});
