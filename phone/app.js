import { parseLinkFragment, sealPassword } from "../shared/protocol.js";

const $ = (id) => document.getElementById(id);

const ERRORS = {
  laptop_not_waiting: "The laptop isn't waiting any more. Open the extension again and scan the new QR code.",
  session_closed: "This QR code has already been used or has expired. Scan a new one.",
  too_large: "That password is too long.",
};

function showError(text) {
  $("error").textContent = text;
  $("error").hidden = false;
}

const session = parseLinkFragment(location.hash);
// The key isn't secret, but keep it out of history and screenshots of the address bar.
history.replaceState(null, "", location.pathname);

if (!session) {
  showError("Scan the QR code shown by Postern on your laptop.");
} else {
  $("send").hidden = false;
}

$("toggle").addEventListener("click", () => {
  const input = $("password");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  $("toggle").textContent = show ? "Hide" : "Show";
  $("toggle").setAttribute("aria-label", show ? "Hide password" : "Show password");
});

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("error").hidden = true;
  const input = $("password");
  const submit = $("submit");
  submit.disabled = true;
  submit.textContent = "Sending…";

  try {
    const { message, code } = await sealPassword({ ...session, password: input.value });
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
    input.value = "";
    $("send").hidden = true;
    $("code").textContent = code;
    $("done").hidden = false;
  } catch (err) {
    showError(err.message);
    submit.disabled = false;
    submit.textContent = "Send";
  }
});
