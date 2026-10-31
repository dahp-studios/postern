// Store packages, made by `npm run package` after a production build:
//   dist/postern-chrome-<version>.zip    Chrome Web Store, Microsoft Edge Add-ons, Opera
//   dist/postern-firefox-<version>.zip   addons.mozilla.org
//   dist/postern-source-<version>.zip    the source code Mozilla asks for with bundled add-ons
// Safari is built and uploaded from Xcode (safari/README.md).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8"));

// Refuse to ship a build that points at a development server.
for (const dir of ["dist", "dist-firefox"]) {
  if (!readFileSync(join(root, "extension", dir, "popup.js"), "utf8").includes('"https://postern.dahp.io"')) {
    console.error(`extension/${dir} wasn't built for production. Run \`npm run package\`, not this script directly.`);
    process.exit(1);
  }
}

const out = join(root, "dist");
mkdirSync(out, { recursive: true });
const zip = (name, cwd) => {
  const file = join(out, name);
  rmSync(file, { force: true });
  execFileSync("zip", ["-r", "-X", "-q", file, "."], { cwd, stdio: "inherit" });
  console.log(`Packaged dist/${name}`);
};
zip(`postern-chrome-${version}.zip`, join(root, "extension/dist"));
zip(`postern-firefox-${version}.zip`, join(root, "extension/dist-firefox"));

// Source for Mozilla's reviewers: the committed tree, which rebuilds with `npm ci && npm run build:release`.
const source = join(out, `postern-source-${version}.zip`);
rmSync(source, { force: true });
execFileSync("git", ["archive", "--format=zip", `--output=${source}`, "HEAD"], { cwd: root, stdio: "inherit" });
console.log(`Packaged dist/postern-source-${version}.zip (from the last commit)`);
