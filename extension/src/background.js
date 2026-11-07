// Background worker: holds the connection to the relay while waiting for the phone, so the
// popup can close (it does whenever you click elsewhere) without losing the session.
// Also adds "Postern: receive from phone" to the right-click menu.

import { buildLink, createReceiver, SESSION_TTL_MS } from "../../shared/protocol.js";
import { getServer } from "./settings.js";
import { acceptMessage, clearState, EXPIRE_ALARM, getState, OFFLINE_TTL_MS, setState, updateWaiting } from "./session.js";

const MENU_ID = "receive-password";
const PING_MS = 20_000; // Chrome keeps the worker alive while WebSocket messages flow
const RECONNECT_MS = 2_000;

let socket = null;
let pingTimer = null;

// Firefox for Android has no context menus; the toolbar button still works there.
if (chrome.contextMenus) {
  chrome.runtime.onInstalled.addListener(async () => {
    await chrome.contextMenus.removeAll(); // an update keeps the old entry
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Postern: receive from phone",
      contexts: ["editable", "page"], // on a field to fill it, anywhere for links and files
    });
  });
}

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab) return;
  try {
    await chrome.action.openPopup({ windowId: tab.windowId });
  } catch {
    // openPopup isn't available everywhere (older Chrome); use a small window instead.
    await chrome.windows.create({
      url: `popup.html?tab=${tab.id}`,
      type: "popup",
      width: 340,
      height: 520,
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message).then(
    () => sendResponse({ ok: true }),
    (err) => sendResponse({ error: err.message }),
  );
  return true; // respond asynchronously
});

async function handle({ cmd, tabId, canFill }) {
  if (cmd === "open") {
    const state = await getState();
    const live = state.expiresAt > Date.now();
    if (state.phase === "waiting" && live && state.key) {
      await setState({ ...state, tabId, canFill });
      if (!socket && state.connection !== "offline") connect(state);
      return;
    }
    if (state.phase === "received" && live) {
      await setState({ ...state, tabId }); // fill into the tab the popup was opened on now
      return;
    }
    return start(tabId, canFill);
  }
  if (cmd === "new") return start(tabId, canFill);
  if (cmd === "clear") {
    closeSocket();
    return clearState();
  }
  throw new Error(`Unknown command ${cmd}`);
}

async function start(tabId, canFill) {
  closeSocket();
  const server = await getServer();
  const receiver = await createReceiver();
  const state = {
    phase: "waiting",
    link: buildLink(server, receiver),
    server,
    key: await receiver.save(),
    tabId,
    canFill,
    connection: "connecting",
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  await setState(state);
  connect(state);
}

const CANCELLED = 4001; // tells the relay to end the session rather than wait for a reconnect

function closeSocket() {
  clearInterval(pingTimer);
  const ws = socket;
  socket = null;
  ws?.close(CANCELLED, "cancelled");
}

function connect(state) {
  const { sessionId } = state.key;
  const ws = new WebSocket(`${state.server.replace(/^http/, "ws")}/api/s/${sessionId}`);
  socket = ws;
  let opened = false;
  let delivered = false;

  ws.addEventListener("open", () => {
    opened = true;
    ws.send("ping"); // also tells the relay to send anything that arrived while reconnecting
    pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), PING_MS);
    updateWaiting(sessionId, { connection: "online" });
  });

  ws.addEventListener("message", async (event) => {
    if (event.data === "pong") return;
    delivered = true;
    closeSocket();
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      message = null;
    }
    await acceptMessage(message, sessionId);
    chrome.action.openPopup().catch(() => {
      // No focused browser window; the badge shows something arrived.
    });
  });

  ws.addEventListener("close", async (event) => {
    if (socket !== ws || delivered) return;
    socket = null;
    clearInterval(pingTimer);
    const current = await getState();
    if (current.phase !== "waiting" || current.key?.sessionId !== sessionId) return;

    if (!opened) {
      // Can't reach the server. The phone can still send by showing its message as a QR code.
      await updateWaiting(sessionId, { connection: "offline", expiresAt: Math.max(current.expiresAt, Date.now() + OFFLINE_TTL_MS) });
    } else if (event.code === 4000 || current.expiresAt <= Date.now()) {
      await expire();
    } else {
      // Dropped (laptop slept, network blip). The relay keeps the session, so connect again.
      await updateWaiting(sessionId, { connection: "connecting" });
      setTimeout(async () => {
        const latest = await getState();
        if (!socket && latest.phase === "waiting" && latest.key?.sessionId === sessionId) connect(latest);
      }, RECONNECT_MS);
    }
  });
}

async function expire() {
  closeSocket();
  const state = await getState();
  if (state.phase === "waiting") await setState({ phase: "expired" });
  else if (state.phase === "received") await clearState(); // discard what arrived
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== EXPIRE_ALARM) return;
  const state = await getState();
  if (state.expiresAt && state.expiresAt <= Date.now() + 1000) await expire();
});
