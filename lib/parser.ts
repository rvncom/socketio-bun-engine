/** Engine.IO v4 wire-protocol encoder/decoder. */

const SEPARATOR = String.fromCharCode(30); // see https://en.wikipedia.org/wiki/Delimiter#ASCII_delimited_text

export type PacketType =
  | "open"
  | "close"
  | "ping"
  | "pong"
  | "message"
  | "upgrade"
  | "noop"
  | "error";

export type RawData = string | Buffer;

export interface Packet {
  type: PacketType;
  data?: RawData;
}

// Plain objects for JIT inline-cache friendly lookups
const PACKET_TYPES: Record<string, string> = {
  open: "0",
  close: "1",
  ping: "2",
  pong: "3",
  message: "4",
  upgrade: "5",
  noop: "6",
};

const PACKET_TYPES_REVERSE: Record<string, PacketType> = {
  "0": "open",
  "1": "close",
  "2": "ping",
  "3": "pong",
  "4": "message",
  "5": "upgrade",
  "6": "noop",
};

const ERROR_PACKET: Packet = { type: "error", data: "parser error" };

export const Parser = {
  /** Encodes a packet to its wire format. Binary data is base64-encoded when supportsBinary is false. */
  encodePacket({ type, data }: Packet, supportsBinary: boolean): RawData {
    if (Buffer.isBuffer(data)) {
      return supportsBinary ? data : "b" + data.toString("base64");
    }
    // Fast path: message type is 95%+ of traffic
    if (type === "message") {
      return "4" + (data || "");
    }
    return PACKET_TYPES[type] + (data || "");
  },

  /** Decodes a wire-format string or Buffer into a Packet. */
  decodePacket(encodedPacket: RawData): Packet {
    if (typeof encodedPacket !== "string") {
      return {
        type: "message",
        data: encodedPacket,
      };
    }
    const typeChar = encodedPacket.charAt(0);
    // Fast path: message type "4" is 95%+ of traffic
    if (typeChar === "4") {
      return encodedPacket.length > 1
        ? { type: "message", data: encodedPacket.substring(1) }
        : { type: "message" };
    }
    if (typeChar === "b") {
      const buffer = Buffer.from(encodedPacket.substring(1), "base64");
      return {
        type: "message",
        data: buffer,
      };
    }
    const type = PACKET_TYPES_REVERSE[typeChar];
    if (type === undefined) {
      return ERROR_PACKET;
    }
    return encodedPacket.length > 1
      ? {
          type,
          data: encodedPacket.substring(1),
        }
      : {
          type,
        };
  },

  /** Encodes an array of packets into a single payload string separated by ASCII record separator. */
  encodePayload(packets: Packet[]) {
    const encodedPackets = [];

    for (const packet of packets) {
      encodedPackets.push(this.encodePacket(packet, false));
    }

    return encodedPackets.join(SEPARATOR);
  },

  /** Decodes a payload string into an array of packets. Stops on first error packet. */
  decodePayload(encodedPayload: string): Packet[] {
    const encodedPackets = encodedPayload.split(SEPARATOR);
    const packets = [];
    for (let i = 0; i < encodedPackets.length; i++) {
      const decodedPacket = this.decodePacket(encodedPackets[i]!);
      packets.push(decodedPacket);
      if (decodedPacket.type === "error") {
        break;
      }
    }
    return packets;
  },
};
