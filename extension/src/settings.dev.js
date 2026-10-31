// Development builds only (`npm run build`): like settings.js, but Settings may point Postern at a
// local relay or a tunnel for testing. Store builds use settings.js and never include this file.

export const DEFAULT_SERVER = __DEFAULT_SERVER__;

/** Phones need HTTPS for the encryption to work, so plain http is only for local testing. */
function isAllowedServer(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** { server, source }: source is "settings" when a test server is set. */
export async function getServerInfo() {
  const { server } = await chrome.storage.local.get("server");
  if (server && isAllowedServer(server)) return { server: server.replace(/\/+$/, ""), source: "settings" };
  return { server: DEFAULT_SERVER, source: "default" };
}

export async function getServer() {
  return (await getServerInfo()).server;
}

/** Show and handle the test-server field on the Settings page. */
export function setupServerField(onChange) {
  const form = document.getElementById("custom");
  const input = document.getElementById("server");
  form.hidden = false;
  input.placeholder = DEFAULT_SERVER;
  chrome.storage.local.get("server").then(({ server }) => {
    input.value = server || "";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (value && !isAllowedServer(value)) {
      input.setCustomValidity("Must start with https:// (http:// only for localhost)");
      input.reportValidity();
      return;
    }
    input.setCustomValidity("");
    if (value) await chrome.storage.local.set({ server: value.replace(/\/+$/, "") });
    else await chrome.storage.local.remove("server");
    document.getElementById("saved").hidden = false;
    onChange();
  });
}
