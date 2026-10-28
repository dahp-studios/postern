import { DEFAULT_SERVER, setServer } from "./settings.js";

// Phones need HTTPS for the encryption to work, so plain http is only for local testing.
function isAllowedServer(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

const input = document.getElementById("server");
input.placeholder = DEFAULT_SERVER;
chrome.storage.local.get("server").then(({ server }) => {
  input.value = server || "";
});

document.getElementById("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (value && !isAllowedServer(value)) {
    input.setCustomValidity("Must start with https:// (http:// only for localhost)");
    input.reportValidity();
    return;
  }
  input.setCustomValidity("");
  await setServer(value);
  document.getElementById("saved").hidden = false;
});
