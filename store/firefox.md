# Firefox Add-ons (addons.mozilla.org) submission

Upload: `dist/postern-firefox-<version>.zip`. Source: `dist/postern-source-<version>.zip`.
Both come from `npm run package`.

## Listing

**Name:** Postern

**Summary** (250 characters max):
Send passwords, text, links and files from your phone to Firefox by scanning a QR code. End-to-end encrypted, with no app or account needed. Passwords go straight into the field, never the clipboard.

**Description:**

Postern is a private gate from your phone to your browser.

Your password is on your phone and the login form is on your computer. Instead of typing a long password by hand, open Postern, scan its QR code with your phone, and send it. It's filled straight into the field you selected.

What you can send:
- Passwords: filled into the selected field, never copied to the clipboard
- Text: user IDs, codes, addresses, notes
- Links: open in a new tab, fill, or copy
- Files up to 256 KB: JSON, text or anything else, saved to Downloads

Private by design:
- Encrypted on your phone with a one-time key that only your browser holds (HPKE, RFC 9180: X25519, HKDF-SHA256, AES-256-GCM)
- The relay only passes on ciphertext it can't read, keeps nothing on disk, and forgets it within 2 minutes
- A 4-digit code on both screens confirms what arrived came from your phone
- No accounts, no tracking, no analytics

Easy:
- Nothing to install on the phone: the QR code opens a web page
- Right-click a field, click the toolbar icon, or press Alt+Shift+P
- No internet? The phone can show the encrypted message as a QR code for your webcam

**Categories:** Privacy & Security; Productivity (or the closest that AMO offers)

**Support email:** info@dahp.io
**Homepage / support site:** https://postern.dahp.io/
**Privacy policy:** https://postern.dahp.io/privacy (paste its text if AMO asks for the policy itself)
**License:** Apache License 2.0
**Screenshots:** `store/screenshots/1-scan.png`, `2-confirm.png`, `3-filled.png`

## Notes for reviewers

Paste this into "Notes to Reviewer":

Postern receives a password, text, link or file that the user sends from their own phone, end-to-end encrypted, and fills it into the field they selected.

How to test without a phone: click into a text field on any page, then click the toolbar icon. The popup shows a QR code; right-click the popup, choose Inspect, and run document.getElementById("qr").dataset.link in the console. Open that link in another browser or private window: it's the phone page. Type something, press Send, and the popup shows the same 4-digit code with Fill, Copy or Discard.

Permissions:
- activeTab and scripting: fill the received value into the focused field, only on the tab where the user opened Postern, only when they click Fill.
- contextMenus: the "Postern: receive from phone" right-click entry.
- storage: the current one-time session (storage.session, memory only), so the popup can close and reopen, and an organization's relay address from enterprise policy (storage.managed). Users can't change the server.
- alarms: delete the one-time key and anything received when the session expires.

Network: the extension connects only to https://postern.dahp.io (or a relay an administrator sets by enterprise policy) over WebSocket. Messages are HPKE ciphertext; the relay can't decrypt them. No data collection (data_collection_permissions: none). No remote code: everything is bundled.

Source code: the package is bundled with esbuild from the attached source (no minification). To rebuild:
1. Node.js 20 or later (tested with 25), npm 10 or later.
2. In the source folder: `npm ci`
3. `npm run build:release`
4. The add-on is in `extension/dist-firefox/` and is identical to the uploaded package.

Protocol specification: docs/PROTOCOL.md in the source. Tests: `npm test`.
