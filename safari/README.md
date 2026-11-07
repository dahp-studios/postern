# Postern for Safari (macOS)

`safari/Postern/Postern.xcodeproj` wraps the extension in a small Mac app, as Safari requires.
Generated with Apple's `safari-web-extension-converter`, macOS 13 or later.

The project doesn't copy the extension: it uses `extension/dist-safari/` directly, so build that first.

## Signing and bundle ID

Nothing account-specific is in the project. `safari/Postern/Config/Postern.xcconfig` sets the bundle ID
(`io.dahp.postern`; the extension is `io.dahp.postern.Extension`) and includes an optional
`Local.xcconfig` next to it, which git ignores. Before building:

```sh
cp safari/Postern/Config/Local.xcconfig.example safari/Postern/Config/Local.xcconfig
```

and put your Apple Developer Team ID in it. Pick the team there, not in Xcode's Signing pane, or
Xcode writes it into the project file. Building your own copy for distribution? Also set
`POSTERN_BUNDLE_ID` to an ID you own, since `io.dahp.postern` is registered to DAHP Tech LLC.

## Try it on this Mac

```sh
npm run build:release        # extension/dist-safari pointing at postern.dahp.io
open safari/Postern/Postern.xcodeproj
```

1. In Xcode, choose the **Postern** scheme and **My Mac**, then **Product → Run**.
2. In Safari: **Settings → Advanced → Show features for web developers**, then
   **Develop → Allow Unsigned Extensions** (needed until the app is signed; Safari asks again after
   every restart).
3. **Safari → Settings → Extensions**, turn on **Postern**, and allow it on websites when asked.

## Publish to the Mac App Store

The account owner does these steps in the browser and in Xcode, with the team ID in `Local.xcconfig`.

1. developer.apple.com → Identifiers → **+** → App IDs: `io.dahp.postern` and
   `io.dahp.postern.Extension`.
2. Profiles → **+** → **Mac App Store Connect**, one per App ID, with the DAHP Tech LLC
   distribution certificate. Name them `Postern App Store` and `Postern Extension App Store`.
   Download and double-click them. (Or let Xcode's automatic signing create them.)
3. App Store Connect → Apps → **+** → New App: platform macOS, name **Postern**, bundle ID
   `io.dahp.postern`, SKU `postern-mac`.
4. Bump `CURRENT_PROJECT_VERSION` for every upload, then **Product → Archive** →
   **Distribute App → App Store Connect → Upload**.
5. In App Store Connect: description and screenshots from `store/listing.md`, privacy policy
   `https://postern.dahp.io/privacy`, App Privacy "Data Not Collected", category Productivity.
6. **Export compliance:** Postern uses standard encryption (HPKE: X25519 and AES-256-GCM) to
   protect what users send. Answer App Store Connect's encryption questions for that; it may
   ask for a self-classification. Leave `ITSAppUsesNonExemptEncryption` unset until that's decided.

## Known differences in Safari

- The popup may not reopen by itself when something arrives; the toolbar badge shows it instead.
- Offline mode needs camera access in the extension's scan page; if Safari refuses, use the
  web receiver (postern.dahp.io/receive) for offline transfers.
