// Shared protocol for the laptop extension and the phone page.
//
// Encryption is HPKE (RFC 9180), base mode:
//   KEM  DHKEM(X25519, HKDF-SHA256)  - fresh key pair per session
//   KDF  HKDF-SHA256
//   AEAD AES-256-GCM
//
// The laptop (receiver) puts its public key in the QR link. The phone (sender)
// seals the password to that key and posts the ciphertext to the relay, which
// can't read it. Both sides derive a 4-digit confirmation code from the HPKE
// exporter so the user can check that the laptop got the phone's message.

import { CipherSuite, Aes256Gcm, HkdfSha256 } from "@hpke/core";
// Pure-JS X25519, so older phone browsers without WebCrypto X25519 still work.
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";

export const PROTOCOL_VERSION = 1;
export const SESSION_TTL_MS = 2 * 60 * 1000;
export const MAX_PASSWORD_LENGTH = 1024;
// Plaintext is padded to a multiple of this, so ciphertext size hides the exact password length.
const PAD_BLOCK = 128;
const MAX_CIPHERTEXT_BYTES = 8192;

const SESSION_ID_RE = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes, base64url
const PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{43}$/; // 32-byte X25519 key, base64url

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const INFO = encoder.encode("dahp password-transfer v1");

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});

export function toBase64Url(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(str) {
  if (typeof str !== "string" || !/^[A-Za-z0-9_-]*$/.test(str)) {
    throw new Error("Invalid base64url");
  }
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function isValidSessionId(id) {
  return typeof id === "string" && SESSION_ID_RE.test(id);
}

function aadFor(sessionId) {
  return encoder.encode(`v${PROTOCOL_VERSION}:${sessionId}`);
}

async function confirmationCode(context) {
  const bytes = new Uint8Array(await context.export(encoder.encode("confirmation code"), 4));
  const n = new DataView(bytes.buffer).getUint32(0);
  return String(n % 10000).padStart(4, "0");
}

function encodePlaintext(password) {
  const json = encoder.encode(JSON.stringify({ p: password }));
  const padded = new Uint8Array(Math.ceil((json.length + 1) / PAD_BLOCK) * PAD_BLOCK);
  padded.fill(0x20); // trailing spaces are valid JSON whitespace
  padded.set(json);
  return padded;
}

function decodePlaintext(bytes) {
  const { p } = JSON.parse(decoder.decode(bytes));
  if (typeof p !== "string") throw new Error("Malformed payload");
  return p;
}

/** Laptop side: create a one-time key pair and session. */
export async function createReceiver() {
  const keyPair = await suite.kem.generateKeyPair();
  const publicKey = toBase64Url(await suite.kem.serializePublicKey(keyPair.publicKey));
  const sessionId = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  let used = false;

  return {
    sessionId,
    publicKey,
    /** Decrypt the phone's message. Works once; the key is single-use. */
    async open(message) {
      if (used) throw new Error("Session already used");
      used = true;
      if (!message || message.v !== PROTOCOL_VERSION) throw new Error("Unsupported message version");
      const enc = fromBase64Url(message.enc);
      const ct = fromBase64Url(message.ct);
      if (enc.length !== 32 || ct.length > MAX_CIPHERTEXT_BYTES) throw new Error("Malformed message");

      const recipient = await suite.createRecipientContext({ recipientKey: keyPair, enc, info: INFO });
      const plaintext = await recipient.open(ct, aadFor(sessionId)); // throws if tampered
      return { password: decodePlaintext(plaintext), code: await confirmationCode(recipient) };
    },
  };
}

/** Phone side: encrypt a password to the laptop's public key. */
export async function sealPassword({ sessionId, publicKey, password }) {
  if (!isValidSessionId(sessionId)) throw new Error("Invalid session");
  if (typeof publicKey !== "string" || !PUBLIC_KEY_RE.test(publicKey)) throw new Error("Invalid key");
  if (typeof password !== "string" || password.length === 0) throw new Error("Password is empty");
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error("Password is too long");

  const recipientPublicKey = await suite.kem.deserializePublicKey(fromBase64Url(publicKey));
  const sender = await suite.createSenderContext({ recipientPublicKey, info: INFO });
  const ct = await sender.seal(encodePlaintext(password), aadFor(sessionId));
  return {
    message: { v: PROTOCOL_VERSION, enc: toBase64Url(sender.enc), ct: toBase64Url(ct) },
    code: await confirmationCode(sender),
  };
}

/** Link encoded in the QR. Everything after "#" stays on the device; browsers never send it to the server. */
export function buildLink(baseUrl, { sessionId, publicKey }) {
  const params = new URLSearchParams({ v: String(PROTOCOL_VERSION), id: sessionId, k: publicKey });
  return `${baseUrl.replace(/\/+$/, "")}/#${params}`;
}

export function parseLinkFragment(hash) {
  const params = new URLSearchParams(String(hash).replace(/^#/, ""));
  const sessionId = params.get("id");
  const publicKey = params.get("k");
  if (params.get("v") !== String(PROTOCOL_VERSION)) return null;
  if (!isValidSessionId(sessionId) || !publicKey || !PUBLIC_KEY_RE.test(publicKey)) return null;
  return { sessionId, publicKey };
}
