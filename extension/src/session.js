// The current session, shared by the background worker, the popup and the scan page.
//
// It lives in chrome.storage.session: kept in memory only (never written to disk), cleared when
// the browser closes, and readable only by the extension's own pages. That's what lets the popup
// close and reopen without losing the QR code or what arrived.
//
//   { phase: "idle" }
//   { phase: "waiting", link, server, key, tabId, canFill, connection: "connecting"|"online"|"offline", expiresAt }
//   { phase: "received", item, code, tabId, expiresAt }
//   { phase: "expired" } | { phase: "error", error }

import { createReceiver, fromBase64Url, toBase64Url } from "../../shared/protocol.js";

const KEY = "session";
export const EXPIRE_ALARM = "postern-expire";
export const OFFLINE_TTL_MS = 5 * 60 * 1000; // scanning the phone's QR takes longer
export const RECEIVED_TTL_MS = 3 * 60 * 1000; // what arrived is discarded after this

export async function getState() {
  return (await chrome.storage.session.get(KEY))[KEY] ?? { phase: "idle" };
}

export async function setState(state) {
  await chrome.storage.session.set({ [KEY]: state });
  if (state.expiresAt) await chrome.alarms.create(EXPIRE_ALARM, { when: state.expiresAt });
  else await chrome.alarms.clear(EXPIRE_ALARM);
  await chrome.action.setBadgeText({ text: state.phase === "received" ? "1" : "" });
}

/** Change a waiting session, unless it has been replaced in the meantime. */
export async function updateWaiting(sessionId, changes) {
  const state = await getState();
  if (state.phase !== "waiting" || state.key?.sessionId !== sessionId) return false;
  await setState({ ...state, ...changes });
  return true;
}

export function onStateChange(callback) {
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes[KEY]) callback(changes[KEY].newValue ?? { phase: "idle" });
  });
}

function packItem(item) {
  return item.type === "file" ? { ...item, bytes: toBase64Url(item.bytes) } : item;
}

export function unpackItem(item) {
  return item.type === "file" ? { ...item, bytes: fromBase64Url(item.bytes) } : item;
}

/**
 * Decrypt a message for the waiting session (from the relay or the phone's offline QR).
 * The key is deleted first, so a session can only ever accept one message.
 */
export async function acceptMessage(message, sessionId) {
  const state = await getState();
  if (state.phase !== "waiting" || !state.key) throw new Error("Postern isn't waiting for anything. Open it and scan again.");
  if (sessionId && sessionId !== state.key.sessionId) throw new Error("That code is for a different QR code. Send again from the phone.");
  await setState({ ...state, key: null });

  try {
    const receiver = await createReceiver(state.key);
    const { item, code } = await receiver.open(message);
    await chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
    await setState({ phase: "received", item: packItem(item), code, tabId: state.tabId, expiresAt: Date.now() + RECEIVED_TTL_MS });
  } catch {
    await setState({ phase: "error", error: "Received data couldn't be decrypted, so it was discarded." });
  }
}

export async function clearState() {
  await setState({ phase: "idle" });
}
