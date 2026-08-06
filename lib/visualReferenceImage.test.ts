import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { decodeVisualReferenceImage, VisualReferenceImageError } from "@/lib/visualReferenceImage";

// 1x1 透明 PNG（真实 magic bytes）
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TINY_PNG_SHA256 = "c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    dataUrl: `data:image/png;base64,${TINY_PNG.toString("base64")}`,
    mimeType: "image/png",
    contentHash: TINY_PNG_SHA256,
    productKey: "amazon:US:B0TEST0001",
    candidateIdentityHash: sha256("sellersprite-candidate-identity:v1:amazon:US:B0TEST0001"),
    ...overrides,
  };
}

describe("decodeVisualReferenceImage (V2 Visual Reference Preview 解码)", () => {
  it("合法快照解码成功：字节/MIME/contentHash 全部校验", () => {
    const image = decodeVisualReferenceImage(makeSnapshot());
    expect(image).not.toBeNull();
    expect(image!.mimeType).toBe("image/png");
    expect(image!.contentHash).toBe(TINY_PNG_SHA256);
    expect(image!.bytes).toEqual(new Uint8Array(TINY_PNG));
    expect(image!.productKey).toBe("amazon:US:B0TEST0001");
  });

  it("null 快照 → null（不抛错，调用方按 404）", () => {
    expect(decodeVisualReferenceImage(null)).toBeNull();
  });

  it("dataUrl 格式非法（非 base64 图片）→ null", () => {
    expect(decodeVisualReferenceImage(makeSnapshot({ dataUrl: "not-a-dataurl" }))).toBeNull();
    expect(decodeVisualReferenceImage(makeSnapshot({ dataUrl: "data:text/plain;base64,AAAA" }))).toBeNull();
  });

  it("magic bytes 不匹配（MIME 声称 png 但内容不是）→ null", () => {
    // 注意：base64 "iVBORw0KGgo" 解码正是 PNG magic —— 必须用真正非图片内容
    const text = Buffer.from("hello world this is not an image at all");
    expect(decodeVisualReferenceImage(makeSnapshot({ dataUrl: `data:image/png;base64,${text.toString("base64")}` }))).toBeNull();
    // JPEG magic 内容但声称 png → 拒绝
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(decodeVisualReferenceImage(makeSnapshot({ dataUrl: `data:image/png;base64,${jpeg.toString("base64")}` }))).toBeNull();
  });

  it("contentHash 断言不一致 → 抛 VisualReferenceImageError（fail-closed）", () => {
    expect(() => decodeVisualReferenceImage(makeSnapshot(), "b".repeat(64)))
      .toThrow(VisualReferenceImageError);
    try {
      decodeVisualReferenceImage(makeSnapshot(), "b".repeat(64));
      expect.fail("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(VisualReferenceImageError);
      expect((error as VisualReferenceImageError).code).toBe("visual_reference_content_hash_mismatch");
    }
  });

  it("期望 hash 匹配时通过（即使快照字段 contentHash 不同——以期望为准）", () => {
    // 快照字段声明错误 hash，但期望 hash 为真实值 → 以期望为准校验
    const image = decodeVisualReferenceImage(makeSnapshot({ contentHash: "b".repeat(64) }), TINY_PNG_SHA256);
    expect(image).not.toBeNull();
    expect(image!.contentHash).toBe(TINY_PNG_SHA256);
  });

  it("超大字节（>2MiB）→ null（大小限制）", () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1, 0x89); // 非合法 PNG 但先过大小
    const bigPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), big]);
    expect(decodeVisualReferenceImage(makeSnapshot({ dataUrl: `data:image/png;base64,${bigPng.toString("base64")}` }))).toBeNull();
  });

  it("base64 无效（含非法字符）→ null", () => {
    expect(decodeVisualReferenceImage(makeSnapshot({ dataUrl: `data:image/png;base64,${"!!!not-base64!!!"}` }))).toBeNull();
  });
});
