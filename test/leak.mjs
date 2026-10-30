// Finds a secret in captured bytes, in any common encoding: raw UTF-8, UTF-16, hex,
// base64 and base64url (at every byte alignment, so it's found even in the middle of a
// longer base64 string), URL encoding and JSON escapes. Used by the attack tests and by
// `npm run verify`.

const utf8 = (s) => new TextEncoder().encode(s);

function base64Cores(bytes, url) {
  // A secret inside a longer base64 string can start at any of 3 byte offsets. Encode it at each
  // offset and keep only the characters that depend solely on the secret's own bytes.
  const cores = [];
  for (let offset = 0; offset < 3; offset++) {
    const padded = new Uint8Array(offset + bytes.length);
    padded.set(bytes, offset);
    let b64 = Buffer.from(padded).toString("base64");
    if (url) b64 = b64.replace(/\+/g, "-").replace(/\//g, "_");
    const start = Math.ceil((offset * 4) / 3);
    const end = Math.floor(((offset + bytes.length) * 4) / 3);
    if (end - start >= 8) cores.push(b64.slice(start, end));
  }
  return cores;
}

/** Every form the secret could take on the wire. */
export function encodingsOf(secret) {
  const bytes = utf8(secret);
  const forms = [
    ["UTF-8", bytes],
    ["UTF-16LE", Buffer.from(secret, "utf16le")],
    ["hex", utf8(Buffer.from(bytes).toString("hex"))],
    ["HEX", utf8(Buffer.from(bytes).toString("hex").toUpperCase())],
    ["URL-encoded", utf8(encodeURIComponent(secret))],
    ["JSON-escaped", utf8(JSON.stringify(secret).slice(1, -1).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`))],
    ...base64Cores(bytes, false).map((c) => ["base64", utf8(c)]),
    ...base64Cores(bytes, true).map((c) => ["base64url", utf8(c)]),
  ];
  // Also look for any 8-byte piece of the raw secret, in case part of it leaks.
  for (let i = 1; i + 8 <= bytes.length; i += 4) forms.push([`UTF-8 bytes ${i}–${i + 8}`, bytes.subarray(i, i + 8)]);
  const seen = new Set();
  return forms.filter(([, b]) => {
    const key = Buffer.from(b).toString("hex");
    return b.length >= 4 && !seen.has(key) && seen.add(key);
  });
}

function indexOf(haystack, needle) {
  return Buffer.from(haystack.buffer, haystack.byteOffset, haystack.byteLength).indexOf(Buffer.from(needle));
}

/** Returns [{ secret, encoding, offset }] for every secret found in the haystack. */
export function findLeaks(haystack, secrets) {
  const bytes = typeof haystack === "string" ? utf8(haystack) : haystack;
  const leaks = [];
  for (const secret of secrets) {
    for (const [encoding, needle] of encodingsOf(secret)) {
      const offset = indexOf(bytes, needle);
      if (offset !== -1) leaks.push({ secret, encoding, offset });
    }
  }
  return leaks;
}
