# @dahp/postern

Let people send a **password, text, link or file from their phone** to your web page or app. They
scan a QR code, type or paste on the phone, and it arrives end-to-end encrypted. No app to install,
no accounts.

- **Private:** encrypted on the phone with a one-time key only your page holds (HPKE, RFC 9180:
  X25519, HKDF-SHA256, AES-256-GCM). The relay passes on ciphertext it can't read.
- **Small:** one button, or a headless API for your own design.
- **Works everywhere JavaScript runs:** browsers, smart-TV web apps (Samsung Tizen, LG webOS),
  Electron, Node 20+. Plain HTTP long polling where WebSocket isn't available.
- **Open protocol:** native apps (Android, Google TV, iOS, Apple TV) can use the REST API directly.

Live demo: <https://postern.dahp.io/developers>

## Install

```sh
npm install @dahp/postern
```

Or with a script tag, which defines `window.Postern`:

```html
<script src="https://cdn.jsdelivr.net/npm/@dahp/postern@1/dist/postern.global.js"></script>
```

## Add a "From phone" button to a field

```html
<input type="password" id="password" data-postern>
<script type="module">
  import { attachAll } from "@dahp/postern/ui";
  attachAll();
</script>
```

Or place the button yourself:

```html
<input type="password" id="password">
<postern-button for="password"></postern-button>
```

The button opens a dialog with the QR code. After the phone sends, the user checks the 4-digit code
and clicks **Use it**, and the field is filled the way typing would fill it, so React, Vue and
Angular see the change.

To handle the item yourself (files, for example), cancel the default fill:

```js
button.addEventListener("postern-receive", (event) => {
  event.preventDefault();
  const { item, code } = event.detail;
  // item: { type: "password" | "text" | "url", text } or { type: "file", name, mime, bytes }
});
```

## Your own interface

```js
import { open } from "@dahp/postern/ui";
const received = await open({ types: ["file"] }); // { item, code }, or null if closed
```

No interface at all, for TV apps and custom designs:

```js
import { receive, drawQr } from "@dahp/postern";

const session = await receive({ types: ["password", "text"] });
drawQr(canvas, session.link);            // or render session.link with any QR library
const { item, code } = await session.result;
// Show `code` and use `item` only after the user confirms it matches their phone.
```

`session.cancel()` ends it. `session.result` rejects with a `PosternError` whose `code` is
`expired` (after 2 minutes), `cancelled` or `decrypt_failed`.

### Options

| Option | Meaning | Default |
|---|---|---|
| `server` | Relay address, for example your self-hosted relay | `https://postern.dahp.io` |
| `types` | What the phone may send: `password`, `text`, `url`, `file` | all; the button picks by field type |
| `transport` | `"websocket"`, `"poll"` or `"auto"` | `"auto"` |
| `onStatus` | Called with `"connecting"`, `"waiting"` or `"offline"` | none |
| `signal` | An `AbortSignal` that cancels | none |
| `scanner` (UI) | `startScanner` from `@dahp/postern/scanner`, for offline mode | off |

### Offline mode

Without internet, the phone can show its encrypted message as a QR code. To read it with the
computer's camera:

```js
import { open } from "@dahp/postern/ui";
import { startScanner } from "@dahp/postern/scanner";
await open({ scanner: startScanner });
```

With your own scanner, pass the scanned text to `session.acceptOffline(text)`.

## Content-Security-Policy

If your site sets one, allow the relay: `connect-src https://postern.dahp.io wss://postern.dahp.io`.
The dialog needs no inline scripts or styles. Restyle it with `--postern-accent`,
`--postern-radius` and `--postern-font`.

## Self-hosting

The relay is open source and runs on your own server or as a Docker image; pass its address as
`server`. See the repository's `selfhost/` folder.

## Protocol

The full specification and test vectors are in `docs/PROTOCOL.md` in the repository. In short: the
QR holds `https://postern.dahp.io/#v=1&id=<session>&k=<public key>`; the phone posts
`{"v":1,"enc","ct"}` to `/api/s/<session>`; the receiver waits on a WebSocket or polls
`/api/s/<session>/wait`.

## Terms

Using the public relay at postern.dahp.io is subject to the [Terms of Use](https://postern.dahp.io/terms). If you add Postern to your product, you're responsible for your integration and your own users (section 5). The dialog links to the Terms of whichever relay it uses.

## License

Apache-2.0. © 2026 DAHP Tech LLC.
