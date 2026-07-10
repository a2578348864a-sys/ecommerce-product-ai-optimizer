import { AI_IMAGE_MAX_FILE_BYTES } from "@/lib/server/aiImageDraftStorage";
import { AiImageProviderError, type AiImageProvider } from "@/lib/server/openaiImageClient";

export const VALID_ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export type MockAiImageScenario =
  | "success"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network_error"
  | "content_blocked"
  | "empty"
  | "invalid_base64"
  | "non_image"
  | "too_large"
  | "count_mismatch";

export function createMockAiImageProvider(
  scenario: MockAiImageScenario,
  onCall?: () => void,
): AiImageProvider {
  return async (input) => {
    onCall?.();
    if (scenario === "rate_limited") throw new AiImageProviderError("rate_limited", "图片服务繁忙，请稍后重试。", true);
    if (scenario === "server_error") throw new AiImageProviderError("provider_unavailable", "图片服务暂时不可用。", true);
    if (scenario === "timeout") throw new AiImageProviderError("timeout", "图片生成超时。", true);
    if (scenario === "network_error") throw new AiImageProviderError("provider_error", "图片生成服务调用失败。", false);
    if (scenario === "content_blocked") throw new AiImageProviderError("content_blocked", "图片请求未通过内容安全检查。", false);
    if (scenario === "empty") throw new AiImageProviderError("empty_response", "图片服务没有返回有效图片。", true);
    if (scenario === "invalid_base64") return { model: "mock-image-v2", images: [{ base64: "***" }] };
    if (scenario === "non_image") return { model: "mock-image-v2", images: [{ base64: Buffer.from("not an image").toString("base64") }] };
    if (scenario === "too_large") {
      return { model: "mock-image-v2", images: [{ base64: Buffer.alloc(AI_IMAGE_MAX_FILE_BYTES + 1).toString("base64") }] };
    }
    const requestedCount = scenario === "count_mismatch" ? Math.max(0, input.count - 1) : input.count;
    return {
      model: "mock-image-v2",
      requestId: "mock-request-id",
      images: Array.from({ length: requestedCount }, () => ({ base64: VALID_ONE_PIXEL_PNG_BASE64 })),
    };
  };
}
