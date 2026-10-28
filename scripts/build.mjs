// Builds the phone page into relay/public and the extension into extension/dist.
//
//   npm run build                                       # extension points at http://localhost:8787
//   PT_SERVER=https://postern.example.com npm run build # default server baked into the extension
//
// Everything is bundled locally: no CDNs or remote code (required for MV3, and keeps the phone page auditable).

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = process.env.PT_SERVER || "http://localhost:8787";

const common = { bundle: true, format: "esm", minify: false, sourcemap: false, legalComments: "none", logLevel: "info" };

// Phone page
const phoneOut = join(root, "relay/public");
const PHONE_STATIC = [
  "index.html", "privacy.html", "style.css", "favicon.svg", "_headers",
  "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png",
];
// Empty the folder rather than deleting it, so a running `wrangler dev` keeps serving from it.
mkdirSync(phoneOut, { recursive: true });
for (const f of readdirSync(phoneOut)) rmSync(join(phoneOut, f), { recursive: true, force: true });
for (const f of PHONE_STATIC) cpSync(join(root, "phone", f), join(phoneOut, f));
await build({
  ...common,
  entryPoints: [join(root, "phone/app.js")],
  outdir: phoneOut,
  splitting: true, // the camera scanner loads only when it's used
  chunkNames: "chunks/[name]-[hash]",
  target: ["safari15", "chrome100", "firefox100"],
});

// Service worker: caches every built file so the page opens offline. Its version changes
// whenever any file does, which makes phones pick up the new files.
const builtFiles = readdirSync(phoneOut, { recursive: true })
  .filter((f) => !f.startsWith("_") && /\.\w+$/.test(f) && f !== "index.html" && f !== "privacy.html")
  .sort();
const hash = createHash("sha256");
for (const f of builtFiles.concat("index.html", "privacy.html")) hash.update(readFileSync(join(phoneOut, f)));
// Pages are served without ".html" (Cloudflare redirects /privacy.html to /privacy).
const cacheList = ["/", "/privacy", ...builtFiles.map((f) => `/${f}`)];
writeFileSync(
  join(phoneOut, "sw.js"),
  readFileSync(join(root, "phone/sw.js"), "utf8")
    .replace("__VERSION__", hash.digest("hex").slice(0, 12))
    .replace("__FILES__", JSON.stringify(cacheList)),
);

// Extension
const extOut = join(root, "extension/dist");
rmSync(extOut, { recursive: true, force: true });
mkdirSync(extOut, { recursive: true });
cpSync(join(root, "extension/manifest.json"), join(extOut, "manifest.json"));
cpSync(join(root, "extension/icons"), join(extOut, "icons"), { recursive: true });
for (const f of ["popup.html", "popup.css", "options.html", "scan.html"]) cpSync(join(root, "extension/src", f), join(extOut, f));
await build({
  ...common,
  entryPoints: ["popup.js", "options.js", "background.js", "scan.js"].map((f) => join(root, "extension/src", f)),
  outdir: extOut,
  target: ["chrome116"],
  define: { __DEFAULT_SERVER__: JSON.stringify(server) },
});

console.log(`\nBuilt with default server ${server}`);
