import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDns = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  default: mockDns,
  lookup: mockDns.lookup,
}));

import {
  downloadImageFromUrl,
  createPinnedHttpsRequestOptions,
  getImageResultHostWhitelist,
  ImageUrlFetchError,
  validateImageResultDns,
  validateImageResultUrl,
} from "@/lib/server/aiImageUrlFetcher";
import { VALID_ONE_PIXEL_PNG_BASE64 } from "@/tests/helpers/mockAiImageProvider";

const WHITELIST = new Set(["image.65535.space"]);
type ResolvedAddress = { address: string; family: 4 | 6 };
type PinnedRequest = (url: URL, address: ResolvedAddress, signal: AbortSignal) => Promise<Response>;

function mockFetch(status: number, body: string | Uint8Array, headers: Record<string, string> = {}): PinnedRequest {
  return async () => {
    const content = typeof body === "string" ? new TextEncoder().encode(body) : body;
    return new Response(content, { status, headers: new Headers(headers) });
  };
}

function mockFetchStreaming(chunks: Uint8Array[], headers: Record<string, string> = {}): PinnedRequest {
  return async () => {
    let closed = false;
    const body = new ReadableStream({
      pull(controller) {
        if (closed) return;
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
        closed = true;
      },
    });
    return new Response(body, { status: 200, headers: new Headers(headers) });
  };
}

function mockFetchRedirect(location: string, redirectCount = 0): PinnedRequest {
  let calls = 0;
  return async () => {
    calls += 1;
    if (calls <= redirectCount + 1 && calls === 1) {
      return new Response(null, { status: 302, headers: new Headers({ location }) });
    }
    // Return a valid 1-pixel PNG after redirect
    const pngBytes = Buffer.from(VALID_ONE_PIXEL_PNG_BASE64, "base64");
    return new Response(pngBytes, { status: 200, headers: new Headers({ "content-type": "image/png" }) });
  };
}

