/** Engine.IO server — HTTP routing, WebSocket lifecycle, and client management. */

import { EventEmitter } from "./event-emitter";
import { Socket } from "./socket";
import { Polling } from "./transports/polling";
import {
  WS,
  type BunWebSocket,
  type WebSocketData,
} from "./transports/websocket";
import { addCorsHeaders, type CorsOptions } from "./cors";
import { Transport } from "./transport";
import { generateId, byteSize } from "./util";
import { Parser, type RawData } from "./parser";
import { ServerMetrics, type MetricsSnapshot } from "./metrics";
import { type RateLimitOptions } from "./rate-limiter";
import { debuglog } from "node:util";

const debug = debuglog("engine.io");

const TRANSPORTS = ["polling", "websocket"];

export interface ServerOptions {
  /**
   * Name of the request path to handle
   * @default "/engine.io/"
   */
  path: string;
  /**
   * Duration in milliseconds without a pong packet to consider the connection closed
   * @default 20000
   */
  pingTimeout: number;
  /**
   * Duration in milliseconds before sending a new ping packet
   * @default 25000
   */
  pingInterval: number;
  /**
   * Duration in milliseconds before an uncompleted transport upgrade is cancelled
   * @default 10000
   */
  upgradeTimeout: number;
  /**
   * Duration in milliseconds before a polling request times out
   * @default 60000 (60 seconds)
   */
  pollingTimeout: number;
  /**
   * Maximum size in bytes or number of characters a message can be, before closing the session (to avoid DoS).
   * @default 1e6 (1 MB)
   */
  maxHttpBufferSize: number;
  /**
   * Maximum number of concurrent clients. Set to 0 for unlimited.
   * @default 0
   */
  maxClients: number;
  /**
   * WebSocket send buffer threshold in bytes for backpressure. Set to 0 to disable.
   * @default 1048576 (1 MB)
   */
  backpressureThreshold: number;
  /**
   * Per-socket message rate limiting. Disabled by default.
   */
  rateLimit?: RateLimitOptions;
  /**
   * Enable WebSocket per-message deflate compression (RFC 7692).
   * Pass `true` for defaults or an object with `compress`/`decompress` options.
   * @default false
   */
  perMessageDeflate?:
    | boolean
    | {
        compress?: Bun.WebSocketCompressor | boolean;
        decompress?: Bun.WebSocketCompressor | boolean;
      };
  /**
   * Enable per-message byte counting metrics. When false, only connection/disconnection
   * counters are tracked (cheap increments). Per-message byte metrics are activated lazily
   * on first `server.metrics` access or when set to true.
   * @default false
   */
  enableMetrics?: boolean;
  /**
   * Fraction (0–1) of maxClients at which graceful degradation activates.
   * Requires maxClients > 0. Set to 0 to disable (default).
   * @default 0
   */
  degradationThreshold: number;
  /**
   * A function that receives a given handshake or upgrade request as its first parameter,
   * and can decide whether to continue or not.
   */
  allowRequest?: (
    req: Request,
    server: Bun.Server<WebSocketData>,
  ) => Promise<void>;
  /**
   * The options related to Cross-Origin Resource Sharing (CORS)
   */
  cors?: CorsOptions;
  /**
   * A function that allows to edit the response headers of the handshake request
   */
  editHandshakeHeaders?: (
    responseHeaders: Headers,
    req: Request,
    server: Bun.Server<WebSocketData>,
  ) => void | Promise<void>;
  /**
   * A function that allows to edit the response headers of all requests
   */
  editResponseHeaders?: (
    responseHeaders: Headers,
    req: Request,
    server: Bun.Server<WebSocketData>,
  ) => void | Promise<void>;
}

interface ConnectionError {
  req: Request;
  code: number;
  message: string;
  context: Record<string, unknown>;
}

export interface DegradationEvent {
  active: boolean;
  clients: number;
}

