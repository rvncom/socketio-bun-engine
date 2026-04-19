/** Represents a single client connection with transport binding and ping/pong keepalive. */

import { EventEmitter } from "./event-emitter";
import { type Packet, type PacketType, type RawData } from "./parser";
import { Transport, TransportError, ReadyState } from "./transport";
import { WS } from "./transports/websocket";
import { type ServerOptions } from "./server";
import { RateLimiter } from "./rate-limiter";
import { byteSize } from "./util";
import { debuglog } from "node:util";

const debug = debuglog("engine.io:socket");

type UpgradeState = "not_upgraded" | "upgrading" | "upgraded";

// this is the format expected by the `socket.io` library
// see https://github.com/socketio/socket.io/blob/cf6816afcff25c227b14ae6981e421bcad5af331/packages/socket.io/lib/socket.ts#L201-L215
export interface HandshakeRequestReference {
  url: string;
  headers: Record<string, string>;
  _query: Record<string, string>;
  connection: {
    encrypted: boolean;
  };
}

export type CloseReason =
  | "transport error"
  | "transport close"
  | "forced close"
  | "ping timeout"
  | "parse error";

interface SocketEvents {
  open: () => void;
  packet: (packet: Packet) => void;
  packetCreate: (packet: Packet) => void;
  data: (data: RawData) => void;
  flush: (writeBuffer: Packet[]) => void;
  drain: () => void;
  heartbeat: () => void;
  upgrading: (transport: Transport) => void;
  upgrade: (transport: Transport) => void;
  close: (reason: CloseReason) => void;
  rateLimited: () => void;
}

const FAST_UPGRADE_INTERVAL_MS = 100;

// Pre-encoded ping packet: Parser.encodePacket({ type: "ping" }, true) === "2"
const ENCODED_PING = "2";
// Pre-encoded pong packet: Parser.encodePacket({ type: "pong" }, true) === "3"
const ENCODED_PONG = "3";

export class Socket extends EventEmitter<
  Record<never, never>,
  Record<never, never>,
  SocketEvents
