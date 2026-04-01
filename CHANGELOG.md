# Changelog

## 1.1.2

### Bug Fixes

- **Type safety in upgrade timeout**: Removed unsafe `as any` cast by adding public `getReadyState()` method to Transport base class
- **WebSocket null check in backpressure**: Added socket existence and readyState validation before calling `getBufferedAmount()` to prevent race conditions
- **Option validation**: Added range validation for all numeric options (pingInterval, pingTimeout, upgradeTimeout, maxHttpBufferSize, maxClients, backpressureThreshold, degradationThreshold) — negative values now throw RangeError with clear messages
- **Content-Length validation**: Fixed bypass vulnerability with leading zeros and malformed headers — now validates that parsed value matches original string
- **Polling timeout**: Added 60-second timeout for polling requests to prevent indefinite hangs when clients never poll again
- **Polling promise rejection**: Fixed unused reject callback in polling transport — now properly invoked on timeout
- **Timer type**: Changed `NodeJS.Timeout` to `Timer` for proper Bun compatibility in upgrade timeout

### Performance

- **Empty broadcast optimization**: Added early return when client list is empty, avoiding unnecessary packet encoding
- **WebSocket constant caching**: Cached `WebSocket.OPEN` constant to avoid repeated property lookups in hot paths (3 locations)
- **Magic number extraction**: Extracted backpressure check interval (32) to named constant `BACKPRESSURE_CHECK_INTERVAL`

### New Features

- **RTT metrics with bounded growth**: Added max sample size (1000) to prevent unbounded memory growth — automatically resets to rolling average
- **Transport distribution metrics**: Added `pollingCount` and `websocketCount` to metrics snapshot for monitoring transport distribution
- **ReadyState enum**: Replaced magic strings with `ReadyState` enum (`OPEN`, `CLOSING`, `CLOSED`, `OPENING`) for better type safety

### Code Quality

- **Readonly modifiers**: Added `readonly` to immutable fields (`clients`, `_metrics`, `_metricsAttached`) for better type safety
- **Improved error messages**: Enhanced capacity error messages with actual values (e.g., "Server capacity reached (100/100)")

### API

- **Exported types**: Added `Packet`, `PacketType`, `Transport`, and `ReadyState` to public API exports

### Documentation

- **JSDoc for Socket.write()**: Added comprehensive documentation explaining fast-path optimization and parameters
- **Debugging section**: Added NODE_DEBUG usage examples to README for enabling debug logs
- **Requirements section**: Documented Bun >= 1.0.0 and TypeScript >= 5.9.2 requirements

### Developer Experience

- **Bun runtime check**: Added helpful error message when package is used outside Bun runtime

## 1.1.1

### Bug Fixes

- **Content-Type validation in polling transport**: Added validation for Content-Type header in POST requests — only `text/plain` and `application/octet-stream` are now accepted, invalid types return 400
- **Null checks in broadcast methods**: `broadcast()` and `broadcastExcept()` now throw TypeError when data is null or undefined, preventing silent failures
- **Upgrade timeout race condition**: Added readyState check in upgrade timeout callback to prevent attempting to close an already-closed transport

### Testing

- **New test suites**: Added comprehensive tests for transport error handling and backpressure edge cases
- **Transport error tests**: Added tests for Content-Type validation, including charset parameters and missing headers
- **Broadcast validation tests**: Added tests for null/undefined data validation in broadcast methods
- **Backpressure tests**: Added tests for disabled backpressure (threshold=0), rapid message sending, upgrade scenarios, and multiple concurrent sockets

### Tooling

- **Test scripts**: Added `test` and `test:coverage` scripts to package.json for easier testing
- **Dev script**: Added `dev` script with TypeScript watch mode for development

### Documentation

- **CI badge**: Added GitHub Actions CI status badge to README

## 1.1.0

### Package Rename

- Renamed package from `@rvncom/socket-bun-engine` -> `@rvncom/socketio-bun-engine`
- The old package is now deprecated and acts as a proxy to the new package

## 1.0.9

### Security

