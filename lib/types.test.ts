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

  it("ALL_KNOWN_PLATFORMS includes both Chinese and cross-border", () => {
    expect(ALL_KNOWN_PLATFORMS).toContain("jd");
    expect(ALL_KNOWN_PLATFORMS).toContain("amazon");
    expect(ALL_KNOWN_PLATFORMS).toContain("tiktok");
    expect(ALL_KNOWN_PLATFORMS).toContain("alibaba");
  });

  it("platformOptions still contains Chinese radar platforms", () => {
    expect(platformOptions).toContain("jd");
    expect(platformOptions).toContain("xhs");
    expect(platformOptions).toContain("manual");
    // Cross-border platforms should NOT be in platformOptions
    expect(platformOptions as readonly string[]).not.toContain("amazon");
  });
});
