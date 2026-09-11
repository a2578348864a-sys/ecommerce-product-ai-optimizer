/**
 * Case A/B/C writer regeneration for the Listing V5 benchmark.
 *
 * Why this exists: the three real persisted snapshots were finalised by the
 * deleted deterministic residual rewrite, which replaced the AI description
 * with a template. Their original writer text is unrecoverable, so the
 * benchmark needs a fresh current-pipeline candidate.
 *
 * Design constraints (see the closure brief):
 *  - Strategy is reused from the persisted snapshot. The rebuilt context
 *    fingerprint MUST match the snapshot's, otherwise the cached strategy does
 *    not belong to this context and the case is reported as unsafe to reuse.
 *  - Exactly one writer provider call per case, hard-capped across all cases.
 *  - No repair is attempted: the remaining budget is reserved for the writers.
 *    A draft that still needs a repair is recorded as
 *    REPAIR_REQUIRED_BUT_BUDGET_EXHAUSTED and loses.
 *  - The writer draft is frozen to a benchmark artifact; writing to the real
 *    task record is deliberately NOT done.
 *
 * Usage (from the project root):
 *   npx tsx tools/listing-v5-eval/regenerateCaseWriter.ts --dry-run   # 0 calls
 *   npx tsx tools/listing-v5-eval/regenerateCaseWriter.ts             # real calls
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const TOOL_DIR = join(process.cwd(), "tools", "listing-v5-eval");
const nodeRequire = createRequire(join(TOOL_DIR, "runCaseD.ts"));

type ModuleWithResolve = { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const ModuleRegistry = nodeRequire("node:module") as unknown as ModuleWithResolve;
const SERVER_ONLY_STUB = join(TOOL_DIR, "serverOnlyStub.cjs");
const originalResolve = ModuleRegistry._resolveFilename;
ModuleRegistry._resolveFilename = function resolveWithStub(this: unknown, request: string, ...rest: unknown[]): string {
  if (request === "server-only") return SERVER_ONLY_STUB;
  return originalResolve.call(this, request, ...rest);
};

const MAX_PROVIDER_CALLS = 3;

/** Order matters: it is also the provider-budget allocation order. */
const CASES = [
  { key: "A", name: "Owala", taskId: "cmtugly0m0003teq1ptxxedhz" },
  { key: "B", name: "LE TAUCI", taskId: "cmtog3dd70002lcbj88dqslpw" },
  { key: "C", name: "ukeetap", taskId: "cmtugd7cl000jr74vgzmfonfs" },
];

function loadEnvPath(file: string): boolean {
  if (!existsSync(file)) return false;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
  return true;
}

