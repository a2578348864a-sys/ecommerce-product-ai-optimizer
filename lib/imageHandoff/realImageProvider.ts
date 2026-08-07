import "server-only";

/**
 * V2 Final Integration: 真实 Image Provider Adapter（复用现有 openaiImageClient + aiImageDraftStorage）。
 *
 * 不重造 Provider：包装既有 generateOpenAiImage（openai_compatible_relay 真实文生图）：
 *   - 真实模型调用（OPENAI_IMAGE_BASE_URL / OPENAI_IMAGE_MODEL env 配置）
 *   - base64 结果 / relay URL 安全下载（DNS 校验 + SSRF 防护 + magic bytes 校验）
 *   - 超时/429/5xx/非JSON/空响应/URL 不可信错误映射
 *
 * 能力边界（审计确认）：
 *   - 真实 Provider 仅支持文生图（imageType/prompt/size），无参考图/图生图参数。
 *   - composition_concept：真实调用可用。
 *   - product_visual_draft：真实 Provider 不支持参考图 → 保持禁用（mock-only），
 *     最终分类 V2_FINAL_REAL_IMAGE_REFERENCE_UNSUPPORTED，不假装用文字描述实现参考图能力。
 *
 * Provider 模式由服务端环境变量决定（IMAGE_PROVIDER_MODE=mock|real），fail-closed：
 *   - 配置缺失/非法 → 稳定配置错误（绝不静默回退）
 *   - real 模式缺 Key → openaiImageClient 返回 configuration_error
 *
 * 图片资产：真实 Provider 返回 base64 → 复用 aiImageDraftStorage 持久化
 *   （storageKey 校验/原子写入/magic bytes/MIME/尺寸/大小校验，拒绝 SVG 与可执行内容）。
 *   存储根 AI_IMAGE_DRAFT_STORAGE_ROOT 环境配置，位于发布目录之外，可配置为生产持久数据目录。
 *   真实 Provider 失败时清理孤儿资产（阶段C 原子保存失败 → 调用方清理）。
 *
 * 新链只替换阶段B 的 Provider Adapter；阶段A/C 门禁、Visual Gate、原子保存均不变。
 */

import { createHash, randomUUID } from "node:crypto";
import { createMockImageProvider, type MockImageProvider } from "@/lib/imageHandoff/mockImageProvider";
import type { ImageGenerationInput, ImageVisualMode } from "@/lib/imageHandoff/imageGenerationInput";

export type ImageProviderMode = "mock" | "real";

/** 从服务端环境读取 Provider 模式（fail-closed：缺失/非法 → 配置错误） */
export function resolveImageProviderMode(): ImageProviderMode {
  const mode = process.env.IMAGE_PROVIDER_MODE?.trim().toLowerCase();
  if (mode === "real") return "real";
  if (mode === "mock") return "mock";
  throw new Error("IMAGE_PROVIDER_MODE 未配置或非法（必须为 mock 或 real）；已阻止生成。");
}

export function realImageProviderEnabled(): boolean {
  try {
    return resolveImageProviderMode() === "real";
  } catch {
    return false;
  }
}

/** 真实 Provider 能力声明（审计确认）：文生图 + 参考图生图（images.edit；gpt-image-2 支持） */
export const REAL_IMAGE_PROVIDER_CAPABILITY = Object.freeze({
  textToImage: true,
  referenceImage: true,
  supportedModes: ["composition_concept", "product_visual_draft"] as ImageVisualMode[],
  note: "openai SDK images.edit（multipart image+prompt，gpt-image-2 支持 input_fidelity）；参考图真实作为 Provider 输入。",
} as const);

