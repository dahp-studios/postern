# Security policy

Postern moves passwords and other secrets, so we take reports seriously.

## Reporting a vulnerability

Please report it privately, not in a public issue:

- **GitHub:** the repository's **Security** tab → **Report a vulnerability**, or
- **Email:** info@dahp.io, with "Postern security" in the subject.

Include what you found, how to reproduce it, and what an attacker could do with it. We'll reply
within 3 working days, keep you updated, and credit you when the fix is released, unless you'd rather
stay anonymous. Please give us a reasonable time to fix it before you publish details.

## What's in scope

- The protocol and encryption (`shared/protocol.js`, `docs/PROTOCOL.md`)
- The browser extensions, the phone page, `/receive` and the npm package `@dahp/postern`
- The relay (`relay/`, `selfhost/`) and the service at postern.dahp.io

Out of scope: attacks that need a compromised device or browser, denial of service by sheer volume,
missing security headers with no demonstrated impact, and reports produced only by automated scanners.

Please test only against your own sessions or a local relay (`npm run dev`), and never access other
people's data.

## Supported versions

Only the latest release of each component (extension, npm package, relay) gets security fixes.

## How the design can be checked

See "Security design" and "Verifying the security yourself" in the [README](README.md): the RFC 9180
test vectors, the attack tests (`npm test`) and the traffic recorder (`npm run verify`).
