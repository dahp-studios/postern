// Ready-made UI for websites: a dialog that shows the QR code and the confirmation code, and a
// <postern-button> that fills a field.
//
//   import { attach } from "@dahp/postern/ui";
//   attach(document.querySelector("#password"));       // adds a "From phone" button after the field
//
//   <postern-button for="password"></postern-button>    // or place the button yourself
//
//   const received = await open({ types: ["file"] });  // or drive the dialog yourself: { item, code } or null
//
// The dialog lives in a shadow root, so the site's CSS can't break it and it can't affect the site.
// Restyle it with CSS custom properties on the page: --postern-accent, --postern-radius, --postern-font.

import { DEFAULT_SERVER, drawQr, fileAsText, fill, isSafeUrl, receive } from "./index.js";
import { withoutTrailingSlash } from "../../../shared/protocol.js";

export { fill };

const STYLE = `
:host { all: initial; }
.backdrop {
  --accent: var(--postern-accent, #2457d6); --radius: var(--postern-radius, 14px);
  --bg: #ffffff; --fg: #15171a; --muted: #5b6270; --line: #d5d9e0; --soft: #f3f5f8; --on-accent: #ffffff;
  position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 16px;
  background: rgb(10 14 22 / 0.55); font: 15px/1.45 var(--postern-font, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  color: var(--fg); box-sizing: border-box;
}
@media (prefers-color-scheme: dark) {
  .backdrop { --bg: #181b21; --fg: #eceef2; --muted: #9aa2b1; --line: #2c313b; --soft: #12151a; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.dialog { width: min(100%, 360px); max-height: calc(100vh - 32px); overflow: auto; background: var(--bg); border-radius: var(--radius);
  box-shadow: 0 20px 60px rgb(0 0 0 / 0.35); padding: 20px; display: grid; gap: 14px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
section { display: grid; gap: 10px; }
h2 { margin: 0; font-size: 17px; font-weight: 650; }
p { margin: 0; }
button { font: inherit; border-radius: 9px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); padding: 9px 12px; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.close { border: 0; padding: 4px 8px; font-size: 22px; line-height: 1; color: var(--muted); background: none; }
.qr { display: block; width: 100%; max-width: 260px; height: auto; margin: 0 auto; border-radius: 10px; image-rendering: pixelated; background: #fff; }
.status { text-align: center; color: var(--muted); font-size: 14px; }
.hint { text-align: center; color: var(--muted); font-size: 13px; }
.what { font-weight: 600; overflow-wrap: anywhere; }
.preview { max-height: 120px; overflow: auto; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--soft);
  font: 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.code { font: 700 34px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.3em; text-align: center; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
.link { border: 0; background: none; color: var(--accent); padding: 4px; font-size: 13px; text-decoration: underline; justify-self: center; }
video { width: 100%; border-radius: 10px; background: #000; transform: scaleX(-1); }
footer { text-align: center; color: var(--muted); font-size: 12px; }
footer a { color: inherit; }
`;

const TEMPLATE = `
<div class="backdrop" part="backdrop">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="title" part="dialog">
    <header><h2 id="title">Send from your phone</h2><button class="close" type="button" aria-label="Close">×</button></header>
    <section class="waiting">
      <canvas class="qr" role="img" aria-label="QR code to scan with your phone"></canvas>
      <p class="status" role="status">Connecting…</p>
      <p class="hint">Scan with your phone's camera. It's encrypted on the phone and only this page can read it.</p>
      <button class="link scan" type="button" hidden>Phone offline? Scan its QR code</button>
    </section>
    <section class="scanning" hidden>
      <video muted playsinline></video>
      <p class="hint scan-status">Hold the phone's QR code up to the camera.</p>
      <button class="link stop-scan" type="button">Back</button>
    </section>
    <section class="received" hidden>
      <p class="what"></p>
      <div class="preview" hidden></div>
      <p class="hint">Does your phone show this code? Only continue if it matches.</p>
      <p class="code"></p>
      <div class="actions"><button class="primary use" type="button">Use it</button><button class="discard" type="button">Discard</button></div>
    </section>
    <section class="message" hidden>
      <p class="message-text"></p>
      <button class="primary retry" type="button">New QR code</button>
    </section>
    <footer>Postern · end-to-end encrypted · <a class="terms" target="_blank" rel="noopener">Terms</a></footer>
  </div>
</div>`;