interface ServerReservedEvents {
  connection: (
    socket: Socket,
    request: Request,
    server: Bun.Server<WebSocketData>,
  ) => void;
  connection_error: (err: ConnectionError) => void;
  degradation: (event: DegradationEvent) => void;
  shutdown: () => void;
}

const enum ERROR_CODES {
  UNKNOWN_TRANSPORT = 0,
  UNKNOWN_SID,
  BAD_HANDSHAKE_METHOD,
  BAD_REQUEST,
  FORBIDDEN,
  UNSUPPORTED_PROTOCOL_VERSION,
}

const ERROR_MESSAGES = new Map<ERROR_CODES, string>([
  [ERROR_CODES.UNKNOWN_TRANSPORT, "Transport unknown"],
  [ERROR_CODES.UNKNOWN_SID, "Session ID unknown"],
  [ERROR_CODES.BAD_HANDSHAKE_METHOD, "Bad handshake method"],
  [ERROR_CODES.BAD_REQUEST, "Bad request"],
  [ERROR_CODES.FORBIDDEN, "Forbidden"],
  [ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version"],
]);

export class Server extends EventEmitter<
  Record<never, never>,
  Record<never, never>,
  ServerReservedEvents
> {
  public readonly opts: ServerOptions;

  private readonly clients: Map<string, Socket> = new Map();
  private readonly _metrics = new ServerMetrics();
  private _degraded = false;
  private _draining = false;
  private _metricsEnabled = false;
  private readonly _metricsAttached = new WeakSet<Socket>();
  private readonly _startTime = Date.now();

  public get clientsCount(): number {
    return this.clients.size;
  }

  public get draining(): boolean {
    return this._draining;
  }

  /**
   * Returns a snapshot of server metrics.
   * On first access (when enableMetrics is not true), lazily activates
   * per-message byte counting on all existing sockets.
   */
  public get metrics(): MetricsSnapshot {
    if (!this._metricsEnabled) {
      this._metricsEnabled = true;
      for (const socket of this.clients.values()) {
        this._attachMetricsListeners(socket);
      }
    }
    return this._metrics.snapshot();
  }

  constructor(opts: Partial<ServerOptions> = {}) {
    super();

    if (typeof Bun === "undefined") {
      throw new Error(
        "@rvncom/socketio-bun-engine requires the Bun runtime. Please use Bun to run this package.",
      );
    }

    this.opts = Object.assign(
      {
        path: "/engine.io/",
        pingTimeout: 20000,
        pingInterval: 25000,
        upgradeTimeout: 10000,
        pollingTimeout: 60000,
        maxHttpBufferSize: 1e6,
        maxClients: 0,
        backpressureThreshold: 1_048_576,
        degradationThreshold: 0,
      },
      opts,
    );

    if (this.opts.pingInterval < 0) {
      throw new RangeError("pingInterval must be non-negative");
    }
    if (this.opts.pingTimeout < 0) {
      throw new RangeError("pingTimeout must be non-negative");
    }
    if (this.opts.upgradeTimeout < 0) {
      throw new RangeError("upgradeTimeout must be non-negative");
    }
    if (this.opts.pollingTimeout < 0) {
      throw new RangeError("pollingTimeout must be non-negative");
    }
    if (this.opts.maxHttpBufferSize < 0) {
      throw new RangeError("maxHttpBufferSize must be non-negative");
    }
    if (this.opts.maxClients < 0) {
      throw new RangeError("maxClients must be non-negative");
    }
    if (this.opts.backpressureThreshold < 0) {
      throw new RangeError("backpressureThreshold must be non-negative");
    }
    if (
      this.opts.degradationThreshold < 0 ||
      this.opts.degradationThreshold > 1
    ) {
      throw new RangeError("degradationThreshold must be between 0 and 1");
    }

    this._metricsEnabled = this.opts.enableMetrics === true;
  }

  private _attachMetricsListeners(socket: Socket) {
    if (this._metricsAttached.has(socket)) return;
    this._metricsAttached.add(socket);
    socket._hasPacketCreateListener = true;

    socket.on("data", (data) => {
      this._metrics.onBytesReceived(
        typeof data === "string"
          ? data.length
          : Buffer.isBuffer(data)
            ? data.byteLength
            : 0,
      );
    });

    socket.on("packetCreate", (packet) => {
      if (packet.data != null) {
        this._metrics.onBytesSent(
          typeof packet.data === "string"
            ? packet.data.length
            : Buffer.isBuffer(packet.data)
              ? packet.data.byteLength
              : 0,
        );
      }
    });

    socket.on("heartbeat", () => {
      if (socket.rtt > 0) {
        this._metrics.onRtt(socket.rtt);
      }
    });

    socket.on("upgrade", () => {
      this._metrics.onUpgrade();
      // Update transport counts: polling → websocket
      this._metrics.onPollingDisconnection();
      this._metrics.onWebSocketConnection();
    });
  }

  /**
   * Handles an HTTP request.
   *
   * @param req
   * @param server
   */
  public async handleRequest(
    req: Request,
    server: Bun.Server<WebSocketData>,
    _url?: URL,
  ): Promise<Response> {
    const url = _url ?? new URL(req.url);

    debug(`handling ${req.method} ${req.url}`);

    const responseHeaders = new Headers();
    if (this.opts.cors) {
      addCorsHeaders(responseHeaders, this.opts.cors, req);

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: responseHeaders });
      }
    }

    if (this.opts.editResponseHeaders) {
      try {
        await this.opts.editResponseHeaders(responseHeaders, req, server);
      } catch (err) {
        debug("editResponseHeaders threw: %O", err);
      }
    }

    try {
      await this.verify(req, url);
    } catch (err) {
      const { code, context } = err as {
        code: ERROR_CODES;
        context: Record<string, unknown>;
      };
      const message = ERROR_MESSAGES.get(code)!;
      this._metrics.onError();
      this.emitReserved("connection_error", {
        req,
        code,
        message,
        context,
      });
      const body = JSON.stringify({
        code,
        message,
      });
      responseHeaders.set("Content-Type", "application/json");
      return new Response(body, {
        status: 400,
        headers: responseHeaders,
      });
    }

    if (this.opts.allowRequest) {
      try {
        await this.opts.allowRequest(req, server);
      } catch (reason) {
        this.emitReserved("connection_error", {
          req,
          code: ERROR_CODES.FORBIDDEN,
          message: ERROR_MESSAGES.get(ERROR_CODES.FORBIDDEN)!,
          context: {
            message: reason,
          },
        });
        const body = JSON.stringify({
          code: ERROR_CODES.FORBIDDEN,
          message: reason,
        });
        responseHeaders.set("Content-Type", "application/json");
        return new Response(body, {
          status: 403,
          headers: responseHeaders,
        });
      }
    }

    const sid = url.searchParams.get("sid");
    if (sid) {
      const socket = this.clients.get(sid);
      if (!socket) {
        return new Response(null, { status: 400, headers: responseHeaders });
      }

      if (req.headers.has("upgrade")) {
        const transport = new WS(this.opts);

        const isSuccess = server.upgrade(req, {
          headers: responseHeaders,
          data: {
            transport,
          },
        });

        debug(`upgrade was successful: ${isSuccess}`);

        if (!isSuccess) {
          return new Response(null, { status: 500 });
        }

        socket._maybeUpgrade(transport);
        return new Response(null);
      }

      debug("setting new request for existing socket");

      return (socket.transport as Polling).onRequest(req, responseHeaders);
    } else {
      return this.handshake(req, server, url, responseHeaders);
    }
  }

  public onWebSocketOpen(ws: BunWebSocket) {
    debug("on ws open");
    ws.data.transport.onOpen(ws);
  }

  public onWebSocketMessage(ws: BunWebSocket, message: RawData) {
    debug("on ws message");
    ws.data.transport.onMessage(message);
  }

  public onWebSocketClose(ws: BunWebSocket, code: number, message: string) {
    debug("on ws close");
    ws.data.transport.onCloseEvent(code, message);
  }

  /**
   * Verifies a request.
   *
   * @param req
   * @param url
   * @private
   */
  private verify(req: Request, url: URL): Promise<void> {
    const transport = url.searchParams.get("transport") || "";
    if (!TRANSPORTS.includes(transport)) {
      debug(`unknown transport "${transport}"`);
      return Promise.reject({
        code: ERROR_CODES.UNKNOWN_TRANSPORT,
        context: {
          transport,
        },
      });
    }

    const sid = url.searchParams.get("sid");
    if (sid) {
      const client = this.clients.get(sid);
      if (!client) {
        debug(`unknown client with sid ${sid}`);
        return Promise.reject({
          code: ERROR_CODES.UNKNOWN_SID,
          context: {
            sid,
          },
        });
      }
      const previousTransport = client.transport.name;
      if (previousTransport === "websocket") {
        debug("unexpected transport without upgrade");
        return Promise.reject({
          code: ERROR_CODES.BAD_REQUEST,
          context: {
            name: "TRANSPORT_MISMATCH",
            transport,
            previousTransport,
          },
        });
      }
    } else {
      // handshake is GET only
      if (req.method !== "GET") {
        return Promise.reject({
          code: ERROR_CODES.BAD_HANDSHAKE_METHOD,
          context: {
            method: req.method,
          },
        });
      }

      const protocol = url.searchParams.get("EIO") === "4" ? 4 : 3; // 3rd revision by default
      if (protocol === 3) {
        return Promise.reject({
          code: ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
          context: {
            protocol,
          },
        });
      }
    }

    return Promise.resolve();
  }

  /**
   * Handshakes a new client.
   *
   * @param req
   * @param server
   * @param url
   * @param responseHeaders
   * @private
   */
  private async handshake(
    req: Request,
    server: Bun.Server<WebSocketData>,
    url: URL,
    responseHeaders: Headers,
  ): Promise<Response> {
    if (this._draining) {
      responseHeaders.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify({
          code: ERROR_CODES.FORBIDDEN,
          message: "Server shutting down",
        }),
        { status: 503, headers: responseHeaders },
      );
    }

    if (this.opts.maxClients > 0 && this.clients.size >= this.opts.maxClients) {
      this.emitReserved("connection_error", {
        req,
        code: ERROR_CODES.FORBIDDEN,
        message: `Server capacity reached (${this.clients.size}/${this.opts.maxClients})`,
        context: {
          maxClients: this.opts.maxClients,
          currentClients: this.clients.size,
        },
      });
      responseHeaders.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify({
          code: ERROR_CODES.FORBIDDEN,
          message: `Server capacity reached (${this.clients.size}/${this.opts.maxClients})`,
        }),
        { status: 503, headers: responseHeaders },
      );
    }

    const id = generateId();

    // Graceful degradation: use cached flag (updated on connect/disconnect)

    if (this.opts.editHandshakeHeaders) {
      try {
        await this.opts.editHandshakeHeaders(responseHeaders, req, server);
      } catch (err) {
        debug("editHandshakeHeaders threw: %O", err);
      }
    }

    let isUpgrade = req.headers.has("upgrade");

    // Under degradation, reject new polling connections (WebSocket only)
    if (this._degraded && !isUpgrade) {
      this.emitReserved("connection_error", {
        req,
        code: ERROR_CODES.FORBIDDEN,
        message: "Degraded mode: only WebSocket connections accepted",
        context: { degraded: true },
      });
      responseHeaders.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify({
          code: ERROR_CODES.FORBIDDEN,
          message: "Degraded mode: only WebSocket connections accepted",
        }),
        { status: 503, headers: responseHeaders },
      );
    }

    let transport: Transport;
    if (isUpgrade) {
      transport = new WS(this.opts);

      const isSuccess = server.upgrade(req, {
        headers: responseHeaders,
        data: {
          transport: transport as WS,
        },
      });

      if (!isSuccess) {
        return new Response(null, { status: 500 });
      }
    } else {
      transport = new Polling(this.opts);
    }

    debug(`new socket ${id}`);

    const socketOpts = this._degraded
      ? { ...this.opts, pingInterval: this.opts.pingInterval * 2 }
      : this.opts;

    const request: import("./socket").HandshakeRequestReference = {
      url: req.url,
      _query: Object.fromEntries(url.searchParams.entries()),
      connection: {
        encrypted: url.protocol === "https:" || url.protocol === "wss:",
      },
      get headers() {
        const h = Object.fromEntries(req.headers.entries());
        Object.defineProperty(this, "headers", { value: h });
        return h;
      },
    };

    const socket = new Socket(id, socketOpts, transport, request);

    this.clients.set(id, socket);
    this._metrics.onConnection();

    // Track transport type
    if (transport.name === "polling") {
      this._metrics.onPollingConnection();
    } else if (transport.name === "websocket") {
      this._metrics.onWebSocketConnection();
    }

    this.updateDegradationState();

    if (this._metricsEnabled) {
      this._attachMetricsListeners(socket);
    }

    socket.once("close", (reason) => {
      debug(`socket ${id} closed due to ${reason}`);
      this.clients.delete(id);
      this._metrics.onDisconnection();

      // Track transport type on disconnect
      if (socket.transport.name === "polling") {
        this._metrics.onPollingDisconnection();
      } else if (socket.transport.name === "websocket") {
        this._metrics.onWebSocketDisconnection();
      }

      this.updateDegradationState();
    });

    if (isUpgrade) {
      this.emitReserved("connection", socket, req, server);
      return new Response(null);
    }

    const promise = (transport as Polling).onRequest(req, responseHeaders);

    this.emitReserved("connection", socket, req, server);

    return promise;
  }

  /**
   * Returns an iterator over all connected sockets.
   */
  public get sockets(): IterableIterator<Socket> {
    return this.clients.values();
  }

  /**
   * Returns the socket with the given id, if any.
   */
  public getSocket(id: string): Socket | undefined {
    return this.clients.get(id);
  }

  /**
   * Returns whether the server is currently in degraded mode.
   */
  public get degraded(): boolean {
    return this._degraded;
  }

  /**
   * Returns a health check object with server status information.
   * Useful for monitoring and load balancer health checks.
   */
  public healthCheck(): {
    status: "ok" | "degraded" | "draining";
    connections: number;
    uptime: number;
    metrics: MetricsSnapshot;
  } {
    return {
      status: this._draining ? "draining" : this._degraded ? "degraded" : "ok",
      connections: this.clients.size,
      uptime: Date.now() - this._startTime,
      metrics: this._metrics.snapshot(),
    };
  }

  /**
   * Sends a message to all connected sockets.
   * Encodes the packet once and sends the pre-encoded data to WebSocket transports (zero-copy).
   * Polling transports fall back to the normal socket.write() path.
   */
  public broadcast(data: RawData): void {
    if (data == null) {
      throw new TypeError("broadcast data cannot be null or undefined");
    }
    const clientsSize = this.clients.size;
    if (clientsSize === 0) return;

    const encoded = Parser.encodePacket({ type: "message", data }, true);
    const size = byteSize(data);

    for (const socket of this.clients.values()) {
      const transport = socket.transport;
      if (transport.name === "websocket") {
        (transport as WS).sendRaw(encoded);
        socket.messagesSent++;
        socket.bytesSent += size;
      } else {
        socket.write(data);
      }
    }
  }

  /**
   * Sends a message to all connected sockets except the one with the given id.
   * Encodes the packet once and sends the pre-encoded data to WebSocket transports (zero-copy).
   * Polling transports fall back to the normal socket.write() path.
   */
  public broadcastExcept(excludeId: string, data: RawData): void {
    if (data == null) {
      throw new TypeError("broadcast data cannot be null or undefined");
    }
    const clientsSize = this.clients.size;
    if (clientsSize === 0) return;

    const encoded = Parser.encodePacket({ type: "message", data }, true);
    const size = byteSize(data);

    for (const [id, socket] of this.clients) {
      if (id !== excludeId) {
        const transport = socket.transport;
        if (transport.name === "websocket") {
          (transport as WS).sendRaw(encoded);
          socket.messagesSent++;
          socket.bytesSent += size;
        } else {
          socket.write(data);
        }
      }
    }
  }

  private updateDegradationState() {
    const { degradationThreshold, maxClients } = this.opts;
    if (degradationThreshold <= 0 || maxClients <= 0) return;
    const degraded = this.clients.size / maxClients >= degradationThreshold;
    if (degraded !== this._degraded) {
      this._degraded = degraded;
      this.emitReserved("degradation", {
        active: degraded,
        clients: this.clients.size,
      });
    }
  }

  /**
   * Gracefully shuts down the server: stops accepting new connections,
   * closes all existing clients, and resolves when done or on timeout.
   */
  public shutdown(opts?: { timeout?: number }): Promise<void> {
    this._draining = true;
    const timeout = opts?.timeout ?? 10000;

    return new Promise<void>((resolve) => {
      if (this.clients.size === 0) {
        this.emitReserved("shutdown");
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        // Force-close any remaining clients
        this.clients.forEach((client) => {
          client.close();
        });
        this.emitReserved("shutdown");
        resolve();
      }, timeout);

      let remaining = this.clients.size;
      const onClose = () => {
        if (--remaining === 0) {
          clearTimeout(timer);
          this.emitReserved("shutdown");
          resolve();
        }
      };

      this.clients.forEach((client) => {
        client.once("close", onClose);
        client.close();
      });
    });
  }

  /**
   * Closes all clients and returns a Promise that resolves when all are closed.
   */
  public close(): Promise<void> {
    debug("closing all open clients");
    if (this.clients.size === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let remaining = this.clients.size;
      const onClose = () => {
        if (--remaining === 0) {
          resolve();
        }
      };
      this.clients.forEach((client) => {
        client.once("close", onClose);
        client.close();
      });
    });
  }

  /**
   * Creates a request handler.
   *
   * @example
   * Bun.serve({
   *   port: 3000,
   *   ...engine.handler()
   * });
   *
   * // expanded
   * Bun.serve({
   *   port: 3000,
   *
   *   fetch(req, server) {
   *     return engine.handleRequest(req, server);
   *   },
   *
   *   websocket: {
   *     open(ws: BunWebSocket) {
   *       engine.onWebSocketOpen(ws);
   *     },
   *
   *     message(ws: BunWebSocket, message: RawData) {
   *       engine.onWebSocketMessage(ws, message);
   *     },
   *
   *     close(ws: BunWebSocket, code: number, message: string) {
   *       engine.onWebSocketClose(ws, code, message);
   *     },
   *   },
   * });
   */
  public handler() {
    const idleTimeoutInSeconds = Math.ceil((2 * this.opts.pingInterval) / 1000);

    return {
      fetch: (req: Request, server: Bun.Server<WebSocketData>) => {
        const url = new URL(req.url);

        if (url.pathname === this.opts.path) {
          return this.handleRequest(req, server, url);
        } else {
          return new Response(null, { status: 404 });
        }
      },

      websocket: {
        open: (ws: BunWebSocket) => {
          this.onWebSocketOpen(ws);
        },
        message: (ws: BunWebSocket, message: RawData) => {
          this.onWebSocketMessage(ws, message);
        },
        close: (ws: BunWebSocket, code: number, message: string) => {
          this.onWebSocketClose(ws, code, message);
        },
        maxPayloadLength: this.opts.maxHttpBufferSize,
        perMessageDeflate: this.opts.perMessageDeflate ?? false,
      },

      idleTimeout: idleTimeoutInSeconds,
      maxRequestBodySize: this.opts.maxHttpBufferSize,
    };
  }
}
