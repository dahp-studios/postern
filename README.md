# Postern

A private gate from your phone to your browser.

[Website](https://postern.dahp.io) · [Chrome Web Store](https://chromewebstore.google.com/detail/postern/lakdmlaodafbajkgleggmnelbdacglmm) · [For developers](https://postern.dahp.io/developers) ·
[npm: `@dahp/postern`](https://www.npmjs.com/package/@dahp/postern) · [Protocol](docs/PROTOCOL.md) ·
[Security](SECURITY.md)

Send a **password**, **text** (user IDs, codes), a **link**, or a **file** (JSON or anything up to 256 KB)
from your phone to the browser on your computer (Chrome, Edge, Firefox, Safari), or to any website or
app that adds the npm package. On the laptop you can fill it into the focused field, open the
link, copy it, or save the file.

The extension shows a QR code, the phone scans it, and the item travels end-to-end encrypted.
Nothing to install on the phone, no accounts. Works without internet too (two-QR offline mode).

```
LAPTOP (browser extension)                      PHONE (web page or home-screen app)
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
| `shared/protocol.js` | Encryption, link and offline QR formats, used everywhere |
| `shared/scanner.js`, `shared/qr.js` | Camera QR reader (BarcodeDetector or jsQR) and QR drawing |
| `extension/` | Browser extension: popup, background session, scan page, settings, field filling |
| `safari/` | Xcode project that wraps the extension for Safari on macOS (`safari/README.md`) |
| `packages/postern/` | The npm package `@dahp/postern` for websites and JavaScript apps |
| `phone/` | Web pages: phone page (installable, offline), `/receive`, `/developers`, `/privacy` |
| `relay/` | Cloudflare Worker + Durable Object; `relay/src/mailbox.js` is the session logic |
| `selfhost/`, `Dockerfile` | The same relay as a Node server and Docker image |
| `docs/PROTOCOL.md` | The protocol specification, with test vectors in `test/vectors/` |
| `scripts/` | Build (esbuild, no CDNs or remote code), packaging, test vectors, playground server |
| `store/` | Store listing text, screenshots and promo tile |
| `test/` | Unit, RFC vector, attack and relay tests; `verify.mjs`; the playground page |

## Where it works

| Receiving side | How |
|---|---|
| Chrome, Edge, Brave, Opera | [The extension on the Chrome Web Store](https://chromewebstore.google.com/detail/postern/lakdmlaodafbajkgleggmnelbdacglmm) (`extension/dist`) |
| Firefox 140+ | The extension (`extension/dist-firefox`) |
| Safari on macOS 13+ | The extension in a Mac app (`safari/`) |
| Any browser, no install | `postern.dahp.io/receive`: shows the item with Copy, Open and Save |
| Any website | `npm install @dahp/postern`: a "From phone" button for its fields |
| Smart-TV web apps, Node, Electron | The npm package, headless `receive()` |
| Android, Google TV, iOS, Apple TV, anything else | The REST API in `docs/PROTOCOL.md` |

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
- **The extension's server is fixed** to postern.dahp.io in store builds; nothing can change it.
- **Limits:** password 1,024 characters, text 10,000, link 4,096, file 256 KB.

Trust note: the phone page's code comes from the server (same model as any web app). The service
worker uses network first, so a fixed version reaches phones as soon as they're online.

## Verifying the security yourself

```sh
npm test         # 56 tests, including the suites below
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

Put that URL in the extension's **Settings**. Only development builds (`npm run build`) have that field; store builds are fixed to postern.dahp.io.

## Release

Production is `https://postern.dahp.io`, a Cloudflare Worker on a custom domain (`relay/wrangler.jsonc`).
Its `workers.dev` address is turned off.

```sh
npm run deploy                                      # builds and deploys the relay and web pages
PT_SERVER=https://postern.dahp.io npm run test:e2e  # checks the live relay
npm run package                                     # store zips in dist/ (Chrome/Edge, Firefox, source)
npm run sdk:pack                                    # dist/dahp-postern-<version>.tgz, then `npm publish` it
```

| Store | Upload | Notes |
|---|---|---|
| Chrome Web Store | `dist/postern-chrome-<v>.zip` | Text in `store/listing.md` |
| Microsoft Edge Add-ons | the same zip | Free developer account |
| addons.mozilla.org | `dist/postern-firefox-<v>.zip` + `dist/postern-source-<v>.zip` | Build steps for reviewers: `npm ci && npm run build:release` |
| Mac App Store | Xcode archive | `safari/README.md` |
| npm | `cd packages/postern && npm publish --access public` | Needs the `dahp` npm organisation |

`npm run package` builds with the production server and refuses to zip a development build.

## Self-hosting the relay

```sh
docker build -t postern-relay .
docker run -p 8790:8790 postern-relay     # or: cd selfhost && npm ci && node server.mjs
```

Put it behind HTTPS, then point the npm package (`server` option) or the extension at it.

The browser extension always uses `postern.dahp.io`. Nothing can change that: no setting, no
policy, no stored value. So nobody can be talked into, or tricked into, using someone else's server.
Self-hosting is for websites and apps, through the npm package's `server` option. An organization
that wants an extension for its own relay builds one from this code with its own fixed server
(`PT_SERVER=https://postern.example.com npm run build`) and publishes it under its own name.

The self-hosted relay passes the same end-to-end tests as the Cloudflare relay. Settings: `PORT`,
`RATE_LIMIT`, `TRUST_PROXY`, `PUBLIC_DIR` (see `selfhost/server.mjs`).

Development builds (`npm run build`) also accept a server in Settings, for testing with a tunnel or
a local relay.

## Contributing and security

Bug reports and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Please report
security problems privately, as described in [SECURITY.md](SECURITY.md), not in a public issue.

## License

Apache-2.0 (see `LICENSE` and `NOTICE`). © 2026 DAHP Tech LLC.

## Roadmap

- Kotlin and Swift libraries for Android, Google TV, iOS and Apple TV
- Native phone app via Universal Links / App Links (same QR link opens it when installed)
- Larger files (chunked transfer)
- Roku (needs X25519 in BrightScript)
