import { describe, expect, it } from "vitest";
import { buildImageHandoffDraftSnapshot, mapImageHandoffProviderFailure } from "@/lib/imageHandoff/imageGenerationService";
import { AiImageProviderError } from "@/lib/server/openaiImageClient";
import { normalizeAiImageDraftSnapshot } from "@/lib/aiImageDraft";

describe("V2.1.6 Image Provider error contract", () => {
  it.each([
    ["provider_auth_failed", "provider_auth_failed", 502],
    ["provider_quota", "provider_quota", 503],
    ["timeout", "provider_timeout", 504],
    ["provider_unavailable", "provider_unavailable", 503],
    ["network_error", "network_error", 502],
    ["configuration_error", "provider_config_invalid", 503],
  ] as const)("maps %s without collapsing it into image_provider_failed", (providerCode, publicCode, status) => {
    const mapped = mapImageHandoffProviderFailure(
      new AiImageProviderError(providerCode, "sanitized provider message", false),
    );

    expect(mapped).toMatchObject({ code: publicCode, status });
  });

  it("does not expose an unknown raw Provider error", () => {
    const mapped = mapImageHandoffProviderFailure(new Error("raw upstream secret detail"));
    expect(mapped.code).toBe("provider_unavailable");
    expect(mapped.message).not.toContain("raw upstream secret detail");
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