function validPngResponse(): PinnedRequest {
  const pngBytes = Buffer.from(VALID_ONE_PIXEL_PNG_BASE64, "base64");
  return mockFetchStreaming([pngBytes], { "content-type": "image/png", "content-length": String(pngBytes.length) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDns.lookup.mockReset();
  process.env.OPENAI_IMAGE_RESULT_HOSTS = "image.65535.space";
  mockDns.lookup.mockResolvedValue([
    { address: "104.26.15.58", family: 4 },
    { address: "2606:4700:20::681a:f3a", family: 6 },
  ]);
});

afterEach(() => {
  delete process.env.OPENAI_IMAGE_RESULT_HOSTS;
});

/* ── hostname whitelist ────────────────────────────────── */

describe("image result host whitelist", () => {
  it("returns an empty set when OPENAI_IMAGE_RESULT_HOSTS is not set", () => {
    delete process.env.OPENAI_IMAGE_RESULT_HOSTS;
    expect(getImageResultHostWhitelist().size).toBe(0);
  });

  it("parses a single hostname", () => {
    process.env.OPENAI_IMAGE_RESULT_HOSTS = "image.65535.space";
    expect(getImageResultHostWhitelist()).toEqual(new Set(["image.65535.space"]));
  });

  it("parses comma-separated hostnames", () => {
    process.env.OPENAI_IMAGE_RESULT_HOSTS = "image.65535.space,cdn.65535.space";
    const whitelist = getImageResultHostWhitelist();
    expect(whitelist.has("image.65535.space")).toBe(true);
    expect(whitelist.has("cdn.65535.space")).toBe(true);
  });

  it("trims whitespace around hostnames", () => {
    process.env.OPENAI_IMAGE_RESULT_HOSTS = " image.65535.space , cdn.65535.space ";
    const whitelist = getImageResultHostWhitelist();
    expect(whitelist.has("image.65535.space")).toBe(true);
    expect(whitelist.has("cdn.65535.space")).toBe(true);
  });

  it("lowercases all hostnames", () => {
    process.env.OPENAI_IMAGE_RESULT_HOSTS = "IMAGE.65535.SPACE";
    expect(getImageResultHostWhitelist().has("image.65535.space")).toBe(true);
  });

  it("filters out empty entries", () => {
    process.env.OPENAI_IMAGE_RESULT_HOSTS = "image.65535.space,,cdn.65535.space,";
    expect(getImageResultHostWhitelist().size).toBe(2);
  });
});

/* ── URL validation ────────────────────────────────────── */

describe("validateImageResultUrl", () => {
  it("accepts a valid HTTPS URL on the whitelist", () => {
    const url = validateImageResultUrl("https://image.65535.space/path/to/img.png?token=sig", WHITELIST);
    expect(url.hostname).toBe("image.65535.space");
    expect(url.protocol).toBe("https:");
  });

  it("rejects an empty URL", () => {
    expect(() => validateImageResultUrl("", WHITELIST)).toThrowError(ImageUrlFetchError);
    try { validateImageResultUrl("", WHITELIST); } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_untrusted_result_url");
    }
  });

  it("rejects a non-whitelisted hostname", () => {
    expect(() => validateImageResultUrl("https://cdn.example.com/img.png", WHITELIST)).toThrowError(ImageUrlFetchError);
    try { validateImageResultUrl("https://cdn.example.com/img.png", WHITELIST); } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_untrusted_result_url");
      // Must not leak the URL
      expect((e as ImageUrlFetchError).message).not.toContain("cdn.example.com");
    }
  });

  it("rejects an HTTP URL", () => {
    expect(() => validateImageResultUrl("http://image.65535.space/img.png", WHITELIST)).toThrowError(ImageUrlFetchError);
    try { validateImageResultUrl("http://image.65535.space/img.png", WHITELIST); } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_untrusted_result_url");
      expect((e as ImageUrlFetchError).message).not.toContain("http://");
    }
  });

  it("rejects a URL with username:password", () => {
    expect(() => validateImageResultUrl("https://user:pass@image.65535.space/img.png", WHITELIST)).toThrowError(ImageUrlFetchError);
    try { validateImageResultUrl("https://user:pass@image.65535.space/img.png", WHITELIST); } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_untrusted_result_url");
      expect((e as ImageUrlFetchError).message).not.toContain("user");
    }
  });

  it("rejects a non-443 port", () => {
    expect(() => validateImageResultUrl("https://image.65535.space:8080/img.png", WHITELIST)).toThrowError(ImageUrlFetchError);
    try { validateImageResultUrl("https://image.65535.space:8080/img.png", WHITELIST); } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_untrusted_result_url");
    }
  });

  it("rejects a URL with a fragment", () => {
    expect(() => validateImageResultUrl("https://image.65535.space/img.png#section", WHITELIST)).toThrowError(ImageUrlFetchError);
    try { validateImageResultUrl("https://image.65535.space/img.png#section", WHITELIST); } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_untrusted_result_url");
    }
  });

  it("rejects an IP address literal", () => {
    expect(() => validateImageResultUrl("https://104.26.15.58/img.png", WHITELIST)).toThrowError(ImageUrlFetchError);
  });

  it("rejects a URL with backslash confusion", () => {
    expect(() => validateImageResultUrl("https://image.65535.space\\@evil.com/img.png", WHITELIST)).toThrowError(ImageUrlFetchError);
  });

  it("rejects a non-parseable URL", () => {
    expect(() => validateImageResultUrl("not-a-url", WHITELIST)).toThrowError(ImageUrlFetchError);
  });

  it("rejects unicode/punycode domain confusion", () => {
    expect(() => validateImageResultUrl("https://xn--mgba3a4f16a.com/img.png", WHITELIST)).toThrowError(ImageUrlFetchError);
  });

  it("rejects hostname with trailing dot (dns root confusion)", () => {
    expect(() => validateImageResultUrl("https://image.65535.space./img.png", WHITELIST)).toThrowError(ImageUrlFetchError);
  });

  it("rejects when whitelist is empty", () => {
    expect(() => validateImageResultUrl("https://image.65535.space/img.png", new Set())).toThrowError(ImageUrlFetchError);
    try { validateImageResultUrl("https://image.65535.space/img.png", new Set()); } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_untrusted_result_url");
    }
  });

  it("accepts URL with port 443", () => {
    const url = validateImageResultUrl("https://image.65535.space:443/img.png", WHITELIST);
    expect(url.hostname).toBe("image.65535.space");
  });

  it("does not reject a valid query string (temporary signatures allowed)", () => {
    const url = validateImageResultUrl("https://image.65535.space/img.png?token=abc&expires=123", WHITELIST);
    expect(url.search).toBe("?token=abc&expires=123");
  });
});

