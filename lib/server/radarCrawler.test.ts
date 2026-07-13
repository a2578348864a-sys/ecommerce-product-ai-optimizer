import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as dns } from "dns";
import {
  createPinnedRadarRequestOptions,
  crawlSingleUrl,
  crawlUrls,
  type PinnedRadarRequest,
} from "./radarCrawler";

const PUBLIC_ADDRESS = { address: "93.184.216.34", family: 4 as const };

function htmlResponse(body = "<html><body><h1>Desk phone stand</h1><p>Public product evidence for review.</p></body></html>") {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function requestWithRobots(pageResponse: Response): PinnedRadarRequest {
  return vi.fn(async (url) => (
    url.pathname === "/robots.txt"
      ? new Response("", { status: 404, headers: { "content-type": "text/plain" } })
      : pageResponse
  ));
}

beforeEach(() => {
  vi.spyOn(dns, "lookup").mockResolvedValue([PUBLIC_ADDRESS] as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("radar crawler pinned public URL requests", () => {
  it("builds production request options whose lookup returns only the validated address", async () => {
    const options = createPinnedRadarRequestOptions(
      new URL("https://example.com/products/item?q=desk"),
      PUBLIC_ADDRESS,
    );

    expect(options).toMatchObject({
      hostname: "example.com",
      port: 443,
      path: "/products/item?q=desk",
      servername: "example.com",
      rejectUnauthorized: true,
      family: 4,
    });

    const selected = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      if (!options.lookup) throw new Error("missing pinned lookup");
      options.lookup("example.com", { family: 0 }, ((error: NodeJS.ErrnoException | null, address: string, family: number) => {
        if (error) reject(error);
        else resolve({ address, family });
      }) as never);
    });
    expect(selected).toEqual(PUBLIC_ADDRESS);
  });

  it("uses an unbracketed IPv6 hostname and does not send an IP literal as TLS SNI", () => {
    const address = { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const };
    const options = createPinnedRadarRequestOptions(
      new URL("https://[2606:2800:220:1:248:1893:25c8:1946]/item"),
      address,
    );

    expect(options.hostname).toBe("2606:2800:220:1:248:1893:25c8:1946");
    expect(options.servername).toBeUndefined();
    expect(options.headers).toMatchObject({ Host: "[2606:2800:220:1:248:1893:25c8:1946]" });
  });

  it("pins robots and page connections to the address returned by validation", async () => {
    const request = requestWithRobots(htmlResponse());

    const result = await crawlSingleUrl("https://example.com/products/desk-stand", { request });

    expect(result.status).toBe("ok");
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.mocked(request).mock.calls.map((call) => call[1])).toEqual([
      PUBLIC_ADDRESS,
      PUBLIC_ADDRESS,
    ]);
    expect(result).toMatchObject({
      provenance: {
        submittedUrl: "https://example.com/products/desk-stand",
        finalUrl: "https://example.com/products/desk-stand",
        redirectCount: 0,
        robots: "not_present",
        transportSecurity: "https",
        httpStatus: 200,
        contentType: "text/html",
      },
    });
    expect(result.provenance?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("revalidates a redirect and refuses a private target before another request", async () => {
    const request = vi.fn(async (url: URL) => {
      if (url.pathname === "/robots.txt") {
        return new Response("", { status: 404, headers: { "content-type": "text/plain" } });
      }
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/internal" },
      });
    }) as PinnedRadarRequest;

    const result = await crawlSingleUrl("https://example.com/products/desk-stand", { request });

    expect(result).toMatchObject({ status: "blocked", failureReason: "ssrf_blocked" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("re-resolves a public redirect and pins the next request to its new address", async () => {
    const redirectedAddress = { address: "1.1.1.1", family: 4 as const };
    vi.spyOn(dns, "lookup")
      .mockResolvedValueOnce([PUBLIC_ADDRESS] as never)
      .mockResolvedValueOnce([redirectedAddress] as never);
    const request = vi.fn(async (url: URL) => {
      if (url.pathname === "/robots.txt") {
        return new Response("", { status: 404, headers: { "content-type": "text/plain" } });
      }
      if (url.hostname === "example.com") {
        return new Response(null, { status: 302, headers: { location: "https://redirect.example/item" } });
      }
      return htmlResponse();
    }) as PinnedRadarRequest;

    const result = await crawlSingleUrl("https://example.com/item", { request });

    expect(result.status).toBe("ok");
    expect(vi.mocked(request).mock.calls.map((call) => call[1])).toEqual([
      PUBLIC_ADDRESS,
      PUBLIC_ADDRESS,
      redirectedAddress,
      redirectedAddress,
    ]);
    expect(result).toMatchObject({
      provenance: {
        submittedUrl: "https://example.com/item",
        finalUrl: "https://redirect.example/item",
        redirectCount: 1,
        robots: "not_present",
        transportSecurity: "https",
      },
    });
  });

  it("records HTTP when any document redirect hop uses insecure transport", async () => {
    const request = vi.fn(async (url: URL) => {
      if (url.pathname === "/robots.txt") {
        return new Response("", { status: 404, headers: { "content-type": "text/plain" } });
      }
      if (url.protocol === "http:") {
        return new Response(null, { status: 302, headers: { location: "https://example.com/secure-item" } });
      }
      return htmlResponse();
    }) as PinnedRadarRequest;

    const result = await crawlSingleUrl("http://example.com/item", { request });

    expect(result).toMatchObject({
      status: "ok",
      provenance: {
        submittedUrl: "http://example.com/item",
        finalUrl: "https://example.com/secure-item",
        redirectCount: 1,
        robots: "not_present",
        transportSecurity: "http",
      },
    });
  });

  it("distinguishes an explicit robots allow from a missing robots file", async () => {
    const request = vi.fn(async (url: URL) => (
      url.pathname === "/robots.txt"
        ? new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } })
        : htmlResponse()
    )) as PinnedRadarRequest;

    const result = await crawlSingleUrl("https://example.com/item", { request });

    expect(result).toMatchObject({ status: "ok", provenance: { robots: "allowed" } });
  });

  it("checks robots.txt again after redirecting to a new origin", async () => {
    const request = vi.fn(async (url: URL) => {
      if (url.hostname === "redirect.example" && url.pathname === "/robots.txt") {
        return new Response("User-agent: *\nDisallow: /private", { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (url.pathname === "/robots.txt") {
        return new Response("", { status: 404, headers: { "content-type": "text/plain" } });
      }
      if (url.hostname === "example.com") {
        return new Response(null, { status: 302, headers: { location: "https://redirect.example/private/item" } });
      }
      return htmlResponse();
    }) as PinnedRadarRequest;

    const result = await crawlSingleUrl("https://example.com/item", { request });

    expect(result).toMatchObject({ status: "blocked", failureReason: "robots_disallowed" });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("honors robots.txt disallow before requesting the page", async () => {
    const request = vi.fn(async (url: URL) => (
      url.pathname === "/robots.txt"
        ? new Response("User-agent: *\nDisallow: /private", { status: 200, headers: { "content-type": "text/plain" } })
        : htmlResponse()
    )) as PinnedRadarRequest;

    const result = await crawlSingleUrl("https://example.com/private/item", { request });

    expect(result).toMatchObject({ status: "blocked", failureReason: "robots_disallowed" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    new Response("temporary failure", { status: 503, headers: { "content-type": "text/plain" } }),
    new Response(new Uint8Array([0, 1]), { status: 200, headers: { "content-type": "application/octet-stream" } }),
    new Response("oversized", { status: 200, headers: { "content-type": "text/plain", "content-length": String(256 * 1024 + 1) } }),
  ])("fails closed when robots.txt cannot be evaluated safely", async (robotsResponse) => {
    const request = vi.fn(async (url: URL) => (
      url.pathname === "/robots.txt" ? robotsResponse : htmlResponse()
    )) as PinnedRadarRequest;

    const result = await crawlSingleUrl("https://example.com/item", { request });

    expect(result).toMatchObject({ status: "blocked", failureReason: "robots_unavailable" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([404, 429, 500])("rejects HTTP %s instead of normalizing the error page", async (status) => {
    const request = requestWithRobots(new Response("<html>Error page</html>", {
      status,
      headers: { "content-type": "text/html" },
    }));

    await expect(crawlSingleUrl("https://example.com/item", { request })).resolves.toMatchObject({
      status: "error",
      statusCode: status,
      failureReason: "http_error",
    });
  });

  it("rejects non-text response types before normalization", async () => {
    const request = requestWithRobots(new Response(new Uint8Array([0, 1, 2, 3]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    }));

    const result = await crawlSingleUrl("https://example.com/download", { request });
    expect(result).toMatchObject({
      status: "invalid",
      failureReason: "unsupported_content_type",
    });
    expect(result.provenance).toBeUndefined();
  });

  it.each([
    [new Response(new TextEncoder().encode("plain text without a MIME"), { status: 200 }), "unsupported_content_type"],
    [new Response("compressed", { status: 200, headers: { "content-type": "text/html", "content-encoding": "gzip" } }), "unsupported_content_encoding"],
  ])("rejects unsupported response metadata", async (pageResponse, reason) => {
    const request = requestWithRobots(pageResponse);
    await expect(crawlSingleUrl("https://example.com/item", { request })).resolves.toMatchObject({
      status: "invalid",
      failureReason: reason,
    });
  });

  it("rejects an oversized declared response before reading its body", async () => {
    const request = requestWithRobots(new Response("small", {
      status: 200,
      headers: {
        "content-type": "text/html",
        "content-length": String(5 * 1024 * 1024 + 1),
      },
    }));

    await expect(crawlSingleUrl("https://example.com/item", { request })).resolves.toMatchObject({
      status: "too_large",
      failureReason: "response_too_large",
    });
  });

  it("uses one deadline for robots and page work", async () => {
    const request = vi.fn((_url: URL, _address: typeof PUBLIC_ADDRESS, signal: AbortSignal) => (
      new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      })
    )) as PinnedRadarRequest;

    const result = await crawlSingleUrl("https://example.com/item", {
      request,
      timeoutMs: 10,
    });

    expect(result).toMatchObject({ status: "timeout", failureReason: "timeout" });
    expect(result.provenance).toBeUndefined();
  });

  it.each([
    [
      "anti-bot",
      `<html><body><h1>Cloudflare challenge</h1><p>Security check verification ${"x".repeat(150)}</p></body></html>`,
      "anti_bot_challenge",
    ],
    [
      "JS-only",
      `<html><head><script>${"x".repeat(700)}</script></head><body><div id="root"></div></body></html>`,
      "js_rendered_source_not_supported",
    ],
  ])("does not create provenance for a blocked %s response", async (_label, body, failureReason) => {
    const request = requestWithRobots(htmlResponse(body));

    const result = await crawlSingleUrl("https://example.com/item", { request });

    expect(result).toMatchObject({ status: "blocked", failureReason });
    expect(result.provenance).toBeUndefined();
  });

  it("returns on deadline even when DNS lookup itself never settles", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(() => new Promise(() => undefined) as never);

    const outcome = await Promise.race([
      crawlSingleUrl("https://dns-stall.example/item", { timeoutMs: 10 }),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 80)),
    ]);

    expect(outcome).not.toBe("hung");
    expect(outcome).toMatchObject({ status: "timeout", failureReason: "timeout" });
  });

  it("stops a multi-URL crawl when the shared batch budget is exhausted", async () => {
    let now = 0;
    const request = requestWithRobots(htmlResponse());

    const result = await crawlUrls([
      "https://one.example/item",
      "https://two.example/item",
      "https://three.example/item",
    ], {
      request,
      batchTimeoutMs: 15,
      perUrlTimeoutMs: 10,
      interRequestDelayMs: 0,
      now: () => {
        now += 10;
        return now;
      },
    });

    expect(result.results).toHaveLength(3);
    expect(result.results.filter((item) => item.failureReason === "batch_timeout").length).toBeGreaterThan(0);
  });
});
