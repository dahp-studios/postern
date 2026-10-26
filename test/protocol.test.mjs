import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createReceiver,
  sealPassword,
  buildLink,
  parseLinkFragment,
  fromBase64Url,
  toBase64Url,
} from "../shared/protocol.js";

test("round trip: phone seals, laptop opens, codes match", async () => {
  const rx = await createReceiver();
  const password = "c0rrect horse battery staple – ünïcødé 🔐";
  const { message, code } = await sealPassword({ sessionId: rx.sessionId, publicKey: rx.publicKey, password });
  const opened = await rx.open(message);
  assert.equal(opened.password, password);
  assert.equal(opened.code, code);
  assert.match(code, /^\d{4}$/);
});

test("receiver key is single-use", async () => {
  const rx = await createReceiver();
  const { message } = await sealPassword({ sessionId: rx.sessionId, publicKey: rx.publicKey, password: "x" });
  await rx.open(message);
  await assert.rejects(rx.open(message), /already used/);
});

test("tampered ciphertext is rejected", async () => {
  const rx = await createReceiver();
  const { message } = await sealPassword({ sessionId: rx.sessionId, publicKey: rx.publicKey, password: "secret" });
  const ct = fromBase64Url(message.ct);
  ct[0] ^= 1;
  await assert.rejects(rx.open({ ...message, ct: toBase64Url(ct) }));
});

test("message bound to its session id (no cross-session replay)", async () => {
  const rx = await createReceiver();
  const { message } = await sealPassword({ sessionId: "A".repeat(22), publicKey: rx.publicKey, password: "secret" });
  await assert.rejects(rx.open(message));
});

test("another laptop's key cannot decrypt", async () => {
  const rx = await createReceiver();
  const eve = await createReceiver();
  const { message } = await sealPassword({ sessionId: eve.sessionId, publicKey: rx.publicKey, password: "secret" });
  await assert.rejects(eve.open(message));
});

test("injected message from someone else yields a different code", async () => {
  const rx = await createReceiver();
  const phone = await sealPassword({ sessionId: rx.sessionId, publicKey: rx.publicKey, password: "real" });
  const attacker = await sealPassword({ sessionId: rx.sessionId, publicKey: rx.publicKey, password: "fake" });
  // A 1-in-10000 collision is possible; skip rather than flake.
  if (phone.code === attacker.code) return;
  const opened = await rx.open(attacker.message);
  assert.notEqual(opened.code, phone.code);
});

test("ciphertext length hides password length within a 128-byte block", async () => {
  const rx = await createReceiver();
  const a = await sealPassword({ sessionId: rx.sessionId, publicKey: rx.publicKey, password: "a" });
  const b = await sealPassword({ sessionId: rx.sessionId, publicKey: rx.publicKey, password: "a".repeat(100) });
  assert.equal(a.message.ct.length, b.message.ct.length);
});

test("input validation", async () => {
  const rx = await createReceiver();
  const base = { sessionId: rx.sessionId, publicKey: rx.publicKey };
  await assert.rejects(sealPassword({ ...base, password: "" }), /empty/);
  await assert.rejects(sealPassword({ ...base, password: "x".repeat(1025) }), /too long/);
  await assert.rejects(sealPassword({ ...base, sessionId: "bad", password: "x" }), /session/);
  await assert.rejects(sealPassword({ ...base, publicKey: "bad", password: "x" }), /key/);
});

test("link build and parse", async () => {
  const rx = await createReceiver();
  const link = buildLink("https://pt.example.com/", rx);
  const url = new URL(link);
  assert.equal(url.pathname, "/");
  assert.deepEqual(parseLinkFragment(url.hash), { sessionId: rx.sessionId, publicKey: rx.publicKey });
  assert.equal(parseLinkFragment("#v=2&id=x&k=y"), null);
  assert.equal(parseLinkFragment(""), null);
});
