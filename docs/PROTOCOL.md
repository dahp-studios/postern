# Postern protocol, version 1

Postern moves one item (a password, text, link or file) from a **sender** (usually a phone) to a
**receiver** (a browser extension, a web page, a TV app) through a **relay** that can't read it.
This document is enough to write a compatible sender, receiver or relay in any language.
`test/vectors/postern-v1.json` has fixed inputs and the exact expected outputs.

## 1. Overview

1. The receiver makes a fresh X25519 key pair and a random session ID, and shows a QR code with both.
2. The receiver connects to the relay and waits.
3. The sender scans the QR, encrypts the item to the receiver's public key with HPKE, and posts the
   ciphertext to the relay.
4. The relay hands the ciphertext to the receiver and forgets it.
5. Both sides derive a 4-digit confirmation code; the user checks they match.

Without internet, step 3 can instead show the ciphertext as a second QR code that the receiver
scans with its camera (section 7).

## 2. Encryption

HPKE ([RFC 9180](https://www.rfc-editor.org/rfc/rfc9180)), base mode (`mode_base`, 0x00):

| Parameter | Value |
|---|---|
| KEM | DHKEM(X25519, HKDF-SHA256), `0x0020` |
| KDF | HKDF-SHA256, `0x0001` |
| AEAD | AES-256-GCM, `0x0002` |
| `info` | the ASCII bytes `dahp postern v1` |
| `aad` | the ASCII bytes `v1:` followed by the session ID, for example `v1:AAECAwQFBgcICQoLDA0ODw` |

The sender calls `SetupBaseS(pkR, info)` and seals the padded plaintext (section 4) once with `aad`.
The receiver calls `SetupBaseR(enc, skR, info)` and opens it. Each key pair opens exactly one
message, then the receiver must delete it.

**Confirmation code:** `Export("confirmation code", 4)` on the HPKE context, read as a big-endian
unsigned 32-bit integer, modulo 10000, written as 4 digits with leading zeros. The sender shows it
after sending; the receiver shows it before the item is used.

## 3. The QR link

```
https://<relay>/#v=1&id=<session id>&k=<public key>[&t=<types>]
```

| Field | Format |
|---|---|
| `v` | `1` |
| `id` | 16 random bytes, base64url without padding (22 characters) |
| `k` | the receiver's 32-byte X25519 public key, base64url without padding (43 characters) |
| `t` | optional: comma-separated item types the receiver accepts, from `password`, `text`, `url`, `file`. Absent means all. |

Everything after `#` is a URL fragment: browsers never send it to the server, so the relay never
sees the public key. A sender web page should remove it from the address bar after reading it.

## 4. Plaintext

UTF-8 JSON, padded with spaces (0x20):

```json
{"t":"password","v":"correct horse battery staple"}
{"t":"text","v":"user-42@example.com"}
{"t":"url","v":"https://example.com/reset?token=abc"}
{"t":"file","n":"config.json","m":"application/json","d":"<file bytes, base64url>"}
```

**Padding:** let `L` be the JSON length in bytes. Use blocks of 128 bytes if `L < 1024`, otherwise
4096 bytes. The padded length is `ceil((L + 1) / block) × block`; fill the rest with spaces. Trailing
spaces are valid JSON whitespace, so the receiver parses the whole buffer.

**Limits and checks.** Receivers must check these after decrypting, because a sender who saw the
QR code could encrypt anything:

| Type | Limit | Check |
|---|---|---|
| `password` | 1,024 characters | not empty; used exactly as sent |
| `text` | 10,000 characters | trimmed, not empty |
| `url` | 4,096 characters | trimmed; only `http:` and `https:` links |
| `file` | 256 KB of data | name: path parts, control characters and `<>:"\|?*` removed, leading dots removed, at most 200 characters, `file` if empty; type: must look like `type/subtype`, otherwise `application/octet-stream` |

## 5. Messages

```json
{"v":1,"enc":"<HPKE enc, base64url, 43 characters>","ct":"<ciphertext, base64url>"}
```

Receivers reject `v` other than the number 1, an `enc` that isn't 32 bytes, and ciphertext over
512 KB.

## 6. Relay API

All under `https://<relay>/api/s/<session id>`. Responses are JSON. The API sends
`Access-Control-Allow-Origin: *` and uses no cookies or credentials.

| Request | Side | Responses |
|---|---|---|
| `GET` with WebSocket upgrade | receiver | `101`, then the message arrives as one text frame; `409` if another receiver is connected or the session is over. Send the text `ping` on connecting and every 20 s; the relay answers `pong`. |
| `GET …/wait` | receiver | Long polling. `200` with the message as the body; `204` after 25 s with nothing (ask again); `409` if a WebSocket receiver is connected; `410` if the session is over. |
| `DELETE` | receiver | Cancel: `200`. The session ends; a waiting poll gets `410`. |
| `POST` with the message as the body | sender | `200` delivered; `202` queued because the receiver is between connections (it gets it when it's back); `404` no receiver has connected yet; `410` the session is over (used, cancelled or expired); `400` malformed; `413` over 768 KB; `429` rate limited. |

**Lifetime.** A session lasts 2 minutes from the receiver's first connection, then the relay closes
it (a WebSocket closes with code `4000`). It takes one message. The receiver may reconnect
(WebSocket or poll) as long as the session lasts. Closing the WebSocket with code `4001` cancels,
like `DELETE`.

**What a relay stores.** Only the pending ciphertext, in memory, until it's delivered or the
session ends. It may use the client IP for rate limiting (postern.dahp.io: 30 API requests a minute
per IP) and must not log contents.

## 7. Offline mode

The sender shows the message as a QR code containing:

```
PT1.<session id>.<enc>.<ct>
```

The receiver checks the session ID is its own, then opens the message as in section 2. Payloads
over 1,000 characters aren't shown, so they stay readable by a laptop webcam; that's about 600
characters of text.

## 8. Security notes

- The relay sees only the session ID, ciphertext and IP addresses. It can drop or delay messages but
  can't read or change them: AES-GCM rejects any change, and the session ID in `aad` stops replay
  into another session.
- Someone who photographs the QR code can send their own message first. The confirmation code
  exposes this: theirs won't match the user's phone. A receiver must show the code before the item
  is used.
- The padding hides the exact length of short items.
- A sender web page is code served by the relay's host; a native sender app removes that trust.

## 9. Test vectors

`test/vectors/postern-v1.json` gives `ikmR` and, per item, `ikmE`. Derive the key pairs with
`DeriveKeyPair` (RFC 9180 section 7.1.3), seal each item with that fixed ephemeral key, and compare
`message`, `code` and `offline_payload` exactly. The suite itself is checked against the official
RFC 9180 vector in `test/vectors/rfc9180-base-x25519-sha256-aes256gcm.json`.
