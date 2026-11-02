// The popup only shows the session; the background worker holds it. Closing the popup
// (Chrome does that whenever you click elsewhere) loses nothing.

import { fileAsText, isSafeUrl } from "../../shared/protocol.js";
import { drawQr } from "../../shared/qr.js";
import { getState, onStateChange, unpackItem } from "./session.js";
import { getServerInfo } from "./settings.js";
import { fillFocused, hasFillableFocus, runInFrames } from "./fill.js";

const $ = (id) => document.getElementById(id);

let tab = null;
let canFill = false;
let shownLink = null;
let shownReceived = null;
let timer = null;

const send = (cmd) => chrome.runtime.sendMessage({ cmd, tabId: tab?.id, canFill });

function show(sectionId) {
  for (const id of ["waiting", "received", "message"]) $(id).hidden = id !== sectionId;
}

function showMessage(text, { retry = true } = {}) {
  $("message-text").textContent = text;
  $("retry").hidden = !retry;
  show("message");
}

function countdown(expiresAt, render) {
  clearInterval(timer);
  const tick = () => {
    const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    render(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`);
  };
  tick();
  timer = setInterval(tick, 1000);
}

function hostOf(url) {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

function formatSize(bytes) {
  return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

async function getTargetTab() {
  // Opened as a window from the right-click menu, the target tab comes in the URL.
  const tabParam = new URLSearchParams(location.search).get("tab");
  if (tabParam) return chrome.tabs.get(Number(tabParam));
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active;
}

async function finish() {
  await send("clear");
  window.close();
}

/** Build the action buttons for what arrived. Everything from the phone is shown with textContent only. */
function renderReceived(item, code) {
  const actions = [];
  const keepHint = "Click into the field, then open Postern again. It's kept until the timer runs out.";

  const fill = (value) => async () => {
    const ok = await runInFrames(tab.id, fillFocused, [value]).catch(() => false);
    if (ok) return finish();
    $("preview").textContent = `The field lost focus. ${keepHint}`;
    $("preview").hidden = false;
  };

  const copy = (value) => async (button) => {
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = "Copied";
      setTimeout(finish, 700);
    } catch {
      button.textContent = "Copy failed";
    }
  };

  let title;
  let preview = null;

  if (item.type === "password") {
    title = "Password received";
    if (canFill) actions.push(["Fill password", fill(item.text), true]);
    else preview = `No field is selected. ${keepHint}`;
  } else if (item.type === "text") {
    title = "Text received";
    preview = item.text;
    if (canFill) actions.push(["Fill field", fill(item.text), true]);
    actions.push(["Copy", copy(item.text), !canFill]);
  } else if (item.type === "url" && isSafeUrl(item.text)) {
    title = `Link to ${new URL(item.text).hostname}`;
    preview = item.text;
    actions.push(["Open in new tab", async () => {
      // Clear first: switching to the new tab closes this popup.
      await send("clear");
      await chrome.tabs.create({ url: item.text, openerTabId: tab?.id });
      window.close();
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

  // Say where a fill goes, so a password never lands on a site the user didn't expect.
  const fillsHere = actions.some(([label]) => label.startsWith("Fill"));
  const host = fillsHere ? hostOf(tab?.url) : null;
  $("target").textContent = host ? `Fill puts it into the selected field on ${host}.` : "";
  $("target").hidden = !host;

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
  discard.addEventListener("click", async () => {
    await send("clear");
    showMessage("Discarded.");
  });
  container.append(discard);

  show("received");
  container.querySelector("button")?.focus();
}

const STATUS = {
  connecting: "Connecting…",
  online: "Waiting for phone…",
  offline: "Can't reach the server.",
};

function render(state) {
  if (state.phase === "waiting") {
    shownReceived = null;
    if (state.link !== shownLink) {
      drawQr($("qr"), state.link, 480);
      $("qr").dataset.link = state.link; // read by the browser test
      shownLink = state.link;
    }
    $("status").textContent = STATUS[state.connection] ?? "";
    $("offline-hint").hidden = state.connection !== "offline";
    $("no-field").hidden = canFill;
    countdown(state.expiresAt, (t) => ($("timer").textContent = `(${t})`));
    show("waiting");
  } else if (state.phase === "received") {
    countdown(state.expiresAt, (t) => ($("received-timer").textContent = `Discarded automatically in ${t}.`));
    const id = `${state.code}:${state.expiresAt}`;
    if (shownReceived === id) return; // keep button states such as "Saved to Downloads"
    shownReceived = id;
    renderReceived(unpackItem(state.item), state.code);
  } else {
    clearInterval(timer);
    shownLink = shownReceived = null;
    if (state.phase === "expired") showMessage("The QR code expired.");
    else if (state.phase === "error") showMessage(state.error);
    else if (!$("message").hidden) return; // already showing "Discarded." or similar
    else showMessage("Nothing waiting.");
  }
}

async function init() {
  tab = await getTargetTab();
  try {
    canFill = await runInFrames(tab.id, hasFillableFocus, []);
  } catch {
    // chrome:// pages, the Web Store, etc. don't allow scripts; links and files still work
  }
  const { server, source } = await getServerInfo();
  if (source !== "default") {
    $("server").textContent = `Server: ${new URL(server).host} (development build)`;
    $("server").hidden = false;
  }
  onStateChange(render);
  const reply = await send("open");
  if (reply?.error) return showMessage(reply.error);
  render(await getState());
}

$("retry").addEventListener("click", () => send("new"));
$("cancel").addEventListener("click", finish);
$("scan").addEventListener("click", async () => {
  await chrome.tabs.create({ url: "scan.html" });
  window.close();
});

init();
