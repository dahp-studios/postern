// Attacks on Postern's encryption. Each test plays an attacker and must fail to learn or
// change anything. The attackers:
//   - the relay operator (or anyone who records the traffic): sees every {v, enc, ct} message
//   - someone who photographed the QR code: knows the session ID and the laptop's public key
//
// Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLink,
  cipherSuite,
  createReceiver,
  decodeOfflinePayload,
  encodeOfflinePayload,
  fromBase64Url,
  HPKE_INFO,
  sealItem,
  toBase64Url,
} from "../shared/protocol.js";
import { findLeaks } from "./leak.mjs";

const SECRET = "Tr0ub4dor&3-correct-horse-🔐";
const enc = new TextEncoder();

async function capture(item = { type: "password", text: SECRET }) {
  const rx = await createReceiver();
  const saved = await rx.save();
  const { message, code } = await sealItem({ sessionId: rx.sessionId, publicKey: rx.publicKey, item });
  return { rx, saved, message, code };
}

/** True if the laptop's key opens the message (a fresh copy each time, since keys are single-use). */
async function opens(saved, message) {
  try {
    await (await createReceiver(saved)).open(message);
    return true;
  } catch {
    return false;
  }
}

const withCt = (message, ct) => ({ ...message, ct: toBase64Url(ct) });
const withEnc = (message, e) => ({ ...message, enc: toBase64Url(e) });

// ---------------------------------------------------------------------------------------------
// The relay operator / network observer

test("the relay sees no trace of the secret, in any encoding", async () => {
  for (const item of [
    { type: "password", text: SECRET },
    { type: "text", text: `user id ${SECRET}` },
    { type: "url", text: `https://example.com/reset?token=${encodeURIComponent(SECRET)}` },
    { type: "file", name: "secrets.json", mime: "application/json", bytes: enc.encode(JSON.stringify({ apiKey: SECRET })) },
  ]) {
    const { message, saved } = await capture(item);
    const wire = JSON.stringify(message);
    const decoded = new Uint8Array([...fromBase64Url(message.enc), ...fromBase64Url(message.ct)]);
    assert.deepEqual(findLeaks(wire, [SECRET, "secrets.json", "apiKey"]), [], `${item.type}: found in the JSON`);
    assert.deepEqual(findLeaks(decoded, [SECRET, "secrets.json", "apiKey"]), [], `${item.type}: found in the decoded bytes`);
    // Neither key is in the message either.
    assert.ok(!wire.includes(saved.privateKey) && !wire.includes(saved.publicKey), `${item.type}: key in message`);
  }
});

test("the leak detector itself works (control: an unencrypted secret is caught)", () => {
  const leaks = findLeaks(JSON.stringify({ ct: Buffer.from(`xx${SECRET}`).toString("base64") }), [SECRET]);
  assert.ok(leaks.some((l) => l.encoding === "base64"), "base64 of the secret not detected");
  assert.ok(findLeaks(`pw=${encodeURIComponent(SECRET)}`, [SECRET]).length > 0, "URL-encoded secret not detected");
});

test("the relay can't decrypt with any key it could make up", async () => {
  const { message, rx } = await capture();
  const guesses = [
    await cipherSuite.kem.deriveKeyPair(enc.encode(rx.sessionId)), // from the session ID it sees
    await cipherSuite.kem.deriveKeyPair(fromBase64Url(rx.publicKey)), // from the public key (if it had it)
    await cipherSuite.kem.deriveKeyPair(new Uint8Array(32)), // all zeros
    await cipherSuite.kem.deriveKeyPair(fromBase64Url(message.enc)), // from the message itself
  ];
  for (let i = 0; i < 200; i++) guesses.push(await cipherSuite.kem.generateKeyPair()); // random keys
  let opened = 0;
  for (const keyPair of guesses) {
    const saved = {
      sessionId: rx.sessionId,
      publicKey: toBase64Url(await cipherSuite.kem.serializePublicKey(keyPair.publicKey)),
      privateKey: toBase64Url(await cipherSuite.kem.serializePrivateKey(keyPair.privateKey)),
    };
    if (await opens(saved, message)) opened++;
  }
  assert.equal(opened, 0, `${opened} of ${guesses.length} wrong keys opened the message`);
});

