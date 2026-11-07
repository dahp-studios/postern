# Contributing

Thanks for helping. Bug reports, fixes and improvements are welcome.

- **Bugs and ideas:** open an issue with steps to reproduce, your browser and operating system.
- **Security problems:** don't open an issue; follow [SECURITY.md](SECURITY.md).
- **Pull requests:** keep them focused on one change, and run the tests first:

  ```sh
  npm install
  npm test            # unit, RFC 9180 vector and attack tests
  npm run dev         # local relay and phone page at http://localhost:8787
  npm run test:e2e    # in a second terminal
  ```

- **Protocol changes** need a matching update to `docs/PROTOCOL.md` and the test vectors
  (`npm run vectors`), and must stay compatible with version 1 or bump the version.
- **No new runtime dependencies or remote code** without discussing it in an issue first.

## Running your own copy

Everything that names the DAHP service is in one place each. To ship a fork under your own name
and server, change:

| What | Where |
|---|---|
| Relay address in the extension | `PT_SERVER` when running `npm run build:release` (see `extension/src/settings.js`) |
| Firefox add-on ID (`postern@dahp.io`) | `browser_specific_settings.gecko.id` in `scripts/build.mjs` |
| Safari bundle ID and signing team | `safari/Postern/Config/Postern.xcconfig` and `Local.xcconfig` (see `safari/README.md`) |
| Cloudflare route (`postern.dahp.io`) | `routes` in `relay/wrangler.jsonc` |
| Default relay in the npm package | `DEFAULT_SERVER` in `packages/postern/src/index.js`, and the package name in `packages/postern/package.json` |
| Site text, Terms and Privacy pages | `phone/` |

Keep the HPKE `info` string (`"dahp postern v1"` in `shared/protocol.js`) and the message format as
they are, so your build stays compatible with the npm package and the published test vectors.

By contributing, you agree that your contribution is licensed under the Apache License 2.0, the
same as the project (see section 5 of the license). "Postern" and "DAHP" are trademarks of
DAHP Tech LLC and aren't covered by the license.
