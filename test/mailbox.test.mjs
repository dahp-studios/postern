// The relay's session logic (relay/src/mailbox.js), shared by the Cloudflare and self-hosted servers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CANCELLED, MAX_SOCKET_MESSAGES, Mailbox, parseDelivery, route } from "../relay/src/mailbox.js";

const MESSAGE = '{"v":1,"enc":"e","ct":"c"}';

function fakeSocket() {
  const socket = { sent: [], closed: null, send: (m) => socket.sent.push(m), close: (code) => (socket.closed = code) };
  return socket;
}

test("WebSocket receiver gets the message, then the session is over", async () => {
  const box = new Mailbox();
  const socket = fakeSocket();
  await box.attachSocket(socket);
  assert.equal(box.deliver(MESSAGE).status, 200);
  assert.deepEqual(socket.sent, [MESSAGE]);
  assert.equal(socket.closed, 1000);
  assert.equal(box.deliver(MESSAGE).status, 410);
});

test("ping gets pong", async () => {
  const box = new Mailbox();
  const socket = fakeSocket();
  const handlers = await box.attachSocket(socket);
  handlers.message("ping");
  assert.deepEqual(socket.sent, ["pong"]);
});

test("long-poll receiver gets the message", async () => {
  const box = new Mailbox();
  const waiting = box.wait(5000);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(box.deliver(MESSAGE).status, 200);
  assert.deepEqual(await waiting, { status: 200, body: MESSAGE });
  assert.equal((await box.wait(50)).status, 410);
});

test("a long poll with nothing to deliver answers 204, and the next poll still works", async () => {
  const box = new Mailbox();
  assert.equal((await box.wait(20)).status, 204);
  const waiting = box.wait(5000);
  box.deliver(MESSAGE);
  assert.equal((await waiting).status, 200);
});

test("a message sent between polls waits for the next poll", async () => {
  const box = new Mailbox();
  await box.wait(10); // receiver seen, then gone
  assert.equal(box.deliver(MESSAGE).status, 202);
  assert.deepEqual(await box.wait(5000), { status: 200, body: MESSAGE });
});

test("a message sent while the WebSocket reconnects goes out on its first ping", async () => {
  const box = new Mailbox();
  const first = await box.attachSocket(fakeSocket());
  first.close(1006);
  assert.equal(box.deliver(MESSAGE).status, 202);
  const socket = fakeSocket();
  const again = await box.attachSocket(socket);
  again.message("ping");
  assert.deepEqual(socket.sent, ["pong", MESSAGE]);
});

test("nobody waiting yet: the sender is told (404)", () => {
  assert.equal(new Mailbox().deliver(MESSAGE).status, 404);
});

test("a second receiver is refused while one is connected", async () => {
  const box = new Mailbox();
  await box.attachSocket(fakeSocket());
  assert.equal((await box.attachSocket(fakeSocket())).error.status, 409);
  assert.equal((await box.wait(10)).status, 409);
});

test("cancel ends the session, by DELETE or by closing the WebSocket with 4001", async () => {
  const a = new Mailbox();
  const waiting = a.wait(5000);
  assert.equal(a.cancel().status, 200);
  assert.equal((await waiting).status, 410);
  assert.equal(a.deliver(MESSAGE).status, 410);

  const b = new Mailbox();
  const handlers = await b.attachSocket(fakeSocket());
  handlers.close(CANCELLED);
  assert.equal(b.deliver(MESSAGE).status, 410);
});

test("expiry drops a waiting message and closes the receiver", async () => {
  const box = new Mailbox();
  const socket = fakeSocket();
  await box.attachSocket(socket);
  box.expire();
  assert.equal(socket.closed, 4000);
  assert.equal(box.deliver(MESSAGE).status, 410);
});

test("the expiry timer starts when the first receiver arrives", async () => {
  let started = 0;
  const box = new Mailbox({ onFirstUse: () => started++ });
  await box.wait(5);
  await box.wait(5);
  assert.equal(started, 1);
});

test("routes and body checks", () => {
  const id = "A".repeat(22);
  assert.deepEqual(route("GET", `/api/s/${id}`, true), { id, action: "socket" });
  assert.deepEqual(route("GET", `/api/s/${id}/wait`, false), { id, action: "wait" });
  assert.deepEqual(route("POST", `/api/s/${id}`, false), { id, action: "deliver" });
  assert.deepEqual(route("DELETE", `/api/s/${id}`, false), { id, action: "cancel" });
  assert.equal(route("GET", "/api/s/short", false), null);
  assert.equal(route("PUT", `/api/s/${id}`, false).action, "bad_method");
  assert.equal(parseDelivery("x".repeat(800 * 1024)).error.status, 413);
  assert.equal(parseDelivery("nope").error.status, 400);
  assert.equal(parseDelivery('{"v":1}').error.status, 400);
  assert.equal(parseDelivery('{"v":1,"enc":"e","ct":"c","extra":"dropped"}').message, MESSAGE);
});

test("a receiver that sends anything but ping, or floods pings, is dropped; the session stays open", async () => {
  const box = new Mailbox();
  const rogue = fakeSocket();
  (await box.attachSocket(rogue)).message("x".repeat(5000));
  assert.equal(rogue.closed, 1008);
  assert.deepEqual(rogue.sent, []);

  const flooder = fakeSocket();
  const handlers = await box.attachSocket(flooder);
  for (let i = 0; i < 50; i++) handlers.message("ping");
  assert.equal(flooder.closed, 1008);
  assert.equal(flooder.sent.length, MAX_SOCKET_MESSAGES);

  const real = fakeSocket();
  (await box.attachSocket(real)).message("ping");
  assert.equal(box.deliver(MESSAGE).status, 200);
  assert.deepEqual(real.sent, ["pong", MESSAGE]);
});

test("binary WebSocket data is refused", async () => {
  const box = new Mailbox();
  const socket = fakeSocket();
  (await box.attachSocket(socket)).message(new ArrayBuffer(8));
  assert.equal(socket.closed, 1008);
});
