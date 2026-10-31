// Server = where the phone page and relay live.
//
// The extension always uses DEFAULT_SERVER (postern.dahp.io, fixed at build time). Nothing can
// change it: no setting, no policy, no stored value. So nobody can point Postern at someone else's
// server, whose phone page could read what's typed. Self-hosting is for websites and apps, through
// the npm package's `server` option, or a separate build of this extension with its own server.
//
// Development builds (`npm run build`) use settings.dev.js instead, which also accepts a server typed
// into Settings for testing. Store builds never include that file.

export const DEFAULT_SERVER = __DEFAULT_SERVER__;

/** { server, source } */
export async function getServerInfo() {
  return { server: DEFAULT_SERVER, source: "default" };
}

export async function getServer() {
  return DEFAULT_SERVER;
}

/** Settings page: development builds add a server field here; store builds have none. */
export function setupServerField() {}
