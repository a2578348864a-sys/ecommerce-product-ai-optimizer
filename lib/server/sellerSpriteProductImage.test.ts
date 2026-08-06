import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildSellerSpriteProductImageSnapshot,
  fetchSellerSpriteProductImage,
  SELLERSPRITE_IMAGE_HOSTS,
} from "@/lib/server/sellerSpriteProductImage";

// 1x1 透明 PNG（真实 magic bytes）
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TINY_PNG_SHA256 = "c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77";

function fakeFetch() {
  return vi.fn();
}

describe("sellerSpriteProductImage (P1-1 图片资产化)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("主机白名单仅允许 Amazon 商品主图 CDN", () => {
    expect(SELLERSPRITE_IMAGE_HOSTS).toEqual(new Set([
      "m.media-amazon.com",
      "images-na.ssl-images-amazon.com",
    ]));
  });

  it("imageUrl 为空时返回 null（不下载、不报错）", async () => {
    const result = await fetchSellerSpriteProductImage(null);
    expect(result).toBeNull();
    const result2 = await fetchSellerSpriteProductImage("   ");
    expect(result2).toBeNull();
  });

  it("白名单外域名（SSRF 风险）→ 降级 null 且不触发真实网络", async () => {
    const result = await fetchSellerSpriteProductImage("https://evil.example.com/img.png");
    expect(result).toBeNull();
  });

  it("构造的快照可被 parseProductImageSnapshot 严格验证通过", async () => {
    const snapshot = buildSellerSpriteProductImageSnapshot({
      fetched: {
        bytes: TINY_PNG,
        mimeType: "image/png",
        sha256: TINY_PNG_SHA256,
      },
      asin: "B0TEST0001",
      capturedAt: "2026-08-06T00:00:00.000Z",
    });
    expect(snapshot.version).toBe("product-batch-product-image.v1");
    expect(snapshot.source).toBe("sellersprite_product_batch");
    expect(snapshot.productKey).toBe("amazon:US:B0TEST0001");
    expect(snapshot.candidateIdentityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.mimeType).toBe("image/png");
    expect(snapshot.bytes).toBe(TINY_PNG.length);
    expect(snapshot.contentHash).toBe(TINY_PNG_SHA256);
    expect(snapshot.dataUrl).toContain("data:image/png;base64,");

    const { parseProductImageSnapshot } = await import("@/lib/productResearchImage");
    const reparsed = parseProductImageSnapshot(snapshot);
    expect(reparsed).not.toBeNull();
    expect(reparsed?.productKey).toBe("amazon:US:B0TEST0001");
  });

  it("非法 ASIN 拒绝构造", () => {
    expect(() => buildSellerSpriteProductImageSnapshot({
      fetched: { bytes: TINY_PNG, mimeType: "image/png", sha256: TINY_PNG_SHA256 },
      asin: "not-an-asin",
      capturedAt: "2026-08-06T00:00:00.000Z",
    })).toThrow();
  });

  it("超大 dataUrl 拒绝构造（内嵌上限保护）", () => {
    // >2.1MiB 原始字节 → base64 >2.8MB，超出内嵌上限
    const big = Buffer.alloc(2_200_000, 0x89);
    expect(() => buildSellerSpriteProductImageSnapshot({
      fetched: { bytes: big, mimeType: "image/jpeg", sha256: "b".repeat(64) },
      asin: "B0TEST0001",
      capturedAt: "2026-08-06T00:00:00.000Z",
    })).toThrow(/image_data_url_too_large|内嵌存储上限/);
  });
});
