// Builds the phone page into relay/public and the extension into extension/dist.
//
//   PT_SERVER=https://pt.example.com npm run build   # default server baked into the extension
//
// Everything is bundled locally: no CDNs or remote code (required for MV3, and keeps the phone page auditable).

import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = process.env.PT_SERVER || "http://localhost:8787";

const common = { bundle: true, format: "esm", minify: false, sourcemap: false, legalComments: "none", logLevel: "info" };

// Phone page
const phoneOut = join(root, "relay/public");
// Empty the folder rather than deleting it, so a running `wrangler dev` keeps serving from it.
mkdirSync(phoneOut, { recursive: true });
for (const f of readdirSync(phoneOut)) rmSync(join(phoneOut, f), { recursive: true, force: true });
for (const f of ["index.html", "style.css", "favicon.svg", "_headers"]) cpSync(join(root, "phone", f), join(phoneOut, f));
await build({
  ...common,
  entryPoints: [join(root, "phone/app.js")],
  outfile: join(phoneOut, "app.js"),
  target: ["safari15", "chrome100", "firefox100"],
});

// Extension
const extOut = join(root, "extension/dist");
rmSync(extOut, { recursive: true, force: true });
mkdirSync(extOut, { recursive: true });
cpSync(join(root, "extension/manifest.json"), join(extOut, "manifest.json"));
cpSync(join(root, "extension/icons"), join(extOut, "icons"), { recursive: true });
for (const f of ["popup.html", "popup.css", "options.html"]) cpSync(join(root, "extension/src", f), join(extOut, f));
await build({
  ...common,
  entryPoints: ["popup.js", "options.js", "background.js"].map((f) => join(root, "extension/src", f)),
  outdir: extOut,
  target: ["chrome116"],
  define: { __DEFAULT_SERVER__: JSON.stringify(server) },
});

console.log(`\nBuilt with default server ${server}`);
