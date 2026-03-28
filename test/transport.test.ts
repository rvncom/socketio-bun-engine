import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Server as Engine } from "../lib";

describe("Transport error handling", () => {
  let engine: Engine;
  const PORT = 3010;
  const URL = `http://localhost:${PORT}`;

  beforeAll(() => {
    engine = new Engine();
    Bun.serve({
      port: PORT,
      ...engine.handler(),
    });
  });

  afterAll(() => {
    engine.close();
  });

  test("should reject polling POST with invalid Content-Type", async () => {
    const res = await fetch(`${URL}/engine.io/?EIO=4&transport=polling`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "1:4test",
    });

    expect(res.status).toBe(400);
  });

  test("should accept polling POST with text/plain Content-Type", async () => {
    // First get a session
    const handshake = await fetch(`${URL}/engine.io/?EIO=4&transport=polling`);
    const text = await handshake.text();
    const data = JSON.parse(text.substring(1));
    const sid = data.sid;

    const res = await fetch(
      `${URL}/engine.io/?EIO=4&transport=polling&sid=${sid}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: "1:4test",
      },
    );

    expect(res.status).toBe(200);
  });

  test("should accept polling POST with application/octet-stream Content-Type", async () => {
    // First get a session
    const handshake = await fetch(`${URL}/engine.io/?EIO=4&transport=polling`);
    const text = await handshake.text();
    const data = JSON.parse(text.substring(1));
    const sid = data.sid;

    const res = await fetch(
      `${URL}/engine.io/?EIO=4&transport=polling&sid=${sid}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: "1:4test",
      },
    );

    expect(res.status).toBe(200);
  });

  test("should accept polling POST without Content-Type header", async () => {
    // First get a session
    const handshake = await fetch(`${URL}/engine.io/?EIO=4&transport=polling`);
    const text = await handshake.text();
    const data = JSON.parse(text.substring(1));
    const sid = data.sid;

    const res = await fetch(
      `${URL}/engine.io/?EIO=4&transport=polling&sid=${sid}`,
      {
        method: "POST",
        body: "1:4test",
      },
    );

    expect(res.status).toBe(200);
  });

  test("should handle Content-Type with charset parameter", async () => {
    // First get a session
    const handshake = await fetch(`${URL}/engine.io/?EIO=4&transport=polling`);
    const text = await handshake.text();
    const data = JSON.parse(text.substring(1));
    const sid = data.sid;

    const res = await fetch(
      `${URL}/engine.io/?EIO=4&transport=polling&sid=${sid}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: "1:4test",
      },
    );

    expect(res.status).toBe(200);
  });
});

describe("Broadcast validation", () => {
  let engine: Engine;
  const PORT = 3011;

  beforeAll(() => {
    engine = new Engine();
    Bun.serve({
      port: PORT,
      ...engine.handler(),
    });
  });

  afterAll(() => {
    engine.close();
  });

  test("should throw TypeError when broadcasting null", async () => {
    expect(() => {
      engine.broadcast(null as any);
    }).toThrow(TypeError);
  });

  test("should throw TypeError when broadcasting undefined", async () => {
    expect(() => {
      engine.broadcast(undefined as any);
    }).toThrow(TypeError);
  });

  test("should throw TypeError when broadcastExcept with null data", async () => {
    expect(() => {
      engine.broadcastExcept("some-id", null as any);
    }).toThrow(TypeError);
  });

  test("should throw TypeError when broadcastExcept with undefined data", async () => {
    expect(() => {
      engine.broadcastExcept("some-id", undefined as any);
    }).toThrow(TypeError);
  });

  test("should successfully broadcast empty string", async () => {
    expect(() => {
      engine.broadcast("");
    }).not.toThrow();
  });

  test("should successfully broadcast zero", async () => {
    expect(() => {
      engine.broadcast(0 as any);
    }).not.toThrow();
  });
});
