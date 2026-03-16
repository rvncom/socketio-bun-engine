# Changelog

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
