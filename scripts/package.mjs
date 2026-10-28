// Zips extension/dist for the Chrome Web Store. Run through `npm run package`, which builds
// with the production server first.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "extension/dist");
const { version } = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));

// Refuse to ship a build that points at a development server.
const settings = readFileSync(join(dist, "popup.js"), "utf8");
if (!settings.includes('"https://postern.dahp.io"')) {
  console.error("extension/dist wasn't built for production. Run `npm run package`, not this script directly.");
  process.exit(1);
}

const out = join(root, "dist", `postern-extension-${version}.zip`);
mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
execFileSync("zip", ["-r", "-X", "-q", out, "."], { cwd: dist, stdio: "inherit" });
console.log(`\nPackaged ${out}`);
