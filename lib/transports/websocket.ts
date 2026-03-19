import { Transport } from "../transport";
import { type Packet, Parser, type RawData } from "../parser";
import { debuglog } from "node:util";

const debug = debuglog("engine.io:websocket");

export type WebSocketData = {
  transport: WS;
};

export type BunWebSocket = Bun.ServerWebSocket<WebSocketData>;

export class WS extends Transport {
  private socket?: BunWebSocket;
  private readonly _checkBackpressure: boolean;

  /**
   * Fast-path callback for message packets (type "4").
   * Set by Socket.bindTransport() to bypass the full event chain.
   */
  public _onMessageFast?: (data: RawData | undefined) => void;

  constructor(opts: import("../server").ServerOptions) {
    super(opts);
    this._checkBackpressure = opts.backpressureThreshold > 0;
  }

  public get name() {
    return "websocket";
  }

  public get upgradesTo(): string[] {
    return [];
  }

  public send(packets: Packet[]) {
    if (
      !this.writable ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    if (packets.length === 1) {
      this.socket.send(Parser.encodePacket(packets[0]!, true));
    } else {
      // Batch multiple packets into a single syscall via cork()
      this.socket.cork(() => {
        for (const packet of packets) {
          this.socket!.send(Parser.encodePacket(packet, true));
        }
      });
    }

    // Check backpressure after send (skip entirely when disabled)
    if (
      this._checkBackpressure &&
      this.socket.getBufferedAmount() > this.opts.backpressureThreshold
    ) {
      debug("backpressure: buffer full after send, pausing writes");
      this.writable = false;
    }
  }

  /**
   * Sends a message directly — encodes inline as "4" + data.
   * Bypasses Packet allocation, writeBuffer, flush, and event emission.
   * Returns true if sent, false otherwise.
   */
  public sendMessage(data: RawData): boolean {
    if (
      !this.writable ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return false;
    }

    this.socket.send(typeof data === "string" ? "4" + data : data);

    if (
      this._checkBackpressure &&
      this.socket.getBufferedAmount() > this.opts.backpressureThreshold
    ) {
      debug("backpressure: buffer full after sendMessage, pausing writes");
      this.writable = false;
    }

    return true;
  }

  /**
   * Sends pre-encoded data directly — bypasses packet creation, event emission, and buffering.
   * Used by Server.broadcast() for zero-copy broadcasting.
   */
  public sendRaw(encoded: RawData) {
    if (
      !this.writable ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    this.socket.send(encoded);

    if (
      this._checkBackpressure &&
      this.socket.getBufferedAmount() > this.opts.backpressureThreshold
    ) {
      debug("backpressure: buffer full after sendRaw, pausing writes");
      this.writable = false;
    }
  }

  protected doClose() {
    this.socket?.close();
  }

  public onOpen(socket: BunWebSocket) {
    debug("on open");
    this.socket = socket;
    this.writable = true;
  }

  public onMessage(message: RawData) {
    debug("on message");

    // Resume writes if backpressure cleared (skip check when disabled)
    if (
      !this.writable &&
      this._checkBackpressure &&
      this.socket &&
      this.socket.getBufferedAmount() <= this.opts.backpressureThreshold
    ) {
      debug("backpressure: buffer drained, resuming writes");
      this.writable = true;
      this.emitReserved("drain");
    }

    // Fast path: string message starting with "4" (message type) — skip full decode/event chain
    if (
      this._onMessageFast &&
      typeof message === "string" &&
      message.charCodeAt(0) === 52
    ) {
      this._onMessageFast(
        message.length > 1 ? message.substring(1) : undefined,
      );
      return;
    }

    this.onPacket(Parser.decodePacket(message));
  }

  public onCloseEvent(_code: number, _message: string) {
    debug("on close");
    this.onClose();
  }
}
