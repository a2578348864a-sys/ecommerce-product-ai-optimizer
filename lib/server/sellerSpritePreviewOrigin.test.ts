import { describe, expect, it } from "vitest";
import { hasSellerSpritePreviewSameOrigin } from "./sellerSpritePreviewOrigin";

const expectedOrigin = "http://127.0.0.1:3105";
const routeUrl = `${expectedOrigin}/api/opportunities/sellersprite-preview`;

function request(
  headers: Record<string, string> = {},
  url = routeUrl,
  host: string | null = new URL(expectedOrigin).host,
): Request {
  const requestHeaders = new Headers(headers);
  if (host !== null) requestHeaders.set("host", host);
  return new Request(url, { method: "POST", headers: requestHeaders });
}

describe("SellerSprite Preview same-origin boundary", () => {
  it("allows an exact Origin and a same-origin Referer fallback", () => {
    expect(hasSellerSpritePreviewSameOrigin(request({ origin: expectedOrigin }))).toBe(true);
    expect(hasSellerSpritePreviewSameOrigin(request({
      referer: `${expectedOrigin}/opportunities/sellersprite-preview?source=local`,
    }))).toBe(true);
  });

  it("compares normalized URL origins without ignoring scheme, host, or port", () => {
    expect(hasSellerSpritePreviewSameOrigin(request({ origin: "HTTP://127.0.0.1:3105" }))).toBe(true);
    for (const origin of [
      "https://127.0.0.1:3105",
      "http://127.0.0.1:3106",
      "http://localhost:3105",
      "http://127.0.0.1:3105.evil.example",
    ]) {
      expect(hasSellerSpritePreviewSameOrigin(request({ origin }))).toBe(false);
    }
  });

  it("derives the expected origin from the current direct-request Host authority", () => {
    const localhost = "http://localhost:3105";
    const localhostRoute = `${localhost}/api/opportunities/sellersprite-preview`;

    expect(hasSellerSpritePreviewSameOrigin(request({ origin: expectedOrigin }, localhostRoute, "127.0.0.1:3105"))).toBe(true);
    expect(hasSellerSpritePreviewSameOrigin(request({ origin: localhost }, localhostRoute, "127.0.0.1:3105"))).toBe(false);
    expect(hasSellerSpritePreviewSameOrigin(request({ origin: expectedOrigin }, localhostRoute, "localhost:3105"))).toBe(false);
    expect(hasSellerSpritePreviewSameOrigin(request({
      referer: `${expectedOrigin}/opportunities/sellersprite-preview`,
    }, localhostRoute, "127.0.0.1:3105"))).toBe(true);
  });

  it("fails closed when Origin is null, malformed, path-bearing, or inconsistent with Referer", () => {
    const rejectedHeaders: Array<Record<string, string>> = [
      {},
      { origin: "null" },
      { origin: "not a URL" },
      { origin: `${expectedOrigin}/unexpected-path` },
      { origin: expectedOrigin, referer: "https://attacker.test/preview" },
      { origin: "https://attacker.test", referer: `${expectedOrigin}/opportunities/sellersprite-preview` },
      { referer: "not a URL" },
    ];
    for (const headers of rejectedHeaders) {
      expect(hasSellerSpritePreviewSameOrigin(request(headers))).toBe(false);
    }
  });

  it.each([
    [null],
    [""],
    ["localhost:3105, attacker.test"],
    ["http://localhost:3105"],
    ["localhost:3105/path"],
    ["user@localhost:3105"],
  ])("fails closed for an absent or invalid direct-request Host authority: %s", (host) => {
    expect(hasSellerSpritePreviewSameOrigin(request({ origin: expectedOrigin }, routeUrl, host))).toBe(false);
  });
});