test("flipping any single bit of the ciphertext or enc is detected", async () => {
  const { message, saved } = await capture();
  const ct = fromBase64Url(message.ct);
  const e = fromBase64Url(message.enc);
  let accepted = 0;
  for (let bit = 0; bit < ct.length * 8; bit++) {
    const bad = ct.slice();
    bad[bit >> 3] ^= 1 << (bit & 7);
    if (await opens(saved, withCt(message, bad))) accepted++;
  }
  for (let bit = 0; bit < e.length * 8; bit++) {
    const bad = e.slice();
    bad[bit >> 3] ^= 1 << (bit & 7);
    if (await opens(saved, withEnc(message, bad))) accepted++;
  }
  assert.equal(accepted, 0, `${accepted} of ${(ct.length + e.length) * 8} modified messages were accepted`);
  assert.ok(await opens(saved, message), "control: the untouched message opens");
});

test("cutting, extending or emptying the ciphertext is detected", async () => {
  const { message, saved } = await capture();
  const ct = fromBase64Url(message.ct);
  for (const [name, bad] of [
    ["last byte cut", ct.slice(0, -1)],
    ["auth tag removed", ct.slice(0, -16)],
    ["only the tag", ct.slice(-16)],
    ["one byte added", new Uint8Array([...ct, 0])],
    ["block added", new Uint8Array([...ct, ...ct.slice(0, 16)])],
    ["empty", new Uint8Array()],
    ["blocks reordered", new Uint8Array([...ct.slice(16, 32), ...ct.slice(0, 16), ...ct.slice(32)])],
  ]) {
    assert.equal(await opens(saved, withCt(message, bad)), false, name);
  }
});

test("mixing parts of two messages to the same laptop is detected", async () => {
  const rx = await createReceiver();
  const saved = await rx.save();
  const a = await sealItem({ ...rx, item: { type: "password", text: "first" } });
  const b = await sealItem({ ...rx, item: { type: "password", text: "second" } });
  assert.equal(await opens(saved, { ...a.message, ct: b.message.ct }), false, "enc of A + ct of B");
  assert.equal(await opens(saved, { ...b.message, ct: a.message.ct }), false, "enc of B + ct of A");
});

test("a recorded message can't be replayed into another session, even one with the same key", async () => {
  const { message, saved } = await capture();
  const otherSession = { ...saved, sessionId: toBase64Url(crypto.getRandomValues(new Uint8Array(16))) };
  assert.equal(await opens(otherSession, message), false);
  assert.equal(await opens(await (await createReceiver()).save(), message), false, "another laptop");
});

test("each key opens one message only", async () => {
  const { message, rx } = await capture();
  await rx.open(message);
  await assert.rejects(rx.open(message), /already used/);
});

test("the same password sent twice looks completely different", async () => {
  const rx = await createReceiver();
  const a = await sealItem({ ...rx, item: { type: "password", text: SECRET } });
  const b = await sealItem({ ...rx, item: { type: "password", text: SECRET } });
  assert.notEqual(a.message.enc, b.message.enc);
  const ca = fromBase64Url(a.message.ct);
  const cb = fromBase64Url(b.message.ct);
  let differentBits = 0;
  for (let i = 0; i < ca.length; i++) for (let x = ca[i] ^ cb[i]; x; x >>= 1) differentBits += x & 1;
  const share = differentBits / (ca.length * 8);
  assert.ok(share > 0.4 && share < 0.6, `${(share * 100).toFixed(1)}% of bits differ; random would be ~50%`);
});

