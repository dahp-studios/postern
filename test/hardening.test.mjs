// Abuse handling: a self-hosted relay against bad clients, and the npm package against a relay
// that refuses it. Each test was first run against the unfixed code to check that it fails there.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { receive } from "../packages/postern/src/index.js";

const SESSION = "AAECAwQFBgcICQoLDA0ODw";

async function freePort() {
  const probe = http.createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  probe.close();
  return port;
}

async function startSelfHost(env) {
  const server = spawn(process.execPath, [fileURLToPath(new URL("../selfhost/server.mjs", import.meta.url))], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(await freePort()), ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  after(() => server.kill());
  let out = "";
  for await (const chunk of server.stdout) {
    out += chunk;
    const port = out.match(/127\.0\.0\.1:(\d+)/)?.[1];
    if (port) return `http://127.0.0.1:${port}`;
  }
  throw new Error("self-hosted relay didn't start");
}

async function closeCode(url, send) {
  const ws = new WebSocket(url);
  await once(ws, "open");
  ws.send(send);
  const [event] = await once(ws, "close");
  return event.code;
}

test("self-host: a spoofed first X-Forwarded-For entry doesn't get around the rate limit", async () => {
  const base = await startSelfHost({ TRUST_PROXY: "1", RATE_LIMIT: "3" });
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    // The client invents the first entry each time; the proxy appends the real address last.
    const res = await fetch(`${base}/api/s/${SESSION}`, { method: "DELETE", headers: { "X-Forwarded-For": `10.0.0.${i}, 203.0.113.7` } });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(3), [429, 429]);
});

test("self-host: oversized WebSocket messages and anything but ping close the socket", async () => {
  const base = (await startSelfHost({ RATE_LIMIT: "0" })).replace("http", "ws");
  assert.equal(await closeCode(`${base}/api/s/${SESSION}`, "x".repeat(4096)), 1009); // too big
  assert.equal(await closeCode(`${base}/api/s/${SESSION}`, "hello"), 1008); // not ping
});

test("self-host: an oversized upload is refused from its Content-Length, without reading it", async () => {
  const base = await startSelfHost({ RATE_LIMIT: "0" });
  const status = await new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/s/${SESSION}`, { method: "POST", headers: { "Content-Length": 50 * 1024 * 1024 } }, (res) => resolve(res.statusCode));
    req.on("error", reject);
    req.write("{"); // sends almost nothing of the declared 50 MB
  });
  assert.equal(status, 413);
});

test("npm package: the server option must be an http(s) URL", async () => {
  for (const server of ["javascript:alert(1)", "ws://relay", "relay.example", "", 42]) {
    await assert.rejects(receive({ server, transport: "poll" }), TypeError);
  }
});

test("npm package: a relay answering 429 is asked again with growing pauses, not flooded", async () => {
  let hits = 0;
  const relay = http.createServer((req, res) => {
    hits++;
    res.writeHead(429, { "Content-Type": "application/json" }).end('{"error":"rate_limited"}');
  });
  relay.listen(0, "127.0.0.1");
  await once(relay, "listening");
  const session = await receive({ server: `http://127.0.0.1:${relay.address().port}`, transport: "poll" });
  await new Promise((r) => setTimeout(r, 3500));
  session.cancel();
  relay.close();
  // Pauses of 2 s, then 4 s: about 2 requests (the unfixed code made tens of thousands).
  assert.ok(hits >= 1 && hits <= 3, `${hits} requests`);
});
