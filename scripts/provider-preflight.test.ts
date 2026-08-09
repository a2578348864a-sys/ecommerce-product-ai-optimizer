import { describe, expect, it } from "vitest";
// Production entrypoint stays plain Node ESM; Vitest only collects *.test.ts in this repository.
// @ts-expect-error The adjacent .mjs module is intentionally dependency-free and has no declaration file.
import { formatProviderPreflightSummary, validateProviderConfig } from "./provider-preflight.mjs";

const SECRET = "test-secret-that-must-never-be-rendered";

function validEnv(overrides: Record<string, string> = {}) {
  return {
    AI_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: SECRET,
    LISTING_PROVIDER_MODE: "real",
    IMAGE_PROVIDER_MODE: "real",
    OPENAI_API_KEY: `${SECRET}-image`,
    OPENAI_IMAGE_BASE_URL: "https://api.65535.space/v1",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    OPENAI_IMAGE_RESULT_HOSTS: "api.65535.space",
    AI_IMAGE_DRAFT_STORAGE_ROOT: "/srv/app/data/ai-image-drafts",
    OPENAI_LISTING_ENABLED: "true",
    OPENAI_IMAGE_GENERATION_ENABLED: "true",
    ...overrides,
  };
}

const accessibleStorage = () => ({ ok: true as const });

describe("Production Provider preflight", () => {
  it("fails when LISTING_PROVIDER_MODE is missing", () => {
    const result = validateProviderConfig(validEnv({ LISTING_PROVIDER_MODE: "" }), { checkStorage: accessibleStorage });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "missing_config", field: "LISTING_PROVIDER_MODE" }));
  });

  it("fails when IMAGE_PROVIDER_MODE is missing", () => {
    const result = validateProviderConfig(validEnv({ IMAGE_PROVIDER_MODE: "" }), { checkStorage: accessibleStorage });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "missing_config", field: "IMAGE_PROVIDER_MODE" }));
  });

  it("fails closed when the independent Listing real-AI gate is disabled", () => {
    const result = validateProviderConfig(validEnv({ OPENAI_LISTING_ENABLED: "false" }), { checkStorage: accessibleStorage });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "disabled_gate", field: "OPENAI_LISTING_ENABLED" }));
  });

  it("fails closed when the independent Image real-AI gate is disabled", () => {
    const result = validateProviderConfig(validEnv({ OPENAI_IMAGE_GENERATION_ENABLED: "" }), { checkStorage: accessibleStorage });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "disabled_gate", field: "OPENAI_IMAGE_GENERATION_ENABLED" }));
  });

  it("fails when the selected Provider key is missing", () => {
    const result = validateProviderConfig(validEnv({ DEEPSEEK_API_KEY: "" }), { checkStorage: accessibleStorage });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "missing_secret", field: "DEEPSEEK_API_KEY" }));
  });

  it("passes a complete config contract without calling a Provider", () => {
    const result = validateProviderConfig(validEnv(), { checkStorage: accessibleStorage });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("fails when the relay Base URL host is outside the exact allowlist", () => {
    const result = validateProviderConfig(
      validEnv({ OPENAI_IMAGE_BASE_URL: "https://untrusted.example/v1" }),
      { checkStorage: accessibleStorage },
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "invalid_config", field: "OPENAI_IMAGE_BASE_URL" }));
  });

  it("never returns or renders raw Secret values", () => {
    const result = validateProviderConfig(validEnv(), { checkStorage: accessibleStorage });
    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain(SECRET);
    expect(rendered).toContain("fingerprint");
  });

  it("does not treat the Image key as a configured DeepSeek research provider", () => {
    const result = validateProviderConfig(validEnv({ DEEPSEEK_API_KEY: "" }), { checkStorage: accessibleStorage });
    const rendered = formatProviderPreflightSummary(result, { runtimeConfigLoaded: true });

    expect(rendered).toContain("RESEARCH_PROVIDER: missing");
    expect(rendered).toContain("LISTING_PROVIDER: missing mode=real");
  });

  it("renders exactly five non-sensitive deployment preflight lines", () => {
    const result = validateProviderConfig(validEnv(), { checkStorage: accessibleStorage });
    const rendered = formatProviderPreflightSummary(result, { runtimeConfigLoaded: true });

    expect(rendered.split("\n")).toEqual([
      "RESEARCH_PROVIDER: configured",
      "LISTING_PROVIDER: configured mode=real",
      "IMAGE_PROVIDER: configured mode=real",
      "IMAGE_BASE_HOST: allowed",
      "PM2_RUNTIME: config_loaded",
    ]);
    expect(rendered).not.toContain(SECRET);
    expect(rendered).not.toContain("fingerprint");
  });
});