> {
  public readonly id: string;
  public readyState: ReadyState = ReadyState.OPENING;
  public transport: Transport;
  public readonly request: HandshakeRequestReference;

  private readonly opts: ServerOptions;
  private upgradeState: UpgradeState = "not_upgraded";
  private writeBuffer: Packet[] = [];
  /*
   * Note: using a single timer for all sockets seems to result in a higher CPU consumption than using one timer for each socket
   */
  private pingIntervalTimer?: Timer;
  private pingTimeoutTimer?: Timer;
  private _pingSentAt = 0;
  private rateLimiter?: RateLimiter;
  public rtt = 0;
  /** Set to true when packetCreate listeners are attached (e.g. metrics). */
  public _hasPacketCreateListener = false;
  /** Cached WS transport reference — avoids instanceof check on every write(). */
  private _wsTransport: WS | null = null;

  // Per-socket metrics
  public bytesSent = 0;
  public bytesReceived = 0;
  public messagesSent = 0;
  public messagesReceived = 0;
  public readonly connectedAt = Date.now();

  constructor(
    id: string,
    opts: ServerOptions,
    transport: Transport,
    req: HandshakeRequestReference,
  ) {
    super();

    this.id = id;
    this.opts = opts;

    this.transport = transport;
    this.bindTransport(transport);

    this.request = req;

    if (opts.rateLimit) {
      this.rateLimiter = new RateLimiter(opts.rateLimit);
    }

    this.onOpen();
  }

  /**
   * Called upon transport considered open.
   *
   * @private
   */
  private onOpen() {
    this.readyState = ReadyState.OPEN;

    const upgrades = this.transport.upgradesTo;
    const upgradesStr =
      upgrades.length === 0
        ? "[]"
        : upgrades.length === 1
          ? '["' + upgrades[0] + '"]'
          : JSON.stringify(upgrades);
    this.sendPacket(
      "open",
      '{"sid":"' +
        this.id +
        '","upgrades":' +
        upgradesStr +
        ',"pingInterval":' +
        this.opts.pingInterval +
        ',"pingTimeout":' +
        this.opts.pingTimeout +
        ',"maxPayload":' +
        this.opts.maxHttpBufferSize +
        "}",
    );

    this.emitReserved("open");
    this.schedulePing();
  }

  /**
   * Called upon transport packet.
   *
   * @param packet
   * @private
   */
  private onPacket(packet: Packet) {
    if (this.readyState !== ReadyState.OPEN) {
      debug("packet received with closed socket");
      return;
    }

    debug(`received packet ${packet.type}`);

    this.emitReserved("packet", packet);

    switch (packet.type) {
      case "pong":
        debug("got pong");

        if (this._pingSentAt > 0) {
          this.rtt = Date.now() - this._pingSentAt;
          this._pingSentAt = 0;
        }

        clearTimeout(this.pingTimeoutTimer);
        this.schedulePing();

        this.emitReserved("heartbeat");
        break;

      case "ping":
        debug("got ping from client, sending pong");
        if (this._wsTransport && this._wsTransport.writable) {
          this._wsTransport.sendRaw(ENCODED_PONG);
        } else {
          this.sendPacket("pong");
        }
        break;

      case "message":
        if (this.rateLimiter && !this.rateLimiter.consume()) {
          debug("message dropped: rate limited");
          this.emitReserved("rateLimited");
          break;
        }
        this.messagesReceived++;
        if (packet.data != null) {
          this.bytesReceived += byteSize(packet.data);
        }
        this.emitReserved("data", packet.data!);
        break;

      case "error":
      default:
        this.onClose("parse error");
        break;
    }
  }

  /**
   * Called upon transport error.
   *
   * @param err
   * @private
   */
  private onError(err: TransportError) {
    debug(`transport error: ${err.message}`);
    this.onClose("transport error");
  }

  /**
   * Pings client every `pingInterval` and expects response
   * within `pingTimeout` or closes connection.
   *
   * @private
   */
  private schedulePing() {
    if (this.pingTimeoutTimer) {
      this.pingIntervalTimer?.refresh();
      return;
    }
    this.pingIntervalTimer = setTimeout(() => {
      debug(
        `writing ping packet - expecting pong within ${this.opts.pingTimeout} ms`,
      );
      this._pingSentAt = Date.now();
      // Fast path: send pre-encoded ping directly on WS transport
      if (this._wsTransport && this._wsTransport.writable) {
        this._wsTransport.sendRaw(ENCODED_PING);
      } else {
        this.sendPacket("ping");
      }
      this.resetPingTimeout();
    }, this.opts.pingInterval);
  }

  /**
   * Resets ping timeout.
   *
   * @private
   */
  private resetPingTimeout() {
    clearTimeout(this.pingTimeoutTimer);
    this.pingTimeoutTimer = setTimeout(() => {
      this.onClose("ping timeout");
    }, this.opts.pingTimeout);
  }

  /**
   * Attaches handlers for the given transport.
   *
   * @param transport
   * @private
   */
  private bindTransport(transport: Transport) {
    this.transport = transport;
    this._wsTransport = transport instanceof WS ? transport : null;
    this.transport.once("error", (err) => this.onError(err));
    this.transport.on("packet", (packet) => this.onPacket(packet));
    this.transport.on("drain", () => this.flush());
    this.transport.on("close", () => this.onClose("transport close"));

    // Wire fast-path callback for WS message packets
    if (this._wsTransport) {
      this._wsTransport._onMessageFast = (data) => {
        if (this.readyState !== "open") return;
        if (this.rateLimiter && !this.rateLimiter.consume()) {
          debug("message dropped: rate limited");
          this.emitReserved("rateLimited");
          return;
        }
        this.messagesReceived++;
        if (data != null) {
          this.bytesReceived += byteSize(data);
        }
        this.emitReserved("data", data!);
      };
    }
  }

  /**
   * Upgrades socket to the given transport
   *
   * @param transport
   * @private
   */
  /* private */ _maybeUpgrade(transport: Transport) {
    if (this.upgradeState === "upgrading") {
      debug("transport has already been trying to upgrade");
      return transport.close();
    } else if (this.upgradeState === "upgraded") {
      debug("transport has already been upgraded");
      return transport.close();
    }

    debug("upgrading existing transport");
    this.upgradeState = "upgrading";

    const timeoutId = setTimeout(() => {
      debug("client did not complete upgrade - closing transport");
      const state = transport.getReadyState();
      if (
        transport.writable &&
        state !== ReadyState.CLOSED &&
        state !== ReadyState.CLOSING
      ) {
        transport.close();
      }
    }, this.opts.upgradeTimeout);

    let fastUpgradeTimerId: Timer | undefined;

    transport.on("close", () => {
      clearTimeout(timeoutId);
      clearInterval(fastUpgradeTimerId);
      transport.off();
    });

    // we need to make sure that no packets gets lost during the upgrade, so the client does not cancel the HTTP
    // long-polling request itself, instead the server sends a "noop" packet to cleanly end any ongoing polling request
    const sendNoopPacket = () => {
      if (this.transport.name === "polling" && this.transport.writable) {
        debug("writing a noop packet to polling for fast upgrade");
        this.transport.send([{ type: "noop" }]);
      }
    };

    transport.on("packet", (packet) => {
      if (packet.type === "ping" && packet.data === "probe") {
        debug("got probe ping packet, sending pong");
        transport.send([{ type: "pong", data: "probe" }]);

        sendNoopPacket();
        fastUpgradeTimerId = setInterval(
          sendNoopPacket,
          FAST_UPGRADE_INTERVAL_MS,
        );

        this.emitReserved("upgrading", transport);
      } else if (
        packet.type === "upgrade" &&
        this.readyState !== ReadyState.CLOSED
      ) {
        debug("got upgrade packet - upgrading");

        this.upgradeState = "upgraded";

        clearTimeout(timeoutId);
        clearInterval(fastUpgradeTimerId);

        // Bind new transport before closing old to prevent buffer loss
        const oldTransport = this.transport;
        transport.off();
        this.bindTransport(transport);
        oldTransport.off();
        oldTransport.close();

        this.emitReserved("upgrade", transport);
        this.flush();
      } else {
        debug("invalid upgrade packet");

        clearTimeout(timeoutId);
        transport.close();
      }
    });
  }

  /**
   * Called upon transport considered closed.
   *
   * @param reason
   * @private
   */
  private onClose(reason: CloseReason) {
    if (this.readyState === ReadyState.CLOSED) {
      return;
    }
    debug(`socket closed due to ${reason}`);

    this.readyState = ReadyState.CLOSED;
    clearTimeout(this.pingIntervalTimer);
    clearTimeout(this.pingTimeoutTimer);
    this.rateLimiter?.destroy();

    this.closeTransport();
    this.emitReserved("close", reason);
  }

  /**
   * Sends a "message" packet.
   *
   * @param data
   */
  /**
   * Writes a message packet to the client.
   * Uses fast-path direct send on WebSocket when possible, bypassing packet allocation
   * and buffering when the transport is writable and no metrics listeners are attached.
   *
   * @param data - The message data to send (string or Buffer)
   * @returns This socket instance for chaining
   */
  public write(data: RawData): Socket {
    const state = this.readyState;
    if (state === ReadyState.CLOSING || state === ReadyState.CLOSED) {
      return this;
    }
    const wst = this._wsTransport;
    if (
      wst !== null &&
      !this._hasPacketCreateListener &&
      wst.writable &&
      this.writeBuffer.length === 0
    ) {
      if (wst.sendMessage(data)) {
        this.messagesSent++;
        this.bytesSent += byteSize(data);
        return this;
      }
    }
    this.sendPacket("message", data);
    return this;
  }

  /**
   * Sends a packet.
   *
   * @param type
   * @param data
   * @private
   */
  private sendPacket(type: PacketType, data?: RawData) {
    const state = this.readyState;
    if (state === ReadyState.CLOSING || state === ReadyState.CLOSED) {
      return;
    }

    debug(`sending packet ${type} (${data})`);

    if (type === "message") {
      this.messagesSent++;
      if (data != null) {
        this.bytesSent += byteSize(data);
      }
    }

    const packet: Packet = {
      type,
      data,
    };

    if (this._hasPacketCreateListener) {
      this.emitReserved("packetCreate", packet);
    }

    this.writeBuffer.push(packet);

    this.flush();
  }

  /**
   * Attempts to flush the packets buffer.
   *
   * @private
   */
  private flush() {
    const shouldFlush =
      this.readyState !== ReadyState.CLOSED &&
      this.transport.writable &&
      this.writeBuffer.length > 0;

    if (!shouldFlush) {
      return;
    }

    debug(
      `[socket] flushing buffer with ${this.writeBuffer.length} packet(s) to transport`,
    );

    this.emitReserved("flush", this.writeBuffer);

    const buffer = this.writeBuffer;
    this.writeBuffer = [];

    this.transport.send(buffer);
    this.emitReserved("drain");
  }

  /**
   * Closes the socket and underlying transport.
   */
  public close() {
    if (this.readyState !== ReadyState.OPEN) {
      return;
    }

    this.readyState = ReadyState.CLOSING;

    const close = () => {
      this.closeTransport();
      this.onClose("forced close");
    };

    if (this.writeBuffer.length) {
      debug(`buffer not empty, waiting for the drain event`);
      this.once("drain", close);
    } else {
      close();
    }
  }

  /**
   * Closes the underlying transport.
   *
   * @private
   */
  private closeTransport() {
    this.transport.off();
    this.transport.close();
  }
}
