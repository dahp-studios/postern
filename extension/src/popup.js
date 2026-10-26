import qrcode from "qrcode-generator";
import { buildLink, createReceiver, fileAsText, isSafeUrl, SESSION_TTL_MS } from "../../shared/protocol.js";
import { getServer } from "./settings.js";
import { fillFocused, hasFillableFocus, runInFrames } from "./fill.js";

const $ = (id) => document.getElementById(id);

let received = null; // the decrypted item, held only until used or discarded
let socket = null;
let timer = null;

function show(sectionId) {
  for (const id of ["waiting", "received", "message"]) $(id).hidden = id !== sectionId;
}

function showMessage(text, { retry = false } = {}) {
  $("message-text").textContent = text;
  $("retry").hidden = !retry;
  show("message");
}

function cleanup() {
  clearInterval(timer);
  socket?.close();
  socket = null;
  received = null;
}

function renderQr(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  $("qr").src = qr.createDataURL(8, 2);
}

function startCountdown(onExpire) {
  const deadline = Date.now() + SESSION_TTL_MS;
  const tick = () => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    $("timer").textContent = `(${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")})`;
    if (left === 0) onExpire();
  };
  tick();
  timer = setInterval(tick, 1000);
}

function formatSize(bytes) {
  return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

async function getTargetTab() {
  // Opened as a window from the right-click menu, the target tab comes in the URL.
  const tabParam = new URLSearchParams(location.search).get("tab");
  if (tabParam) return chrome.tabs.get(Number(tabParam));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Build the action buttons for what arrived. Everything from the phone is shown with textContent only. */
function renderReceived(item, code, { tab, canFill }) {
  const actions = [];
  const done = () => {
    cleanup();
    window.close();
  };

  const fill = (value) => async () => {
    const ok = await runInFrames(tab.id, fillFocused, [value]).catch(() => false);
    if (ok) return done();
    cleanup();
    showMessage("The field lost focus. Click into it, open Postern, and send again.", { retry: true });
  };

  const copy = (value) => async (button) => {
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = "Copied";
      setTimeout(done, 700);
    } catch {
      button.textContent = "Copy failed";
    }
  };

  let title;
  let preview = null;

  if (item.type === "password") {
    title = "Password received";
    if (canFill) actions.push(["Fill password", fill(item.text), true]);
    else preview = "No field was selected. Click into the password field, open Postern, and send again.";
  } else if (item.type === "text") {
    title = "Text received";
    preview = item.text;
    if (canFill) actions.push(["Fill field", fill(item.text), true]);
    actions.push(["Copy", copy(item.text), !canFill]);
  } else if (item.type === "url" && isSafeUrl(item.text)) {
    title = `Link to ${new URL(item.text).hostname}`;
    preview = item.text;
    actions.push(["Open in new tab", async () => {
      await chrome.tabs.create({ url: item.text, openerTabId: tab?.id });
      done();
    }, true]);
    if (canFill) actions.push(["Fill field", fill(item.text), false]);
    actions.push(["Copy", copy(item.text), false]);
  } else if (item.type === "file") {
    title = `File: ${item.name} · ${formatSize(item.bytes.length)}`;
    const text = fileAsText(item);
    if (text !== null) preview = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
    actions.push(["Save file", (button) => {
      const url = URL.createObjectURL(new Blob([item.bytes], { type: item.mime }));
      const a = Object.assign(document.createElement("a"), { href: url, download: item.name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      button.textContent = "Saved to Downloads";
      button.disabled = true;
    }, true]);
    if (text !== null && canFill) actions.push(["Fill field", fill(text), false]);
  } else {
    title = "Received something Postern can't use";
  }

  $("received-title").textContent = title;
  $("preview").textContent = preview ?? "";
  $("preview").hidden = preview === null;
  $("code").textContent = code;

  const container = $("actions");
  container.replaceChildren();
  for (const [label, handler, primary] of actions) {
    const button = document.createElement("button");
    button.textContent = label;
    button.dataset.action = label;
    if (primary) button.className = "primary";
    button.addEventListener("click", () => handler(button));
    container.append(button);
  }
  const discard = document.createElement("button");
  discard.textContent = "Discard";
  discard.dataset.action = "Discard";
  discard.addEventListener("click", () => {
    cleanup();
    showMessage("Discarded.", { retry: true });
  });
  container.append(discard);

  show("received");
  container.querySelector("button")?.focus();
}

async function start() {
  cleanup();
  const tab = await getTargetTab();

  let canFill = false;
  try {
    canFill = await runInFrames(tab.id, hasFillableFocus, []);
  } catch {
    // chrome:// pages, the Web Store, etc. don't allow scripts; links and files still work
  }

  const server = await getServer();
  const receiver = await createReceiver();
  const link = buildLink(server, receiver);
  renderQr(link);
  $("qr").dataset.link = link; // read by the browser test
  $("no-field").hidden = canFill;
  $("status").textContent = "Connecting…";
  show("waiting");

  const ws = new WebSocket(`${server.replace(/^http/, "ws")}/api/s/${receiver.sessionId}`);
  socket = ws;
  let gotMessage = false;

  ws.addEventListener("open", () => {
    $("status").textContent = "Waiting for phone…";
    startCountdown(() => {
      cleanup();
      showMessage("The QR code expired.", { retry: true });
    });
  });

  ws.addEventListener("message", async (event) => {
    gotMessage = true;
    clearInterval(timer);
    try {
      const { item, code } = await receiver.open(JSON.parse(event.data));
      received = item;
      renderReceived(item, code, { tab, canFill });
    } catch {
      showMessage("Received data couldn't be decrypted, so it was discarded.", { retry: true });
    }
  });

  ws.addEventListener("close", () => {
    if (socket !== ws || gotMessage) return;
    cleanup();
    showMessage(`Lost connection to ${server}.`, { retry: true });
  });
}

$("retry").addEventListener("click", start);
window.addEventListener("pagehide", cleanup);

start();
