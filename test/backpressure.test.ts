import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Server as Engine } from "../lib";
import { createWebSocket, waitFor, sleep } from "./util";

describe("WebSocket backpressure edge cases", () => {
  let engine: Engine;
  const PORT = 3012;
  const URL = `http://localhost:${PORT}`;
  const WS_URL = URL.replace("http", "ws");

  beforeAll(() => {
    engine = new Engine({
      backpressureThreshold: 1024, // 1KB threshold for testing
    });
    Bun.serve({
      port: PORT,
      ...engine.handler(),
    });
  });

  afterAll(() => {
    engine.close();
  });

  test("should handle backpressure with threshold set to 0 (disabled)", async () => {
    const engineNoBackpressure = new Engine({
      backpressureThreshold: 0, // disabled
    });

    const server = Bun.serve({
      port: 3020,
      ...engineNoBackpressure.handler(),
    });

    const ws = createWebSocket(
      `ws://localhost:3020/engine.io/?EIO=4&transport=websocket`,
    );
    await waitFor(ws, "open");
    await sleep(100);

    const socket = Array.from(engineNoBackpressure.sockets)[0];

    // Should be able to write without backpressure checks
    for (let i = 0; i < 100; i++) {
      socket.write("test message " + i);
    }

    expect(socket.messagesSent).toBeGreaterThan(0);

    ws.close();
    server.stop();
    engineNoBackpressure.close();
  });

  test("should track bytes sent correctly during backpressure", async () => {
    const ws = createWebSocket(
      `${WS_URL}/engine.io/?EIO=4&transport=websocket`,
    );
    await waitFor(ws, "open");
    await sleep(100);

    const socket = Array.from(engine.sockets)[0];
    const initialBytesSent = socket.bytesSent;

    // Send multiple messages
    const message = "x".repeat(100);
    for (let i = 0; i < 10; i++) {
      socket.write(message);
    }

    await sleep(100);

    expect(socket.bytesSent).toBeGreaterThan(initialBytesSent);
    expect(socket.messagesSent).toBeGreaterThanOrEqual(10);

    ws.close();
    await sleep(100);
  });

  test("should handle rapid message sending", async () => {
    const ws = createWebSocket(
      `${WS_URL}/engine.io/?EIO=4&transport=websocket`,
    );
    await waitFor(ws, "open");
    await sleep(100);

    const socket = Array.from(engine.sockets)[0];

    // Send many messages rapidly
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 1000; i++) {
      promises.push(
        new Promise<void>((resolve) => {
          socket.write(`message-${i}`);
          resolve();
        }),
      );
    }

    await Promise.all(promises);

    // All messages should be queued/sent
    expect(socket.messagesSent).toBeGreaterThan(0);

    ws.close();
    await sleep(100);
  });

  test("should handle backpressure during upgrade", async () => {
    // Start with polling
    const handshake = await fetch(`${URL}/engine.io/?EIO=4&transport=polling`);
    const text = await handshake.text();
    const data = JSON.parse(text.substring(1));
    const sid = data.sid;

    await sleep(100);
    const socket = Array.from(engine.sockets)[0];

    // Send messages while on polling transport
    socket.write("message before upgrade");

    // Upgrade to WebSocket
    const ws = createWebSocket(
      `${WS_URL}/engine.io/?EIO=4&transport=websocket&sid=${sid}`,
    );
    await waitFor(ws, "open");

    // Wait for upgrade
    await sleep(500);

    // Send messages after upgrade
    socket.write("message after upgrade");

    expect(socket.messagesSent).toBeGreaterThanOrEqual(2);

    ws.close();
    await sleep(100);
  });

  test("should handle socket close during backpressure", async () => {
    const ws = createWebSocket(
      `${WS_URL}/engine.io/?EIO=4&transport=websocket`,
    );
    await waitFor(ws, "open");
    await sleep(100);

    const socket = Array.from(engine.sockets)[0];

    // Send large message to trigger backpressure
    const largeMessage = "x".repeat(10000);
    socket.write(largeMessage);

    // Close immediately
    ws.close();

    await sleep(500);

    // Socket should be disconnected
    expect(engine.clientsCount).toBeLessThanOrEqual(1);
  });

  test("should handle multiple sockets with different backpressure states", async () => {
    // Wait for previous test cleanup
    await sleep(500);

    const ws1 = createWebSocket(
      `${WS_URL}/engine.io/?EIO=4&transport=websocket`,
    );
    const ws2 = createWebSocket(
      `${WS_URL}/engine.io/?EIO=4&transport=websocket`,
    );
    const ws3 = createWebSocket(
      `${WS_URL}/engine.io/?EIO=4&transport=websocket`,
    );

    await waitFor(ws1, "open");
    await waitFor(ws2, "open");
    await waitFor(ws3, "open");
    await sleep(200);

    const sockets = Array.from(engine.sockets);
    expect(sockets.length).toBeGreaterThanOrEqual(3);

    // Get the last 3 sockets (the ones we just created)
    const testSockets = sockets.slice(-3);

    // Send different amounts to each socket
    testSockets[0].write("small");
    testSockets[1].write("x".repeat(500));
    testSockets[2].write("x".repeat(1000));

    await sleep(100);

    // Verify messages were sent
    expect(testSockets[0].messagesSent).toBeGreaterThanOrEqual(1);
    expect(testSockets[1].messagesSent).toBeGreaterThanOrEqual(1);
    expect(testSockets[2].messagesSent).toBeGreaterThanOrEqual(1);

    // Verify byte counts are different (larger messages = more bytes)
    expect(testSockets[1].bytesSent).toBeGreaterThan(testSockets[0].bytesSent);
    expect(testSockets[2].bytesSent).toBeGreaterThan(testSockets[1].bytesSent);

    ws1.close();
    ws2.close();
    ws3.close();
    await sleep(200);
  });
});
