// Builds the npm package into packages/postern/dist, the web pages (phone, receive, developers)
// into relay/public, and the extension into extension/dist.
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
// Only development builds (pointing at localhost) let the user type a server into Settings. Store
// builds use their built-in server, or one an organization sets through managed policy.
const userServerAllowed = server.startsWith("http://localhost");

const common = { bundle: true, format: "esm", minify: false, sourcemap: false, legalComments: "none", logLevel: "info" };

// npm package @dahp/postern
const sdkDir = join(root, "packages/postern");
const sdkOut = join(sdkDir, "dist");
rmSync(sdkOut, { recursive: true, force: true });
await build({
  ...common,
  entryPoints: ["index.js", "ui.js", "scanner.js"].map((f) => join(sdkDir, "src", f)),
  outdir: sdkOut,
  splitting: true,
  chunkNames: "shared-[hash]",
  external: ["@hpke/core", "@hpke/dhkem-x25519", "qrcode-generator", "jsqr"], // installed as dependencies
  target: ["es2020"],
});
// One-file builds for a <script> tag: window.Postern (core + UI) and window.PosternScanner.
await build({
  ...common,
  stdin: { contents: 'export * from "./src/index.js"; export * from "./src/ui.js";', resolveDir: sdkDir },
  format: "iife",
  globalName: "Postern",
  minify: true,
  outfile: join(sdkOut, "postern.global.js"),
  target: ["es2020"],
});
await build({
  ...common,
  entryPoints: [join(sdkDir, "src/scanner.js")],
  format: "iife",
  globalName: "PosternScanner",
  minify: true,
  outfile: join(sdkOut, "postern-scanner.global.js"),
  target: ["es2020"],
});
for (const f of ["index.d.ts", "ui.d.ts", "scanner.d.ts"]) cpSync(join(sdkDir, "src", f), join(sdkOut, f));

// Web pages
const phoneOut = join(root, "relay/public");
const PAGES = ["index.html", "privacy.html", "receive.html", "developers.html"];
const PHONE_STATIC = [
  ...PAGES, "style.css", "favicon.svg", "_headers",
  "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png",
];
// Empty the folder rather than deleting it, so a running `wrangler dev` keeps serving from it.
mkdirSync(phoneOut, { recursive: true });
for (const f of readdirSync(phoneOut)) rmSync(join(phoneOut, f), { recursive: true, force: true });
for (const f of PHONE_STATIC) cpSync(join(root, "phone", f), join(phoneOut, f));
await build({
  ...common,
  entryPoints: ["app.js", "receive.js", "developers.js"].map((f) => join(root, "phone", f)),
  outdir: phoneOut,
  splitting: true, // the camera scanner loads only when it's used
  chunkNames: "chunks/[name]-[hash]",
  target: ["safari15", "chrome100", "firefox100"],
});

// Service worker: caches every built file so the page opens offline. Its version changes
// whenever any file does, which makes phones pick up the new files.
const builtFiles = readdirSync(phoneOut, { recursive: true })
  .filter((f) => !f.startsWith("_") && /\.\w+$/.test(f) && !PAGES.includes(f))
  .sort();
const hash = createHash("sha256");
for (const f of builtFiles.concat(PAGES)) hash.update(readFileSync(join(phoneOut, f)));
// Pages are served without ".html" (Cloudflare redirects /privacy.html to /privacy).
const cacheList = [...PAGES.map((f) => (f === "index.html" ? "/" : `/${f.slice(0, -5)}`)), ...builtFiles.map((f) => `/${f}`)];
writeFileSync(
  join(phoneOut, "sw.js"),
  readFileSync(join(root, "phone/sw.js"), "utf8")
    .replace("__VERSION__", hash.digest("hex").slice(0, 12))
    .replace("__FILES__", JSON.stringify(cacheList)),
);

// The script-tag builds, for anyone who wants them from this server rather than a CDN.
mkdirSync(join(phoneOut, "sdk"), { recursive: true });
for (const f of ["postern.global.js", "postern-scanner.global.js"]) cpSync(join(sdkOut, f), join(phoneOut, "sdk", f));

// Extension: one build, then a copy per browser with its own manifest.
//   dist/          Chrome, Edge, Brave, Opera (service worker)
//   dist-firefox/  Firefox (background script, add-on ID, data-collection declaration)
//   dist-safari/   input for Apple's safari-web-extension-converter (see safari/README.md)
const extOut = join(root, "extension/dist");
rmSync(extOut, { recursive: true, force: true });
mkdirSync(extOut, { recursive: true });
cpSync(join(root, "extension/icons"), join(extOut, "icons"), { recursive: true });
cpSync(join(root, "extension/managed_schema.json"), join(extOut, "managed_schema.json"));
for (const f of ["popup.html", "popup.css", "options.html", "scan.html"]) cpSync(join(root, "extension/src", f), join(extOut, f));
await build({
  ...common,
  entryPoints: ["popup.js", "options.js", "background.js", "scan.js"].map((f) => join(root, "extension/src", f)),
  outdir: extOut,
  target: ["chrome116", "firefox128", "safari17"],
  define: { __DEFAULT_SERVER__: JSON.stringify(server), __USER_SERVER_ALLOWED__: JSON.stringify(userServerAllowed) },
});

const manifest = JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8"));
const writeManifest = (dir, m) => writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(m, null, 2)}\n`);
writeManifest(extOut, manifest);

// Firefox reads managed settings from policies.json without a schema; Safari has none.
const { minimum_chrome_version, background, storage, ...portable } = manifest;
const firefoxOut = join(root, "extension/dist-firefox");
rmSync(firefoxOut, { recursive: true, force: true });
cpSync(extOut, firefoxOut, { recursive: true });
writeManifest(firefoxOut, {
  ...portable,
  background: { scripts: [background.service_worker] },
  // Chrome's default policy. Firefox's default adds upgrade-insecure-requests, which would turn the
  // ws:// of a local test relay into wss:// (Settings only accept plain http for localhost).
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  browser_specific_settings: {
    gecko: {
      id: "postern@dahp.io",
      strict_min_version: "140.0", // first version with data_collection_permissions (also the current ESR)
      data_collection_permissions: { required: ["none"] }, // Postern collects nothing
    },
    gecko_android: { strict_min_version: "142.0" },
  },
});

const safariOut = join(root, "extension/dist-safari");
rmSync(safariOut, { recursive: true, force: true });
cpSync(extOut, safariOut, { recursive: true });
writeManifest(safariOut, { ...portable, background });

console.log(`\nBuilt with default server ${server}${userServerAllowed ? " (Settings may change it: development build)" : " (fixed; organizations can set their own by policy)"}`);