test("highly repetitive input leaves no pattern: no repeated blocks, bytes look random", async () => {
  // 200 KB of zeros: any weakness (ECB mode, keystream reuse) would show as repeats or skew.
  const { message } = await capture({ type: "file", name: "zeros.bin", mime: "application/octet-stream", bytes: new Uint8Array(200 * 1024) });
  const ct = fromBase64Url(message.ct);
  const blocks = new Set();
  for (let i = 0; i + 16 <= ct.length; i += 16) blocks.add(Buffer.from(ct.subarray(i, i + 16)).toString("hex"));
  assert.equal(blocks.size, Math.floor(ct.length / 16), "a 16-byte block repeats");

  const counts = new Array(256).fill(0);
  for (const byte of ct) counts[byte]++;
  const expected = ct.length / 256;
  const chi2 = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
  // 255 degrees of freedom: random data averages 255; above 400 would happen by chance less than once in a billion.
  assert.ok(chi2 < 400, `byte distribution chi-squared ${chi2.toFixed(0)} (random ≈ 255)`);
});

test("knowing one message's plaintext doesn't help with another (no keystream reuse)", async () => {
  const known = await capture({ type: "password", text: "known-password-123456" });
  const target = await capture({ type: "password", text: SECRET });
  // Classic attack on reused keystreams: ct1 XOR pt1 XOR ct2 would reveal pt2.
  const pt1 = enc.encode(JSON.stringify({ t: "password", v: "known-password-123456" }).padEnd(128, " "));
  const ct1 = fromBase64Url(known.message.ct);
  const ct2 = fromBase64Url(target.message.ct);
  const guess = ct2.slice(0, 128).map((b, i) => b ^ ct1[i] ^ pt1[i]);
  assert.deepEqual(findLeaks(guess, [SECRET, '"password"']), []);
});

test("ciphertext length doesn't reveal password length (1 to 100 characters)", async () => {
  const rx = await createReceiver();
  const lengths = new Set();
  for (let n = 1; n <= 100; n++) {
    lengths.add(fromBase64Url((await sealItem({ ...rx, item: { type: "password", text: "x".repeat(n) } })).message.ct).length);
  }
  assert.equal(lengths.size, 1, `lengths seen: ${[...lengths]}`);
});

test("malformed or downgraded messages are refused before any decryption", async () => {
  const { message, saved } = await capture();
  const e = fromBase64Url(message.enc);
  for (const [name, bad] of [
    ["version 0", { ...message, v: 0 }],
    ["version 2", { ...message, v: 2 }],
    ["version as string", { ...message, v: "1" }],
    ["enc too short", withEnc(message, e.slice(0, 31))],
    ["enc too long", withEnc(message, new Uint8Array([...e, 0]))],
    ["not base64", { ...message, ct: "<script>" }],
    ["oversized ciphertext", withCt(message, new Uint8Array(600 * 1024))],
    ["null", null],
  ]) {
    assert.equal(await opens(saved, bad), false, name);
  }
});

// ---------------------------------------------------------------------------------------------
// Someone who photographed the QR code (knows the session ID and the public key)

test("the key is never sent to the server: it's after the # in the QR link", async () => {
  const rx = await createReceiver();
  const url = new URL(buildLink("https://postern.example", rx));
  const sentToServer = url.origin + url.pathname + url.search; // browsers never send the fragment
  assert.ok(!sentToServer.includes(rx.publicKey) && !sentToServer.includes(rx.sessionId));
  assert.ok(url.hash.includes(rx.publicKey));
});

