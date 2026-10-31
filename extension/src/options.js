import { getServerInfo, setupServerField } from "./settings.js";

const $ = (id) => document.getElementById(id);

async function showServer() {
  const { server, source } = await getServerInfo();
  $("server-now").textContent = new URL(server).host;
  $("server-source").textContent =
    source === "settings" ? "Test server set below (development build)." : "Postern's own relay. It only ever sees encrypted data. This can't be changed.";
}

setupServerField(showServer); // development builds only; a no-op in store builds
showServer();