- **Fix Content-Length NaN bypass**: Malformed Content-Length headers (e.g. "abc") no longer bypass payload size check — `parseInt()` returning NaN now correctly triggers 413 rejection

### Bug Fixes

- **Guard user callback exceptions**: `editHandshakeHeaders` and `editResponseHeaders` callbacks are now wrapped in try-catch — a throwing callback no longer crashes the entire request handler
- **Guard SID lookup after verify**: Add explicit null check for socket lookup during upgrade/polling, preventing theoretical crash from race between verify and disconnect
- **Fix broadcast metrics**: `broadcast()` and `broadcastExcept()` now correctly increment per-socket `messagesSent` and `bytesSent` counters for WebSocket transports using `sendRaw()`

### Performance

- **Pre-encode pong packet**: Pong responses on WebSocket connections now send pre-encoded "3" directly, bypassing packet allocation and encoding (mirrors existing ping optimization)

## 1.0.8

### Code Quality

- **Extract `byteSize()` utility**: Eliminates 4 duplicated data-size calculations in socket.ts
- **Standardize polling Response returns**: Remove unnecessary `Promise.resolve()` wrapping in async `onDataRequest()`
- **Named constant `MESSAGE_CHARCODE`**: Replace magic number `52` in WebSocket fast-path

### Documentation

- Add module-level JSDoc to 8 source files
- Add JSDoc to all exported functions and methods (parser, cors, metrics, transport, polling, websocket, util)

### CI

- Fix `bench.yml`: save `readme-snippet.md` before gh-pages branch switch
- Fix `bench.yml`: add `SERVER_WORKERS=1` to prevent `EADDRINUSE` on CI
- Fix `bench.yml`: use `--frozen-lockfile`, validate `results.json`, preserve `.git` on gh-pages

## 1.0.7

### Bug Fixes

- **Fix write buffer loss during upgrade**: Swapped `closeTransport()` / `bindTransport()` order in upgrade completion — new WS transport is now bound before closing the old polling transport, preventing message loss if an error occurs mid-switch.
- **Fix upgrade timeout timer leak**: The upgrade `timeoutId` is now cleared in the transport `close` handler. Previously, if the transport closed before upgrade completed (e.g. client disconnected), the timeout timer would fire on a dead transport.
- **Guard `req.text()` in polling**: Wrapped `await req.text()` in a try-catch in `onDataRequest()`. If the client aborts mid-body, the transport now emits an error and returns 400 instead of leaving the polling promise in a broken state.

### Performance

- **Cork single-packet sends**: `WS.send()` now always uses `socket.cork()`, including for single-packet sends. Previously only batches of 2+ were corked — single sends incurred an extra write+flush syscall.
- **Cache degradation state**: Merged `isDegraded()` computation into `updateDegradationState()`, called only on connect/disconnect. `handshake()` now reads the cached `_degraded` flag directly instead of recomputing the ratio on every request.

### New Features

- **Per-socket metrics**: `socket.bytesSent`, `socket.bytesReceived`, `socket.messagesSent`, `socket.messagesReceived`, `socket.connectedAt` — lightweight counters on each socket for identifying bandwidth-heavy or slow clients. Zero overhead when not read.

## 1.0.6

### Performance

- **Amortized backpressure check**: `getBufferedAmount()` FFI call now runs every 32 sends instead of every send (97% reduction in FFI crossings). Uses bitmask counter `(++count & 31) === 0` in a shared `_checkAndApplyBackpressure()` method across `send()`, `sendMessage()`, and `sendRaw()`.
- **Cached `instanceof WS` check**: `write()` and `schedulePing()` no longer walk the prototype chain on every call — transport type is cached as `_wsTransport` in `bindTransport()`.

### Bug Fixes

- **Fix silent message loss on `sendMessage` failure**: `Socket.write()` now checks the return value of `WS.sendMessage()`. If it returns `false` (e.g. socket closed mid-send), the message falls through to the buffered `sendPacket()` path instead of being silently dropped.

## 1.0.5

### New Features

