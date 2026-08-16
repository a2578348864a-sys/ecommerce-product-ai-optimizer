/**
 * V3 Final R9（§151）：resolvePublicSourceImageUrl 测试（图片找货自动预填数据源解析）
 */
import { describe, expect, it } from "vitest";
import { resolvePublicSourceImageUrl } from "./sourceImageUrl";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("resolvePublicSourceImageUrl", () => {
  it("productBatchSnapshot.imageUrl 为公网 https → 返回", () => {
    const result = {
      sourceMeta: {
        productBatchSnapshot: { imageUrl: "https://m.media-amazon.com/images/I/71X8e8wz7mL._AC_SL1500_.jpg" },
      },
    };
    expect(resolvePublicSourceImageUrl(result)).toBe("https://m.media-amazon.com/images/I/71X8e8wz7mL._AC_SL1500_.jpg");
  });

  it("candidateSnapshot.imageUrl 为公网 https → 返回", () => {
    const result = {
      sourceMeta: { candidateSnapshot: { imageUrl: "https://img.alicdn.com/imgextra/i4/abc.jpg" } },
    };
    expect(resolvePublicSourceImageUrl(result)).toBe("https://img.alicdn.com/imgextra/i4/abc.jpg");
  });

  it("productIdentity.image 为公网 https → 返回", () => {
    const result = { productIdentity: { image: "https://cdn.example.com/p.png" } };
    expect(resolvePublicSourceImageUrl(result)).toBe("https://cdn.example.com/p.png");
  });

  it("dataUrl 快照 / 内网 / http / 相对路径 → null（不预填，用户手动粘贴）", () => {
    expect(resolvePublicSourceImageUrl({ sourceMeta: { productBatchSnapshot: { imageUrl: PNG_DATA_URL } } })).toBeNull();
    expect(resolvePublicSourceImageUrl({ sourceMeta: { productBatchSnapshot: { imageUrl: "http://192.168.1.1/a.jpg" } } })).toBeNull();
    expect(resolvePublicSourceImageUrl({ sourceMeta: { productBatchSnapshot: { imageUrl: "http://example.com/a.jpg" } } })).toBeNull();
    expect(resolvePublicSourceImageUrl({ sourceMeta: { productBatchSnapshot: { imageUrl: "/local/a.jpg" } } })).toBeNull();
    expect(resolvePublicSourceImageUrl({})).toBeNull();
    expect(resolvePublicSourceImageUrl(null)).toBeNull();
  });

  it("https 但含空白字符 → null", () => {
    expect(resolvePublicSourceImageUrl({ sourceMeta: { productBatchSnapshot: { imageUrl: "https://example.com/a b.jpg" } } })).toBeNull();
  });
});
