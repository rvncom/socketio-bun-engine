import { describe, it, expect } from "bun:test";
import { ServerMetrics } from "../lib/metrics";

describe("ServerMetrics", () => {
  it("increments connections on onConnection", () => {
    const m = new ServerMetrics();
    m.onConnection();
    m.onConnection();
    expect(m.snapshot().connections).toBe(2);
  });

  it("increments disconnections on onDisconnection", () => {
    const m = new ServerMetrics();
    m.onDisconnection();
    expect(m.snapshot().disconnections).toBe(1);
  });

  it("calculates activeConnections = connections - disconnections", () => {
    const m = new ServerMetrics();
    m.onConnection();
    m.onConnection();
    m.onConnection();
    m.onDisconnection();
    expect(m.snapshot().activeConnections).toBe(2);
  });

  it("increments upgrades on onUpgrade", () => {
    const m = new ServerMetrics();
    m.onUpgrade();
    m.onUpgrade();
    expect(m.snapshot().upgrades).toBe(2);
  });

  it("accumulates bytesReceived", () => {
    const m = new ServerMetrics();
    m.onBytesReceived(100);
    m.onBytesReceived(200);
    expect(m.snapshot().bytesReceived).toBe(300);
  });

  it("accumulates bytesSent", () => {
    const m = new ServerMetrics();
    m.onBytesSent(50);
    m.onBytesSent(150);
    expect(m.snapshot().bytesSent).toBe(200);
  });

  it("increments errors on onError", () => {
    const m = new ServerMetrics();
    m.onError();
    m.onError();
    m.onError();
    expect(m.snapshot().errors).toBe(3);
  });

  it("calculates avgRtt as rounded average", () => {
    const m = new ServerMetrics();
    m.onRtt(10);
    m.onRtt(20);
    m.onRtt(30);
    expect(m.snapshot().avgRtt).toBe(20);
  });

  it("returns avgRtt = 0 when no RTT samples", () => {
    const m = new ServerMetrics();
    expect(m.snapshot().avgRtt).toBe(0);
  });

  it("snapshot returns all fields", () => {
    const m = new ServerMetrics();
    m.onConnection();
    m.onDisconnection();
    m.onUpgrade();
    m.onBytesReceived(100);
    m.onBytesSent(200);
    m.onError();
    m.onRtt(15);
    const s = m.snapshot();
    expect(s).toEqual({
      connections: 1,
      disconnections: 1,
      activeConnections: 0,
      upgrades: 1,
      bytesReceived: 100,
      bytesSent: 200,
      errors: 1,
      avgRtt: 15,
      pollingCount: 0,
      websocketCount: 0,
    });
  });

  it("rounds avgRtt correctly", () => {
    const m = new ServerMetrics();
    m.onRtt(10);
    m.onRtt(11);
    // (10 + 11) / 2 = 10.5 → rounds to 11
    expect(m.snapshot().avgRtt).toBe(11);
  });

  it("resets RTT after 1000 samples to prevent unbounded growth", () => {
    const m = new ServerMetrics();
    // Add 1000 samples
    for (let i = 0; i < 1000; i++) {
      m.onRtt(10);
    }
    expect(m.snapshot().avgRtt).toBe(10);

    // Add one more sample - should trigger reset
    m.onRtt(20);
    // After reset: rttSum = 10 (avg), rttCount = 1, then add 20
    // New avg = (10 + 20) / 2 = 15
    expect(m.snapshot().avgRtt).toBe(15);
  });

  it("tracks polling transport count", () => {
    const m = new ServerMetrics();
    m.onPollingConnection();
    m.onPollingConnection();
    expect(m.snapshot().pollingCount).toBe(2);
    m.onPollingDisconnection();
    expect(m.snapshot().pollingCount).toBe(1);
  });

  it("tracks websocket transport count", () => {
    const m = new ServerMetrics();
    m.onWebSocketConnection();
    m.onWebSocketConnection();
    m.onWebSocketConnection();
    expect(m.snapshot().websocketCount).toBe(3);
    m.onWebSocketDisconnection();
    expect(m.snapshot().websocketCount).toBe(2);
  });
});