- **WebSocket compression (`perMessageDeflate`)**: Pass `perMessageDeflate: true` (or a `Bun.WebSocketPerMessageDeflateOptions` object) to enable RFC 7692 per-message deflate compression. Default: `false` (no change in behavior).
- **Graceful shutdown (`server.shutdown()`)**: Stops accepting new connections (returns 503), closes all existing clients, and resolves when all are disconnected or after a configurable timeout. Emits `'shutdown'` event when done.
- **`server.draining` getter**: Returns `true` after `shutdown()` has been called.

### Code Quality

- **Fix `as unknown` type assertions**: Replaced unsafe `(data as unknown as { byteLength: number }).byteLength` in metrics listeners with proper `Buffer.isBuffer()` checks.

### Performance

- **Fast ID generation**: Replaced `randomBytes(15).toString("base64url")` (sync crypto) with Bun-native `crypto.randomUUID()` for faster handshakes.
- **Inline handshake JSON**: Replaced `JSON.stringify()` in the open packet with string concatenation — eliminates object serialization on every new connection.
- **Lazy header serialization**: `request.headers` in the handshake is now a lazy getter — `Object.fromEntries(req.headers.entries())` only runs when the property is actually accessed.
- **Protocol check optimization**: Replaced `["https", "wss"].includes(url.protocol)` with direct `===` comparisons (URL.protocol includes the colon).
- **Fast message callback**: WebSocket message type `"4"` (95%+ of traffic) now bypasses the full `Parser.decodePacket()` → `Transport.onPacket()` → `emitReserved("packet")` → `Socket.onPacket()` chain via a direct callback on the transport.
- **Skip packetCreate emission**: `emitReserved("packetCreate")` is skipped entirely when no metrics listeners are attached, eliminating a no-op event dispatch on every outgoing packet.
- **Direct write path**: `socket.write(data)` on WebSocket transports now sends directly via `WS.sendMessage()` when the buffer is empty and no packetCreate listeners exist — skips Packet object allocation, writeBuffer push/swap, flush, and drain events.
- **Pre-encoded ping**: Ping packets on WebSocket transports use a pre-encoded `"2"` string sent via `sendRaw()`, bypassing packet creation and event emission.
- **`WS.sendMessage()`**: New method on WebSocket transport for direct message sending — encodes inline as `"4" + data`, returns success boolean.

## 1.0.4

### Performance

- **Lazy metrics activation**: Per-message byte counting listeners are no longer attached to every socket unconditionally. Set `enableMetrics: true` or access `server.metrics` to activate. Connection/disconnection counters remain always-on (cheap increments). Eliminates extra event listeners and `listeners.slice()` copies on every incoming message.
- **Rate limiter: timer-based window**: Replaced `Date.now()` call on every message with a periodic `setInterval` reset. `consume()` is now a simple decrement + comparison. Added `destroy()` to clean up timer on socket close.
- **Backpressure check cache**: `getBufferedAmount()` native call is skipped entirely when `backpressureThreshold` is 0 (disabled). Cached boolean avoids repeated threshold comparison.
- **EventEmitter 2-listener fast path**: `emit()` now directly calls both listeners when exactly 2 are registered, avoiding `listeners.slice()` array copy. Only falls back to slice for 3+ listeners.
- **Parser fast paths**: Replaced `Map` lookups with plain objects (JIT inline-cache friendly). Added dedicated fast paths for message type (`"4"`) in both `encodePacket()` and `decodePacket()` — covers 95%+ of traffic.
- **Micro-optimizations**: Replaced `["closing", "closed"].includes(readyState)` with direct `===` comparisons in `Socket.sendPacket()` and `Transport.close()` — eliminates temporary array allocation and linear search.
- **Zero-copy broadcast**: `broadcast()` and `broadcastExcept()` now encode the packet once with `Parser.encodePacket()` and send the pre-encoded data directly to WebSocket transports via `WS.sendRaw()`. Polling transports fall back to the normal `socket.write()` path.

### New Features

- **`enableMetrics` option**: `ServerOptions.enableMetrics` (default `false`) controls whether per-message byte counting is active from the start. When false, metrics activate lazily on first `server.metrics` access.
- **`WS.sendRaw()`**: New method on WebSocket transport for sending pre-encoded data, bypassing packet creation and event emission.

