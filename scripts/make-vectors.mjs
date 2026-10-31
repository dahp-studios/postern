// Generates test/vectors/postern-v1.json: fixed inputs and the exact outputs Postern produces for
// them, so implementations in other languages can check themselves byte for byte.
//   node scripts/make-vectors.mjs
import { writeFileSync } from "node:fs";
import { buildLink, cipherSuite, createReceiver, encodeOfflinePayload, sealItem, toBase64Url } from "../shared/protocol.js";

const hex = (b) => Buffer.from(new Uint8Array(b)).toString("hex");
const seed = (label) => new Uint8Array(32).map((_, i) => (label.charCodeAt(i % label.length) + i) & 0xff);

const ikmR = seed("postern receiver key seed");
const recipient = await cipherSuite.kem.deriveKeyPair(ikmR);
const saved = {
  sessionId: "AAECAwQFBgcICQoLDA0ODw", // bytes 00..0f, base64url
  publicKey: toBase64Url(await cipherSuite.kem.serializePublicKey(recipient.publicKey)),
  privateKey: toBase64Url(await cipherSuite.kem.serializePrivateKey(recipient.privateKey)),
};
const receiver = await createReceiver(saved);

const items = [
  { type: "password", text: "correct horse battery staple" },
  { type: "text", text: "user-42@example.com" },
  { type: "url", text: "https://example.com/reset?token=abc" },
  { type: "file", name: "config.json", mime: "application/json", bytes: new TextEncoder().encode('{"apiKey":"k-123"}') },
];

const cases = [];
for (const [i, item] of items.entries()) {
  const ikmE = seed(`postern ephemeral seed ${i}`);
  const { message, code } = await sealItem({ ...saved, item, testEphemeralSeed: ikmE });
  const opened = await (await createReceiver(saved)).open(message);
  if (opened.code !== code) throw new Error("vector does not round-trip");
  cases.push({
    item: item.type === "file" ? { ...item, bytes: undefined, bytes_hex: hex(item.bytes) } : item,
    ikmE: hex(ikmE),
    message,
    code,
    offline_payload: encodeOfflinePayload(saved.sessionId, message),
  });
}

const vectors = {
  description: "Postern protocol v1 test vectors. Derive the receiver key pair from ikmR and each ephemeral key pair from ikmE with DHKEM(X25519, HKDF-SHA256) DeriveKeyPair (RFC 9180 section 7.1.3); sealing each item must give exactly `message`, and opening it must give the item and `code`.",
  suite: { mode: "base", kem: "DHKEM(X25519, HKDF-SHA256) 0x0020", kdf: "HKDF-SHA256 0x0001", aead: "AES-256-GCM 0x0002" },
  info: "dahp postern v1",
  ikmR: hex(ikmR),
  receiver: { sessionId: saved.sessionId, publicKey: saved.publicKey, privateKey: saved.privateKey },
  link: buildLink("https://postern.dahp.io", receiver),
  link_with_types: buildLink("https://postern.dahp.io", receiver, { types: ["password", "text"] }),
  aad: `v1:${saved.sessionId}`,
  cases,
};
writeFileSync(new URL("../test/vectors/postern-v1.json", import.meta.url), `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`Wrote ${cases.length} cases to test/vectors/postern-v1.json`);
