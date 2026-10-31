// Server = where the phone page and relay live.
//
// Store builds always use DEFAULT_SERVER (postern.dahp.io). Users can't change it, so nobody can be
// talked into pointing Postern at someone else's server. An organization that runs its own relay
// sets it centrally through managed policy (Chrome: "3rdparty" extension policy; Firefox:
// policies.json), which only its administrators control.
// Development builds (`npm run build`) also accept a server typed into Settings, for testing.

export const DEFAULT_SERVER = __DEFAULT_SERVER__;
export const USER_SERVER_ALLOWED = __USER_SERVER_ALLOWED__;

/** Phones need HTTPS for the encryption to work, so plain http is only for local testing. */
export function isAllowedServer(value, { allowLocalHttp = true } = {}) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return allowLocalHttp && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function managedServer() {
  try {
    const { server } = await chrome.storage.managed.get("server");
    return typeof server === "string" && isAllowedServer(server, { allowLocalHttp: false }) ? server : null;
  } catch {
    return null; // no policy, or the browser has no managed storage (Safari)
  }
}

/** { server, source }: source is "default", "organization" (managed policy) or "settings" (development builds). */
export async function getServerInfo() {
  const managed = await managedServer();
  if (managed) return { server: managed.replace(/\/+$/, ""), source: "organization" };
  if (USER_SERVER_ALLOWED) {
    const { server } = await chrome.storage.local.get("server");
    if (server && isAllowedServer(server)) return { server: server.replace(/\/+$/, ""), source: "settings" };
  }
  return { server: DEFAULT_SERVER, source: "default" };
}

export async function getServer() {
  return (await getServerInfo()).server;
}

export async function setServer(value) {
  if (!USER_SERVER_ALLOWED) throw new Error("This build of Postern uses a fixed server.");
  if (!value) return chrome.storage.local.remove("server");
  return chrome.storage.local.set({ server: value.replace(/\/+$/, "") });
}