## 1.0.3

### Bug Fixes

- **Packet loss during backpressure**: Removed pre-send backpressure early return in `WS.send()` — packets dequeued by `flush()` are no longer silently dropped when backpressure is detected mid-send. Post-send backpressure check still pauses future flushes.

### New Features

- **Rate limiting**: Per-socket message rate limiting via `rateLimit` option (`{ maxMessages, windowMs }`). Dropped messages emit `rateLimited` event on the socket.
- **Graceful degradation**: `degradationThreshold` option (0–1 fraction of `maxClients`). When exceeded, new polling connections are rejected (WS only) and ping interval is doubled for new connections. Server emits `degradation` event on state change.
- **Broadcast**: `server.broadcast(data)` and `server.broadcastExcept(excludeId, data)` methods for sending messages to all connected sockets.
- **Export `RateLimitOptions` and `DegradationEvent`**: Types available from package entry point.

### Cleanup

- **Parser**: Removed unused `BinaryType` type and `_binaryType`/`binaryType` parameters from `decodePacket` and `decodePayload`

### CI/CD

- **Trusted Publishing**: Publish workflow uses NPM OIDC provenance (no `NODE_AUTH_TOKEN` secret required)

## 1.0.2

### New Features

- **Built-in server metrics**: `server.metrics` returns a snapshot with connections, disconnections, activeConnections, upgrades, bytesReceived, bytesSent, errors, and avgRtt
- **Socket RTT measurement**: `socket.rtt` tracks round-trip time from ping/pong cycles (ms)
- **WebSocket backpressure**: Automatically pauses writes when `getBufferedAmount()` exceeds `backpressureThreshold`, resumes on drain
- **`backpressureThreshold` option**: Configurable send buffer limit (default 1MB, set 0 to disable)
- **Export `MetricsSnapshot`**: Type available from package entry point

### Dependencies

- Updated `@types/bun` to 1.3.10, `prettier` to 3.8.1, `socket.io` to 4.8.3, `typescript` peer to ^5.9.2

## 1.0.1

### Performance

- **WebSocket cork()**: Multiple packets are now batched into a single syscall via `ws.cork()` instead of individual sends
- **URL parsing**: `handleRequest()` accepts an optional pre-parsed `URL` to avoid double parsing when used via `handler()`

### New Features

- **`server.close()` returns Promise**: Resolves when all clients have disconnected — enables graceful shutdown
- **`server.sockets` iterator**: Iterate over all connected Socket instances
- **`server.getSocket(id)`**: Look up a specific socket by session ID
- **Export `Socket` and `CloseReason`**: Now available from the package entry point

### CI/CD

- **GitHub Actions**: Added `ci.yml` — runs lint, test, compile on push/PR to main
- **GitHub Actions**: Added `publish.yml` — automated NPM publish on `v*` tag push

## 1.0.0 — Fork from `@socket.io/bun-engine` v0.1.0

### Bug Fixes

- **CORS**: Fixed unsafe non-null assertion on `Origin` header — no longer crashes when the header is missing
- **Polling memory leak**: Pending poll promise now properly resolves on client abort, preventing leaked connections
- **Polling body pre-check**: `Content-Length` is validated against `maxHttpBufferSize` before buffering the full request body
- **Socket upgrade**: `fastUpgradeTimerId` declared before usage in close callback, preventing potential undefined reference
- **Event emitter**: Replaced `@ts-ignore` with proper type assertion

### New Features

- **`clientsCount` getter**: Public API to get the number of connected clients (no more `(engine as any).clientsCount`)
- **`maxClients` option**: Optional limit on concurrent connections — returns HTTP 503 when capacity is reached

### Removed

- **Hono**: Removed as a dependency and from test setup (was only used as an optional test path via `USE_HONO` env)

### Package

- Renamed to `@rvncom/socket-bun-engine`
- Bumped to v1.0.0
- Added `"type": "module"`, `exports` field, `engines: { bun: ">=1.0.0" }`
