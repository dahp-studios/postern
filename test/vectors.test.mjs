// Postern's own published test vectors (test/vectors/postern-v1.json, made by scripts/make-vectors.mjs).
// If this fails after a change, the change broke compatibility with every other implementation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLink, cipherSuite, createReceiver, encodeOfflinePayload, sealItem, toBase64Url } from "../shared/protocol.js";

const v = JSON.parse(readFileSync(new URL("./vectors/postern-v1.json", import.meta.url)));
const fromHex = (s) => Uint8Array.from(s.match(/../g), (b) => parseInt(b, 16));
const itemOf = (c) => (c.item.type === "file" ? { type: "file", name: c.item.name, mime: c.item.mime, bytes: fromHex(c.item.bytes_hex) } : c.item);

test("receiver key pair and links match", async () => {
  const kp = await cipherSuite.kem.deriveKeyPair(fromHex(v.ikmR));
  assert.equal(toBase64Url(await cipherSuite.kem.serializePublicKey(kp.publicKey)), v.receiver.publicKey);
  assert.equal(toBase64Url(await cipherSuite.kem.serializePrivateKey(kp.privateKey)), v.receiver.privateKey);
  const rx = await createReceiver(v.receiver);
  assert.equal(buildLink("https://postern.dahp.io", rx), v.link);
  assert.equal(buildLink("https://postern.dahp.io", rx, { types: ["password", "text"] }), v.link_with_types);
});

for (const c of v.cases) {
  test(`${c.item.type}: sealing gives exactly the published message, opening gives the item and code`, async () => {
    const { message, code } = await sealItem({ ...v.receiver, item: itemOf(c), testEphemeralSeed: fromHex(c.ikmE) });
    assert.deepEqual(message, c.message);
    assert.equal(code, c.code);
    assert.equal(encodeOfflinePayload(v.receiver.sessionId, message), c.offline_payload);
    const opened = await (await createReceiver(v.receiver)).open(c.message);
    assert.deepEqual(opened.item, itemOf(c));
    assert.equal(opened.code, c.code);
  });
}