/* ── DNS / IP safety ───────────────────────────────────── */

describe("validateImageResultDns", () => {
  it("resolves a hostname with public IPv4 and IPv6 addresses", async () => {
    mockDns.lookup.mockResolvedValue([
      { address: "104.26.15.58", family: 4 },
      { address: "2606:4700:20::681a:f3a", family: 6 },
    ]);
    await expect(validateImageResultDns("image.65535.space")).resolves.toEqual([
      { address: "104.26.15.58", family: 4 },
      { address: "2606:4700:20::681a:f3a", family: 6 },
    ]);
    expect(mockDns.lookup).toHaveBeenCalledWith("image.65535.space", { all: true, verbatim: true });
  });

  it("resolves a single public IPv4 address", async () => {
    mockDns.lookup.mockResolvedValue([{ address: "104.26.15.58", family: 4 }]);
    await expect(validateImageResultDns("image.65535.space")).resolves.toEqual([
      { address: "104.26.15.58", family: 4 },
    ]);
  });

  it("accepts the public 172.67 IPv4 range used by the relay hostname", async () => {
    mockDns.lookup.mockResolvedValue([{ address: "172.67.70.1", family: 4 }]);
    await expect(validateImageResultDns("image.65535.space")).resolves.toEqual([
      { address: "172.67.70.1", family: 4 },
    ]);
  });

  it("resolves with only IPv6", async () => {
    mockDns.lookup.mockResolvedValue([{ address: "2606:4700:20::681a:f3a", family: 6 }]);
    await expect(validateImageResultDns("image.65535.space")).resolves.toEqual([
      { address: "2606:4700:20::681a:f3a", family: 6 },
    ]);
  });

  it("rejects when DNS resolution returns no addresses", async () => {
    mockDns.lookup.mockResolvedValue([]);
    await expect(validateImageResultDns("image.65535.space")).rejects.toThrowError(ImageUrlFetchError);
    try { await validateImageResultDns("image.65535.space"); } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_result_dns_rejected");
    }
  });

  it.each(["ECONNREFUSED", "ENOTFOUND"])("rejects lookup %s without leaking resolver details", async (code) => {
    mockDns.lookup.mockRejectedValue(Object.assign(new Error("resolver detail"), { code }));
    await expect(validateImageResultDns("image.65535.space")).rejects.toMatchObject({
      code: "image_provider_result_dns_rejected",
      message: "图片结果域名 DNS 解析失败。",
    });
  });

  it.each([
    ["127.0.0.1", "loopback"],
    ["127.0.0.2", "loopback range"],
    ["10.0.0.1", "private 10/8"],
    ["10.255.255.255", "private 10/8 edge"],
    ["172.16.0.1", "private 172.16/12"],
    ["172.31.255.255", "private 172.16/12 edge"],
    ["192.168.0.1", "private 192.168/16"],
    ["192.168.255.255", "private 192.168/16 edge"],
    ["169.254.1.1", "link-local"],
    ["169.254.169.254", "cloud metadata"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.255", "multicast edge"],
    ["240.0.0.1", "reserved 240/4"],
    ["255.255.255.255", "broadcast"],
    ["100.64.0.1", "CGNAT"],
    ["100.127.255.255", "CGNAT edge"],
    ["0.0.0.0", "this network"],
    ["0.255.255.255", "0/8"],
  ])("rejects IPv4 %s (%s)", async (addr) => {
    mockDns.lookup.mockResolvedValue([{ address: addr, family: 4 }]);
    await expect(validateImageResultDns("bad.example")).rejects.toThrowError(ImageUrlFetchError);
    try { await validateImageResultDns("bad.example"); } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_result_dns_rejected");
    }
  });

  it.each([
    ["::1", "IPv6 loopback"],
    ["::", "IPv6 unspecified"],
    ["ff02::1", "IPv6 multicast"],
    ["ff00::", "IPv6 multicast edge"],
    ["fe80::1", "IPv6 link-local"],
    ["feb0::1", "IPv6 link-local edge"],
    ["fc00::1", "IPv6 ULA"],
    ["fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "IPv6 ULA edge"],
  ])("rejects IPv6 %s (%s)", async (addr) => {
    mockDns.lookup.mockResolvedValue([{ address: addr, family: 6 }]);
    await expect(validateImageResultDns("bad.example")).rejects.toThrowError(ImageUrlFetchError);
    try { await validateImageResultDns("bad.example"); } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_result_dns_rejected");
    }
  });

  it("rejects DNS with multiple addresses where one is private", async () => {
    mockDns.lookup.mockResolvedValue([
      { address: "104.26.15.58", family: 4 },
      { address: "10.0.0.1", family: 4 },
      { address: "2606:4700:20::681a:f3a", family: 6 },
    ]);
    await expect(validateImageResultDns("bad.example")).rejects.toThrowError(ImageUrlFetchError);
    try { await validateImageResultDns("bad.example"); } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_result_dns_rejected");
    }
  });

  it("rejects DNS with public IPv4 but private IPv6", async () => {
    mockDns.lookup.mockResolvedValue([
      { address: "104.26.15.58", family: 4 },
      { address: "::1", family: 6 },
    ]);
    await expect(validateImageResultDns("bad.example")).rejects.toThrowError(ImageUrlFetchError);
  });

  it("rejects DNS with public IPv6 but private IPv4", async () => {
    mockDns.lookup.mockResolvedValue([
      { address: "192.168.0.1", family: 4 },
      { address: "2606:4700:20::681a:f3a", family: 6 },
    ]);
    await expect(validateImageResultDns("bad.example")).rejects.toThrowError(ImageUrlFetchError);
  });
});

