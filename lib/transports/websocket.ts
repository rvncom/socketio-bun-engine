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

    this.onPacket(Parser.decodePacket(message));
  }

  public onCloseEvent(_code: number, _message: string) {
    debug("on close");
    this.onClose();
  }
}
