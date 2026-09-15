import { describe, expect, it } from "vitest";
import { buildImageHandoffDraftSnapshot, mapImageHandoffProviderFailure } from "@/lib/imageHandoff/imageGenerationService";
import { AiImageProviderError, mapProviderError } from "@/lib/server/openaiImageClient";
import { normalizeAiImageDraftSnapshot } from "@/lib/aiImageDraft";

/**
 * V2.1.2：复刻 OpenAI SDK 错误的**真实形态** ——
 * 类名保留在 constructor 上，但实例的 `name` 是继承来的 "Error"
 * （见 node_modules/openai/core/error.js:88-92，该类未设置 this.name）。
 * 旧实现只查 `error.name`，因此真实超时永远匹配不上，被误判成 provider_error。
 */
class APIConnectionTimeoutError extends Error {
  constructor() {
    super("Request timed out.");
  }
}

describe("V2.1.6 Image Provider error contract", () => {
  it.each([
    ["provider_auth_failed", "provider_auth_failed", 502],
    ["provider_quota", "provider_quota", 503],
    ["timeout", "timeout", 504],
    ["provider_unavailable", "provider_unavailable", 503],
    ["network_error", "network_error", 502],
    ["configuration_error", "provider_config_invalid", 503],
  ] as const)("maps %s without collapsing it into image_provider_failed", (providerCode, publicCode, status) => {
    const mapped = mapImageHandoffProviderFailure(
      new AiImageProviderError(providerCode, "sanitized provider message", false),
    );

    expect(mapped).toMatchObject({ code: publicCode, status });
  });

  // ── V2.1.2：真实超时分类 ──────────────────────────────────────────────
  it("V2.1.2：SDK 超时（constructor.name=APIConnectionTimeoutError、name=Error）必须映射为 timeout", () => {
    const sdkError = new APIConnectionTimeoutError();
    // 先确认这确实是 SDK 的真实形态（否则本测试会失去意义）
    expect(sdkError.constructor.name).toBe("APIConnectionTimeoutError");
    expect(sdkError.name).toBe("Error");
    expect(sdkError.message).toBe("Request timed out.");

    const classified = mapProviderError(sdkError);
    expect(classified.code).toBe("timeout");

    // 端到端：服务层必须给出 504 + 面向用户的超时文案
    const mapped = mapImageHandoffProviderFailure(classified);
    expect(mapped).toMatchObject({ code: "timeout", status: 504 });
    expect(mapped.message).toBe("图片生成请求超时，请稍后重试。");
  });

  it("V2.1.2：仅凭 message='Request timed out.' 的普通 Error 也应判为 timeout（不依赖类名）", () => {
    const classified = mapProviderError(new Error("Request timed out."));
    expect(classified.code).toBe("timeout");
  });

  it("V2.1.2：六类上游错误必须各自独立（互不合并）", () => {
    const cases = [
      ["timeout", "timeout", 504],
      ["network_error", "network_error", 502],
      ["rate_limited", "rate_limited", 429],
      ["provider_unavailable", "provider_unavailable", 503],
      ["empty_response", "empty_response", 502],
      ["provider_error", "provider_error", 502],
    ] as const;
    const seen = new Set<string>();
    for (const [upstream, expectedCode, expectedStatus] of cases) {
      const mapped = mapImageHandoffProviderFailure(new AiImageProviderError(upstream, "raw upstream detail", true));
      expect(mapped).toMatchObject({ code: expectedCode, status: expectedStatus });
      expect(mapped.message).not.toContain("raw upstream detail");
      seen.add(mapped.code);
    }
    expect(seen.size).toBe(6);
  });

  it("V2.1.3：undici 连接超时（TypeError: fetch failed + cause=ConnectTimeoutError）必须判为 timeout", () => {
    // 复刻 Node 内置 undici 的真实形态：判因信息只在 cause 里
    const cause = Object.assign(
      new Error("Connect Timeout Error (attempted address: example:443, timeout: 10000ms)"),
      { name: "ConnectTimeoutError", code: "UND_ERR_CONNECT_TIMEOUT" },
    );
    const raw = Object.assign(new TypeError("fetch failed"), { cause });
    expect(mapProviderError(raw).code).toBe("timeout");
    expect(mapImageHandoffProviderFailure(mapProviderError(raw))).toMatchObject({ code: "timeout", status: 504 });
  });

  it("does not expose an unknown raw Provider error", () => {    const mapped = mapImageHandoffProviderFailure(new Error("raw upstream secret detail"));
    // V2.1.1：未知异常保留**独立兜底分类**（不再伪装成「服务不可用」），
    // 但对外仍然只给稳定码 + 通用文案，绝不泄漏上游原文（本断言的原始意图不变）。
    expect(mapped.code).toBe("provider_error");
    expect(mapped.status).toBe(502);
    expect(mapped.message).not.toContain("raw upstream secret detail");
  });

  it("V2.1.1：限流 / 服务不可用 / 空响应 / 未知必须各自保留分类（不再合并）", () => {
    const cases = [
      ["rate_limited", "rate_limited", 429],
      ["provider_unavailable", "provider_unavailable", 503],
      ["empty_response", "empty_response", 502],
      ["provider_error", "provider_error", 502],
    ] as const;
    const seen = new Set<string>();
    for (const [upstream, expectedCode, expectedStatus] of cases) {
      const mapped = mapImageHandoffProviderFailure(new AiImageProviderError(upstream, "upstream raw detail", true));
      expect(mapped).toMatchObject({ code: expectedCode, status: expectedStatus });
      // 上游原文一律不得进入对外消息
      expect(mapped.message).not.toContain("upstream raw detail");
      seen.add(mapped.code);
    }
    // 四个分类必须互不相同（这正是本次修复的目标）
    expect(seen.size).toBe(4);
  });

  it.each([
    ["real_image_persist_failed:secret storage path", "image_storage_failed", 500],
    ["real_image_provider_empty:raw provider response", "image_response_invalid", 502],
  ] as const)("classifies local image failures without exposing the raw detail", (raw, code, status) => {
    const mapped = mapImageHandoffProviderFailure(new Error(raw));
    expect(mapped).toMatchObject({ code, status });
    expect(mapped.message).not.toContain(raw);
  });

  it("writes a complete canonical snapshot for a valid persisted Image Handoff item", () => {
    const rawDraft = {
      id: "123e4567-e89b-42d3-a456-426614174001",
      imageType: "lifestyle_scene",
      model: "gpt-image-2",
      createdAt: "2026-08-08T08:41:52.058Z",
      storageKey: "owner/task-1/123e4567-e89b-42d3-a456-426614174001.png",
      mimeType: "image/png",
      fileSizeBytes: 128,
      sha256: "a".repeat(64),
      reviewStatus: "needs_human_review",
      accessMode: "owner",
      source: "real_ai_image_draft",
      safetyWarnings: [],
      generationBasis: {
        sellingPoints: [],
        riskWarnings: [],
        missingFacts: [],
        imageMaterialNeeds: [],
      },
      handoffMode: "product_visual_draft",
      compositionSummary: "Approved reference draft.",
    };
    const snapshot = buildImageHandoffDraftSnapshot({
      existingSnapshot: null,
      rawDraft,
      itemId: rawDraft.id,
      accessMode: "owner",
      updatedAt: rawDraft.createdAt,
    });

    expect(snapshot).toMatchObject({
      version: 1,
      snapshotType: "ai_image_draft",
      provider: "openai_compatible_relay",
      accessMode: "owner",
      humanReviewRequired: true,
    });
    expect(normalizeAiImageDraftSnapshot(snapshot)?.items).toHaveLength(1);
  });
});