/**
 * Style a shadow root. Constructed stylesheets work under a strict Content-Security-Policy (no
 * 'unsafe-inline' needed); older browsers get a <style> element.
 */
function applyStyle(root, css) {
  if ("adoptedStyleSheets" in Document.prototype && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } else {
    const style = document.createElement("style");
    style.textContent = css;
    root.prepend(style);
  }
}

const STATUS = {
  connecting: "Connecting…",
  waiting: "Waiting for your phone…",
  offline: "Can't reach the server.",
};

function formatSize(bytes) {
  return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

/** What to show for an item, without ever revealing a password. */
function describe(item) {
  if (item.type === "password") return { what: "Password received", preview: null };
  if (item.type === "text") return { what: "Text received", preview: item.text };
  if (item.type === "url") return { what: isSafeUrl(item.text) ? `Link to ${new URL(item.text).hostname}` : "Link received", preview: item.text };
  const text = fileAsText(item);
  return { what: `File: ${item.name} · ${formatSize(item.bytes.length)}`, preview: text === null ? null : text.slice(0, 2000) };
}

/**
 * Show the dialog and wait. Resolves with { item, code } when the user confirms, or null if they
 * close it.
 *
 * @param {object} [options]
 * @param {string} [options.server]
 * @param {string[]} [options.types]  what the phone may send
 * @param {string} [options.title]
 * @param {(video: HTMLVideoElement, onText: (text: string) => Promise<boolean>, options?: object) => Promise<() => void>} [options.scanner]
 *        pass `startScanner` from "@dahp/postern/scanner" to offer offline mode (reads the phone's QR with the webcam)
 */
export function open({ server = DEFAULT_SERVER, types, title, scanner } = {}) {
  const host = document.createElement("postern-dialog");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = TEMPLATE;
  applyStyle(root, STYLE);
  const $ = (sel) => root.querySelector(sel);
  if (title) $("#title").textContent = title;
  $(".terms").href = `${withoutTrailingSlash(server)}/terms`; // the relay's Terms of Use
  const previousFocus = document.activeElement;
  document.body.append(host);

  let session = null;
  let timer = null;
  let stopScan = null;

  return new Promise((resolve) => {
    const show = (name) => {
      for (const s of ["waiting", "scanning", "received", "message"]) $(`.${s}`).hidden = s !== name;
    };

    const close = (value) => {
      clearInterval(timer);
      stopScan?.();
      if (value === null) session?.cancel();
      host.remove();
      document.removeEventListener("keydown", onKey, true);
      previousFocus?.focus?.();
      resolve(value);
    };

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    $(".close").addEventListener("click", () => close(null));
    $(".backdrop").addEventListener("click", (event) => event.target === $(".backdrop") && close(null));

    async function start() {
      show("waiting");
      $(".status").textContent = STATUS.connecting;
      $(".scan").hidden = !scanner;
      try {
        session = await receive({ server, types, onStatus: (s) => ($(".status").textContent = STATUS[s] ?? "") });
      } catch {
        return message("Postern couldn't start here. This page needs a secure (https) connection.");
      }
      drawQr($(".qr"), session.link, 520);
      $(".qr").dataset.link = session.link; // for tests and screen readers that need the raw link
      clearInterval(timer);
      timer = setInterval(() => {
        const left = Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000));
        $(".hint").textContent = `Scan with your phone's camera. Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}.`;
      }, 1000);
      $(".close").focus();
      session.result.then(received, (err) => {
        if (err.code === "cancelled") return;
        message(err.code === "expired" ? "The QR code expired." : err.message);
      });
    }

    function message(text) {
      clearInterval(timer);
      stopScan?.();
      $(".message-text").textContent = text;
      show("message");
      $(".retry").focus();
    }

    function received({ item, code }) {
      clearInterval(timer);
      stopScan?.();
      const { what, preview } = describe(item);
      $(".what").textContent = what;
      $(".preview").textContent = preview ?? "";
      $(".preview").hidden = preview === null;
      $(".code").textContent = code;
      show("received");
      $(".use").focus();
      $(".use").onclick = () => close({ item, code });
      $(".discard").onclick = () => close(null);
    }

    $(".retry").addEventListener("click", start);
    $(".scan").addEventListener("click", async () => {
      show("scanning");
      try {
        stopScan = await scanner($("video"), async (text) => {
          try {
            await session.acceptOffline(text);
            return false;
          } catch (err) {
            $(".scan-status").textContent = err.message;
            return true; // keep scanning
          }
        }, { facingMode: "user" });
      } catch {
        $(".scan-status").textContent = "The camera couldn't start. Allow camera access and try again.";
      }
    });
    $(".stop-scan").addEventListener("click", () => {
      stopScan?.();
      stopScan = null;
      show("waiting");
    });

    start();
  });
}