test("an attacker who saw the QR can send first, but the confirmation code exposes it", async () => {
  let matches = 0;
  const trials = 1000;
  for (let i = 0; i < trials; i++) {
    const rx = await createReceiver();
    const attacker = await sealItem({ ...rx, item: { type: "password", text: "attacker" } });
    const victim = await sealItem({ ...rx, item: { type: "password", text: SECRET } });
    const opened = await rx.open(attacker.message); // the laptop takes the first message
    assert.equal(opened.code, attacker.code);
    if (opened.code === victim.code) matches++; // the user would only be fooled if these matched
    await assert.rejects(rx.open(victim.message)); // and the real message can't follow it in
  }
  // A 4-digit code fools the user about 1 time in 10,000, and the attacker gets one try per QR code.
  assert.ok(matches <= 3, `codes matched ${matches} times in ${trials}`);
});

/** Seal arbitrary plaintext with the real HPKE setup, skipping the phone's checks (an attacker would). */
async function sealRaw(rx, plaintext) {
  const sender = await cipherSuite.createSenderContext({
    recipientPublicKey: await cipherSuite.kem.deserializePublicKey(fromBase64Url(rx.publicKey)),
    info: HPKE_INFO,
  });
  const ct = await sender.seal(enc.encode(plaintext), enc.encode(`v1:${rx.sessionId}`));
  return { v: 1, enc: toBase64Url(sender.enc), ct: toBase64Url(ct) };
}

test("a correctly encrypted but malicious message can't smuggle in anything dangerous", async () => {
  const refused = [
    ['javascript: link', JSON.stringify({ t: "url", v: "javascript:alert(document.cookie)" })],
    ["data: link", JSON.stringify({ t: "url", v: "data:text/html,<script>alert(1)</script>" })],
    ["file: link", JSON.stringify({ t: "url", v: "file:///etc/passwd" })],
    ["unknown type", JSON.stringify({ t: "script", v: "alert(1)" })],
    ["password too long", JSON.stringify({ t: "password", v: "x".repeat(5000) })],
    ["empty password", JSON.stringify({ t: "password", v: "" })],
    ["not JSON", "<html><script>alert(1)</script>"],
    ["file over 256 KB", JSON.stringify({ t: "file", n: "big.bin", m: "x/y", d: toBase64Url(new Uint8Array(300 * 1024)) })],
  ];
  for (const [name, plaintext] of refused) {
    const rx = await createReceiver();
    await assert.rejects(rx.open(await sealRaw(rx, plaintext)), undefined, name);
  }

  // Accepted, but made harmless.
  const rx = await createReceiver();
  const { item } = await rx.open(await sealRaw(rx, JSON.stringify({ t: "file", n: "../../.ssh/authorized_keys", m: "text/html\r\nX: y", d: toBase64Url(enc.encode("x")) })));
  assert.equal(item.name, "authorized_keys", "path removed from the file name");
  assert.equal(item.mime, "application/octet-stream", "invalid type replaced");

  const rx2 = await createReceiver();
  await rx2.open(await sealRaw(rx2, '{"t":"text","v":"hi","__proto__":{"polluted":true}}'));
  assert.equal({}.polluted, undefined, "prototype pollution");
});

test("offline QR: changing any character of the encrypted part is detected", async () => {
  const { message, saved, rx } = await capture();
  const payload = encodeOfflinePayload(rx.sessionId, message);
  const dataStart = `PT1.${rx.sessionId}.`.length;
  let accepted = 0;
  for (let i = dataStart; i < payload.length; i++) {
    if (payload[i] === ".") continue;
    const swapped = payload.slice(0, i) + (payload[i] === "A" ? "B" : "A") + payload.slice(i + 1);
    const decoded = decodeOfflinePayload(swapped);
    if (decoded && (await opens(saved, decoded.message))) accepted++;
  }
  assert.equal(accepted, 0, `${accepted} altered QR codes were accepted`);
  // Changing the session ID part gives a different ID, which the extension refuses.
  const otherId = decodeOfflinePayload(payload.replace(rx.sessionId, rx.sessionId.replace(/^./, (c) => (c === "A" ? "B" : "A"))));
  assert.notEqual(otherId.sessionId, rx.sessionId);
});
