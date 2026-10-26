# Password Transfer

Send a password from your phone into a field in your laptop's browser. The extension
shows a QR code, the phone scans it, and the password travels end-to-end encrypted.
Nothing to install on the phone, no accounts, no clipboard.

```
LAPTOP (Chrome extension)                       PHONE (web page, no install)
1. Click into a password field, open the extension
2. New one-time X25519 key pair
   QR: https://<server>/#v=1&id=<session>&k=<public key>
                    ───── QR (scanned by phone camera) ─────▶ 3. Page opens; type/paste/autofill
                                                              4. HPKE-encrypt to the laptop's key
            ◀──── WebSocket ──── RELAY ◀──── POST ciphertext ─┘
                     (one-time mailbox, ciphertext only, 2 min TTL)
5. Decrypt, show 4-digit code; user checks it matches the phone
6. Fill the field
```

## Layout

| Path | What |
|---|---|
| `shared/protocol.js` | Encryption and link format, used by both sides |
| `extension/` | Chrome MV3 extension (popup, settings, field filling) |
| `phone/` | Phone web page (built into `relay/public/`) |
| `relay/` | Cloudflare Worker + Durable Object: relay API and phone page hosting |
| `scripts/build.mjs` | Bundles everything with esbuild (no CDNs or remote code) |
| `test/` | Unit tests (`npm test`) and end-to-end relay test (`npm run test:e2e`) |

## Security design

- **HPKE (RFC 9180)** base mode: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM,
  via [`@hpke/core`](https://github.com/dajiaji/hpke-js). No custom crypto.
- **Fresh key pair per session.** The private key never leaves the extension popup and is dropped when it closes.
- **The relay sees only ciphertext.** It can't decrypt; it holds nothing on disk; each session takes exactly one message and expires after 2 minutes.
- **The key travels in the URL fragment** (`#…`), which browsers never send to servers. The phone page then removes it from the address bar.
- **Ciphertext is bound to the session ID** (AEAD associated data), so a message can't be replayed into another session.
- **Confirmation code** from the HPKE exporter: if someone who photographed the QR injects their own message, the laptop's code won't match the phone's, and the user discards it.
- **Padding** to 128-byte blocks hides the password length.
- **Phone page CSP** allows only same-origin scripts and connections; no third-party code or analytics.
- **No clipboard.** The extension writes straight into the focused field.

Trust note: the phone page's code is downloaded from the server each time (same model as any
web app). A future native app or pinned PWA removes that.

## Develop locally

```sh
npm install
npm test            # crypto unit tests
npm run dev         # builds, then runs relay + phone page at http://localhost:8787
npm run test:e2e    # in a second terminal: full transfer through the local relay
```

Load the extension: `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist`.
Open it on a password field by right-clicking the field → **Receive password from phone**, clicking the
toolbar icon, or pressing **Alt+Shift+P**.

### Testing with a real phone

The phone needs HTTPS (browsers only allow WebCrypto on secure origins), so `http://<laptop-ip>:8787`
won't work. Use a temporary tunnel:

```sh
brew install cloudflared
cloudflared tunnel --url http://localhost:8787    # prints https://<random>.trycloudflare.com
```

Put that URL in the extension's **Settings** (or rebuild with `PT_SERVER=https://… npm run build`).

Note: the extension popup closes when it loses focus, ending the session. Opening the phone link
in another tab on the same laptop closes it, so test with a phone (or `npm run test:e2e`).

## Deploy (later)

DNS for the company domain is on Cloudflare, so the Worker can get its own subdomain without
touching the existing website records:

1. `cd relay && npx wrangler login && npx wrangler deploy`
2. Cloudflare dashboard → Workers → `password-transfer` → Settings → Domains → add a custom
   domain such as `send.<company-domain>`.
3. `PT_SERVER=https://send.<company-domain> npm run build`, then pack `extension/dist` for the Chrome Web Store.
4. `PT_SERVER=https://send.<company-domain> npm run test:e2e`

## Roadmap

- Offline two-QR mode (laptop webcam scans the phone's ciphertext QR; no relay)
- Native phone app via Universal Links / App Links (same QR link opens it when installed)
- Installable PWA
- Keep the session alive if the popup loses focus (in-page overlay or small window)
- Relay rate limiting; Firefox/Edge builds
