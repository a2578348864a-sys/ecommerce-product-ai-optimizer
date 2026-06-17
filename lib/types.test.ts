import { describe, it, expect } from "vitest";
import { CROSS_BORDER_PLATFORMS, ALL_KNOWN_PLATFORMS, platformOptions } from "@/lib/types";

describe("platform constants", () => {
  it("CROSS_BORDER_PLATFORMS includes all cross-border platforms", () => {
    expect(CROSS_BORDER_PLATFORMS).toContain("amazon");
    expect(CROSS_BORDER_PLATFORMS).toContain("shopify");
    expect(CROSS_BORDER_PLATFORMS).toContain("ebay");
    expect(CROSS_BORDER_PLATFORMS).toContain("etsy");
    expect(CROSS_BORDER_PLATFORMS).toContain("tiktok_shop");
    expect(CROSS_BORDER_PLATFORMS).toContain("shopee");
    expect(CROSS_BORDER_PLATFORMS).toContain("lazada");
    expect(CROSS_BORDER_PLATFORMS).toContain("temu");
    expect(CROSS_BORDER_PLATFORMS).toContain("other");
  });

  it("ALL_KNOWN_PLATFORMS includes both overseas and cross-border", () => {
    expect(ALL_KNOWN_PLATFORMS).toContain("amazon");
    expect(ALL_KNOWN_PLATFORMS).toContain("tiktok");
    expect(ALL_KNOWN_PLATFORMS).toContain("alibaba");
  });

  it("platformOptions contains overseas content platforms", () => {
    expect(platformOptions).toContain("tiktok");
    expect(platformOptions).toContain("amazon");
    expect(platformOptions).toContain("etsy");
    expect(platformOptions).toContain("shopify");
    expect(platformOptions).toContain("manual");
    // TikTok Shop (selling platform) is separate from TikTok (content platform)
    expect(CROSS_BORDER_PLATFORMS).toContain("tiktok_shop");
  });
});
