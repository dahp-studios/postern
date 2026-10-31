import { DEFAULT_SERVER, USER_SERVER_ALLOWED, getServerInfo, isAllowedServer, setServer } from "./settings.js";

const $ = (id) => document.getElementById(id);

async function showServer() {
  const { server, source } = await getServerInfo();
  $("server-now").textContent = new URL(server).host;
  $("server-source").textContent = {
    default: "Postern's own relay. It only ever sees encrypted data.",
    organization: "Set by your organization's administrator.",
    settings: "Set below (development build).",
  }[source];
}

if (USER_SERVER_ALLOWED) {
  // Development builds only: point at a local relay or a tunnel for testing.
  $("custom").hidden = false;
  const input = $("server");
  input.placeholder = DEFAULT_SERVER;
  chrome.storage.local.get("server").then(({ server }) => {
    input.value = server || "";
  });
  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (value && !isAllowedServer(value)) {
      input.setCustomValidity("Must start with https:// (http:// only for localhost)");
      input.reportValidity();
      return;
    }
    input.setCustomValidity("");
    await setServer(value);
    $("saved").hidden = false;
    showServer();
  });
}

showServer();
