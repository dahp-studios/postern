// These functions are injected into the page with chrome.scripting.executeScript,
// so they must be self-contained (no imports or outer variables).

const FILLABLE_TYPES = ["password", "text", "email", "tel", "url", "search", ""];

/** Runs in each frame. True if this frame's focused element can take a password. */
export function hasFillableFocus(types) {
  const el = document.activeElement;
  if (!el || el.disabled || el.readOnly) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && types.includes(el.getAttribute("type")?.toLowerCase() ?? "");
}

/** Runs in each frame. Fills the focused field, firing the events frameworks like React listen for. */
export function fillFocused(value, types) {
  const el = document.activeElement;
  if (!el || el.disabled || el.readOnly) return false;
  const isTextArea = el instanceof HTMLTextAreaElement;
  if (!isTextArea && !(el instanceof HTMLInputElement && types.includes(el.getAttribute("type")?.toLowerCase() ?? ""))) {
    return false;
  }
  const proto = isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.focus();
  return true;
}

export async function runInFrames(tabId, func, args) {
  const inject = (target) => chrome.scripting.executeScript({ target, func, args: [...args, FILLABLE_TYPES] });
  let results;
  try {
    results = await inject({ tabId, allFrames: true });
  } catch {
    // activeTab may not cover cross-origin iframes; fall back to the top frame.
    results = await inject({ tabId });
  }
  return results.some((r) => r.result === true);
}
