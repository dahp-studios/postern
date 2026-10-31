// postern.dahp.io/receive: the receiving side in any browser, no extension. Shows the item with
// Copy, Open and Save instead of filling a field.

import { drawQr, fileAsText, isSafeUrl, receive } from "../packages/postern/src/index.js";

const $ = (id) => document.getElementById(id);
const STATUS = { connecting: "Connecting…", waiting: "Waiting for your phone…", offline: "Can't reach the server." };

let session = null;
let timer = null;
let stopScan = null;

function show(id) {
  for (const s of ["waiting", "scanning", "received", "message"]) $(s).hidden = s !== id;
}

function message(text) {
  clearInterval(timer);
  stopScan?.();
  $("message-text").textContent = text;
  show("message");
}

function formatSize(bytes) {
  return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

function button(label, handler, primary = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (primary) b.className = "primary";
  b.addEventListener("click", () => handler(b));
  return b;
}

const copy = (text) => async (b) => {
  try {
    await navigator.clipboard.writeText(text);
    b.textContent = "Copied";
  } catch {
    b.textContent = "Copy failed";
  }
};

function save(item) {
  const url = URL.createObjectURL(new Blob([item.bytes], { type: item.mime }));
  Object.assign(document.createElement("a"), { href: url, download: item.name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function received({ item, code }) {
  clearInterval(timer);
  stopScan?.();
  const actions = [];
  let what;
  let preview = null;
  let note = null;

  if (item.type === "password") {
    what = "Password received";
    actions.push(button("Show", (b) => {
      const hidden = $("preview").hidden;
      $("preview").textContent = hidden ? item.text : "";
      $("preview").hidden = !hidden;
      b.textContent = hidden ? "Hide" : "Show";
    }));
    actions.push(button("Copy", copy(item.text), true));
    note = "A copied password stays on the clipboard until you copy something else. The Postern extension fills fields without the clipboard.";
  } else if (item.type === "text") {
    what = "Text received";
    preview = item.text;
    actions.push(button("Copy", copy(item.text), true));
  } else if (item.type === "url" && isSafeUrl(item.text)) {
    what = `Link to ${new URL(item.text).hostname}`;
    preview = item.text;
    const open = document.createElement("a");
    Object.assign(open, { href: item.text, target: "_blank", rel: "noopener noreferrer", className: "button primary", textContent: "Open link" });
    actions.push(open);
    actions.push(button("Copy", copy(item.text)));
  } else if (item.type === "file") {
    what = `File: ${item.name} · ${formatSize(item.bytes.length)}`;
    const text = fileAsText(item);
    if (text !== null) {
      preview = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
      actions.push(button("Copy text", copy(text)));
    }
    actions.unshift(button("Save file", (b) => {
      save(item);
      b.textContent = "Saved to Downloads";
    }, true));
  }
  actions.push(button("Done", () => start()));

  $("what").textContent = what;
  $("preview").textContent = preview ?? "";
  $("preview").hidden = preview === null;
  $("code").textContent = code;
  $("note").textContent = note ?? "";
  $("note").hidden = note === null;
  $("actions").replaceChildren(...actions);
  show("received");
}

async function start() {
  clearInterval(timer);
  session?.cancel();
  show("waiting");
  $("status").textContent = STATUS.connecting;
  session = await receive({ server: location.origin, onStatus: (s) => ($("status").textContent = STATUS[s] ?? "") });
  drawQr($("qr"), session.link);
  $("qr").dataset.link = session.link; // read by the browser test
  const tick = () => {
    const left = Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000));
    $("timer").textContent = `(${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")})`;
  };
  tick();
  timer = setInterval(tick, 1000);
  const current = session;
  current.result.then(received, (err) => {
    if (session !== current || err.code === "cancelled") return;
    message(err.code === "expired" ? "The QR code expired." : err.message);
  });
}

$("again").addEventListener("click", start);

$("scan").addEventListener("click", async () => {
  show("scanning");
  const { startScanner, cameraError } = await import("../shared/scanner.js");
  try {
    stopScan = await startScanner($("video"), async (text) => {
      try {
        await session.acceptOffline(text);
        return false;
      } catch (err) {
        $("scan-status").textContent = err.message;
        return true;
      }
    }, { facingMode: "user" });
  } catch (err) {
    $("scan-status").textContent = cameraError(err);
  }
});
$("stop-scan").addEventListener("click", () => {
  stopScan?.();
  stopScan = null;
  show("waiting");
});

window.addEventListener("pagehide", () => session?.cancel());
start();
