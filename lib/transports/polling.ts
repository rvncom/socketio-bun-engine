/** HTTP long-polling transport — manages poll/data request cycle. */

import { Transport, ReadyState } from "../transport";
import { type Packet, Parser } from "../parser";
import { debuglog } from "node:util";

const debug = debuglog("engine.io:polling");

export class Polling extends Transport {
  private pollingPromise?: {
    resolve: (res: Response) => void;
    reject: (reason?: string) => void;
    responseHeaders: Headers;
    timeoutId?: Timer;
  };

  /** Transport name identifier. */
  public get name() {
    return "polling";
  }

  /** Transports this can upgrade to. */
  public get upgradesTo(): string[] {
    return ["websocket"];
  }

  /** Dispatches incoming HTTP request to poll or data handler. */
  public onRequest(req: Request, responseHeaders: Headers): Promise<Response> {
    if (req.method === "GET") {
      return this.onPollRequest(req, responseHeaders);
    } else if (req.method === "POST") {
      return this.onDataRequest(req, responseHeaders);
    }
    return Promise.resolve(
      new Response(null, { status: 400, headers: responseHeaders }),
    );
  }

  /**
   * The client sends a long-polling request awaiting the server to send data.
   *
   * @param req
   * @param responseHeaders
   * @private
   */
  private onPollRequest(
    req: Request,
    responseHeaders: Headers,
  ): Promise<Response> {
    if (this.pollingPromise) {
      debug("request overlap");
      this.onError("overlap from client");
      return Promise.resolve(
        new Response(null, { status: 400, headers: responseHeaders }),
      );
    }

    debug("new polling request");

    return new Promise<Response>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pollingPromise) {
          debug("polling request timeout");
          this.pollingPromise = undefined;
          this.writable = false;
          this.onError("polling timeout");
          reject("timeout");
        }
      }, this.opts.pollingTimeout);

      this.pollingPromise = { resolve, reject, responseHeaders, timeoutId };

      req.signal.addEventListener("abort", () => {
        if (this.pollingPromise) {
          clearTimeout(this.pollingPromise.timeoutId);
          this.pollingPromise = undefined;
          this.writable = false;
        }
        this.onError("polling request aborted");
      });

      debug("transport is now writable");
      this.writable = true;
      this.emitReserved("drain");
    });
  }

  /**
   * The client sends a request with data.
   *
   * @param req
   * @param responseHeaders
   */
  private async onDataRequest(
    req: Request,
    responseHeaders: Headers,
  ): Promise<Response> {
    debug("new data request");

    req.signal.addEventListener("abort", () => {
      this.onError("data request aborted");
    });

    const contentType = req.headers.get("content-type");
    if (contentType) {
      const baseType = contentType.split(";")[0]?.trim().toLowerCase();
      if (
        baseType &&
        baseType !== "text/plain" &&
        baseType !== "application/octet-stream"
      ) {
        this.onError("invalid content-type");
        return new Response(null, { status: 400, headers: responseHeaders });
      }
    }

    const contentLength = req.headers.get("content-length");
    if (contentLength) {
      const length = parseInt(contentLength, 10);
      // Check for NaN (malformed header) or leading zeros bypass
      if (isNaN(length) || length.toString() !== contentLength.trim()) {
        this.onError("invalid content-length");
        return new Response(null, { status: 400, headers: responseHeaders });
      }
      if (!(length <= this.opts.maxHttpBufferSize)) {
        this.onError("payload too large");
        return new Response(null, { status: 413, headers: responseHeaders });
      }
    }

    let data: string;
    try {
      data = await req.text();
    } catch {
      this.onError("data request connection lost");
      return new Response(null, { status: 400, headers: responseHeaders });
    }

    if (data.length > this.opts.maxHttpBufferSize) {
      this.onError("payload too large");
      return new Response(null, { status: 413, headers: responseHeaders });
    }

    const packets = Parser.decodePayload(data);

    debug(`decoded ${packets.length} packet(s)`);

    for (const packet of packets) {
      this.onPacket(packet);
    }

    return new Response("ok", {
      status: 200,
      headers: responseHeaders,
    });
  }

  /** Encodes packets and writes as polling response. */
  public send(packets: Packet[]) {
    this.writable = false;
    this.write(Parser.encodePayload(packets));
  }

  /**
   * Writes data as response to long-polling request
   *
   * @param data
   * @private
   */
  private write(data: string) {
    debug(`writing ${data}`);

    if (!this.pollingPromise) {
      return;
    }

    clearTimeout(this.pollingPromise.timeoutId);

    const headers = this.pollingPromise.responseHeaders;
    headers.set("Content-Type", "text/plain; charset=UTF-8");

    this.pollingPromise.resolve(
      new Response(data, {
        status: 200,
        headers,
      }),
    );

    this.pollingPromise = undefined;
  }

  protected doClose() {
    if (this.writable) {
      debug("transport writable - closing right away");
      // if we have received a "close" packet from the client, then we can just send a "noop" packet back
      this.send([
        { type: this.readyState === ReadyState.CLOSING ? "close" : "noop" },
      ]);
    } else if (this.pollingPromise) {
      // Clear timeout if there's a pending polling request
      clearTimeout(this.pollingPromise.timeoutId);
      this.pollingPromise = undefined;
    }

    this.onClose();
  }
}
