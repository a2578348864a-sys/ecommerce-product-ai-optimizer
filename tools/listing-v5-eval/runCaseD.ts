/**
 * Case D golden-fixture runner for the Listing V5 benchmark.
 *
 * Benchmark tooling only - never imported by the application. It reuses the
 * real V5 pipeline (strategy -> writer -> validator -> one bounded repair)
 * against the synthetic desk-lamp fixture.
 *
 * Provider budget is hard-capped at 3 calls (strategy, writer, optional
 * repair). The report never contains an API key, an Authorization header, or
 * any raw model output beyond the listing copy itself.
 *
 * Why the module hook below exists: lib/server/aiClient.ts starts with
 * `import "server-only"`, which is a Next.js build-time alias package and is
 * not installed in this workspace, so plain node/tsx cannot resolve it. The
 * pipeline is therefore required directly (not via hoisted `import`) so the
 * specifier can be mapped to tools/listing-v5-eval/serverOnlyStub.cjs first.
 *
 * Usage (run from the project root):
 *   npx tsx tools/listing-v5-eval/runCaseD.ts --dry-run   # zero provider calls
 *   npx tsx tools/listing-v5-eval/runCaseD.ts             # real provider calls
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const TOOL_DIR = join(process.cwd(), "tools", "listing-v5-eval");
const nodeRequire = createRequire(join(TOOL_DIR, "runCaseD.ts"));

// ── server-only alias ──────────────────────────────────────────────────────
type ModuleWithResolve = {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
};
const ModuleRegistry = nodeRequire("node:module") as unknown as ModuleWithResolve;
const SERVER_ONLY_STUB = join(TOOL_DIR, "serverOnlyStub.cjs");
const originalResolve = ModuleRegistry._resolveFilename;
ModuleRegistry._resolveFilename = function resolveWithStub(
  this: unknown,
  request: string,
  ...rest: unknown[]
): string {
  if (request === "server-only") return SERVER_ONLY_STUB;
  return originalResolve.call(this, request, ...rest);
};

// ── real pipeline (loaded after the alias is in place) ─────────────────────
const { analyzeListingV5Strategy } = nodeRequire("@/lib/listingV5/strategy") as typeof import("@/lib/listingV5/strategy");
const { generateListingV5Draft, buildListingV5FallbackDraft } = nodeRequire("@/lib/listingV5/generation") as typeof import("@/lib/listingV5/generation");
const { repairListingV5Draft } = nodeRequire("@/lib/listingV5/structuredRepair") as typeof import("@/lib/listingV5/structuredRepair");
const { validateListingV5Draft } = nodeRequire("@/lib/listingV5/validation") as typeof import("@/lib/listingV5/validation");
const versions = nodeRequire("@/lib/listingV5/types") as typeof import("@/lib/listingV5/types");
const { buildDeskLampContext, deskLampEvidenceCounts } = nodeRequire("./deskLampFixture") as typeof import("./deskLampFixture");

const MAX_PROVIDER_CALLS = 3;

function loadEnvPath(file: string): boolean {
  if (!existsSync(file)) return false;
  // Values are copied into the environment only; they are never logged.
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
  return true;
}

function loadEnvFile(name: string): boolean {
  return loadEnvPath(join(process.cwd(), name));
}

function argValue(flag: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

const dryRun = process.argv.includes("--dry-run");
const outFile = resolve(argValue("--out") ?? join("tools", "listing-v5-eval", "out", "benchmark-case-d.txt"));

async function main(): Promise<void> {
  // `--env=<absolute path>` supplies the real provider configuration. The
  // feature worktree deliberately has no .env* of its own, so the caller points
  // at the integration tree's file read-only; nothing is copied and no value is
  // ever logged.
  const envArg = argValue("--env");
  const envPaths = envArg ? envArg.split(";").filter(Boolean) : [];
  const loaded = [
    loadEnvFile(".env"),
    loadEnvFile(".env.local"),
    ...envPaths.map(loadEnvPath),
  ].filter(Boolean).length;
  const useProvider = !dryRun;
  let providerCalls = 0;

  const report: string[] = [];
  const line = (value = "") => { report.push(value); };

  const context = buildDeskLampContext();
  const counts = deskLampEvidenceCounts(context);

  line("=== Listing V5 benchmark - Case D ===");
  line(`CASE_ID = ${context.taskId}`);
  line("SYNTHETIC_GOLDEN_FIXTURE = YES");
  line(`REAL_AI = ${useProvider ? "YES" : "NO (dry run)"}`);
  line(`RUN_MODE = ${dryRun ? "dry-run" : "real-provider"}`);
  line(`ENV_FILES_LOADED = ${loaded}`);
  line("");
  line("--- evidence counts (fixture is the only factual authority) ---");
  line(`confirmedFacts = ${counts.confirmedFacts}`);
  line(`voc = ${counts.voc}`);
  line(`keywords = ${counts.keywords}`);
  line(`competitors = ${counts.competitors}`);
  line(`sourcing = ${counts.sourcing}`);
  line("");
  line("--- prompt versions ---");
  line(`strategyPromptVersion = ${versions.LISTING_V5_STRATEGY_PROMPT_VERSION}`);
  line(`writerPromptVersion = ${versions.LISTING_V5_WRITER_PROMPT_VERSION}`);
  line(`validatorVersion = ${versions.LISTING_V5_VALIDATION_VERSION}`);
  line(`repairPromptVersion = ${versions.LISTING_V5_REPAIR_PROMPT_VERSION}`);
  line("");

  const onProviderCallStart = () => {
    providerCalls += 1;
    if (providerCalls > MAX_PROVIDER_CALLS) {
      throw new Error(`provider budget exceeded: ${providerCalls} > ${MAX_PROVIDER_CALLS}`);
    }
  };

  const strategyResult = await analyzeListingV5Strategy(context, { useProvider, onProviderCallStart });
  line("--- strategy ---");
  line(`providerAttempted = ${strategyResult.providerAttempted}`);
  line(`providerSucceeded = ${strategyResult.providerSucceeded}`);
  line(`trace = ${JSON.stringify(strategyResult.trace)}`);
  line(`strategy = ${JSON.stringify(strategyResult.strategy)}`);
  line("");

  const generated = await generateListingV5Draft(context, strategyResult.strategy, { useProvider, onProviderCallStart });
  line("--- writer ---");
  line(`providerAttempted = ${generated.providerAttempted}`);
  line(`providerSucceeded = ${generated.providerSucceeded}`);
  line(`trace = ${JSON.stringify(generated.trace)}`);
  line("-- AI writer draft (before any repair) --");
  line(`DRAFT_TITLE = ${generated.draft.title?.text ?? ""}`);
  (generated.draft.bullets ?? []).forEach((bullet, index) => { line(`DRAFT_BULLET_${index + 1} = ${bullet.text}`); });
  line(`DRAFT_DESCRIPTION = ${generated.draft.description?.text ?? ""}`);
  line(`DRAFT_SEARCH_TERMS = ${(generated.draft.backendSearchTerms ?? []).join(", ")}`);
  line("");

  let draft = generated.draft;
  let validation = validateListingV5Draft(context, strategyResult.strategy, draft);
  const firstValidation = validation;
  let repairApplied = false;
  let fallbackUsed = !generated.providerSucceeded;

  if (validation.status === "REPAIRABLE") {
    const repaired = await repairListingV5Draft({
      context,
      strategy: strategyResult.strategy,
      validation,
      draft,
      useProvider,
      onProviderCallStart,
    });
    line("--- repair ---");
    line(`attempted = ${repaired.attempted}`);
    line(`succeeded = ${repaired.succeeded}`);
    line(`appliedPaths = ${JSON.stringify(repaired.appliedPaths)}`);
    line(`trace = ${JSON.stringify(repaired.trace)}`);
    line("");
    repairApplied = repaired.succeeded && repaired.appliedPaths.length > 0;
    draft = repaired.draft;
    validation = validateListingV5Draft(context, strategyResult.strategy, draft);
  }

  if (validation.status !== "PASS") {
    draft = buildListingV5FallbackDraft(context, strategyResult.strategy);
    fallbackUsed = true;
    validation = validateListingV5Draft(context, strategyResult.strategy, draft);
  }

  line("--- validation ---");
  line(`firstValidationStatus = ${firstValidation.status}`);
  line(`firstTitleIssues = ${JSON.stringify(firstValidation.title.issues)}`);
  line(`firstDescriptionIssues = ${JSON.stringify(firstValidation.description.issues)}`);
  line(`firstBulletIssues = ${JSON.stringify(firstValidation.bullets.map((bullet, index) => ({ index, valid: bullet.valid, issues: bullet.issues })).filter((row) => !row.valid))}`);
  line(`firstUnsupportedClaims = ${JSON.stringify(firstValidation.claims.unsupportedClaims)}`);
  line(`firstProhibitedClaims = ${JSON.stringify(firstValidation.claims.prohibitedClaims)}`);
  line(`firstCompetitorOverlap = ${JSON.stringify(firstValidation.claims.competitorOverlap)}`);
  line(`firstQuality = ${JSON.stringify(firstValidation.quality)}`);
  line(`firstRepairAllowed = ${firstValidation.repair.allowed}`);
  line(`firstRepairTargets = ${JSON.stringify(firstValidation.repair.targets)}`);
  line(`finalStatus = ${validation.status}`);
  line(`unsupportedClaims = ${validation.claims.unsupportedClaims.length}`);
  line(`prohibitedClaims = ${validation.claims.prohibitedClaims.length}`);
  line(`competitorOverlap = ${validation.claims.competitorOverlap.length}`);
  line(`quality = ${JSON.stringify(validation.quality)}`);
  line("");
  line("--- final listing ---");
  line(`fallbackUsed = ${fallbackUsed}`);
  line(`repairApplied = ${repairApplied}`);
  line(`TITLE = ${draft.title.text}`);
  draft.bullets.forEach((bullet, index) => { line(`BULLET_${index + 1} = ${bullet.text}`); });
  line(`DESCRIPTION = ${draft.description.text}`);
  line(`SEARCH_TERMS = ${draft.backendSearchTerms.join(", ")}`);
  line("");
  line("--- provider calls ---");
  line(`providerCalls = ${providerCalls}`);
  line(`budget = ${MAX_PROVIDER_CALLS}`);
  line("");

  const candidate = !fallbackUsed
    && validation.status === "PASS"
    && validation.claims.unsupportedClaims.length === 0
    && validation.claims.prohibitedClaims.length === 0
    && validation.claims.competitorOverlap.length === 0;
  line(`CASE_D_V5_CANDIDATE = ${candidate ? "VALID" : "LOSS"}`);

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, report.join("\n"), "utf8");
  process.stdout.write(report.join("\n"));
  process.stdout.write(`\n\nwritten: ${outFile}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`runCaseD failed: ${message}\n`);
  process.exitCode = 1;
});