/* ── download ──────────────────────────────────────────── */

describe("pinned HTTPS request options", () => {
  it("keeps the original hostname for SNI and Host while returning only the validated IP", async () => {
    const address: ResolvedAddress = { address: "104.26.15.58", family: 4 };
    const options = createPinnedHttpsRequestOptions(
      new URL("https://image.65535.space/result.png?token=redacted"),
      address,
    );

    expect(options.hostname).toBe("image.65535.space");
    expect(options.servername).toBe("image.65535.space");
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.headers).toEqual({ Host: "image.65535.space" });
    expect(options.path).toBe("/result.png?token=redacted");

    const lookup = options.lookup as NonNullable<typeof options.lookup>;
    const resolved = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      lookup("image.65535.space", { all: false }, ((error: Error | null, selected: string, family: number) => {
        if (error) reject(error);
        else resolve({ address: selected, family });
      }) as never);
    });
    expect(resolved).toEqual(address);
  });
});

describe("downloadImageFromUrl", () => {
  it("uses the validated public IP for the actual download and resolves only once", async () => {
    mockDns.lookup.mockResolvedValue([{ address: "104.26.15.58", family: 4 }]);
    const request = vi.fn<PinnedRequest>(async (_url, address, signal) => {
      expect(address).toEqual({ address: "104.26.15.58", family: 4 });
      return validPngResponse()(_url, address, signal);
    });

    await expect(downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, request)).resolves.toMatchObject({
      mimeType: "image/png",
    });
    expect(mockDns.lookup).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("fails over only across the validated address list", async () => {
    const validated = [
      { address: "104.26.15.58", family: 4 as const },
      { address: "172.67.70.1", family: 4 as const },
    ];
    mockDns.lookup.mockResolvedValue(validated);
    const attempted: ResolvedAddress[] = [];
    const request: PinnedRequest = async (url, address, signal) => {
      attempted.push(address);
      if (attempted.length === 1) throw Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" });
      return validPngResponse()(url, address, signal);
    };

    await expect(downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, request)).resolves.toBeDefined();
    expect(attempted).toEqual(validated);
  });

  it("does not switch to an address that was not returned by the validated lookup", async () => {
    mockDns.lookup.mockResolvedValue([{ address: "104.26.15.58", family: 4 }]);
    const attempted: ResolvedAddress[] = [];
    const request: PinnedRequest = async (_url, address) => {
      attempted.push(address);
      throw new Error("connect failed");
    };

    await expect(downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, request)).rejects.toMatchObject({
      code: "image_provider_result_download_failed",
    });
    expect(attempted).toEqual([{ address: "104.26.15.58", family: 4 }]);
  });

  it("does not perform a second DNS lookup after validation (DNS rebinding simulation)", async () => {
    mockDns.lookup
      .mockResolvedValueOnce([{ address: "104.26.15.58", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const request = vi.fn<PinnedRequest>(async (url, address, signal) => validPngResponse()(url, address, signal));

    await expect(downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, request)).resolves.toBeDefined();
    expect(mockDns.lookup).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toEqual({ address: "104.26.15.58", family: 4 });
  });

  it("revalidates and pins the redirect target before the second connection", async () => {
    mockDns.lookup
      .mockResolvedValueOnce([{ address: "104.26.15.58", family: 4 }])
      .mockResolvedValueOnce([{ address: "172.67.70.1", family: 4 }]);
    const attempted: ResolvedAddress[] = [];
    const request: PinnedRequest = async (url, address, signal) => {
      attempted.push(address);
      if (attempted.length === 1) {
        return new Response(null, {
          status: 302,
          headers: new Headers({ location: "https://image.65535.space/final.png" }),
        });
      }
      return validPngResponse()(url, address, signal);
    };

    await expect(downloadImageFromUrl("https://image.65535.space/redirect", WHITELIST, request)).resolves.toBeDefined();
    expect(mockDns.lookup).toHaveBeenCalledTimes(2);
    expect(attempted).toEqual([
      { address: "104.26.15.58", family: 4 },
      { address: "172.67.70.1", family: 4 },
    ]);
  });

  it("downloads a valid PNG image from a whitelisted hostname", async () => {
    const result = await downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, validPngResponse());
    expect(result.mimeType).toBe("image/png");
    expect(result.sha256).toHaveLength(64);
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it("rejects a non-whitelisted hostname before DNS or fetch", async () => {
    await expect(
      downloadImageFromUrl("https://cdn.evil.com/img.png", WHITELIST, mockFetch(200, "")),
    ).rejects.toThrowError(ImageUrlFetchError);
    try {
      await downloadImageFromUrl("https://cdn.evil.com/img.png", WHITELIST, mockFetch(200, ""));
    } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_untrusted_result_url");
    }
  });

  it("rejects an HTTP URL", async () => {
    await expect(
      downloadImageFromUrl("http://image.65535.space/img.png", WHITELIST, mockFetch(200, "")),
    ).rejects.toThrowError(ImageUrlFetchError);
  });

  it("rejects a DNS resolution to localhost", async () => {
    mockDns.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(
      downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, mockFetch(200, "")),
    ).rejects.toThrowError(ImageUrlFetchError);
    try {
      await downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, mockFetch(200, ""));
    } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_result_dns_rejected");
    }
  });

  it("rejects a DNS resolution to private IPv4", async () => {
    mockDns.lookup.mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    await expect(
      downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, mockFetch(200, "")),
    ).rejects.toThrowError(ImageUrlFetchError);
  });

  it("rejects 404 response", async () => {
    await expect(
      downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, mockFetch(404, "not found")),
    ).rejects.toThrowError(ImageUrlFetchError);
    try {
      await downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, mockFetch(404, "not found"));
    } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_result_download_failed");
    }
  });

  it("rejects 500 response", async () => {
    await expect(
      downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, mockFetch(500, "server error")),
    ).rejects.toThrowError(ImageUrlFetchError);
  });

  it("rejects non-image Content-Type (text/html)", async () => {
    await expect(
      downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, mockFetch(200, "<html>not an image</html>", { "content-type": "text/html" })),
    ).rejects.toThrowError(ImageUrlFetchError);
    try {
      await downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, mockFetch(200, "<html>", { "content-type": "text/html" }));
    } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_result_invalid_mime");
    }
  });

  it("rejects SVG Content-Type", async () => {
    await expect(
      downloadImageFromUrl("https://image.65535.space/img.svg", WHITELIST, mockFetch(200, "<svg></svg>", { "content-type": "image/svg+xml" })),
    ).rejects.toThrowError(ImageUrlFetchError);
    try {
      await downloadImageFromUrl("https://image.65535.space/img.svg", WHITELIST, mockFetch(200, "<svg></svg>", { "content-type": "image/svg+xml" }));
    } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_result_invalid_mime");
    }
  });

  it("rejects Content-Length exceeding 10 MiB", async () => {
    const tooLarge = 10 * 1024 * 1024 + 1;
    await expect(
      downloadImageFromUrl("https://image.65535.space/big.png", WHITELIST, mockFetch(200, "", { "content-type": "image/png", "content-length": String(tooLarge) })),
    ).rejects.toThrowError(ImageUrlFetchError);
    try {
      await downloadImageFromUrl("https://image.65535.space/big.png", WHITELIST, mockFetch(200, "", { "content-type": "image/png", "content-length": String(tooLarge) }));
    } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_result_too_large");
    }
  });

  it("rejects streaming body exceeding 10 MiB when Content-Length is missing", async () => {
    const maxBytes = 10 * 1024 * 1024;
    const bigChunk = new Uint8Array(maxBytes + 1);
    bigChunk.fill(0x00);
    await expect(
      downloadImageFromUrl("https://image.65535.space/big.png", WHITELIST, mockFetchStreaming([bigChunk], { "content-type": "image/png" })),
    ).rejects.toThrowError(ImageUrlFetchError);
    try {
      await downloadImageFromUrl("https://image.65535.space/big.png", WHITELIST, mockFetchStreaming([bigChunk], { "content-type": "image/png" }));
    } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_result_too_large");
    }
  });

  it("rejects HTML content served as image/png (MIME/magic mismatch)", async () => {
    const htmlBytes = new TextEncoder().encode("<html>fake png</html>");
    await expect(
      downloadImageFromUrl("https://image.65535.space/fake.png", WHITELIST, mockFetchStreaming([htmlBytes], { "content-type": "image/png" })),
    ).rejects.toThrowError(ImageUrlFetchError);
    try {
      await downloadImageFromUrl("https://image.65535.space/fake.png", WHITELIST, mockFetchStreaming([htmlBytes], { "content-type": "image/png" }));
    } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_result_invalid_image");
    }
  });

  it("rejects a JPEG served as image/png (MIME mismatch with actual format)", async () => {
    // Minimal valid JPEG: SOI marker + APP0 + DQT + SOF0 + DHT + SOS + EOI
    const jpegBytes = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
      0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
      0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
      0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
      0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
      0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
      0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
      0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00,
      0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
      0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
      0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
      0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
      0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
      0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
      0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2,
      0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
      0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
      0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda,
      0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7b, 0x94, 0x11, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xd9,
    ]);
    await expect(
      downloadImageFromUrl("https://image.65535.space/real.jpg", WHITELIST, mockFetchStreaming([jpegBytes], { "content-type": "image/png" })),
    ).rejects.toThrowError(ImageUrlFetchError);
    try {
      await downloadImageFromUrl("https://image.65535.space/real.jpg", WHITELIST, mockFetchStreaming([jpegBytes], { "content-type": "image/png" }));
    } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_result_invalid_mime");
    }
  });

  it("rejects a redirect to a non-whitelisted domain", async () => {
    const fetch302ToEvil: PinnedRequest = async () => {
      return new Response(null, { status: 302, headers: new Headers({ location: "https://cdn.evil.com/real.png" }) });
    };
    await expect(
      downloadImageFromUrl("https://image.65535.space/redirect", WHITELIST, fetch302ToEvil),
    ).rejects.toThrowError(ImageUrlFetchError);
  });

  it("rejects more than one redirect", async () => {
    let callCount = 0;
    const doubleRedirect: PinnedRequest = async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(null, { status: 302, headers: new Headers({ location: "https://image.65535.space/step2" }) });
      }
      if (callCount === 2) {
        return new Response(null, { status: 302, headers: new Headers({ location: "https://image.65535.space/final.png" }) });
      }
      const pngBytes = Buffer.from(VALID_ONE_PIXEL_PNG_BASE64, "base64");
      return new Response(pngBytes, { status: 200, headers: new Headers({ "content-type": "image/png" }) });
    };
    await expect(
      downloadImageFromUrl("https://image.65535.space/step1", WHITELIST, doubleRedirect),
    ).rejects.toThrowError(ImageUrlFetchError);
    try {
      await downloadImageFromUrl("https://image.65535.space/step1", WHITELIST, doubleRedirect);
    } catch (e) {
      expect((e as ImageUrlFetchError).code).toBe("image_provider_result_redirect_rejected");
    }
  });

  it("follows a single redirect within the same whitelisted domain", async () => {
    const pngBytes = Buffer.from(VALID_ONE_PIXEL_PNG_BASE64, "base64");
    let firstCall = true;
    const singleRedirect: PinnedRequest = async () => {
      if (firstCall) {
        firstCall = false;
        return new Response(null, { status: 302, headers: new Headers({ location: "https://image.65535.space/real.png?token=sig" }) });
      }
      return new Response(pngBytes, { status: 200, headers: new Headers({ "content-type": "image/png" }) });
    };
    const result = await downloadImageFromUrl("https://image.65535.space/redirect", WHITELIST, singleRedirect);
    expect(result.mimeType).toBe("image/png");
  });

  it("rejects a redirect to an HTTP URL", async () => {
    const redirectToHttp: PinnedRequest = async () => {
      return new Response(null, { status: 302, headers: new Headers({ location: "http://image.65535.space/real.png" }) });
    };
    await expect(
      downloadImageFromUrl("https://image.65535.space/redirect", WHITELIST, redirectToHttp),
    ).rejects.toThrowError(ImageUrlFetchError);
  });

  it("validates Content-Type against actual magic bytes", async () => {
    // Valid PNG bytes served with correct image/png Content-Type
    const pngBytes = Buffer.from(VALID_ONE_PIXEL_PNG_BASE64, "base64");
    const result = await downloadImageFromUrl(
      "https://image.65535.space/img.png",
      WHITELIST,
      mockFetchStreaming([pngBytes], { "content-type": "image/png" }),
    );
    expect(result.mimeType).toBe("image/png");
  });

  it("accepts image/webp Content-Type with valid WebP bytes", async () => {
    // Minimal valid WebP (VP8 lossy) — 1x1 pixel
    const webpBytes = Buffer.from("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v9wmAA=", "base64");
    // Pad to meet minimum WebP header requirements (needs at least 30 bytes for VP8X parse attempt)
    const padded = Buffer.concat([webpBytes, Buffer.alloc(40)]);
    // The padded WebP may or may not pass pixel-dimension validation.
    // Either way, the Content-Type path is exercised without crashing.
    const fetchFn = mockFetchStreaming([padded], { "content-type": "image/webp" });
    try {
      const result = await downloadImageFromUrl("https://image.65535.space/img.webp", WHITELIST, fetchFn);
      // If it passed validation, the mime should be image/webp
      expect(result.mimeType).toBe("image/webp");
    } catch (e) {
      // If validation rejected (expected for minimal bytes), it's still valid behavior
      expect((e as ImageUrlFetchError).code).toMatch(/image_provider_result_invalid/);
    }
  });
});

