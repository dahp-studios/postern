// Shared protocol for the laptop extension and the phone page.
//
// Encryption is HPKE (RFC 9180), base mode:
//   KEM  DHKEM(X25519, HKDF-SHA256)  - fresh key pair per session
//   KDF  HKDF-SHA256
//   AEAD AES-256-GCM
//
// The laptop (receiver) puts its public key in the QR link. The phone (sender)
// seals one item (password, text, link or file) to that key and posts the
// ciphertext to the relay, which can't read it. Both sides derive a 4-digit
// confirmation code from the HPKE exporter so the user can check that the
// laptop got the phone's message.

import { CipherSuite, Aes256Gcm, HkdfSha256 } from "@hpke/core";
// Pure-JS X25519, so older phone browsers without WebCrypto X25519 still work.
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";

export const PROTOCOL_VERSION = 1;
export const SESSION_TTL_MS = 2 * 60 * 1000;

export const ITEM_TYPES = ["password", "text", "url", "file"];
export const LIMITS = {
  password: 1024, // characters
  text: 10000, // characters
  url: 4096, // characters
  fileBytes: 256 * 1024,
  fileName: 200, // characters
};
// Ciphertext grows with the base64 file data inside it; this leaves headroom over a 256 KB file.
export const MAX_CIPHERTEXT_BYTES = 512 * 1024;

const SESSION_ID_RE = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes, base64url
const PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{43}$/; // 32-byte X25519 key, base64url

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const INFO = encoder.encode("dahp postern v1");

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});

// Exported so the tests can check this exact configuration against the RFC 9180 test vectors
// and attack it directly. Nothing else should need them.
export { suite as cipherSuite, INFO as HPKE_INFO };

