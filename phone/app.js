import { LIMITS, parseLinkFragment, sealItem } from "../shared/protocol.js";

const $ = (id) => document.getElementById(id);
const tabs = [...document.querySelectorAll("[data-type]")];
const panes = [...document.querySelectorAll("[data-pane]")];

const ERRORS = {
  laptop_not_waiting: "The laptop isn't waiting any more. Open Postern on the laptop again and scan the new QR code.",
  session_closed: "This QR code has already been used or has expired. Scan a new one.",
  too_large: "That's too large to send.",
};

let type = "password";

function showError(text) {
  $("error").textContent = text;
  $("error").hidden = false;
}

function formatSize(bytes) {
  return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

function selectType(next) {
  type = next;
  for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.type === next));
  for (const pane of panes) pane.hidden = pane.dataset.pane !== next;
  $("error").hidden = true;
  const focusTarget = { password: "password", text: "text", url: "url" }[next];
  if (focusTarget) $(focusTarget).focus();
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

const session = parseLinkFragment(location.hash);
// The key isn't secret, but keep it out of history and screenshots of the address bar.
history.replaceState(null, "", location.pathname);

if (!session) {
  showError("Scan the QR code shown by Postern on your laptop.");
} else {
  $("send").hidden = false;
}

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

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("error").hidden = true;
  const submit = $("submit");
  submit.disabled = true;
  submit.textContent = "Sending…";

  try {
    const { message, code } = await sealItem({ ...session, item: await readItem() });
    const res = await fetch(`/api/s/${session.sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(ERRORS[error] || "Couldn't send. Check your connection and try again.");
    }
    clearInputs();
    $("send").hidden = true;
    $("code").textContent = code;
    $("done").hidden = false;
  } catch (err) {
    showError(err.message.endsWith(".") ? err.message : `${err.message}.`);
    submit.disabled = false;
    submit.textContent = "Send";
  }
});
