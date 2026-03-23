# @rvncom/socket-bun-engine

[![npm version](https://img.shields.io/npm/v/@rvncom/socket-bun-engine?style=flat-square&color=blue&label=version)](https://www.npmjs.com/package/@rvncom/socket-bun-engine)
[![npm downloads](https://img.shields.io/npm/dm/@rvncom/socket-bun-engine.svg)](https://www.npmjs.com/package/@rvncom/socket-bun-engine)
[![license](https://img.shields.io/npm/l/@rvncom/socket-bun-engine?style=flat-square&color=orange)](https://github.com/rvncom/socket-bun-engine/blob/main/LICENSE)

Engine.IO server implementation for the Bun runtime. Provides native WebSocket and HTTP long-polling transports for [Socket.IO](https://socket.io/).

Fork of `@socket.io/bun-engine` with bug fixes, improved API, and active maintenance.

## Installation

```bash
bun add @rvncom/socket-bun-engine
```

## Usage

```ts
import { Server as Engine } from "@rvncom/socket-bun-engine";
import { Server } from "socket.io";

const engine = new Engine({
  path: "/socket.io/",
});

const io = new Server();
io.bind(engine);

io.on("connection", (socket) => {
  // ...
});

export default {
  port: 3000,
  ...engine.handler(),
};
```

You can also use `engine.handleRequest()` directly for custom routing:

```ts
Bun.serve({
  port: 3000,

  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", connections: engine.clientsCount }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return engine.handleRequest(req, server);
  },

  websocket: engine.handler().websocket,
});
```

## Options

### `path`

Default: `/engine.io/`

The path to handle on the server side. Must match the client configuration.

### `pingTimeout`

Default: `20000`

Milliseconds without a pong packet before considering the connection closed.

### `pingInterval`

Default: `25000`

Milliseconds between ping packets sent by the server.

### `upgradeTimeout`

Default: `10000`

Milliseconds before an uncompleted transport upgrade is cancelled.

### `maxHttpBufferSize`

Default: `1e6` (1 MB)

Maximum message size in bytes before closing the session.

### `maxClients`

Default: `0` (unlimited)

Maximum number of concurrent clients. New connections are rejected with HTTP 503 when the limit is reached.

### `backpressureThreshold`

Default: `1048576` (1 MB)

WebSocket send buffer threshold in bytes. When `getBufferedAmount()` exceeds this value, writes are paused automatically and resumed when the buffer drains. Set to `0` to disable.

### `rateLimit`

Per-socket message rate limiting. Disabled by default.

```ts
const engine = new Engine({
  rateLimit: {
    maxMessages: 100,   // max messages per window
    windowMs: 1000,     // window duration in ms
  },
});

engine.on("connection", (socket) => {
  socket.on("rateLimited", () => {
    console.log(`Socket ${socket.id} rate limited`);
  });
});
```

### `perMessageDeflate`

Default: `false`

Enable WebSocket per-message deflate compression (RFC 7692). Pass `true` for defaults or a `Bun.WebSocketPerMessageDeflateOptions` object for fine-grained control. Provides 50-70% bandwidth savings for text-heavy payloads.

```ts
const engine = new Engine({
  perMessageDeflate: true,
});
```

### `enableMetrics`

Default: `false`

Controls whether per-message byte counting (`bytesReceived`, `bytesSent`, `avgRtt`, `upgrades`) is active from the start. When `false`, these metrics activate lazily on first `server.metrics` access. Connection and disconnection counters are always tracked regardless of this option.

```ts
const engine = new Engine({
  enableMetrics: true, // attach byte-counting listeners immediately
});
```

### `degradationThreshold`

Default: `0` (disabled)

Fraction (0–1) of `maxClients` at which graceful degradation activates. Requires `maxClients > 0`. When active:
- New polling connections are rejected (WebSocket only, returns 503)
- New connections get doubled `pingInterval` to reduce heartbeat overhead

```ts
const engine = new Engine({
  maxClients: 10000,
  degradationThreshold: 0.8, // degrade at 8000+ clients
});

engine.on("degradation", ({ active, clients }) => {
  console.log(`Degradation ${active ? "ON" : "OFF"} at ${clients} clients`);
});
```

### `allowRequest`

A function that receives the handshake/upgrade request and can reject it:

```ts
const engine = new Engine({
  allowRequest: (req, server) => {
    return Promise.reject("not allowed");
  },
});
```

### `cors`

Cross-Origin Resource Sharing options:

```ts
const engine = new Engine({
  cors: {
    origin: ["https://example.com"],
    allowedHeaders: ["my-header"],
    credentials: true,
  },
});
```

### `editHandshakeHeaders`

Edit response headers for the handshake request:

```ts
const engine = new Engine({
  editHandshakeHeaders: (responseHeaders, req, server) => {
    responseHeaders.set("set-cookie", "sid=1234");
  },
});
```

### `editResponseHeaders`

Edit response headers for all requests:

```ts
const engine = new Engine({
  editResponseHeaders: (responseHeaders, req, server) => {
    responseHeaders.set("my-header", "abcd");
  },
});
```

## Metrics

Built-in server metrics with zero dependencies. Per-message byte counting is lazy by default — counters activate on first `server.metrics` access (or immediately with `enableMetrics: true`). Connection/disconnection counters are always active.

```ts
const snapshot = engine.metrics;
// {
//   connections: 150,        // total opened (cumulative)
//   disconnections: 12,      // total closed
//   activeConnections: 138,  // currently connected
//   upgrades: 130,           // polling → websocket
//   bytesReceived: 524288,
//   bytesSent: 1048576,
//   errors: 2,
//   avgRtt: 14               // average round-trip time (ms)
// }
```

Per-socket RTT is also available:

```ts
engine.on("connection", (socket) => {
  socket.on("heartbeat", () => {
    console.log(`RTT: ${socket.rtt}ms`);
  });
});
```

## API

### `server.clientsCount`

Number of currently connected clients.

### `server.metrics`

Returns a `MetricsSnapshot` object with server-wide counters.

### `server.sockets`

Iterator over all connected `Socket` instances.

### `server.getSocket(id)`

Look up a specific socket by session ID.

### `server.broadcast(data)`

Sends a message to all connected sockets. The packet is encoded once and sent as pre-encoded data to WebSocket transports (zero-copy). Polling transports fall back to the normal path.

### `server.broadcastExcept(excludeId, data)`

Sends a message to all connected sockets except the one with the given id. Same zero-copy optimization as `broadcast()`.

### `server.degraded`

Returns `true` if the server is currently in degraded mode.

### `server.shutdown(opts?)`

Gracefully shuts down the server. Stops accepting new connections (returns 503), sends close to all existing clients, and resolves when all are disconnected or after the timeout.

```ts
await engine.shutdown({ timeout: 10000 }); // default: 10s

engine.on("shutdown", () => {
  console.log("Server shut down");
});
```

Options:
- `timeout` (default: `10000`): Maximum time in milliseconds to wait for clients to disconnect before force-closing.

### `server.draining`

Returns `true` after `shutdown()` has been called.

### `server.close()`

Returns a `Promise<void>` that resolves when all clients have disconnected.

### `socket.bytesSent` / `socket.bytesReceived`

Cumulative byte counters for this socket's message traffic. Counts payload bytes only (excludes protocol framing).

### `socket.messagesSent` / `socket.messagesReceived`

Cumulative message counters for this socket.

### `socket.connectedAt`

Timestamp (`Date.now()`) of when the socket was created. Useful for computing session duration:

```ts
engine.on("connection", (socket) => {
  socket.on("close", () => {
    const duration = Date.now() - socket.connectedAt;
    console.log(`Socket ${socket.id}: ${socket.messagesSent} sent, ${socket.bytesReceived} bytes recv, ${duration}ms`);
  });
});
```

## Benchmarks

<!-- BENCH:START -->
> Benchmarked on GitHub Actions (`ubuntu-latest`), v1.0.9 vs `@socket.io/bun-engine`. [Full report](https://rvncom.github.io/socket-bun-engine-bench/reports/report-latest.html).

| Metric | vs upstream | @rvncom | @socket.io |
|--------|------------|---------|------------|
| Throughput | **1.2x** faster | 230,415 msg/s | 190,114 msg/s |
| Connections | ~same | 901 conn/s | 899 conn/s |
| Latency (p95) | **5%** lower | 1.5 ms | 1.6 ms |
<!-- BENCH:END -->

## License

[MIT](/LICENSE)