function argValue(flag: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

const dryRun = process.argv.includes("--dry-run");
const outFile = resolve(argValue("--out") ?? join("tools", "listing-v5-eval", "out", "benchmark-abc.txt"));

async function main(): Promise<void> {
  const projectRoot = process.env.PROJECT_ROOT || process.cwd();
  loadEnvPath(join(projectRoot, ".env.local"));
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:" + join(projectRoot, "prisma/dev.db");
  }

  const { prisma } = nodeRequire("@/lib/server/db") as typeof import("@/lib/server/db");
  const { checkCreativeHandoffGate } = nodeRequire("@/lib/server/productCreativeHandoffPreview") as typeof import("@/lib/server/productCreativeHandoffPreview");
  const { buildListingInputFromCreativeHandoff } = nodeRequire("@/lib/listingHandoff/listingGenerationInput") as typeof import("@/lib/listingHandoff/listingGenerationInput");
  const { buildListingV5Context } = nodeRequire("@/lib/listingV5/context") as typeof import("@/lib/listingV5/context");
  const { generateListingV5Draft } = nodeRequire("@/lib/listingV5/generation") as typeof import("@/lib/listingV5/generation");
  const { validateListingV5Draft } = nodeRequire("@/lib/listingV5/validation") as typeof import("@/lib/listingV5/validation");
  const types = nodeRequire("@/lib/listingV5/types") as typeof import("@/lib/listingV5/types");

  const lines: string[] = [];
  const line = (value = "") => { lines.push(value); };
  let providerCalls = 0;

  line("=== Listing V5 benchmark - Case A/B/C writer regeneration ===");
  line(`RUN_MODE = ${dryRun ? "dry-run (0 provider calls)" : "real-provider"}`);
  line(`PROVIDER_BUDGET = ${MAX_PROVIDER_CALLS}`);
  line("");

  for (const entry of CASES) {
    line("==============================================================");
    line(`CASE_${entry.key} = ${entry.name}`);
    line(`taskId = ${entry.taskId}`);

    const row = await prisma.viralAnalysisRecord.findUnique({ where: { id: entry.taskId }, select: { resultJson: true } });
    if (!row || typeof row.resultJson !== "string") { line("STATUS = TASK_NOT_FOUND"); line(""); continue; }
    let parsed: Record<string, any>;
    try { parsed = JSON.parse(row.resultJson) as Record<string, any>; } catch { line("STATUS = RESULT_JSON_UNPARSABLE"); line(""); continue; }
    const snapshot = parsed.listingV5;
    if (!snapshot) { line("STATUS = NO_LISTING_V5_SNAPSHOT"); line(""); continue; }
    line(`snapshotVersions = strategy:${snapshot.strategyPromptVersion} writer:${snapshot.writerPromptVersion} validator:${snapshot.validatorVersion} repair:${snapshot.repairPromptVersion}`);

    const cachedStrategy = snapshot.strategy;
    if (!cachedStrategy) { line("STATUS = NO_CACHED_STRATEGY"); line(""); continue; }

    // Rebuild the exact context the route would build.
    const ownerContext = { mode: "owner", token: "benchmark-harness" } as unknown as Parameters<typeof checkCreativeHandoffGate>[1];
    const gate = await checkCreativeHandoffGate(entry.taskId, ownerContext);
    const latestHandoff = gate.currentHandoff?.versions?.[gate.currentHandoff.versions.length - 1];
    // Mirrors the route: a gate that reports no_confirmed_facts may still
    // proceed when the persisted handoff versions carry listing-scoped
    // confirmed facts. Without this the harness would refuse to rebuild exactly
    // the context the route used.
    const hasListingConfirmedFact = Boolean((latestHandoff?.confirmedFacts ?? []).some((fact: any) => fact.usageScopes?.includes("listing")));
    const degradedGateWithPersistedFacts = gate.reason === "no_confirmed_facts" && hasListingConfirmedFact;
    if ((!gate.allowed && !degradedGateWithPersistedFacts) || !gate.currentHandoff || !gate.candidate || !latestHandoff || !gate.candidate.sourceResearch) {
      line(`STATUS = GATE_NOT_ALLOWED (reason=${gate.reason})`);
      line("");
      continue;
    }
    const researchRevision = gate.candidate.sourceResearch.researchRevision;
    const built = buildListingInputFromCreativeHandoff(gate.currentHandoff, researchRevision, { creativeContext: gate.creativeContext ?? null });
    if (!built.ok) { line("STATUS = GENERATION_INPUT_UNAVAILABLE"); line(""); continue; }
    const productIdentity = typeof latestHandoff.productIdentity?.displayName === "string"
      ? latestHandoff.productIdentity.displayName
      : String((gate.candidate as unknown as { productName?: string }).productName ?? "");
    const confirmedFacts = (latestHandoff.confirmedFacts ?? [])
      .filter((fact: any) => fact.usageScopes?.includes("listing"))
      .map((fact: any) => ({ factId: fact.factId, field: fact.field, label: fact.label, value: fact.value, sourceRefs: ["human_confirmation"] }));
    const context = buildListingV5Context({
      taskId: entry.taskId,
      researchRevision,
      handoffRevision: gate.currentHandoff.currentRevision,
      productIdentity,
      generationInput: built.input,
      creativeContext: gate.creativeContext ?? null,
      confirmedFacts,
      manualDirection: latestHandoff.creativePreferences?.additionalRequirements ?? null,
    });

    line(`evidence = facts:${context.confirmedFacts.length} voc:${context.references.voc.length} keywords:${context.references.keywords.length} competitors:${context.references.competitors.length} sourcing:${context.references.sourcing.length}`);
    line(`fingerprintRebuilt = ${context.contextFingerprint}`);
    line(`fingerprintSnapshot = ${snapshot.contextFingerprint}`);
    line(`FINGERPRINT_MATCH = ${context.contextFingerprint === snapshot.contextFingerprint}`);

    if (context.contextFingerprint !== snapshot.contextFingerprint) {
      // The cached strategy does not belong to the rebuilt context; using it
      // would be a version mismatch dressed up as a current candidate.
      line("STATUS = VERSION_MISMATCH_CACHED_STRATEGY_NOT_REUSABLE");
      line("");
      continue;
    }

    if (dryRun) {
      const preview = await generateListingV5Draft(context, cachedStrategy, { useProvider: false });
      const report = validateListingV5Draft(context, cachedStrategy, preview.draft);
      line(`DRY_RUN deterministic validation = ${report.status}`);
      line("-- confirmed facts available to the writer --");
      for (const fact of context.confirmedFacts) {
        line(`FACT ${fact.id} [${fact.canonicalField}] = ${fact.value}`);
      }
      line("-- reference samples (untrusted, not facts) --");
      context.references.voc.slice(0, 2).forEach((ref: any) => line(`VOC = ${ref.text}`));
      context.references.keywords.slice(0, 3).forEach((ref: any) => line(`KW = ${ref.text}`));
      context.references.competitors.slice(0, 2).forEach((ref: any) => line(`COMP = ${ref.text}`));
      line(`prohibitedClaims = ${JSON.stringify(context.prohibitedClaims)}`);
      line("STATUS = DRY_RUN_OK_CONTEXT_REBUILT");
      line("");
      continue;
    }

    if (providerCalls >= MAX_PROVIDER_CALLS) {
      line("STATUS = BUDGET_EXHAUSTED_BEFORE_WRITER");
      line("");
      continue;
    }
    const onProviderCallStart = () => {
      providerCalls += 1;
      if (providerCalls > MAX_PROVIDER_CALLS) throw new Error(`provider budget exceeded: ${providerCalls} > ${MAX_PROVIDER_CALLS}`);
    };

    const generated = await generateListingV5Draft(context, cachedStrategy, { useProvider: true, onProviderCallStart });
    line(`writerAttempted = ${generated.providerAttempted}`);
    line(`writerSucceeded = ${generated.providerSucceeded}`);
    line(`writerTrace = ${JSON.stringify(generated.trace)}`);

    const report = validateListingV5Draft(context, cachedStrategy, generated.draft);
    line(`validation = ${report.status}`);
    line(`unsupportedClaims = ${JSON.stringify(report.claims.unsupportedClaims)}`);
    line(`prohibitedClaims = ${JSON.stringify(report.claims.prohibitedClaims)}`);
    line(`competitorOverlap = ${JSON.stringify(report.claims.competitorOverlap)}`);
    line(`quality = ${JSON.stringify(report.quality)}`);
    line(`repairAllowed = ${report.repair.allowed}`);
    line(`repairTargets = ${JSON.stringify(report.repair.targets)}`);
    line(`titleIssues = ${JSON.stringify(report.title.issues)}`);
    line(`descriptionIssues = ${JSON.stringify(report.description.issues)}`);
    line(`bulletIssues = ${JSON.stringify(report.bullets.map((b: any, i: number) => ({ i, valid: b.valid, issues: b.issues })).filter((r: any) => !r.valid))}`);
    line("-- writer candidate copy --");
    line(`TITLE = ${generated.draft.title?.text ?? ""}`);
    (generated.draft.bullets ?? []).forEach((bullet: any, index: number) => { line(`BULLET_${index + 1} = ${bullet.text}`); });
    line(`DESCRIPTION = ${generated.draft.description?.text ?? ""}`);
    line(`SEARCH_TERMS = ${(generated.draft.backendSearchTerms ?? []).join(", ")}`);

    const safe = generated.providerSucceeded
      && report.claims.unsupportedClaims.length === 0
      && report.claims.prohibitedClaims.length === 0
      && report.claims.competitorOverlap.length === 0;
    const verdict = !generated.providerSucceeded
      ? "V5_LOSS_WRITER_STAGE_FAILED"
      : !safe
        ? "V5_LOSS_FACT_SAFETY"
        : report.status === "PASS"
          ? "V5_CANDIDATE_VALID"
          : "REPAIR_REQUIRED_BUT_BUDGET_EXHAUSTED";
    line(`CASE_${entry.key}_VERDICT = ${verdict}`);
    line("");
  }

  line(`ACTUAL_PROVIDER_CALLS = ${providerCalls}`);
  line(`REAL_CASE_D_TASK_SNAPSHOT_FROZEN_AT = 2026-09-10 (already executed, LOSS)`);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, lines.join("\n"), "utf8");
  process.stdout.write(lines.join("\n"));
  process.stdout.write(`\nwritten: ${outFile}\n`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  process.stderr.write(`regenerateCaseWriter failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
