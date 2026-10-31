import { encodeOfflinePayload, LIMITS, parseLinkFragment, sealItem } from "../shared/protocol.js";
import { drawQr } from "../shared/qr.js";

const $ = (id) => document.getElementById(id);
const tabs = [...document.querySelectorAll("[data-type]")];
const panes = [...document.querySelectorAll("[data-pane]")];

const ERRORS = {
  laptop_not_waiting: "The laptop isn't connected.",
  session_closed: "This QR code has already been used or has expired. Scan a new one.",
  too_large: "That's too large to send.",
  rate_limited: "Too many tries. Wait a minute and try again.",
};
// When these happen the laptop may still be waiting offline, so offer the QR fallback.
const OFFER_QR = new Set(["laptop_not_waiting", "network"]);

let type = "password";
let session = null;
let stopScanner = null;

function showOnly(id) {
  for (const s of ["start", "scanner", "send", "done", "offline"]) $(s).hidden = s !== id;
  $("error").hidden = true;
}

function showError(text, { offerQr = false } = {}) {
  $("error").textContent = text;
  $("error").hidden = false;
  $("error-qr").hidden = !offerQr;
}

function formatSize(bytes) {
  return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

function selectType(next, { focus = true } = {}) {
  type = next;
  for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.type === next));
  for (const pane of panes) pane.hidden = pane.dataset.pane !== next;
  $("error").hidden = true;
  const focusTarget = { password: "password", text: "text", url: "url" }[next];
  if (focusTarget && focus) $(focusTarget).focus();
}

async function readItem() {
  if (type !== "file") {
    return { type, text: $({ password: "password", text: "text", url: "url" }[type]).value };
  }
  const file = $("file").files[0];
  if (!file) throw new Error("Choose a file first.");
  if (file.size > LIMITS.fileBytes) throw new Error("The file is larger than 256 KB");
  return { type, name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
}

function clearInputs() {
  for (const id of ["password", "text", "url", "file"]) $(id).value = "";
}

function sentence(message) {
  return message.endsWith(".") ? message : `${message}.`;
}

function useSession(next) {
  session = next;
  // Offer only what the receiver accepts (a password field may take just passwords and text).
  for (const tab of tabs) tab.hidden = !next.types.includes(tab.dataset.type);
  document.querySelector(".types").hidden = next.types.length === 1;
  selectType(next.types.includes(type) ? type : next.types[0], { focus: false });
  showOnly("send");
}

// The sealed message from the last attempt, so the QR fallback shows the same one (and the same code).
let lastSealed = null;

async function seal() {
  lastSealed = await sealItem({ ...session, item: await readItem() });
  return lastSealed;
}

function showOffline({ message, code }) {
  let text;
  try {
    text = encodeOfflinePayload(session.sessionId, message);
  } catch {
    showError("That's too large for a QR code (about 600 characters at most). Connect to the internet to send it.");
    return;
  }
  clearInputs();
  drawQr($("offline-qr"), text);
  $("offline-code").textContent = code;
  showOnly("offline");
}

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("error").hidden = true;
  const submit = $("submit");
  submit.disabled = true;
  submit.textContent = "Sending…";

  let failure = null;
  try {
    const { message, code } = await seal();
    let res;
    try {
      res = await fetch(`/api/s/${session.sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch {
      failure = "network";
      throw new Error("Couldn't reach the server");
    }
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      failure = error;
      throw new Error(ERRORS[error] || "Couldn't send. Check your connection and try again.");
    }
    clearInputs();
    $("code").textContent = code;
    // 202: the laptop is reconnecting; the relay holds the message until it's back.
    $("done-queued").hidden = res.status !== 202;
    showOnly("done");
  } catch (err) {
    showError(sentence(err.message), { offerQr: OFFER_QR.has(failure) });
  } finally {
    submit.disabled = false;
    submit.textContent = "Send";
  }
});

// "No internet? Show as QR": seal without sending and show it for the laptop's webcam.
$("show-qr").addEventListener("click", async () => {
  try {
    showOffline(await seal());
  } catch (err) {
    showError(sentence(err.message));
  }
});
$("error-qr").addEventListener("click", () => lastSealed && showOffline(lastSealed));
$("offline-back").addEventListener("click", () => showOnly("send"));

for (const tab of tabs) tab.addEventListener("click", () => selectType(tab.dataset.type));

$("toggle").addEventListener("click", () => {
  const input = $("password");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  $("toggle").textContent = show ? "Hide" : "Show";
  $("toggle").setAttribute("aria-label", show ? "Hide password" : "Show password");
});

$("file").addEventListener("change", () => {
  const file = $("file").files[0];
  $("file-info").textContent = file
    ? `${file.name} · ${formatSize(file.size)}${file.size > LIMITS.fileBytes ? " (too large, max 256 KB)" : ""}`
    : "JSON, text, or any file up to 256 KB.";
});

// Opened from the home screen (no QR link): scan the laptop's QR code here instead.
$("scan-start").addEventListener("click", async () => {
  showOnly("scanner");
  try {
    const { startScanner } = await import("../shared/scanner.js");
    stopScanner = await startScanner($("video"), async (text) => {
      let url;
      try {
        url = new URL(text);
      } catch {
        url = null;
      }
      const next = url && url.origin === location.origin ? parseLinkFragment(url.hash) : null;
      if (!next) {
        $("scanner-status").textContent = url
          ? `That QR code is for ${url.host}, not this Postern server.`
          : "That isn't a Postern QR code.";
        return true;
      }
      useSession(next);
      return false;
    });
  } catch (err) {
    const { cameraError } = await import("../shared/scanner.js");
    showOnly("start");
    showError(cameraError(err));
  }
});
$("scanner-cancel").addEventListener("click", () => {
  stopScanner?.();
  showOnly("start");
});

function readLink() {
  const fromLink = parseLinkFragment(location.hash);
  // The key isn't secret, but keep it out of history and screenshots of the address bar.
  if (location.hash) history.replaceState(null, "", location.pathname);
  if (fromLink) useSession(fromLink);
  else if (!session) showOnly("start");
}
readLink();
window.addEventListener("hashchange", readLink); // a new QR link opened in the same tab

// Lets the page open without internet (offline mode) and be added to the home screen.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
