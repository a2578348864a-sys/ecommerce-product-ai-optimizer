import { loadEnvConfig } from "@next/env";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateRealAiListingDraft } from "@/lib/server/aiListingGenerator";
import { getAiConfig } from "@/lib/server/aiClient";

const confirmed = process.env.RUN_REAL_AI_LISTING_SMOKE === "1"
  && process.env.CONFIRM_REAL_AI_LISTING_SMOKE === "1";

const AI_ENV_KEYS = new Set([
  "AI_PROVIDER",
  "AI_API_KEY",
  "AI_BASE_URL",
  "AI_MODEL",
  "AI_TIMEOUT_MS",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
]);

function stripEnvValueQuotes(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadKnownAiEnvForSmoke() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (!AI_ENV_KEYS.has(key) || process.env[key]) continue;

    process.env[key] = stripEnvValueQuotes(rawValue);
  }
}

describe.skipIf(!confirmed)("real AI Listing smoke test", () => {
  it("calls the real AI provider once and returns a validated real_ai_draft without DB writes", async () => {
    loadEnvConfig(process.cwd(), true);
    loadKnownAiEnvForSmoke();

    if (process.env.REAL_AI_LISTING_SMOKE_CONFIG_ONLY === "1") {
      const config = getAiConfig();
      console.info("REAL_AI_LISTING_SMOKE_CONFIG", JSON.stringify(config.ok
        ? {
          ok: true,
          provider: config.data.provider,
          hasApiKey: Boolean(config.data.apiKey),
          hasBaseURL: Boolean(config.data.baseURL),
          hasModel: Boolean(config.data.model),
        }
        : {
          ok: false,
          code: config.error.code,
          provider: config.error.provider || null,
          hasModel: Boolean(config.error.model),
        }));
      expect(config.ok).toBe(true);
      return;
    }

    const result = await generateRealAiListingDraft({
      taskTitle: "Core-4-AI.11 local smoke test",
      productName: "Desktop Phone Stand",
      decisionSummary: "Small-batch listing draft only after manual review.",
      riskLevel: "yellow",
      category: "phone accessory",
      sellingPoints: [
        "Adjustable viewing angle",
        "Compact desktop use",
        "Supplier documents still need manual verification",
      ],
    });

    if (!result.ok) {
      console.info("REAL_AI_LISTING_SMOKE_SUMMARY", JSON.stringify({
        ok: false,
        errorCode: result.error.code,
      }));
      throw new Error(`Real AI Listing smoke failed: ${result.error.code}`);
    }

    expect(result.data.source).toBe("real_ai_draft");
    expect(result.data.humanReviewRequired).toBe(true);

    console.info("REAL_AI_LISTING_SMOKE_SUMMARY", JSON.stringify({
      ok: true,
      source: result.data.source,
      titleCount: result.data.titles.length,
      bulletCount: result.data.bullets.length,
      keywordCount: result.data.keywords.length,
      riskNoteCount: result.data.riskNotes.length,
      reviewWarningCount: result.data.complianceWarnings.length,
      blockedClaimCount: result.data.blockedClaims.length,
      reviewChecklistCount: result.data.reviewChecklist.length,
    }));
  });
});
