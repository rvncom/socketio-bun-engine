import { describe, it, expect } from "bun:test";
import { Server, type RawData } from "../lib";
import { createWebSocket, waitFor, sleep } from "./util";

describe("Server", () => {
  it("clientsCount starts at 0", () => {
    const engine = new Server();
    expect(engine.clientsCount).toBe(0);
  });

  it("clientsCount increments on connect and decrements on disconnect", async () => {
    const engine = new Server({ pingInterval: 5000, pingTimeout: 4000 });
    engine.on("connection", () => {});

    const server = Bun.serve({ port: 3020, ...engine.handler() });

    try {
      const ws = createWebSocket(
        "ws://localhost:3020/engine.io/?EIO=4&transport=websocket",
      );
      await waitFor(ws, "message"); // handshake
      expect(engine.clientsCount).toBe(1);

      ws.close();
      await sleep(50);
      expect(engine.clientsCount).toBe(0);
    } finally {
      await engine.close();
      server.stop(true);
    }
  });

  it("sockets iterator yields connected sockets", async () => {
    const engine = new Server({ pingInterval: 5000, pingTimeout: 4000 });
    engine.on("connection", () => {});

    const server = Bun.serve({ port: 3021, ...engine.handler() });

    try {
      const ws1 = createWebSocket(
        "ws://localhost:3021/engine.io/?EIO=4&transport=websocket",
      );
      const ws2 = createWebSocket(
        "ws://localhost:3021/engine.io/?EIO=4&transport=websocket",
      );
      await waitFor(ws1, "message");
      await waitFor(ws2, "message");

      const ids = [...engine.sockets].map((s) => s.id);
      expect(ids.length).toBe(2);

      ws1.close();
      ws2.close();
    } finally {
      await engine.close();
      server.stop(true);
    }
  });

  it("getSocket(id) returns socket or undefined", async () => {
    const engine = new Server({ pingInterval: 5000, pingTimeout: 4000 });
    let socketId = "";
    engine.on("connection", (socket) => {
      socketId = socket.id;
    });

    const server = Bun.serve({ port: 3022, ...engine.handler() });

    try {
      const ws = createWebSocket(
        "ws://localhost:3022/engine.io/?EIO=4&transport=websocket",
      );
      await waitFor(ws, "message");

      expect(engine.getSocket(socketId)).toBeDefined();
      expect(engine.getSocket("nonexistent")).toBeUndefined();

      ws.close();
    } finally {
      await engine.close();
      server.stop(true);
    }
  });

  it("metrics lazy activation: accessing .metrics enables byte counting", async () => {
    const engine = new Server({ pingInterval: 5000, pingTimeout: 4000 });
    engine.on("connection", (socket) => {
      socket.on("data", (data: RawData) => socket.write(data));
    });

    const server = Bun.serve({ port: 3023, ...engine.handler() });

    try {
      const ws = createWebSocket(
        "ws://localhost:3023/engine.io/?EIO=4&transport=websocket",
      );
      await waitFor(ws, "message"); // handshake

      // Access metrics to trigger lazy activation
      const snap1 = engine.metrics;
      expect(snap1.connections).toBe(1);

      ws.send("4testmsg");
      await waitFor(ws, "message"); // echo

      await sleep(10);
      const snap2 = engine.metrics;
      expect(snap2.bytesReceived).toBeGreaterThan(0);

      ws.close();
    } finally {
      await engine.close();
      server.stop(true);
    }
  });

  it("enableMetrics: true activates byte counting from start", async () => {
    const engine = new Server({
      pingInterval: 5000,
      pingTimeout: 4000,
      enableMetrics: true,
    });
    engine.on("connection", (socket) => {
      socket.on("data", (data: RawData) => socket.write(data));
    });

    const server = Bun.serve({ port: 3024, ...engine.handler() });

    try {
      const ws = createWebSocket(
        "ws://localhost:3024/engine.io/?EIO=4&transport=websocket",
      );
      await waitFor(ws, "message");

      ws.send("4hello");
      await waitFor(ws, "message");

      await sleep(10);
      const snap = engine.metrics;
      expect(snap.bytesReceived).toBeGreaterThan(0);

      ws.close();
    } finally {
      await engine.close();
      server.stop(true);
    }
  });

  it("maxClients: rejects with 503 when limit reached", async () => {
    const engine = new Server({
      pingInterval: 5000,
      pingTimeout: 4000,
      maxClients: 1,
    });
    engine.on("connection", () => {});

    const server = Bun.serve({ port: 3025, ...engine.handler() });

    try {
      const ws = createWebSocket(
        "ws://localhost:3025/engine.io/?EIO=4&transport=websocket",
      );
      await waitFor(ws, "message"); // first client connected

      // Second client via polling should get 503
      const res = await fetch(
        "http://localhost:3025/engine.io/?EIO=4&transport=polling",
      );
      expect(res.status).toBe(503);

      ws.close();
    } finally {
      await engine.close();
      server.stop(true);
    }
  });

  it("allowRequest: rejection returns 403", async () => {
    const engine = new Server({
      pingInterval: 5000,
      pingTimeout: 4000,
      allowRequest: () => Promise.reject("denied"),
    });
    engine.on("connection", () => {});

    const server = Bun.serve({ port: 3026, ...engine.handler() });

    try {
      const res = await fetch(
        "http://localhost:3026/engine.io/?EIO=4&transport=polling",
      );
      expect(res.status).toBe(403);
    } finally {
      await engine.close();
      server.stop(true);
    }
  });

  it("editHandshakeHeaders: headers modified on handshake response", async () => {
    const engine = new Server({
      pingInterval: 5000,
      pingTimeout: 4000,
      editHandshakeHeaders: (headers) => {
        headers.set("X-Custom", "handshake");
      },
    });
    engine.on("connection", () => {});

    const server = Bun.serve({ port: 3027, ...engine.handler() });

    try {
      const res = await fetch(
        "http://localhost:3027/engine.io/?EIO=4&transport=polling",
      );
      expect(res.headers.get("X-Custom")).toBe("handshake");
    } finally {
      await engine.close();
      server.stop(true);
    }
  });

  it("editResponseHeaders: headers modified on all responses", async () => {
    const engine = new Server({
      pingInterval: 5000,
      pingTimeout: 4000,
      editResponseHeaders: (headers) => {
        headers.set("X-Response", "all");
      },
    });
    engine.on("connection", () => {});

    const server = Bun.serve({ port: 3028, ...engine.handler() });

    try {
      const res = await fetch(
        "http://localhost:3028/engine.io/?EIO=4&transport=polling",
      );
      expect(res.headers.get("X-Response")).toBe("all");
    } finally {
      await engine.close();
      server.stop(true);
    }
  });

  describe("shutdown()", () => {
    it("rejects new connections with 503", async () => {
      const engine = new Server({ pingInterval: 5000, pingTimeout: 4000 });
      engine.on("connection", () => {});

      const server = Bun.serve({ port: 3029, ...engine.handler() });

      try {
        const ws = createWebSocket(
          "ws://localhost:3029/engine.io/?EIO=4&transport=websocket",
        );
        await waitFor(ws, "message");

        // Start shutdown (don't await yet)
        const shutdownPromise = engine.shutdown({ timeout: 5000 });

        await sleep(20);

        // New connection should be rejected
        const res = await fetch(
          "http://localhost:3029/engine.io/?EIO=4&transport=polling",
        );
        expect(res.status).toBe(503);

        ws.close();
        await shutdownPromise;
      } finally {
        server.stop(true);
      }
    });

    it("existing clients receive close", async () => {
      const engine = new Server({ pingInterval: 5000, pingTimeout: 4000 });
      engine.on("connection", () => {});

      const server = Bun.serve({ port: 3030, ...engine.handler() });

      try {
        const ws = createWebSocket(
          "ws://localhost:3030/engine.io/?EIO=4&transport=websocket",
        );
        await waitFor(ws, "message"); // handshake

        const closePromise = waitFor(ws, "close");
        await engine.shutdown({ timeout: 5000 });
        await closePromise;
      } finally {
        server.stop(true);
      }
    });

    it("timeout force-closes remaining clients", async () => {
      const engine = new Server({ pingInterval: 5000, pingTimeout: 4000 });
      engine.on("connection", () => {});

      const server = Bun.serve({ port: 3031, ...engine.handler() });

      try {
        const ws = createWebSocket(
          "ws://localhost:3031/engine.io/?EIO=4&transport=websocket",
        );
        await waitFor(ws, "message");

        let shutdownEmitted = false;
        engine.on("shutdown" as any, () => {
          shutdownEmitted = true;
        });

        await engine.shutdown({ timeout: 200 });

        expect(shutdownEmitted).toBe(true);
        expect(engine.clientsCount).toBe(0);

        ws.close();
      } finally {
        server.stop(true);
      }
    });

    it("emits shutdown event when no clients", async () => {
      const engine = new Server({ pingInterval: 5000, pingTimeout: 4000 });
      let emitted = false;
      engine.on("shutdown" as any, () => {
        emitted = true;
      });

      await engine.shutdown();
      expect(emitted).toBe(true);
    });
  });

  it("perMessageDeflate: data integrity with compression enabled", async () => {
    const engine = new Server({
      pingInterval: 5000,
      pingTimeout: 4000,
      perMessageDeflate: true,
    });
    engine.on("connection", (socket) => {
      socket.on("data", (data: RawData) => socket.write(data));
    });

    const server = Bun.serve({ port: 3032, ...engine.handler() });

    try {
      const ws = createWebSocket(
        "ws://localhost:3032/engine.io/?EIO=4&transport=websocket",
      );
      await waitFor(ws, "message"); // handshake

      ws.send("4hello deflate");
      const { data } = await waitFor(ws, "message");
      expect(data).toBe("4hello deflate");

      ws.close();
    } finally {
      await engine.close();
      server.stop(true);
    }
  });

  it("draining getter reflects shutdown state", async () => {
    const engine = new Server({ pingInterval: 5000, pingTimeout: 4000 });
    expect(engine.draining).toBe(false);

    await engine.shutdown();
    expect(engine.draining).toBe(true);
  });
});
