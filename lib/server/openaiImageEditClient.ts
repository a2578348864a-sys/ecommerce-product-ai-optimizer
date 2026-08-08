import "server-only";

/**
 * Final Capability: 真实参考图生图客户端（复用 openai SDK images.edit）。
 *
 * 不重造 Provider：与 openaiImageClient 共用同一 OPENAI_API_KEY / OPENAI_IMAGE_BASE_URL /
 * OPENAI_IMAGE_MODEL 配置；调用 SDK images.edit（multipart 上传参考图 + prompt）。
 * gpt-image-2 支持参考图生图（input_fidelity 控制保真度）。
 *
 * 参考图只来自服务端批准参考（candidateAnalysisContext.productImage.contentHash 匹配），
 * Browser 不能提交任意 URL/本地路径。
 */

import OpenAI from "openai";
import { AiImageProviderError, validateImageBaseUrl, validateImageModel } from "@/lib/server/openaiImageClient";

export type AiImageEditInput = {
  /** 批准参考图 dataUrl（data:image/png;base64,...） */
  imageDataUrl: string;
  prompt: string;
  count: 1 | 2;
};

export type AiImageEditOutput = {
  model: string;
  provider: "openai_compatible_relay";
  images: Array<{ base64: string }>;
};

const DEFAULT_TIMEOUT_MS = 130_000;

function parseTimeoutMs(): number {
  const raw = (process.env.OPENAI_IMAGE_TIMEOUT_MS || "").trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/** 参考图生图：参考图真实作为 Provider 输入（multipart 上传） */
export async function generateOpenAiImageEdit(input: AiImageEditInput): Promise<AiImageEditOutput> {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new AiImageProviderError("configuration_error", "OpenAI 图片服务尚未配置。", false);
  const baseURL = validateImageBaseUrl((process.env.OPENAI_IMAGE_BASE_URL || "").trim());
  const model = validateImageModel((process.env.OPENAI_IMAGE_MODEL || "").trim());
  if (model === "dall-e-2" || model === "dall-e-3") {
    throw new AiImageProviderError("configuration_error", "参考图生图需要 GPT image 模型（gpt-image-1/2）。", false);
  }

  // dataUrl → Buffer（PNG/JPEG/WebP）
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input.imageDataUrl);
  if (!match) throw new AiImageProviderError("image_provider_result_invalid_image", "参考图格式无效。", false);
  const mime = match[1] === "image/jpeg" ? "image/jpeg" : match[1] === "image/webp" ? "image/webp" : "image/png";
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 50 * 1024 * 1024) {
    throw new AiImageProviderError("image_provider_result_too_large", "参考图超过 50MB 上限。", false);
  }

  const client = new OpenAI({ apiKey, baseURL, timeout: parseTimeoutMs(), maxRetries: 0 });
  try {
    const response = await client.images.edit({
      model,
      image: new File([bytes], `reference.${ext}`, { type: mime }),
      prompt: input.prompt,
      n: input.count,
      size: "1536x1024",
      quality: "high",
      output_format: "webp",
      input_fidelity: "high",
    });
    const items = response.data || [];
    if (items.length === 0) {
      // 记录响应结构（不记录内容）供能力诊断
      const shape = Object.keys(response).join(",");
      console.error(`[openaiImageEdit] empty data; response keys: ${shape}`);
      throw new AiImageProviderError("empty_response", "图片服务没有返回有效图片。", true);
    }
    // 解析顺序（Relay URL 合同兼容，规格四节）：
    // 1. 优先接受合法 b64_json；2. 否则接受经过严格 URL 验证的 url；3. 都没有 → 稳定合同错误。
    const images: Array<{ base64: string }> = [];
    for (const item of items) {
      const record = item as { b64_json?: string; url?: string };
      if (typeof record.b64_json === "string" && record.b64_json.length > 0) {
        images.push({ base64: record.b64_json });
      } else if (typeof record.url === "string" && record.url.length > 0) {
        // Relay URL 结果：复用项目安全下载（getImageResultHostWhitelist + downloadImageFromUrl
        // 的 HTTPS-only/精确主机/DNS/SSRF/重定向限制/超时/MIME/magic bytes 校验），
        // 不复制第二套不受控 fetch。
        const { getImageResultHostWhitelist, downloadImageFromUrl } = await import("@/lib/server/aiImageUrlFetcher") as typeof import("@/lib/server/aiImageUrlFetcher");
        const result = await downloadImageFromUrl(record.url, getImageResultHostWhitelist());
        images.push({ base64: result.bytes.toString("base64") });
      }
      // else: 非法 item 静默跳过（由下方 count 检查兜底）
    }
    if (images.length !== input.count) {
      throw new AiImageProviderError("image_provider_incompatible_response", "图片中转站返回了无法识别的响应格式。", false);
    }
    return { model, provider: "openai_compatible_relay", images };
  } catch (error) {
    if (error instanceof AiImageProviderError) throw error;
    // 区分 relay 拒绝（4xx/5xx/鉴权/限流）vs 响应格式问题：
    // 复用 mapProviderError 的既有分类（Provider 能力不可用时如实报告为 invalid_request/provider_unavailable，
    // 而非误报为响应格式问题）
    const { mapProviderError } = await import("@/lib/server/openaiImageClient") as typeof import("@/lib/server/openaiImageClient");
    throw mapProviderError(error);
  }
}
