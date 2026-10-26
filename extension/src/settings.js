// Server = where the phone page and relay live. Set at build time; can be overridden in Settings.
export const DEFAULT_SERVER = __DEFAULT_SERVER__;

export async function getServer() {
  const { server } = await chrome.storage.local.get("server");
  return (server || DEFAULT_SERVER).replace(/\/+$/, "");
}

export async function setServer(value) {
  if (!value) return chrome.storage.local.remove("server");
  return chrome.storage.local.set({ server: value.replace(/\/+$/, "") });
}

