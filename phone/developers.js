// Live demo on the developer page: the published package's UI against this server.

import { attachAll } from "../packages/postern/src/ui.js";
import { startScanner } from "../packages/postern/src/scanner.js";

attachAll(document, { server: location.origin, scanner: startScanner });

document.getElementById("demo-form").addEventListener("postern-receive", (event) => {
  const { item, code } = event.detail;
  const what = item.type === "file" ? `a file (${item.name})` : `a ${item.type === "url" ? "link" : item.type}`;
  document.getElementById("demo-log").textContent = `Received ${what}, confirmation code ${code}. It never touched the server unencrypted.`;
});

// Copy buttons on the code samples.
for (const block of document.querySelectorAll(".code-block")) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy";
  button.textContent = "Copy";
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(block.querySelector("code").textContent);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select and copy";
    }
    setTimeout(() => (button.textContent = "Copy"), 1500);
  });
  block.append(button);
}
