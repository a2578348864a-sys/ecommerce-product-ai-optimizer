import { loadEnvConfig } from "@next/env";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildAiListingPackSaveResult, parseTaskResultJson } from "@/lib/aiListingSnapshot";
import { generateRealAiListingDraft, type RealAiListingContext } from "@/lib/server/aiListingGenerator";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function nestedRecord(input: Record<string, unknown>, key: string) {
  return isRecord(input[key]) ? input[key] : {};
}

function buildContextFromTask(record: {
  title: string | null;
  level: string | null;
  oneLineSummary: string | null;
  materialText: string | null;
  platform: string | null;
  resultJson: string;
}) {
  const parsed = parseTaskResultJson(record.resultJson);
  if (!parsed.ok) throw new Error("Invalid task resultJson.");

  const result = parsed.data;
  const finalReport = nestedRecord(result, "finalReport");
  const sourceMeta = nestedRecord(result, "sourceMeta");
  const listingPackSnapshot = nestedRecord(result, "listingPackSnapshot");
  const pack = nestedRecord(listingPackSnapshot, "pack");

  const productName = text(result.productName) || text(record.title);
  const decisionSummary = text(finalReport.finalVerdict) || text(record.oneLineSummary) || text(record.title);
  const riskLevel = text(finalReport.riskLevel) || text(record.level) || "yellow";
  const category = text(sourceMeta.category) || text(record.platform) || "general product";
  const sellingPoints = [
    ...stringArray(finalReport.sellingPoints),
    ...stringArray(pack.sellingPoints),
    ...text(record.materialText).split(/\r?\n|[;,，；]/).map((item) => item.trim()).filter(Boolean),
  ].slice(0, 6);

  return {
    parsedResultJson: result,
    context: {
      taskTitle: text(record.title) || null,
      productName,
      decisionSummary,
      riskLevel,
      category,
      sellingPoints: sellingPoints.length ? sellingPoints : [decisionSummary],
    },
  };
}

describe.skipIf(!confirmed)("real AI Listing smoke test", () => {
  it("calls the real AI provider once and optionally saves one validated real_ai_draft snapshot", async () => {
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

    const saveRequested = process.env.REAL_AI_LISTING_SMOKE_SAVE === "1";
    const taskId = process.env.REAL_AI_LISTING_SMOKE_TASK_ID;
    let prisma: PrismaClient | null = null;
    let taskContext: RealAiListingContext = {
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
    };
    let existingResultJson: Record<string, unknown> | null = null;

    if (saveRequested) {
      if (!taskId) throw new Error("REAL_AI_LISTING_SMOKE_TASK_ID is required when save is requested.");

      prisma = new PrismaClient();
      const task = await prisma.viralAnalysisRecord.findUnique({
        where: { id: taskId },
        select: {
          title: true,
          level: true,
          oneLineSummary: true,
          materialText: true,
          platform: true,
          resultJson: true,
        },
      });

      if (!task) throw new Error("Selected task was not found.");

      const built = buildContextFromTask(task);
      if (isRecord(built.parsedResultJson.aiListingPackSnapshot)) {
        throw new Error("Selected task already has aiListingPackSnapshot; refusing to overwrite.");
      }
      taskContext = built.context;
      existingResultJson = built.parsedResultJson;
    }

    const result = await generateRealAiListingDraft(taskContext);

    if (!result.ok) {
      if (prisma) await prisma.$disconnect();
      console.info("REAL_AI_LISTING_SMOKE_SUMMARY", JSON.stringify({
        ok: false,
        errorCode: result.error.code,
      }));
      throw new Error(`Real AI Listing smoke failed: ${result.error.code}`);
    }

    expect(result.data.source).toBe("real_ai_draft");
    expect(result.data.humanReviewRequired).toBe(true);

    if (saveRequested) {
      if (!prisma || !taskId || !existingResultJson) throw new Error("Save context was not initialized.");

      const built = buildAiListingPackSaveResult({
        resultJson: existingResultJson,
        listingPack: result.data,
        savedAt: new Date().toISOString(),
      });

      if (!built.ok) {
        await prisma.$disconnect();
        throw new Error(`Failed to build AI Listing snapshot: ${built.error.code}`);
      }

      try {
        await prisma.viralAnalysisRecord.update({
          where: { id: taskId },
          data: { resultJson: JSON.stringify(built.resultJson) },
        });
      } finally {
        await prisma.$disconnect();
        prisma = null;
      }

      console.info("REAL_AI_LISTING_SMOKE_SUMMARY", JSON.stringify({
        ok: true,
        saved: true,
        taskId,
        source: built.snapshot.source,
        snapshotType: built.snapshot.snapshotType,
        version: built.snapshot.version,
        titleCount: built.snapshot.titles.length,
        bulletCount: built.snapshot.bullets.length,
        keywordCount: built.snapshot.keywords.length,
        riskNoteCount: built.snapshot.riskNotes.length,
        reviewWarningCount: built.snapshot.complianceWarnings.length,
        blockedClaimCount: built.snapshot.blockedClaims.length,
        reviewChecklistCount: built.snapshot.reviewChecklist.length,
      }));
      return;
    }

    if (prisma) await prisma.$disconnect();

    console.info("REAL_AI_LISTING_SMOKE_SUMMARY", JSON.stringify({
      ok: true,
      saved: false,
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
