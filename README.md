# @wiuvel/socket-bun-engine

Engine.IO server implementation for the Bun runtime. Provides native WebSocket and HTTP long-polling transports for [Socket.IO](https://socket.io/).

Fork of `@socket.io/bun-engine` with bug fixes, improved API, and active maintenance.

## Installation

```bash
bun add @rvn/bun-engine
```

## Usage

```ts
import { Server as Engine } from "@rvn/bun-engine";
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

## License

[MIT](/LICENSE)
