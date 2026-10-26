import qrcode from "qrcode-generator";
import { buildLink, createReceiver, SESSION_TTL_MS } from "../../shared/protocol.js";
import { getServer } from "./settings.js";
import { fillFocused, hasFillableFocus, runInFrames } from "./fill.js";

const $ = (id) => document.getElementById(id);

let password = null; // held only until filled or discarded
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
  password = null;
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

async function start() {
  cleanup();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  let canFill = false;
  try {
    canFill = await runInFrames(tab.id, hasFillableFocus, []);
  } catch {
    // chrome:// pages, the Web Store, etc. don't allow scripts
  }
  if (!canFill) {
    showMessage("Click into the password field on the page first, then open this again.");
    return;
  }

  const server = await getServer();
  const receiver = await createReceiver();
  const link = buildLink(server, receiver);
  renderQr(link);
  $("qr").dataset.link = link; // read by the browser test
  $("status").textContent = "Connecting…";
  show("waiting");

  const wsUrl = `${server.replace(/^http/, "ws")}/api/s/${receiver.sessionId}`;
  const ws = new WebSocket(wsUrl);
  socket = ws;
  let received = false;

  ws.addEventListener("open", () => {
    $("status").textContent = "Waiting for phone…";
    startCountdown(() => {
      cleanup();
      showMessage("The QR code expired.", { retry: true });
    });
  });

  ws.addEventListener("message", async (event) => {
    received = true;
    clearInterval(timer);
    try {
      const result = await receiver.open(JSON.parse(event.data));
      password = result.password;
      $("code").textContent = result.code;
      show("received");
      $("fill").focus();
    } catch {
      showMessage("Received data couldn't be decrypted, so it was discarded.", { retry: true });
    }
  });

  ws.addEventListener("close", () => {
    if (socket !== ws || received) return;
    cleanup();
    showMessage(`Lost connection to ${server}.`, { retry: true });
  });

  $("fill").onclick = async () => {
    const ok = await runInFrames(tab.id, fillFocused, [password]).catch(() => false);
    cleanup();
    if (ok) {
      window.close();
    } else {
      showMessage("The password field lost focus. Click into it and try again.", { retry: true });
    }
  };
}

$("cancel").addEventListener("click", () => {
  cleanup();
  showMessage("Discarded.", { retry: true });
});
$("retry").addEventListener("click", start);
window.addEventListener("pagehide", cleanup);

start();
