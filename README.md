# Postern

A private gate from your phone to your browser.

Send a **password**, **text** (user IDs, codes), a **link**, or a **file** (JSON or anything up to 256 KB)
from your phone to Chrome on your laptop. On the laptop you can fill it into the focused field, open the
link, copy it, or save the file.

The extension shows a QR code, the phone scans it, and the item travels end-to-end encrypted.
Nothing to install on the phone, no accounts. Works without internet too (two-QR offline mode).

```
LAPTOP (Chrome extension)                       PHONE (web page or home-screen app)
1. Click into a field (optional), open Postern
2. New one-time X25519 key pair
   QR: https://<server>/#v=1&id=<session>&k=<public key>
                    ───── QR (scanned by phone camera) ─────▶ 3. Page opens; pick Password/Text/Link/File
                                                              4. HPKE-encrypt to the laptop's key
            ◀──── WebSocket ──── RELAY ◀──── POST ciphertext ─┘
                     (one-time mailbox, ciphertext only, 2 min TTL)
   or, offline:
            ◀──── laptop webcam ──── phone shows the ciphertext as a QR code
5. Decrypt, show 4-digit code; user checks it matches the phone
6. Fill the field, open the link, copy, or save the file
```

## Using it

- **Open Postern:** right-click a field → **Postern: receive from phone**, the toolbar icon, or **Alt+Shift+P**.
- **The popup can close.** The background worker keeps waiting, so clicking elsewhere loses nothing.
  When something arrives, the popup reopens by itself (or the icon shows a green **1**).
- **What arrived is kept for 3 minutes.** If no field was selected, click into the field and open
  Postern again; no need to resend.
- **No internet?** On the phone, tap **No internet? Show as QR**. On the laptop, click
  **Scan phone's QR** and hold the phone up to the webcam. Works for passwords, links and text
  up to about 600 characters. The phone page must have been opened once before while online.
- **Home-screen app:** open the server address on the phone and add it to the home screen. Opened
  from there, it scans the laptop's QR code itself.

## Layout

| Path | What |
|---|---|
| `shared/protocol.js` | Encryption, link and offline QR formats, used by both sides |
| `shared/scanner.js`, `shared/qr.js` | Camera QR reader (BarcodeDetector or jsQR) and QR drawing |
| `extension/` | Chrome MV3 extension: popup, background session, scan page, settings, field filling |
| `phone/` | Phone web page, installable with offline support (built into `relay/public/`) |
| `relay/` | Cloudflare Worker + Durable Object: relay API and phone page hosting |
| `scripts/` | Build (esbuild, no CDNs or remote code), packaging, playground server |
| `store/` | Chrome Web Store listing text |
| `test/` | Unit tests, end-to-end relay test, and a playground page for manual testing |

## Security design

