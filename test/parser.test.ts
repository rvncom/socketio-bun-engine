import { describe, it, expect } from "bun:test";
import { Parser, type Packet } from "../lib/parser";

const SEPARATOR = String.fromCharCode(30);

describe("Parser", () => {
  describe("encodePacket", () => {
    it("encodes an open packet", () => {
      expect(
        Parser.encodePacket({ type: "open", data: '{"sid":"abc"}' }, true),
      ).toBe('0{"sid":"abc"}');
    });

    it("encodes a close packet", () => {
      expect(Parser.encodePacket({ type: "close" }, true)).toBe("1");
    });

    it("encodes a ping packet", () => {
      expect(Parser.encodePacket({ type: "ping" }, true)).toBe("2");
    });

    it("encodes a ping packet with data", () => {
      expect(Parser.encodePacket({ type: "ping", data: "probe" }, true)).toBe(
        "2probe",
      );
    });

    it("encodes a pong packet", () => {
      expect(Parser.encodePacket({ type: "pong" }, true)).toBe("3");
    });

    it("encodes a pong packet with data", () => {
      expect(Parser.encodePacket({ type: "pong", data: "probe" }, true)).toBe(
        "3probe",
      );
    });

    it("encodes a message packet (fast path)", () => {
      expect(
        Parser.encodePacket({ type: "message", data: "hello" }, true),
      ).toBe("4hello");
    });

    it("encodes a message packet with empty data", () => {
      expect(Parser.encodePacket({ type: "message" }, true)).toBe("4");
    });

    it("encodes an upgrade packet", () => {
      expect(Parser.encodePacket({ type: "upgrade" }, true)).toBe("5");
    });

    it("encodes a noop packet", () => {
      expect(Parser.encodePacket({ type: "noop" }, true)).toBe("6");
    });

    it("encodes a binary Buffer with supportsBinary=true as raw Buffer", () => {
      const buf = Buffer.from([1, 2, 3, 4]);
      const result = Parser.encodePacket({ type: "message", data: buf }, true);
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toEqual(buf);
    });

    it("encodes a binary Buffer with supportsBinary=false as base64", () => {
      const buf = Buffer.from([1, 2, 3, 4]);
      const result = Parser.encodePacket({ type: "message", data: buf }, false);
      expect(typeof result).toBe("string");
      expect(result).toBe("b" + buf.toString("base64"));
    });

    it("encodes a message with undefined data", () => {
      expect(
        Parser.encodePacket({ type: "message", data: undefined }, true),
      ).toBe("4");
    });
  });

  describe("decodePacket", () => {
    it("decodes an open packet", () => {
      const packet = Parser.decodePacket('0{"sid":"abc"}');
      expect(packet.type).toBe("open");
      expect(packet.data).toBe('{"sid":"abc"}');
    });

    it("decodes a close packet", () => {
      expect(Parser.decodePacket("1")).toEqual({ type: "close" });
    });

    it("decodes a ping packet", () => {
      expect(Parser.decodePacket("2")).toEqual({ type: "ping" });
    });

    it("decodes a ping packet with data", () => {
      expect(Parser.decodePacket("2probe")).toEqual({
        type: "ping",
        data: "probe",
      });
    });

    it("decodes a pong packet", () => {
      expect(Parser.decodePacket("3")).toEqual({ type: "pong" });
    });

    it("decodes a message packet (fast path) with data", () => {
      const packet = Parser.decodePacket("4hello");
      expect(packet.type).toBe("message");
      expect(packet.data).toBe("hello");
    });

    it("decodes a message packet (fast path) without data", () => {
      const packet = Parser.decodePacket("4");
      expect(packet.type).toBe("message");
      expect(packet.data).toBeUndefined();
    });

    it("decodes an upgrade packet", () => {
      expect(Parser.decodePacket("5")).toEqual({ type: "upgrade" });
    });

    it("decodes a noop packet", () => {
      expect(Parser.decodePacket("6")).toEqual({ type: "noop" });
    });

    it("decodes binary (non-string) input as message type", () => {
      const buf = Buffer.from([1, 2, 3]);
      const packet = Parser.decodePacket(buf);
      expect(packet.type).toBe("message");
      expect(packet.data).toEqual(buf);
    });

    it("decodes base64 'b' prefix as Buffer", () => {
      const original = Buffer.from([1, 2, 3, 4]);
      const encoded = "b" + original.toString("base64");
      const packet = Parser.decodePacket(encoded);
      expect(packet.type).toBe("message");
      expect(Buffer.isBuffer(packet.data)).toBe(true);
      expect(packet.data).toEqual(original);
    });

    it("returns error packet for invalid type char", () => {
      const packet = Parser.decodePacket("9invalid");
      expect(packet.type).toBe("error");
      expect(packet.data).toBe("parser error");
    });

    it("returns error packet for non-numeric type char", () => {
      const packet = Parser.decodePacket("xinvalid");
      expect(packet.type).toBe("error");
    });

    it("decodes empty string after type char", () => {
      const packet = Parser.decodePacket("2");
      expect(packet.type).toBe("ping");
      expect(packet.data).toBeUndefined();
    });
  });

  describe("encodePayload", () => {
    it("encodes multiple packets joined by separator", () => {
      const packets: Packet[] = [
        { type: "message", data: "hello" },
        { type: "message", data: "world" },
      ];
      const result = Parser.encodePayload(packets);
      expect(result).toBe("4hello" + SEPARATOR + "4world");
    });

    it("encodes a single packet", () => {
      const packets: Packet[] = [{ type: "ping" }];
      const result = Parser.encodePayload(packets);
      expect(result).toBe("2");
    });

    it("encodes binary as base64 in payload", () => {
      const buf = Buffer.from([1, 2, 3]);
      const packets: Packet[] = [
        { type: "message", data: "text" },
        { type: "message", data: buf },
      ];
      const result = Parser.encodePayload(packets);
      expect(result).toBe("4text" + SEPARATOR + "b" + buf.toString("base64"));
    });
  });

  describe("decodePayload", () => {
    it("decodes payload split by separator", () => {
      const encoded = "4hello" + SEPARATOR + "4world";
      const packets = Parser.decodePayload(encoded);
      expect(packets.length).toBe(2);
      expect(packets[0]!.type).toBe("message");
      expect(packets[0]!.data).toBe("hello");
      expect(packets[1]!.type).toBe("message");
      expect(packets[1]!.data).toBe("world");
    });

    it("decodes single packet payload", () => {
      const packets = Parser.decodePayload("2");
      expect(packets.length).toBe(1);
      expect(packets[0]!.type).toBe("ping");
    });

    it("stops on first error packet", () => {
      const encoded = "4hello" + SEPARATOR + "9invalid" + SEPARATOR + "4world";
      const packets = Parser.decodePayload(encoded);
      expect(packets.length).toBe(2);
      expect(packets[0]!.type).toBe("message");
      expect(packets[1]!.type).toBe("error");
    });
  });
});
