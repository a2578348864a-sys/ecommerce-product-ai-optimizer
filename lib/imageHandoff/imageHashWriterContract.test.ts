import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMockImageProvider } from "@/lib/imageHandoff/mockImageProvider";
import { normalizeAiImageDraftItem, type AiImageDraftItem } from "@/lib/aiImageDraft";
import type { ImageGenerationInput, ImageVisualMode } from "@/lib/imageHandoff/imageGenerationInput";

/**
 * Hash Writer 合同（Final Freeze）：
 *   - promptHash / requestKeyHash 有效值必为 lowercase 64-hex SHA-256
 *   - 无真实 Hash → 字段省略（undefined），禁止写入 "real"/"mock" 占位符
 *   - 历史 "real"/"mock" 仅由 Reader（normalizeProviderHash）作 legacy placeholder 规范化
 *   - 其他非 64-hex 值 fail-closed 拒绝
 */

const realProviderSource = readFileSync(resolve(process.cwd(), "lib/imageHandoff/realImageProvider.ts"), "utf8");
const mockProviderSource = readFileSync(resolve(process.cwd(), "lib/imageHandoff/mockImageProvider.ts"), "utf8");
const legacyServiceSource = readFileSync(resolve(process.cwd(), "lib/server/aiImageDraftService.ts"), "utf8");

function buildInput(mode: ImageVisualMode = "composition_concept"): ImageGenerationInput {
  return {
    schema: "image-generation-input.v1",
    mode,
    source: { handoffRevision: 1, researchRevision: 1 },
    productFacts: [{ field: "brand", label: "品牌", value: "TestBrand" }],
    approvedVisualReferences: [],
    compositionReferences: ["户外场景", "白底"],
    creativePreferences: { imageStyle: "minimalist" },
    prohibitedVisualClaims: [],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
  } as unknown as ImageGenerationInput;
}

function baseItem(): AiImageDraftItem {
  return {
    id: "123e4567-e89b-42d3-a456-426614174001",
    imageType: "lifestyle_scene",
    model: "openai-compatible-relay",
    createdAt: "2026-08-07T00:00:00.000Z",
    storageKey: "owner/task-1/123e4567-e89b-42d3-a456-426614174001.png",
    mimeType: "image/png",
    width: 1,
    height: 1,
    fileSizeBytes: 68,
    sha256: "a".repeat(64),
    reviewStatus: "needs_human_review",
    accessMode: "owner",
    source: "real_ai_image_draft",
    safetyWarnings: [],
    generationBasis: { productName: "T", sellingPoints: [], riskWarnings: [], missingFacts: [], imageMaterialNeeds: [] },
  };
}

describe("Image Hash Writer 合同（Final Freeze）", () => {
  // 1. real provider 新 item：不得持久化 "real" 到 Hash 字段
  // （真实 Provider 调用需付费凭据，禁止调用；源码级断言 Writer 不再写占位符）
  it("real provider 源码不再写 promptHash/requestKeyHash 占位符", () => {
    expect(realProviderSource).not.toContain('promptHash: "real"');
    expect(realProviderSource).not.toContain('requestKeyHash: "real"');
    // 不得为填满字段制造假 Hash（无 sha256(prompt) 注入 Hash 字段）
    expect(realProviderSource).not.toMatch(/promptHash:\s*createHash/);
  });

  // 2. mock provider 新 item：不得持久化 "mock" 到 Hash 字段
  it("mock provider 源码与运行时输出不再写 promptHash/requestKeyHash 占位符", async () => {
    expect(mockProviderSource).not.toContain('promptHash: "mock"');
    expect(mockProviderSource).not.toContain('requestKeyHash: "mock"');
    const provider = createMockImageProvider();
    const composition = await provider.generate(buildInput("composition_concept"), {}) as Record<string, unknown>;
    expect("promptHash" in composition).toBe(false);
    expect("requestKeyHash" in composition).toBe(false);
    const visual = await provider.generate(
      { ...buildInput("product_visual_draft"), approvedVisualReferences: [{ referenceFingerprint: "v".repeat(64), summary: "ref" } as never] } as ImageGenerationInput,
      {},
    ) as Record<string, unknown>;
    expect("promptHash" in visual).toBe(false);
    expect("requestKeyHash" in visual).toBe(false);
  });

  // 3. 有真实 Hash：必须是 64-hex 并正确保留（旧 ai-generate 服务路径）
  it("有真实 64-hex Hash 时 normalize 正确保留（不变量）", () => {
    // 旧 ai-generate 服务：sha256(prompt) 真实 64-hex（不回归）
    expect(legacyServiceSource).toMatch(/createHash\("sha256"\)\.update\(prompt\)\.digest\("hex"\)/);
    const normalized = normalizeAiImageDraftItem({ ...baseItem(), promptHash: "B".repeat(64), requestKeyHash: "c".repeat(64) });
    expect(normalized?.promptHash).toBe("b".repeat(64)); // lowercase 归一
    expect(normalized?.requestKeyHash).toBe("c".repeat(64));
  });

  // 4. 无真实 Hash：字段省略/undefined（writer 省略 + normalize 保持）
  it("无 Hash 字段时 normalize 通过且为 undefined", () => {
    const normalized = normalizeAiImageDraftItem(baseItem());
    expect(normalized?.promptHash).toBeUndefined();
    expect(normalized?.requestKeyHash).toBeUndefined();
  });

  // 5. 历史 "real"/"mock"：仍可读取（Reader legacy 兼容，7baead3 保持）
  it("历史 'real'/'mock' 占位符 normalize → undefined（legacy 兼容不回归）", () => {
    for (const placeholder of ["real", "mock"]) {
      const normalized = normalizeAiImageDraftItem({ ...baseItem(), promptHash: placeholder, requestKeyHash: placeholder });
      expect(normalized?.promptHash).toBeUndefined();
      expect(normalized?.requestKeyHash).toBeUndefined();
      expect(normalized?.storageKey).toBe(baseItem().storageKey);
    }
  });

  // 6. 非法未知字符串：仍拒绝（fail-closed 不降低）
  it("非法非 64-hex 字符串仍拒绝 item（fail-closed 保持）", () => {
    for (const bad of ["REAL", "real2", "not-a-hash", "mock-ish", "x".repeat(64)]) {
      expect(normalizeAiImageDraftItem({ ...baseItem(), promptHash: bad })).toBeNull();
      expect(normalizeAiImageDraftItem({ ...baseItem(), requestKeyHash: bad })).toBeNull();
    }
  });

  // 7. 幂等语义：缺失 Hash 不得误命中；真实 Hash 语义不回归
  it("duplicateResult 幂等比较不因缺失 Hash 误命中（requestKeyHash 缺失 item 永不匹配新请求 64-hex hash）", () => {
    const requestHash = "e".repeat(64);
    // 历史占位符 item（Reader 后为 undefined）→ 永不命中
    const legacyItem = normalizeAiImageDraftItem({ ...baseItem(), promptHash: "real", requestKeyHash: "real" });
    expect(legacyItem?.requestKeyHash).toBeUndefined();
    expect(legacyItem?.requestKeyHash === requestHash).toBe(false);
    // 真实 64-hex item 正常匹配（不回归）
    const realItem = normalizeAiImageDraftItem({ ...baseItem(), promptHash: "b".repeat(64), requestKeyHash: requestHash });
    expect(realItem?.requestKeyHash === requestHash).toBe(true);
  });
});
