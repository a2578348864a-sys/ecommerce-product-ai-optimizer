import "server-only";

import type { ImageGenerationInput } from "@/lib/imageHandoff/imageGenerationInput";
import type { ImageVisualMode } from "@/lib/imageHandoff/imageGenerationInput";

/**
 * PR2-3 隔离 Mock Image Provider：
 * - 确定性（不联网、不读正式环境变量、不写数据库）
 * - 可记录调用次数与收到的安全输入（供证据证明只收到允许字段）
 * - 支持 composition_concept / product_visual_draft
 * - 可返回合法/非法输出、可含越权断言、可延迟、可模拟 Provider 错误
 * - 不返回外部 URL；输出为安全摘要形态（本阶段无真实图片资产）
 */

export type MockImageProviderOptions = {
  /** 延迟返回毫秒数（制造竞态） */
  delayMs?: number;
  /** 返回非法结构（schema 校验失败） */
  forceInvalidSchema?: boolean;
  /** 输出含产品外观断言（composition 模式越权） */
  forceProductAssertion?: boolean;
  /** 模拟 Provider 错误 */
  forceProviderError?: boolean;
  /** product_visual_draft 模式但无批准参考（合同越权） */
  forceMissingReference?: boolean;
  count?: 1 | 2;
  persist?: {
    accessMode: "owner" | "visitor";
    visitorAccessId?: string;
    taskId: string;
  };
  tag?: string;
};

export type MockImageProviderCallRecord = {
  order: number;
  received: {
    schema: string;
    mode: ImageVisualMode;
    source: { handoffRevision: number; researchRevision: number };
    productFactFields: string[];
    approvedVisualReferenceCount: number;
    compositionReferenceCount: number;
    prohibitedClaimCount: number;
    unknownCount: number;
    hasInternalKey: boolean;
    inputKeyCount: number;
  };
};

const MOCK_IMAGE_MODEL = "mock-image-provider-v1";

function cleanText(value: string): string {
  return value.trim().replace(/\s{2,}/g, " ").slice(0, 500);
}

/** 从安全 Image Input 构造确定性 Mock 摘要输出（composition_concept） */
function buildCompositionDraft(input: ImageGenerationInput): Record<string, unknown> {
  const modeLabel = "composition_concept";
  const prefs = input.creativePreferences;
  return {
    id: "mock-image-composition",
    imageType: "lifestyle_scene",
    model: MOCK_IMAGE_MODEL,
    createdAt: "2026-08-05T00:00:00.000Z",
    storageKey: `owner/mock/${input.source.handoffRevision}-${input.source.researchRevision}.png`,
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    fileSizeBytes: 0,
    sha256: "mock",
    reviewStatus: "needs_human_review",
    accessMode: "owner",
    source: "real_ai_image_draft",
    safetyWarnings: ["Composition concept only; does not represent real product appearance."],
    promptSummary: `构图概念 · ${prefs.targetMarket ?? "通用构图方向"}`,
    // Hash 合同：无真实 SHA-256 时不写 promptHash/requestKeyHash 字段（不制造假 Hash）
    generationBasis: {
      productName: "composition concept",
      sellingPoints: [],
      riskWarnings: [],
      missingFacts: [],
      imageMaterialNeeds: [],
    },
    handoffMode: modeLabel,
    compositionSummary: cleanText(`Abstract composition concept for listing material planning. Background direction, scene mood, whitespace areas and colour direction only. ${prefs.backgroundPreference ?? ""}`.trim()),
  };
}

/** product_visual_draft 输出（基于批准参考） */
function buildVisualDraft(input: ImageGenerationInput): Record<string, unknown> {
  const ref = input.approvedVisualReferences[0];
  return {
    id: "mock-image-visual",
    imageType: "white_background_concept",
    model: MOCK_IMAGE_MODEL,
    createdAt: "2026-08-05T00:00:00.000Z",
    storageKey: `owner/mock/${input.source.handoffRevision}-${input.source.researchRevision}-visual.png`,
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    fileSizeBytes: 0,
    sha256: "mock",
    reviewStatus: "needs_human_review",
    accessMode: "owner",
    source: "real_ai_image_draft",
    safetyWarnings: ["Product visual draft based on approved reference; human review required before any use."],
    promptSummary: `产品视觉草稿 · ${ref?.summary ?? "approved reference"}`,
    // Hash 合同：无真实 SHA-256 时不写 promptHash/requestKeyHash 字段（不制造假 Hash）
    generationBasis: {
      productName: "product visual draft",
      sellingPoints: [],
      riskWarnings: [],
      missingFacts: [],
      imageMaterialNeeds: [],
    },
    handoffMode: "product_visual_draft",
    approvedReferenceFingerprint: ref?.referenceFingerprint,
    compositionSummary: cleanText("Product visual draft derived strictly from the approved visual reference."),
  };
}