/** Which item types make sense for a field: a password field takes passwords and text. */
function typesFor(field) {
  if (!field) return undefined;
  if (field.type === "password") return ["password", "text"];
  if (field.type === "url") return ["url", "text"];
  return ["text", "password", "url", "file"];
}

/** The text to put into a field for an item, or null if it has none (a binary file). */
function textOf(item) {
  return item.type === "file" ? fileAsText(item) : item.text;
}

const ICON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>`;

/**
 * <postern-button for="field-id" server="…" types="password,text" label="From phone">
 * Fires a cancelable "postern-receive" event ({ detail: { item, code } }); unless you call
 * preventDefault(), it fills the field named by `for`.
 */
export class PosternButton extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<button type="button" part="button">${ICON}<span></span></button>`;
    applyStyle(root, `
      :host { display: inline-block; vertical-align: middle; }
      button { all: unset; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; cursor: pointer;
        border: 1px solid color-mix(in srgb, currentColor 25%, transparent); font: 500 13px/1.2 var(--postern-font, system-ui, -apple-system, sans-serif);
        color: var(--postern-accent, #2457d6); background: transparent; }
      button:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
      button:focus-visible { outline: 2px solid var(--postern-accent, #2457d6); outline-offset: 2px; }
    `);
    const label = this.getAttribute("label") ?? "From phone";
    root.querySelector("span").textContent = label;
    root.querySelector("button").setAttribute("aria-label", `${label}: send it from your phone with Postern`);
    root.querySelector("button").addEventListener("click", () => this.receive());
  }

  get field() {
    const id = this.getAttribute("for");
    return id ? this.getRootNode().getElementById?.(id) ?? document.getElementById(id) : null;
  }

  async receive() {
    const field = this.field;
    const types = this.getAttribute("types")?.split(",").map((t) => t.trim()) ?? typesFor(field);
    const received = await open({ server: this.getAttribute("server") ?? undefined, types, scanner: this.scanner });
    if (!received) return;
    const event = new CustomEvent("postern-receive", { detail: received, bubbles: true, composed: true, cancelable: true });
    if (!this.dispatchEvent(event) || !field) return;
    const text = textOf(received.item);
    if (text !== null) {
      fill(field, text);
      field.focus();
    }
  }
}

if (typeof customElements !== "undefined" && !customElements.get("postern-button")) {
  customElements.define("postern-button", PosternButton);
}

/**
 * Add a "From phone" button right after a field. Returns a function that removes it.
 * Options as for <postern-button>: { server, types, label, scanner }.
 */
export function attach(field, { server, types, label, scanner } = {}) {
  if (!field.id) field.id = `postern-${Math.random().toString(36).slice(2, 10)}`;
  const button = document.createElement("postern-button");
  button.setAttribute("for", field.id);
  if (server) button.setAttribute("server", server);
  if (types) button.setAttribute("types", types.join(","));
  if (label) button.setAttribute("label", label);
  if (scanner) button.scanner = scanner;
  field.insertAdjacentElement("afterend", button);
  return () => button.remove();
}

/** Add a button to every field marked with data-postern (call once after the page loads). */
export function attachAll(root = document, options = {}) {
  return [...root.querySelectorAll("input[data-postern], textarea[data-postern]")].map((field) => attach(field, options));
}
