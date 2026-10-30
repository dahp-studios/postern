// Checks Postern's exact HPKE configuration against the official RFC 9180 test vector for the
// same suite. Matching it byte for byte shows the encryption is the standard one, set up
// correctly: same key derivation, same key schedule, same ciphertext, same exporter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cipherSuite } from "../shared/protocol.js";

const { vector: v } = JSON.parse(readFileSync(new URL("./vectors/rfc9180-base-x25519-sha256-aes256gcm.json", import.meta.url)));

const hex = (s) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));
const toHex = (buf) => Buffer.from(new Uint8Array(buf)).toString("hex");

test("Postern uses the suite the vector is for: base mode, X25519, HKDF-SHA256, AES-256-GCM", () => {
  assert.equal(v.mode, 0);
  assert.equal(cipherSuite.kem.id, v.kem_id); // 0x0020 DHKEM(X25519, HKDF-SHA256)
  assert.equal(cipherSuite.kdf.id, v.kdf_id); // 0x0001 HKDF-SHA256
  assert.equal(cipherSuite.aead.id, v.aead_id); // 0x0002 AES-256-GCM
});

test("key pairs derived from the vector's seeds match (X25519 and HKDF)", async () => {
  const recipient = await cipherSuite.kem.deriveKeyPair(hex(v.ikmR));
  assert.equal(toHex(await cipherSuite.kem.serializePublicKey(recipient.publicKey)), v.pkRm);
  assert.equal(toHex(await cipherSuite.kem.serializePrivateKey(recipient.privateKey)), v.skRm);

  const ephemeral = await cipherSuite.kem.deriveKeyPair(hex(v.ikmE));
  assert.equal(toHex(await cipherSuite.kem.serializePublicKey(ephemeral.publicKey)), v.pkEm);
  assert.equal(toHex(await cipherSuite.kem.serializePrivateKey(ephemeral.privateKey)), v.skEm);
});

test("sealing gives exactly the vector's enc and ciphertexts", async () => {
  const recipient = await cipherSuite.kem.deriveKeyPair(hex(v.ikmR));
  const ephemeral = await cipherSuite.kem.deriveKeyPair(hex(v.ikmE));
  const sender = await cipherSuite.createSenderContext({
    recipientPublicKey: recipient.publicKey,
    info: hex(v.info),
    ekm: ephemeral, // fixed ephemeral key, only possible in a test
  });
  assert.equal(toHex(sender.enc), v.enc);
  for (const [i, e] of v.encryptions.entries()) {
    assert.equal(toHex(await sender.seal(hex(e.pt), hex(e.aad))), e.ct, `encryption ${i}`);
  }
});

test("opening the vector's ciphertexts gives the original plaintexts", async () => {
  const recipient = await cipherSuite.kem.deriveKeyPair(hex(v.ikmR));
  const ctx = await cipherSuite.createRecipientContext({ recipientKey: recipient, enc: hex(v.enc), info: hex(v.info) });
  for (const [i, e] of v.encryptions.entries()) {
    assert.equal(toHex(await ctx.open(hex(e.ct), hex(e.aad))), e.pt, `decryption ${i}`);
  }
});

test("exported secrets match (the 4-digit confirmation code comes from this exporter)", async () => {
  const recipient = await cipherSuite.kem.deriveKeyPair(hex(v.ikmR));
  const ctx = await cipherSuite.createRecipientContext({ recipientKey: recipient, enc: hex(v.enc), info: hex(v.info) });
  for (const x of v.exports) {
    assert.equal(toHex(await ctx.export(hex(x.exporter_context), x.L)), x.exported_value);
  }
});