/** product_visual_draft 的编辑 Prompt：保持批准参考产品形态；不增加未知配件/功能/认证/Logo */
function buildProductVisualPrompt(input: ImageGenerationInput): string {
  const factLines = input.productFacts.slice(0, 8).map((f) => `${f.label}: ${f.value}`).join("; ");
  return [
    "Edit the attached approved product reference image into a product visual draft for listing material planning.",
    "Keep the product shape, structure, materials and packaging text exactly as shown in the reference image.",
    "Do NOT add functions, accessories, certifications, logos, or packaging text that are not in the reference image.",
    "Do NOT alter logos or packaging text shown in the reference.",
    "Adjust background, composition, lighting and colour direction only.",
    "Unknown or conflicting details must stay visually neutral; never infer or complete.",
    "The output remains a human-review draft and must not be presented as a finished product photo.",
    factLines ? `Confirmed facts for context only: ${factLines}.` : "",
  ].filter(Boolean).join(" ");
}

/** 从新链安全输入构造现有真实 Provider 所需输入（composition 模式；仅允许字段） */
function buildRealImageInput(input: ImageGenerationInput) {
  const compositionText = [
    ...input.compositionReferences,
    input.creativePreferences.imageStyle ?? "",
    input.creativePreferences.backgroundPreference ?? "",
    input.creativePreferences.compositionPreference ?? "",
  ].filter(Boolean).join("; ");
  return {
    imageType: "lifestyle_scene" as const,
    count: 1 as const,
    prompt: compositionText || "Abstract composition concept for listing material planning; layout, background, mood, colour direction only. Not a real product photograph.",
  };
}

export type RealImageProviderOptions = {
  onProviderCallStart?: () => void | Promise<void>;
  /** 真实 Provider 输出持久化配置（由调用方传入访问模式；服务层阶段B 无 taskId 时由调用方补传） */
  persist?: {
    accessMode: "owner" | "visitor";
    visitorAccessId?: string;
    taskId: string;
  };
};

export type RealImageProvider = {
  model: string;
  callCount: number;
  generate(input: ImageGenerationInput, options?: RealImageProviderOptions): Promise<unknown>;
};

