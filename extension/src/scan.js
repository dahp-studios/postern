// Offline mode: read the phone's sealed message from its screen with the webcam.

import { decodeOfflinePayload } from "../../shared/protocol.js";
import { cameraError, startScanner } from "../../shared/scanner.js";
import { acceptMessage, getState } from "./session.js";

const $ = (id) => document.getElementById(id);

function say(text, { error = false } = {}) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}

async function handle(text) {
  const payload = decodeOfflinePayload(text);
  if (!payload) {
    say("That isn't a Postern code. On the phone, tap No internet? Show as QR and hold that code up.", { error: true });
    return true; // keep scanning
  }
  try {
    await acceptMessage(payload.message, payload.sessionId);
  } catch (err) {
    say(err.message, { error: true });
    return false;
  }

  const state = await getState();
  if (state.phase !== "received") {
    say(state.error ?? "Something went wrong. Open Postern and try again.", { error: true });
    return false;
  }
  say("Received. Opening Postern…");
  $("video").hidden = true;
  const self = await chrome.tabs.getCurrent();
  try {
    if (state.tabId) await chrome.tabs.update(state.tabId, { active: true });
    await chrome.action.openPopup();
    await chrome.tabs.remove(self.id);
  } catch {
    say("Received. Go back to your tab and click the Postern icon (it shows 1) to use it.");
  }
  return false;
}

async function init() {
  const state = await getState();
  if (state.phase !== "waiting" || !state.key || state.expiresAt <= Date.now()) {
    say("Postern isn't waiting for anything. Open Postern on the page you want, then click Scan phone's QR.", { error: true });
    return;
  }
  try {
    await startScanner($("video"), handle, { facingMode: "user" });
    say("Hold the phone's QR code up to the camera.");
  } catch (err) {
    say(cameraError(err), { error: true });
  }
}

init();