/** 隔离 Mock Image Provider 调用器 */
export function createMockImageProvider() {
  let calls = 0;
  const records: MockImageProviderCallRecord[] = [];

  return {
    get model() {
      return MOCK_IMAGE_MODEL;
    },
    get callCount() {
      return calls;
    },
    get records(): ReadonlyArray<MockImageProviderCallRecord> {
      return records;
    },
    async generate(input: ImageGenerationInput, options: MockImageProviderOptions = {}): Promise<unknown> {
      calls += 1;
      records.push({
        order: calls,
        received: {
          schema: input.schema,
          mode: input.mode,
          source: { handoffRevision: input.source.handoffRevision, researchRevision: input.source.researchRevision },
          productFactFields: input.productFacts.map((f) => f.field),
          approvedVisualReferenceCount: input.approvedVisualReferences.length,
          compositionReferenceCount: input.compositionReferences.length,
          prohibitedClaimCount: input.prohibitedVisualClaims.length,
          unknownCount: input.unknowns.length,
          hasInternalKey: false,
          inputKeyCount: Object.keys(input).length,
        },
      });
      if (options.delayMs && options.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (options.forceProviderError) {
        throw new Error("mock_image_provider_failed");
      }
      if (options.forceInvalidSchema) {
        return { broken: true };
      }
      const count = options.count === 2 ? 2 : 1;
      const drafts: Record<string, unknown>[] = [];
      for (let index = 0; index < count; index += 1) {
        const baseDraft = input.mode === "product_visual_draft"
          ? buildVisualDraft(input)
          : buildCompositionDraft(input);
        let draft: Record<string, unknown> = {
          ...baseDraft,
          id: `${String(baseDraft.id)}-${options.tag ?? "candidate"}-${index + 1}`,
          compositionSummary: `${String(baseDraft.compositionSummary)} Candidate ${index + 1}.`,
        };
        if (options.forceMissingReference && input.mode === "product_visual_draft") {
          draft = { ...draft, approvedReferenceFingerprint: undefined };
        }
        if (options.forceProductAssertion && input.mode === "composition_concept") {
          draft = { ...draft, compositionSummary: "Real product photo with exact colour and material as photographed." };
        }
        if (options.persist) {
          const [{ default: sharp }, { storeAiImage }] = await Promise.all([
            import("sharp"),
            import("@/lib/server/aiImageDraftStorage"),
          ]);
          const bytes = await sharp({
            create: {
              width: 640,
              height: 640,
              channels: 4,
              background: index === 0
                ? { r: 226, g: 243, b: 236, alpha: 1 }
                : { r: 231, g: 238, b: 248, alpha: 1 },
            },
          }).png().toBuffer();
          const stored = await storeAiImage({
            accessMode: options.persist.accessMode,
            visitorAccessId: options.persist.visitorAccessId,
            taskId: options.persist.taskId,
            bytes,
          });
          draft = {
            ...draft,
            id: stored.id,
            storageKey: stored.storageKey,
            mimeType: stored.mimeType,
            width: stored.width,
            height: stored.height,
            fileSizeBytes: stored.fileSizeBytes,
            sha256: stored.sha256,
            accessMode: options.persist.accessMode,
          };
        }
        drafts.push(draft);
      }
      return count === 1 ? drafts[0] : drafts;
    },
  };
}

export type MockImageProvider = ReturnType<typeof createMockImageProvider>;

/** 验证 Mock Provider 只收到允许字段（供证据断言） */
export function assertMockImageInputIsSafe(records: readonly MockImageProviderCallRecord[]): boolean {
  const allowedKeys = [
    "schema", "mode", "source", "productFacts", "approvedVisualReferences",
    "compositionReferences", "creativePreferences", "prohibitedVisualClaims",
    "unknowns", "humanReviewRequired", "researchMode", "promotionEligible",
    "referenceImageDataUrl", "creativeContext",
  ];
  for (const record of records) {
    if (record.received.hasInternalKey) return false;
    if (record.received.inputKeyCount > allowedKeys.length) return false;
  }
  return true;
}
