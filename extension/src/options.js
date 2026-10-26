import { DEFAULT_SERVER, setServer } from "./settings.js";

const input = document.getElementById("server");
input.placeholder = DEFAULT_SERVER;
chrome.storage.local.get("server").then(({ server }) => {
  input.value = server || "";
});

document.getElementById("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (value && !/^https?:\/\//.test(value)) {
    input.setCustomValidity("Must start with https:// (or http://localhost)");
    input.reportValidity();
    return;
  }
  input.setCustomValidity("");
  await setServer(value);
  document.getElementById("saved").hidden = false;
});