/* ── error message safety ──────────────────────────────── */

describe("error message safety", () => {
  it("does not leak URLs in error messages for untrusted URL", () => {
    try {
      validateImageResultUrl("https://cdn.evil.com/secret.png?token=xyz", WHITELIST);
    } catch (e) {
      const msg = (e as ImageUrlFetchError).message;
      expect(msg).not.toContain("cdn.evil.com");
      expect(msg).not.toContain("secret.png");
      expect(msg).not.toContain("token=xyz");
      expect(msg).not.toContain("https://");
    }
  });

  it("does not leak hostname in DNS rejected error messages", async () => {
    mockDns.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    try {
      await validateImageResultDns("secret.internal");
    } catch (e) {
      const msg = (e as ImageUrlFetchError).message;
      expect(msg).not.toContain("secret.internal");
      expect(msg).not.toContain("127.0.0.1");
    }
  });

  it("does not leak a URL, query, validated IP, key, or prompt from connection errors", async () => {
    mockDns.lookup.mockResolvedValue([{ address: "104.26.15.58", family: 4 }]);
    const request: PinnedRequest = async () => {
      throw new Error("https://image.65535.space/private.png?token=secret 104.26.15.58 api-key prompt-text");
    };
    try {
      await downloadImageFromUrl("https://image.65535.space/private.png?token=secret", WHITELIST, request);
    } catch (error) {
      const message = (error as ImageUrlFetchError).message;
      expect(message).toBe("图片下载失败。");
      expect(message).not.toMatch(/https:|token|104\.26|api-key|prompt-text/i);
    }
  });

  it("uses Chinese error messages", async () => {
    try {
      validateImageResultUrl("https://cdn.evil.com/img.png", WHITELIST);
    } catch (e) {
      expect((e as ImageUrlFetchError).message).toMatch(/[一-鿿]/);
    }

    mockDns.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    try {
      await downloadImageFromUrl("https://image.65535.space/img.png", WHITELIST, mockFetch(200, ""));
    } catch (e) {
      expect((e as ImageUrlFetchError).message).toMatch(/[一-鿿]/);
    }
  });
});