/** 真实 Image Provider Adapter：安全输入 → 现有真实文生图 Provider → 持久化资产 + draft item 合同 */
export function createRealImageProvider(): RealImageProvider {
  let calls = 0;
  return {
    get model() {
      return "openai-compatible-relay";
    },
    get callCount() {
      return calls;
    },
    async generate(input: ImageGenerationInput, options: RealImageProviderOptions = {}) {
      calls += 1;
      if (input.mode === "product_visual_draft") {
        // Final Capability: 参考图生图（images.edit）——参考图必须真实作为 Provider 输入
        if (!input.referenceImageDataUrl) {
          throw new Error("real_image_provider_reference_missing: product_visual_draft 需要批准参考图（referenceImageDataUrl 缺失）。");
        }
        const { generateOpenAiImageEdit } = await import("@/lib/server/openaiImageEditClient") as typeof import("@/lib/server/openaiImageEditClient");
        const output = await generateOpenAiImageEdit({
          imageDataUrl: input.referenceImageDataUrl,
          prompt: buildProductVisualPrompt(input),
        });
        const first = output.images[0];
        if (!first?.base64) {
          throw new Error("real_image_provider_empty: Provider 返回空图片。");
        }
        let stored: {
          id: string; storageKey: string; mimeType: string; width?: number; height?: number;
          fileSizeBytes: number; sha256: string;
        } | null = null;
        if (options.persist) {
          const { decodeAiImageBase64, storeAiImage } = await import("@/lib/server/aiImageDraftStorage") as typeof import("@/lib/server/aiImageDraftStorage");
          try {
            const bytes = decodeAiImageBase64(first.base64);
            stored = await storeAiImage({
              accessMode: options.persist.accessMode,
              visitorAccessId: options.persist.visitorAccessId,
              taskId: options.persist.taskId,
              bytes,
            });
          } catch (error) {
            throw new Error(`real_image_persist_failed:${String(error instanceof Error ? error.message : error)}`);
          }
        }
        return {
          id: stored?.id ?? `real-${randomUUID()}`,
          imageType: "lifestyle_scene",
          model: output.model,
          createdAt: new Date().toISOString(),
          storageKey: stored?.storageKey ?? null,
          mimeType: stored?.mimeType ?? "image/webp",
          width: stored?.width,
          height: stored?.height,
          fileSizeBytes: stored?.fileSizeBytes ?? 0,
          sha256: stored?.sha256 ?? createHash("sha256").update(first.base64).digest("hex").slice(0, 16),
          reviewStatus: "needs_human_review",
          accessMode: options.persist?.accessMode ?? "owner",
          source: "real_ai_image_draft",
          safetyWarnings: ["Product visual draft based on approved reference; human review required before any use.", "Product consistency must be checked against the approved reference."],
          promptSummary: "Product visual draft derived strictly from the approved visual reference.",
          // Hash 合同：无真实 SHA-256 时不写 promptHash/requestKeyHash 字段（不制造假 Hash）
          generationBasis: {
            productName: "product visual draft",
            sellingPoints: [],
            riskWarnings: [],
            missingFacts: [],
            imageMaterialNeeds: [],
          },
          handoffMode: "product_visual_draft" as const,
          approvedReferenceFingerprint: input.approvedVisualReferences[0]?.referenceFingerprint ?? null,
          compositionSummary: "Product visual draft derived strictly from the approved visual reference (real reference-image provider).",
        };
      }
      const { generateOpenAiImage } = await import("@/lib/server/openaiImageClient") as typeof import("@/lib/server/openaiImageClient");
      const providerInput = buildRealImageInput(input);
      const output = await generateOpenAiImage(providerInput as never);
      const first = output.images[0];
      if (!first?.base64) {
        throw new Error("real_image_provider_empty: Provider 返回空图片。");
      }
      // 图片资产持久化（复用现有 aiImageDraftStorage：原子写入/magic bytes/MIME/尺寸校验）
      let stored: {
        id: string;
        storageKey: string;
        mimeType: string;
        width?: number;
        height?: number;
        fileSizeBytes: number;
        sha256: string;
      } | null = null;
      if (options.persist) {
        const { decodeAiImageBase64, storeAiImage } = await import("@/lib/server/aiImageDraftStorage") as typeof import("@/lib/server/aiImageDraftStorage");
        try {
          const bytes = decodeAiImageBase64(first.base64);
          stored = await storeAiImage({
            accessMode: options.persist.accessMode,
            visitorAccessId: options.persist.visitorAccessId,
            taskId: options.persist.taskId,
            bytes,
          });
        } catch (error) {
          throw new Error(`real_image_persist_failed:${String(error instanceof Error ? error.message : error)}`);
        }
      }
      return {
        id: stored?.id ?? `real-${randomUUID()}`,
        imageType: "lifestyle_scene",
        model: output.model,
        createdAt: new Date().toISOString(),
        storageKey: stored?.storageKey ?? null,
        mimeType: stored?.mimeType ?? "image/webp",
        width: stored?.width,
        height: stored?.height,
        fileSizeBytes: stored?.fileSizeBytes ?? 0,
        sha256: stored?.sha256 ?? createHash("sha256").update(first.base64).digest("hex").slice(0, 16),
        reviewStatus: "needs_human_review",
        accessMode: options.persist?.accessMode ?? "owner",
        source: "real_ai_image_draft",
        safetyWarnings: ["Composition concept only; does not represent real product appearance.", "Real AI image draft; human review required before any use."],
        promptSummary: providerInput.prompt.slice(0, 200),
        // Hash 合同：无真实 SHA-256 时不写 promptHash/requestKeyHash 字段（不制造假 Hash）
        generationBasis: {
          productName: "composition concept",
          sellingPoints: [],
          riskWarnings: [],
          missingFacts: [],
          imageMaterialNeeds: [],
        },
        handoffMode: "composition_concept" as const,
        compositionSummary: "Abstract composition concept for listing material planning (real AI provider). Background direction, scene mood, whitespace areas and colour direction only.",
      };
    },
  };
}

/** 默认 Provider 工厂：按服务端环境选择 mock 或 real（fail-closed） */
export function createImageProviderByMode(): MockImageProvider {
  const mode = resolveImageProviderMode();
  if (mode === "real") {
    return createRealImageProvider() as unknown as MockImageProvider;
  }
  return createMockImageProvider();
}
