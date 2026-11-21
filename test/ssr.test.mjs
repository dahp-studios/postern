// Server-side rendering frameworks import the package in Node, where there's no DOM.
// Every entry point must import without throwing; the browser-only parts run only in a browser.
import { test } from "node:test";
import assert from "node:assert/strict";

for (const entry of ["../packages/postern/dist/index.js", "../packages/postern/dist/ui.js", "../packages/postern/dist/scanner.js"]) {
  test(`${entry.split("/").pop()} imports without a DOM`, async () => {
    assert.equal(typeof globalThis.HTMLElement, "undefined");
    const module = await import(entry);
    assert.ok(Object.keys(module).length > 0);
  });
}

test("ui exports stay usable after a DOM-less import", async () => {
  const ui = await import("../packages/postern/dist/ui.js");
  for (const name of ["open", "attach", "attachAll", "fill", "PosternButton"]) assert.equal(typeof ui[name], "function", name);
});
