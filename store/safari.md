# Mac App Store submission (Safari)

Build and upload from Xcode: `safari/Postern/Postern.xcodeproj`. Steps are in `safari/README.md`.
Run `npm run build:release` first, so the extension points at https://postern.dahp.io.

## App information

**Name** (30 characters max): Postern
If the name is taken, use: Postern: Phone to Browser

**Subtitle** (30 max): Phone to Safari, encrypted

**Category:** Productivity. Secondary: Utilities.

**Content rights:** no third-party content.

**Age rating:** answer None to every question.

**Copyright:** 2026 DAHP Tech LLC

**Support URL:** https://postern.dahp.io/

**Marketing URL:** https://postern.dahp.io/

**Privacy Policy URL:** https://postern.dahp.io/privacy

**Price:** Free

## Version 1.0.2

**Promotional text** (170 max):
Send a password from your phone straight into a login field in Safari. Scan a QR code, check a 4-digit code, done. End-to-end encrypted, no account.

**Keywords** (100 max, comma-separated, no spaces):
password,send,phone,qr,transfer,encrypted,autofill,login,text,link,file,extension,secure

**Description:**

Postern is a private gate from your phone to Safari on your Mac.

Your password is on your phone and the login form is on your Mac. Instead of typing a long password by hand, open Postern in Safari, scan its QR code with your phone, and send it. It's filled straight into the field you selected.

What you can send:
• Passwords: filled into the selected field, never copied to the clipboard
• Text: user IDs, codes, addresses, notes
• Links: open in a new tab, fill, or copy
• Files up to 256 KB, saved to Downloads

Private by design:
• Encrypted on your phone with a one-time key that only Safari holds (HPKE, RFC 9180: X25519, HKDF-SHA256, AES-256-GCM)
• The relay only passes on ciphertext it can't read, keeps nothing on disk, and forgets it within 2 minutes
• A 4-digit code on both screens confirms what arrived came from your phone
• No accounts, no tracking, no analytics

Easy:
• Nothing to install on the phone: the QR code opens a web page
• Click the toolbar icon, right-click a field, or press Option-Shift-P

After installing, open Postern once and turn on its extension in Safari Settings > Extensions.

Terms of Use: https://postern.dahp.io/terms
Privacy Policy: https://postern.dahp.io/privacy

**Screenshots** (1280 × 800): `store/screenshots/1-scan.png`, `2-confirm.png`, `3-filled.png`

## App Privacy

Data Not Collected. The extension sends only end-to-end encrypted messages to the relay, which
can't read them and keeps nothing after 2 minutes. No analytics, no accounts, no tracking.

## Notes for App Review

Paste into App Review Information > Notes. No sign-in is needed.

Postern is a Safari web extension. It receives a password, text, link or file that the user sends
from their own phone, end-to-end encrypted, and fills it into the field they selected.

How to test:
1. Open Postern, then turn on its extension in Safari Settings > Extensions and allow it on websites.
2. In Safari, open https://postern.dahp.io/developers, click into any text field, then click the
   Postern toolbar button. It shows a QR code.
3. Scan the QR code with an iPhone camera. It opens a web page (postern.dahp.io); nothing to install.
4. Type something on the phone and tap Send. The Mac shows the same 4-digit code as the phone, with
   Fill, Copy or Discard. Fill puts the text into the field.

The extension connects only to https://postern.dahp.io. Messages are encrypted on the phone and can
only be decrypted by the extension. Source code: https://github.com/dahp-studios/postern

## Export compliance

Postern uses standard encryption to protect what users send: HPKE (RFC 9180) with X25519,
HKDF-SHA256 and AES-256-GCM. X25519 runs in the extension's own JavaScript (@hpke/dhkem-x25519),
not in macOS, so in App Store Connect this is "standard encryption algorithms" rather than only
the operating system's encryption. That case needs a French encryption declaration only if the app
is offered in France.