export function toBase64Url(bytes) {
  const arr = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i += 0x8000) bin += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(str) {
  // A length of 4n+1 can't come from base64; atob would throw its own DOMException for it.
  if (typeof str !== "string" || !/^[A-Za-z0-9_-]*$/.test(str) || str.length % 4 === 1) {
    throw new Error("Invalid base64url");
  }
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function isValidSessionId(id) {
  return typeof id === "string" && SESSION_ID_RE.test(id);
}

/** True for http(s) links only; anything else (javascript:, data:, file:) is refused on both sides. */
export function isSafeUrl(text) {
  try {
    const { protocol } = new URL(text);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Strip path parts, control characters and invisible formatting characters so a file name is safe
 * to save and shows its real extension (U+202E could make "x\u202Efdp.exe" display as "xexe.pdf").
 */
export function cleanFileName(name) {
  const base = String(name ?? "").split(/[\\/]/).pop();
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return cleaned.slice(0, LIMITS.fileName) || "file";
}

/**
 * Check an item and return it in canonical form, or throw a message the user can act on.
 *   { type: "password" | "text" | "url", text }
 *   { type: "file", name, mime, bytes: Uint8Array }
 */
export function validateItem(item) {
  if (!item || !ITEM_TYPES.includes(item.type)) throw new Error("Unknown item type");

  if (item.type === "file") {
    if (!(item.bytes instanceof Uint8Array)) throw new Error("Missing file data");
    if (item.bytes.length === 0) throw new Error("The file is empty");
    if (item.bytes.length > LIMITS.fileBytes) throw new Error("The file is larger than 256 KB");
    const mime = typeof item.mime === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(item.mime) ? item.mime : "application/octet-stream";
    return { type: "file", name: cleanFileName(item.name), mime, bytes: item.bytes };
  }

  if (typeof item.text !== "string") throw new Error("Missing text");
  const text = item.type === "password" ? item.text : item.text.trim();
  const label = { password: "Password", text: "Text", url: "Link" }[item.type];
  if (text.length === 0) throw new Error(`${label} is empty`);
  if (text.length > LIMITS[item.type]) throw new Error(`${label} is too long`);
  if (item.type === "url" && !isSafeUrl(text)) throw new Error("Link must start with https:// or http://");
  return { type: item.type, text };
}

/** Text-like files (JSON, plain text, CSV…) can be filled into a field as well as saved. */
export function fileAsText(item) {
  if (item.type !== "file") return null;
  const textual = /^text\/|^application\/(json|xml|x-yaml|yaml|csv)/.test(item.mime) || /\.(json|txt|csv|ya?ml|xml|env|md)$/i.test(item.name);
  if (!textual) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(item.bytes);
  } catch {
    return null; // not valid UTF-8 after all
  }
}

function aadFor(sessionId) {
  return encoder.encode(`v${PROTOCOL_VERSION}:${sessionId}`);
}

async function confirmationCode(context) {
  const bytes = new Uint8Array(await context.export(encoder.encode("confirmation code"), 4));
  const n = new DataView(bytes.buffer).getUint32(0);
  return String(n % 10000).padStart(4, "0");
}

function encodePlaintext(item) {
  const body =
    item.type === "file"
      ? { t: "file", n: item.name, m: item.mime, d: toBase64Url(item.bytes) }
      : { t: item.type, v: item.text };
  const json = encoder.encode(JSON.stringify(body));
  // Pad so ciphertext size hides the exact length: 128-byte steps for short items, 4 KB for large ones.
  const block = json.length < 1024 ? 128 : 4096;
  const padded = new Uint8Array(Math.ceil((json.length + 1) / block) * block);
  padded.fill(0x20); // trailing spaces are valid JSON whitespace
  padded.set(json);
  return padded;
}

function decodePlaintext(bytes) {
  const body = JSON.parse(decoder.decode(bytes));
  if (body?.t === "file") {
    return validateItem({ type: "file", name: body.n, mime: body.m, bytes: fromBase64Url(body.d) });
  }
  return validateItem({ type: body?.t, text: body?.v });
}

/**
 * Laptop side: create a one-time key pair and session, or restore one saved with `save()`.
 * Saving lets another extension page (or a restarted service worker) finish the same session.
 */
export async function createReceiver(saved) {
  let keyPair;
  let sessionId;
  if (saved) {
    if (!isValidSessionId(saved.sessionId) || !PUBLIC_KEY_RE.test(saved.publicKey ?? "")) throw new Error("Invalid saved session");
    keyPair = {
      privateKey: await suite.kem.deserializePrivateKey(fromBase64Url(saved.privateKey)),
      publicKey: await suite.kem.deserializePublicKey(fromBase64Url(saved.publicKey)),
    };
    sessionId = saved.sessionId;
  } else {
    keyPair = await suite.kem.generateKeyPair();
    sessionId = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  }
  const publicKey = toBase64Url(await suite.kem.serializePublicKey(keyPair.publicKey));
  let used = false;

  return {
    sessionId,
    publicKey,
    /** The private key in a storable form. Keep it in memory-only storage and delete it once used. */
    async save() {
      return { sessionId, publicKey, privateKey: toBase64Url(await suite.kem.serializePrivateKey(keyPair.privateKey)) };
    },
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
      return { item: decodePlaintext(plaintext), code: await confirmationCode(recipient) };
    },
  };
}

/**
 * Phone side: encrypt one item to the laptop's public key.
 * `testEphemeralSeed` fixes the ephemeral key, only to generate the published test vectors; never use it otherwise.
 */
export async function sealItem({ sessionId, publicKey, item, testEphemeralSeed }) {
  if (!isValidSessionId(sessionId)) throw new Error("Invalid session");
  if (typeof publicKey !== "string" || !PUBLIC_KEY_RE.test(publicKey)) throw new Error("Invalid key");
  const clean = validateItem(item);

  const recipientPublicKey = await suite.kem.deserializePublicKey(fromBase64Url(publicKey));
  const ekm = testEphemeralSeed ? await suite.kem.deriveKeyPair(testEphemeralSeed) : undefined;
  const sender = await suite.createSenderContext({ recipientPublicKey, info: INFO, ...(ekm && { ekm }) });
  const ct = await sender.seal(encodePlaintext(clean), aadFor(sessionId));
  return {
    message: { v: PROTOCOL_VERSION, enc: toBase64Url(sender.enc), ct: toBase64Url(ct) },
    code: await confirmationCode(sender),
  };
}

/**
 * Link encoded in the QR. Everything after "#" stays on the device; browsers never send it to the server.
 * `types` optionally limits what the phone offers (for example ["password", "text"] for a password field).
 */
/** A URL without trailing slashes. A loop rather than /\/+$/, which backtracks on long runs of slashes. */
export function withoutTrailingSlash(url) {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

export function buildLink(baseUrl, { sessionId, publicKey }, { types } = {}) {
  const params = new URLSearchParams({ v: String(PROTOCOL_VERSION), id: sessionId, k: publicKey });
  const offered = (types ?? []).filter((t) => ITEM_TYPES.includes(t));
  if (offered.length && offered.length < ITEM_TYPES.length) params.set("t", offered.join(","));
  return `${withoutTrailingSlash(baseUrl)}/#${params}`;
}

/** Returns { sessionId, publicKey, types } (types: what the receiver accepts), or null. */
export function parseLinkFragment(hash) {
  const params = new URLSearchParams(String(hash).replace(/^#/, ""));
  const sessionId = params.get("id");
  const publicKey = params.get("k");
  if (params.get("v") !== String(PROTOCOL_VERSION)) return null;
  if (!isValidSessionId(sessionId) || !publicKey || !PUBLIC_KEY_RE.test(publicKey)) return null;
  const asked = (params.get("t") ?? "").split(",").filter((t) => ITEM_TYPES.includes(t));
  return { sessionId, publicKey, types: asked.length ? asked : [...ITEM_TYPES] };
}

// Offline mode: with no internet, the phone shows its sealed message as a QR code and the
// laptop scans it with the webcam. Same ciphertext as the relay carries, so the same guarantees.
//   PT1.<session id>.<enc>.<ct>   (all base64url)
const OFFLINE_PREFIX = "PT1";
// Keeps the QR small enough for a laptop webcam to read off a phone screen (about 600 characters of text).
export const MAX_OFFLINE_PAYLOAD = 1000;

export function encodeOfflinePayload(sessionId, message) {
  const text = [OFFLINE_PREFIX, sessionId, message.enc, message.ct].join(".");
  if (text.length > MAX_OFFLINE_PAYLOAD) throw new Error("Too large to show as a QR code");
  return text;
}

/** Returns { sessionId, message } or null if the text isn't a Postern offline code. */
export function decodeOfflinePayload(text) {
  const parts = String(text).trim().split(".");
  if (parts.length !== 4 || parts[0] !== OFFLINE_PREFIX || !isValidSessionId(parts[1])) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(parts[2]) || !/^[A-Za-z0-9_-]+$/.test(parts[3])) return null;
  return { sessionId: parts[1], message: { v: PROTOCOL_VERSION, enc: parts[2], ct: parts[3] } };
}
