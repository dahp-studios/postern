# Chrome Web Store listing

## Name
Postern

## Summary (132 characters max)
Send passwords, text, links and files from your phone to your browser by QR code, end-to-end encrypted. No app or account needed.

## Category
Productivity (or Tools)

## Description

Postern is a private gate from your phone to your browser.

Your password is on your phone and the login form is on your laptop. Instead of typing a long password by hand, open Postern, scan its QR code with your phone, and send it. It's filled straight into the field.

What you can send:
• Passwords: filled into the field you selected, never copied to the clipboard
• Text: user IDs, codes, addresses, notes
• Links: open in a new tab, fill, or copy
• Files up to 256 KB: JSON, text, or anything else, saved to Downloads

Private by design:
• Encrypted on your phone with a one-time key that only your browser holds (HPKE, RFC 9180: X25519, HKDF-SHA256, AES-256-GCM)
• The server only ever passes on ciphertext it can't read, holds nothing on disk, and forgets it within 2 minutes
• A 4-digit code on both screens confirms that what arrived came from your phone
• No accounts, no tracking, no analytics

Easy:
• Nothing to install on the phone: the QR code opens a web page. You can add it to your home screen if you like.
• Right-click a field, click the toolbar icon, or press Alt+Shift+P
• No internet? The phone can show the encrypted message as a QR code for your webcam

## Single purpose
Receive a password, text, link or file sent from the user's own phone, end-to-end encrypted, and fill it into the selected field, open it, copy it or save it.

## Permission justifications

| Permission | Why |
|---|---|
| activeTab | Fill the received password or text into the field the user selected, only on the tab where they opened Postern. |
| scripting | Insert the value into the focused field (and check that a field is focused) on that tab. Runs only when the user acts. |
| contextMenus | The "Postern: receive from phone" entry when right-clicking a field. |
| storage | Hold the current one-time session in memory-only session storage so the popup can close and reopen. |
| alarms | Delete the one-time key and anything received when the session expires (2–5 minutes). |

No host permissions. No remote code: everything is bundled in the package.

## Data use disclosures
- Collects: none of the listed categories. The extension doesn't collect or transmit user data. What the user sends is end-to-end encrypted between their own phone and browser, and the relay can't read it.
- Not sold, not used for unrelated purposes, not used for creditworthiness.

## Privacy policy URL
https://postern.dahp.io/privacy

## Homepage / support
https://postern.dahp.io/ · info@dahp.io

## Assets
- Screenshots, 1280×800: `store/screenshots/` (scan, confirm code, filled).
- Small promo tile 440×280: `store/promo-small-440x280.png`.
- Store icon 128×128: `store/store-icon-128.png` (96×96 artwork with transparent padding).
- Marquee promo tile 1400×560: `store/promo-marquee-1400x560.png`.
