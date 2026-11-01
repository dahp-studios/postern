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

By contributing, you agree that your contribution is licensed under the Apache License 2.0, the
same as the project (see section 5 of the license). "Postern" and "DAHP" are trademarks of
DAHP Tech LLC and aren't covered by the license.
