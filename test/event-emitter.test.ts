import { describe, it, expect } from "bun:test";
import { EventEmitter } from "../lib/event-emitter";

// Concrete subclass for testing (EventEmitter is not abstract but emitReserved is protected)
class TestEmitter extends EventEmitter<
  { test: (...args: any[]) => void; other: () => void },
  { test: (...args: any[]) => void; other: () => void }
> {
  doEmit(event: string, ...args: any[]): boolean {
    return this.emit(event as any, ...args);
  }
}

describe("EventEmitter", () => {
  describe("on()", () => {
    it("adds a listener and calls it on emit", () => {
      const emitter = new TestEmitter();
      const calls: string[] = [];
      emitter.on("test", (msg: string) => calls.push(msg));
      emitter.doEmit("test", "hello");
      expect(calls).toEqual(["hello"]);
    });

    it("supports multiple listeners for the same event, called in order", () => {
      const emitter = new TestEmitter();
      const order: number[] = [];
      emitter.on("test", () => order.push(1));
      emitter.on("test", () => order.push(2));
      emitter.on("test", () => order.push(3));
      emitter.doEmit("test");
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe("once()", () => {
    it("fires once then auto-removes", () => {
      const emitter = new TestEmitter();
      let count = 0;
      emitter.once("test", () => count++);
      emitter.doEmit("test");
      emitter.doEmit("test");
      expect(count).toBe(1);
    });

    it("does not break other listeners during emit", () => {
      const emitter = new TestEmitter();
      const calls: string[] = [];
      emitter.on("test", () => calls.push("permanent"));
      emitter.once("test", () => calls.push("once"));
      emitter.on("test", () => calls.push("after"));
      emitter.doEmit("test");
      expect(calls).toEqual(["permanent", "once", "after"]);
      calls.length = 0;
      emitter.doEmit("test");
      expect(calls).toEqual(["permanent", "after"]);
    });
  });

  describe("off()", () => {
    it("removes a specific listener", () => {
      const emitter = new TestEmitter();
      let count = 0;
      const listener = () => count++;
      emitter.on("test", listener);
      emitter.off("test", listener);
      emitter.doEmit("test");
      expect(count).toBe(0);
    });

    it("removes all listeners for a specific event when no listener given", () => {
      const emitter = new TestEmitter();
      let count = 0;
      emitter.on("test", () => count++);
      emitter.on("test", () => count++);
      emitter.off("test");
      emitter.doEmit("test");
      expect(count).toBe(0);
    });

    it("clears all listeners when called with no args", () => {
      const emitter = new TestEmitter();
      let testCount = 0;
      let otherCount = 0;
      emitter.on("test", () => testCount++);
      emitter.on("other", () => otherCount++);
      emitter.off();
      emitter.doEmit("test");
      emitter.doEmit("other");
      expect(testCount).toBe(0);
      expect(otherCount).toBe(0);
    });
  });

  describe("emit()", () => {
    it("returns false when no listeners", () => {
      const emitter = new TestEmitter();
      expect(emitter.doEmit("test")).toBe(false);
    });

    it("returns true when listeners exist", () => {
      const emitter = new TestEmitter();
      emitter.on("test", () => {});
      expect(emitter.doEmit("test")).toBe(true);
    });

    it("uses 1-listener fast path (direct call)", () => {
      const emitter = new TestEmitter();
      let called = false;
      emitter.on("test", () => {
        called = true;
      });
      emitter.doEmit("test");
      expect(called).toBe(true);
    });

    it("uses 2-listener fast path (snapshot refs)", () => {
      const emitter = new TestEmitter();
      const calls: number[] = [];
      emitter.on("test", () => calls.push(1));
      emitter.on("test", () => calls.push(2));
      emitter.doEmit("test");
      expect(calls).toEqual([1, 2]);
    });

    it("uses slice for 3+ listeners", () => {
      const emitter = new TestEmitter();
      const calls: number[] = [];
      emitter.on("test", () => calls.push(1));
      emitter.on("test", () => calls.push(2));
      emitter.on("test", () => calls.push(3));
      emitter.doEmit("test");
      expect(calls).toEqual([1, 2, 3]);
    });

    it("passes arguments to listeners", () => {
      const emitter = new TestEmitter();
      let received: any[] = [];
      emitter.on("test", (...args: any[]) => {
        received = args;
      });
      emitter.doEmit("test", "a", 42, true);
      expect(received).toEqual(["a", 42, true]);
    });
  });

  describe("removeListener()", () => {
    it("is an alias for off()", () => {
      const emitter = new TestEmitter();
      let count = 0;
      const listener = () => count++;
      emitter.on("test", listener);
      emitter.removeListener("test", listener);
      emitter.doEmit("test");
      expect(count).toBe(0);
    });
  });

  describe("listeners()", () => {
    it("returns array of registered listeners", () => {
      const emitter = new TestEmitter();
      const fn1 = () => {};
      const fn2 = () => {};
      emitter.on("test", fn1);
      emitter.on("test", fn2);
      expect(emitter.listeners("test")).toEqual([fn1, fn2]);
    });

    it("returns empty array for unknown event", () => {
      const emitter = new TestEmitter();
      expect(emitter.listeners("test")).toEqual([]);
    });
  });
});
