import { describe, expect, it } from "vitest";
import { mapImageHandoffProviderFailure } from "@/lib/imageHandoff/imageGenerationService";
import { AiImageProviderError } from "@/lib/server/openaiImageClient";

describe("V2.1.6 Image Provider error contract", () => {
  it.each([
    ["provider_auth_failed", "provider_auth_failed", 502],
    ["provider_quota", "provider_quota", 503],
    ["timeout", "provider_timeout", 504],
    ["provider_unavailable", "provider_unavailable", 503],
    ["network_error", "network_error", 502],
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
});
