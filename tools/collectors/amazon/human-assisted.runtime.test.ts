import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SelectionBrief } from "../../../lib/upstream/contracts";
import { runHumanAssistedAmazonCurrentPage } from "./human-assisted";

const RUN_AUTHORIZED = process.env.RUN_AMAZON_HUMAN_ASSISTED_CURRENT_PAGE === "authorized-once";
const triggerFile = process.env.HUMAN_ASSISTED_TRIGGER_FILE;
const outputFile = process.env.HUMAN_ASSISTED_OUTPUT_FILE;
const maxAppearances = Number(process.env.HUMAN_ASSISTED_MAX_APPEARANCES);

function delay(milliseconds: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function brief(capturedAt: string, sampleLimit: number): SelectionBrief {
  return {
    schemaVersion: "selection-brief.v1",
    briefId: `brief-human-assisted-${capturedAt.replace(/[^0-9]/g, "").slice(0, 14)}`,
    marketplace: "amazon.com",
    market: "US",
    query: "closet organizer",
    category: null,
    targetScenario: "small-space closet organization",
    targetPriceRange: { currency: "USD", min: 15, max: 45 },
    requiredEvidence: ["identity", "title", "price", "rating", "review_count"],
    hardExclusions: ["confirmed_ip_risk", "regulated_product", "price_out_of_budget"],
    sampleBudget: { maxPages: 1, maxAppearances: sampleLimit },
    rankingRuleVersion: "stage1-deterministic-v1.1",
    createdAt: capturedAt,
    approvedBy: "pending_user_explicit_current_page_trigger",
  };
}

async function waitForTrigger(path: string, signal: AbortSignal) {
  const readyFile = `${path}.ready`;
  writeFileSync(readyFile, "human-assisted-browser-ready\n", "utf8");
  while (!signal.aborted) {
    if (existsSync(path)) {
      const command = readFileSync(path, "utf8").trim();
      rmSync(path, { force: true });
      return command === "COLLECT_CURRENT_PAGE" ? "confirmed" as const : "cancelled" as const;
    }
    await delay(250);
  }
  return "cancelled" as const;
}

describe("authorized human-assisted Amazon current-page runtime", () => {
  it.runIf(RUN_AUTHORIZED)("collects only after the explicit local trigger and writes versioned evidence", async () => {
    if (!triggerFile || !outputFile) throw new Error("HUMAN_ASSISTED_RUNTIME_PATHS_REQUIRED");
    if (!Number.isInteger(maxAppearances) || maxAppearances < 1 || maxAppearances > 20) {
      throw new Error("HUMAN_ASSISTED_MAX_APPEARANCES_INVALID");
    }
    const capturedAt = new Date().toISOString();
    const result = await runHumanAssistedAmazonCurrentPage({
      brief: brief(capturedAt, maxAppearances),
      collectorVersion: "amazon-human-assisted-cdp.v1",
      capturedAt,
      timeoutMs: 10 * 60_000,
      waitForExplicitTrigger: async (signal) => await waitForTrigger(triggerFile, signal),
    });
    const resolvedOutput = resolve(outputFile);
    mkdirSync(dirname(resolvedOutput), { recursive: true });
    writeFileSync(resolvedOutput, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    rmSync(`${triggerFile}.ready`, { force: true });

    expect(result.cleanup).toMatchObject({
      browserClosed: true,
      debugPortReleased: true,
      profileRemoved: true,
    });
    expect(result.formalCandidateGenerated).toBe(false);
    expect(result.productionDatabaseWritten).toBe(false);
  }, 12 * 60_000);
});