- **HPKE (RFC 9180)** base mode: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM,
  via [`@hpke/core`](https://github.com/dajiaji/hpke-js). No custom crypto.
- **Fresh key pair per session.** The private key stays in the extension's memory-only session
  storage (never on disk, extension pages only) and is deleted as soon as one message is opened,
  when the session is cancelled or expires, or when the browser closes.
- **The relay sees only ciphertext.** It can't decrypt; it holds nothing on disk; each session takes
  exactly one message and expires after 2 minutes. When the laptop cancels, the relay ends the
  session so the phone is told rather than left thinking it was delivered.
- **The key travels in the URL fragment** (`#…`), which browsers never send to servers. The phone
  page then removes it from the address bar.
- **Ciphertext is bound to the session ID** (AEAD associated data), so a message can't be replayed
  into another session. The offline QR carries the same ciphertext as the relay would.
- **Confirmation code** from the HPKE exporter: if someone who photographed the QR injects their
  own message, the laptop's code won't match the phone's, and the user discards it.
- **Padding** (128-byte steps for short items, 4 KB for large ones) hides the exact length.
- **Phone page CSP** allows only same-origin scripts and connections; no third-party code or analytics.
- **Passwords never touch the clipboard.** They go straight into the focused field. Copy is offered
  only for text and links.
- **Links are limited to http(s)** on both sides, so a `javascript:` or `file:` link can't be opened.
- **File names are cleaned** of path parts and unsafe characters before saving.
- **Relay rate limit:** 30 API requests a minute per IP.
- **Settings accept only https servers** (plain http only for localhost).
- **Limits:** password 1,024 characters, text 10,000, link 4,096, file 256 KB.

Trust note: the phone page's code comes from the server (same model as any web app). The service
worker uses network first, so a fixed version reaches phones as soon as they're online.

## Verifying the security yourself

```sh
npm test         # 39 tests, including the two suites below
npm run verify   # with `npm run dev` running: records what the relay really sees
```

- **`test/rfc9180.test.mjs`:** checks Postern's exact HPKE setup against the official RFC 9180
  test vector for the same suite (`test/vectors/`). Keys, ciphertext and exported values must
  match byte for byte.
- **`test/attacks.test.mjs`:** tries to break it as the relay operator and as someone who
  photographed the QR code:
  - 200+ wrong keys
  - flipping every single bit of the ciphertext
  - cutting, extending and mixing messages
  - replaying a message into another session
  - keystream reuse
  - statistical patterns in 200 KB of zeros
  - length leaks
  - downgrades
  - 1,000 code-matching attempts
  - correctly encrypted but malicious content
  - altered offline QR codes

  Every attack must fail. Each test was also checked against a deliberately weakened version
  of the code, to confirm it catches the weakness.
- **`npm run verify`:** puts a recording proxy in front of the local relay, sends a password,
  text, link and file, and searches every recorded byte for them. It checks raw text, UTF-16,
  hex, base64/base64url at every alignment, URL and JSON encodings, and 8-byte fragments.
  WebSocket frames are unmasked and decompressed first. It also checks that no key travels,
  and includes an unencrypted control message that must be found. The full recording is
  written to `verify-capture.log`.

To check by hand, open a QR link in a desktop tab with DevTools → Network: the `POST` body is
`{"v":1,"enc":…,"ct":…}`, and the page request is a bare `GET /`, without the `#…` key.

## Develop locally

```sh
npm install
npm test            # unit, RFC 9180 vector and attack tests
npm run dev         # builds, then runs relay + phone page at http://localhost:8787 (no rate limit)
npm run test:e2e    # in a second terminal: full transfer through the local relay
npm run playground  # test page with every field type at http://localhost:8788
```

`PT_TEST_RATE_LIMIT=1 PT_SERVER=http://localhost:<port> npm run test:e2e` also checks the rate limit,
against a relay started with plain `npx wrangler dev` (rate limit on).

Load the extension: `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist`.
It also works in **Microsoft Edge** (`edge://extensions`, same steps).

### Testing with a real phone

The phone needs HTTPS (browsers only allow WebCrypto on secure origins), so `http://<laptop-ip>:8787`
won't work. Use a temporary tunnel:

```sh
brew install cloudflared
cloudflared tunnel --url http://localhost:8787    # prints https://<random>.trycloudflare.com
```

Put that URL in the extension's **Settings** (or rebuild with `PT_SERVER=https://… npm run build`).

## Release

Production is `https://postern.dahp.io` (live since 30 October 2026): a Worker custom domain on the
dahp.io Cloudflare zone. It adds one record for the `postern` subdomain only; the website's records
are untouched. The account's `dahp.workers.dev` subdomain exists because Cloudflare requires one, but
Postern's `workers.dev` address is turned off (`workers_dev: false`).

```sh
npx wrangler login                                  # once, in the browser
npm run deploy                                      # builds and deploys the relay + phone page
PT_SERVER=https://postern.dahp.io npm run test:e2e  # checks the live relay
npm run package                                     # dist/postern-extension-<version>.zip for the Web Store
```

`npm run package` builds the extension pointing at production and refuses to zip a development build.
Store listing text and permission justifications are in `store/listing.md`.

## Roadmap

- Native phone app via Universal Links / App Links (same QR link opens it when installed)
- Firefox build (needs an event-page background instead of a service worker)
- Larger files (chunked transfer)
