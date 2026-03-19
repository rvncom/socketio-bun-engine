import { describe, it, expect } from "bun:test";
import { addCorsHeaders, type CorsOptions } from "../lib/cors";

function makeRequest(
  method: string,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/test", {
    method,
    headers,
  });
}

function getCors(opts: CorsOptions, req: Request): Headers {
  const headers = new Headers();
  addCorsHeaders(headers, opts, req);
  return headers;
}

describe("CORS", () => {
  describe("origin", () => {
    it('origin: "*" sets Access-Control-Allow-Origin: *', () => {
      const headers = getCors({ origin: "*" }, makeRequest("GET"));
      expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("origin: specific string sets that string + Vary: Origin", () => {
      const headers = getCors(
        { origin: "https://example.com" },
        makeRequest("GET"),
      );
      expect(headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
      expect(headers.get("Vary")).toContain("Origin");
    });

    it("origin: RegExp matching reflects the request origin", () => {
      const req = makeRequest("GET", { origin: "https://test.example.com" });
      const headers = getCors({ origin: /\.example\.com$/ }, req);
      expect(headers.get("Access-Control-Allow-Origin")).toBe(
        "https://test.example.com",
      );
    });

    it("origin: RegExp not matching sets false", () => {
      const req = makeRequest("GET", { origin: "https://evil.com" });
      const headers = getCors({ origin: /\.example\.com$/ }, req);
      expect(headers.get("Access-Control-Allow-Origin")).toBe("false");
    });

    it("origin: array of strings reflects matching origin", () => {
      const req = makeRequest("GET", { origin: "https://b.com" });
      const headers = getCors(
        { origin: ["https://a.com", "https://b.com"] },
        req,
      );
      expect(headers.get("Access-Control-Allow-Origin")).toBe("https://b.com");
    });

    it("origin: array with no match sets false", () => {
      const req = makeRequest("GET", { origin: "https://c.com" });
      const headers = getCors(
        { origin: ["https://a.com", "https://b.com"] },
        req,
      );
      expect(headers.get("Access-Control-Allow-Origin")).toBe("false");
    });

    it("origin: boolean true reflects request origin when present", () => {
      const req = makeRequest("GET", { origin: "https://example.com" });
      const headers = getCors({ origin: true }, req);
      expect(headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
    });

    it("origin: boolean true without request origin sets false", () => {
      const headers = getCors({ origin: true }, makeRequest("GET"));
      expect(headers.get("Access-Control-Allow-Origin")).toBe("false");
    });

    it("origin: boolean false sets *", () => {
      const headers = getCors({ origin: false }, makeRequest("GET"));
      expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("no origin option defaults to *", () => {
      const headers = getCors({}, makeRequest("GET"));
      expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("credentials", () => {
    it("credentials: true sets Access-Control-Allow-Credentials: true", () => {
      const headers = getCors({ credentials: true }, makeRequest("GET"));
      expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });

    it("credentials: false does not set the header", () => {
      const headers = getCors({ credentials: false }, makeRequest("GET"));
      expect(headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });
  });

  describe("methods (OPTIONS only)", () => {
    it("sets Access-Control-Allow-Methods on OPTIONS", () => {
      const headers = getCors(
        { methods: ["GET", "POST"] },
        makeRequest("OPTIONS"),
      );
      expect(headers.get("Access-Control-Allow-Methods")).toBe("GET,POST");
    });

    it("accepts string for methods", () => {
      const headers = getCors({ methods: "GET,POST" }, makeRequest("OPTIONS"));
      expect(headers.get("Access-Control-Allow-Methods")).toBe("GET,POST");
    });

    it("does not set methods on non-OPTIONS request", () => {
      const headers = getCors({ methods: ["GET", "POST"] }, makeRequest("GET"));
      expect(headers.get("Access-Control-Allow-Methods")).toBeNull();
    });
  });

  describe("allowedHeaders (OPTIONS only)", () => {
    it("sets Access-Control-Allow-Headers on OPTIONS", () => {
      const headers = getCors(
        { allowedHeaders: ["X-Custom", "Authorization"] },
        makeRequest("OPTIONS"),
      );
      expect(headers.get("Access-Control-Allow-Headers")).toBe(
        "X-Custom,Authorization",
      );
    });

    it("reflects request headers when no allowedHeaders configured", () => {
      const req = makeRequest("OPTIONS", {
        "access-control-request-headers": "X-Foo, X-Bar",
      });
      const headers = getCors({}, req);
      expect(headers.get("Access-Control-Allow-Headers")).toBe("X-Foo, X-Bar");
      expect(headers.get("Vary")).toContain("Access-Control-Request-Headers");
    });
  });

  describe("exposedHeaders", () => {
    it("sets Access-Control-Expose-Headers", () => {
      const headers = getCors(
        { exposedHeaders: ["X-Total-Count"] },
        makeRequest("GET"),
      );
      expect(headers.get("Access-Control-Expose-Headers")).toBe(
        "X-Total-Count",
      );
    });

    it("accepts string for exposedHeaders", () => {
      const headers = getCors(
        { exposedHeaders: "X-Total-Count,X-Page" },
        makeRequest("GET"),
      );
      expect(headers.get("Access-Control-Expose-Headers")).toBe(
        "X-Total-Count,X-Page",
      );
    });
  });

  describe("maxAge (OPTIONS only)", () => {
    it("sets Access-Control-Max-Age on OPTIONS", () => {
      const headers = getCors({ maxAge: 3600 }, makeRequest("OPTIONS"));
      expect(headers.get("Access-Control-Max-Age")).toBe("3600");
    });

    it("does not set maxAge on non-OPTIONS request", () => {
      const headers = getCors({ maxAge: 3600 }, makeRequest("GET"));
      expect(headers.get("Access-Control-Max-Age")).toBeNull();
    });
  });
});
