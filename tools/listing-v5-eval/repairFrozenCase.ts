/**
 * Targeted AI repair for one frozen benchmark case.
 *
 * Authorised use: exactly ONE real provider call, only for a case whose frozen
 * writer output still carries a genuine unsupported claim. The repair prompt
 * receives only the validator's requested targets, so it cannot rewrite fields
 * that already passed, and it may not change factIds, strategyRole or any other
 * structure - `applyOne` replaces text only.
 *
 * Usage (from the project root):
 *   npx tsx tools/listing-v5-eval/repairFrozenCase.ts --case=B [--dry-run]
 *
 * Forensics:
 *   Real runs install a capture wrapper around `@/lib/server/aiClient`, so the
 *   answer handed to the pipeline is written to out/benchmark-case-<x>-response.json
 *   (secret-scanned first; the payload is withheld if the scan fails).
 *   `--replay=<artifact.json>` re-runs the REAL normalizer over that frozen
 *   payload with zero Provider calls, which separates a provider failure from a
 *   parser false negative without spending budget:
 *   npx tsx tools/listing-v5-eval/repairFrozenCase.ts --case=B --replay=tools/listing-v5-eval/out/benchmark-case-b-response.json
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const TOOL_DIR = join(process.cwd(), "tools", "listing-v5-eval");
const nodeRequire = createRequire(join(TOOL_DIR, "runCaseD.ts"));

type ModuleWithResolve = { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const ModuleRegistry = nodeRequire("node:module") as unknown as ModuleWithResolve;
const SERVER_ONLY_STUB = join(TOOL_DIR, "serverOnlyStub.cjs");
const AI_CLIENT_CAPTURE = join(TOOL_DIR, "aiClientCapture.cjs");
const REAL_AI_CLIENT = join(process.cwd(), "lib", "server", "aiClient.ts");

const CASES: Record<string, { name: string; taskId: string }> = {
  A: { name: "Owala", taskId: "cmtugly0m0003teq1ptxxedhz" },
  B: { name: "LE TAUCI", taskId: "cmtog3dd70002lcbj88dqslpw" },
  C: { name: "ukeetap", taskId: "cmtugd7cl000jr74vgzmfonfs" },
};

const MAX_PROVIDER_CALLS = 1;

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

type FrozenCase = { title: string; bullets: string[]; description: string; searchTerms: string };

function parseFrozen(text: string): Map<string, FrozenCase> {
  const out = new Map<string, FrozenCase>();
  let currentKey: string | null = null;
  const value = (line: string, label: string) => (line.startsWith(`${label} = `) ? line.slice(label.length + 3) : null);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const caseMatch = /^CASE_([A-Z]) = /.exec(line);
    if (caseMatch) { currentKey = caseMatch[1]!; out.set(currentKey, { title: "", bullets: [], description: "", searchTerms: "" }); continue; }
    if (!currentKey) continue;
    const entry = out.get(currentKey)!;
    const title = value(line, "TITLE");
    if (title !== null) { entry.title = title; continue; }
    const bullet = /^BULLET_(\d+) = (.*)$/.exec(line);
    if (bullet) { entry.bullets[Number(bullet[1]) - 1] = bullet[2]!; continue; }
    const description = value(line, "DESCRIPTION");
    if (description !== null) { entry.description = description; continue; }
    const searchTerms = value(line, "SEARCH_TERMS");
    if (searchTerms !== null) { entry.searchTerms = searchTerms; continue; }
  }
  return out;
}

const caseKey = (argValue("--case") ?? "B").toUpperCase();
const dryRun = process.argv.includes("--dry-run");
const frozenFile = resolve(argValue("--frozen") ?? join("tools", "listing-v5-eval", "out", "benchmark-abc.txt"));
const outFile = resolve(argValue("--out") ?? join("tools", "listing-v5-eval", "out", `benchmark-case-${caseKey.toLowerCase()}-repair.txt`));
const captureFile = resolve(argValue("--capture") ?? join("tools", "listing-v5-eval", "out", `benchmark-case-${caseKey.toLowerCase()}-response.json`));
const replayArg = argValue("--replay");
const replayFile = replayArg ? resolve(replayArg) : null;
const captureEnabled = !dryRun;

// Install the module stubs BEFORE any pipeline module is required, so the
// capture/replay wrapper is the instance the repair stage actually calls.
const passthroughResolve = ModuleRegistry._resolveFilename;
ModuleRegistry._resolveFilename = function resolveWithStubs(this: unknown, request: string, ...rest: unknown[]): string {
  if (request === "server-only") return SERVER_ONLY_STUB;
  if (captureEnabled && request === "@/lib/server/aiClient") return AI_CLIENT_CAPTURE;
  return passthroughResolve.call(this, request, ...rest);
};
if (captureEnabled) {
  process.env.LISTING_V5_REAL_AI_CLIENT = REAL_AI_CLIENT;
  process.env.LISTING_V5_CASE = caseKey;
  if (replayFile) {
    process.env.LISTING_V5_REPLAY_FILE = replayFile;
    delete process.env.LISTING_V5_CAPTURE_FILE;
  } else {
    process.env.LISTING_V5_CAPTURE_FILE = captureFile;
  }
}

/**
 * Proof that the pipeline really binds to the stub, not to the real client.
 * `require.resolve` goes through the same patched hook, so an unexpected path
 * means the interception is not in effect and the run must abort (fail closed)
 * rather than quietly reach the Provider.
 */
function aiClientBinding(): { resolved: string; expected: string; ok: boolean } {
  let resolved = "unresolved";
  try { resolved = nodeRequire.resolve("@/lib/server/aiClient"); } catch { /* keep marker */ }
  const expected = captureEnabled ? AI_CLIENT_CAPTURE : "real-client";
  return { resolved, expected, ok: !captureEnabled || resolved === AI_CLIENT_CAPTURE };
}

/**
 * A replay must be physically unable to reach the Provider. Removing the API
 * keys means that even a broken interception ends in `missing_api_key` with no
 * network request, instead of spending the final authorised call.
 */
function stripProviderCredentials(): void {
  for (const key of ["AI_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY"]) delete process.env[key];
}

/** A replay must be able to prove the frozen artifact is usable and clean. */
function readReplayArtifact(): { payload: unknown; secretScan: unknown; capturedAt: unknown } {
  const raw = JSON.parse(readFileSync(replayFile!, "utf8")) as Record<string, unknown>;
  if (raw.secretScan !== "PASS" || raw.payload === null || raw.payload === undefined) {
    throw new Error(`frozen response unusable: secretScan=${String(raw.secretScan)} payloadPresent=${raw.payload !== null && raw.payload !== undefined}`);
  }
  return { payload: raw.payload, secretScan: raw.secretScan, capturedAt: raw.capturedAt };
}

async function main(): Promise<void> {
  loadEnvPath(join("D:\\Workspace\\projects\\project-001-跨境电商AI工具\\电商工具", ".env.local"));
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:D:/Workspace/projects/project-001-跨境电商AI工具/电商工具/prisma/dev.db";
  }
  if (replayFile) stripProviderCredentials();
  const binding = aiClientBinding();
  if (!binding.ok) {
    process.stderr.write(`aiClient stub not bound: resolved=${binding.resolved} expected=${binding.expected}\n`);
    process.exitCode = 1;
    return;
  }
  const entry = CASES[caseKey];
  if (!entry) { process.stderr.write(`unknown case ${caseKey}\n`); process.exitCode = 1; return; }

  const frozen = parseFrozen(readFileSync(frozenFile, "utf8")).get(caseKey);
  if (!frozen) { process.stderr.write(`no frozen copy for ${caseKey}\n`); process.exitCode = 1; return; }

  const { prisma } = nodeRequire("@/lib/server/db") as typeof import("@/lib/server/db");
  const { checkCreativeHandoffGate } = nodeRequire("@/lib/server/productCreativeHandoffPreview") as typeof import("@/lib/server/productCreativeHandoffPreview");
  const { buildListingInputFromCreativeHandoff } = nodeRequire("@/lib/listingHandoff/listingGenerationInput") as typeof import("@/lib/listingHandoff/listingGenerationInput");
  const { buildListingV5Context } = nodeRequire("@/lib/listingV5/context") as typeof import("@/lib/listingV5/context");
  const { validateListingV5Draft } = nodeRequire("@/lib/listingV5/validation") as typeof import("@/lib/listingV5/validation");
  const { repairListingV5Draft } = nodeRequire("@/lib/listingV5/structuredRepair") as typeof import("@/lib/listingV5/structuredRepair");

  const row = await prisma.viralAnalysisRecord.findUnique({ where: { id: entry.taskId }, select: { resultJson: true } });
  const parsed = row ? (JSON.parse(row.resultJson) as Record<string, any>) : null;
  const cachedStrategy = parsed?.listingV5?.strategy;
  if (!cachedStrategy) { process.stderr.write("no cached strategy\n"); process.exitCode = 1; return; }

  const ownerContext = { mode: "owner", token: "benchmark-harness" } as unknown as Parameters<typeof checkCreativeHandoffGate>[1];
  const gate = await checkCreativeHandoffGate(entry.taskId, ownerContext);
  const latestHandoff = gate.currentHandoff?.versions?.[gate.currentHandoff.versions.length - 1];
  const hasListingConfirmedFact = Boolean((latestHandoff?.confirmedFacts ?? []).some((fact: any) => fact.usageScopes?.includes("listing")));
  const degraded = gate.reason === "no_confirmed_facts" && hasListingConfirmedFact;
  if ((!gate.allowed && !degraded) || !gate.currentHandoff || !gate.candidate || !latestHandoff || !gate.candidate.sourceResearch) {
    process.stderr.write(`gate not allowed: ${gate.reason}\n`); process.exitCode = 1; return;
  }
  const researchRevision = gate.candidate.sourceResearch.researchRevision;
  const built = buildListingInputFromCreativeHandoff(gate.currentHandoff, researchRevision, { creativeContext: gate.creativeContext ?? null });
  if (!built.ok) { process.stderr.write("generation input unavailable\n"); process.exitCode = 1; return; }
  const productIdentity = typeof latestHandoff.productIdentity?.displayName === "string"
    ? latestHandoff.productIdentity.displayName
    : String((gate.candidate as unknown as { productName?: string }).productName ?? "");
  const context = buildListingV5Context({
    taskId: entry.taskId,
    researchRevision,
    handoffRevision: gate.currentHandoff.currentRevision,
    productIdentity,
    generationInput: built.input,
    creativeContext: gate.creativeContext ?? null,
    confirmedFacts: (latestHandoff.confirmedFacts ?? [])
      .filter((fact: any) => fact.usageScopes?.includes("listing"))
      .map((fact: any) => ({ factId: fact.factId, field: fact.field, label: fact.label, value: fact.value, sourceRefs: ["human_confirmation"] })),
    manualDirection: latestHandoff.creativePreferences?.additionalRequirements ?? null,
  });

  const anchorFactIds = context.confirmedFacts.slice(0, 3).map((fact) => fact.id);
  const single = context.confirmedFacts.slice(0, 1).map((fact) => fact.id);
  const draft = {
    version: "listing-v5.writer-draft.v1" as const,
    title: { text: frozen.title, factIds: anchorFactIds },
    bullets: frozen.bullets.filter(Boolean).map((text, index) => ({
      text,
      factIds: single,
      strategyRole: cachedStrategy.bulletAngles?.[index]?.role ?? "core_outcome",
    })),
    description: { text: frozen.description, factIds: single },
    backendSearchTerms: frozen.searchTerms ? frozen.searchTerms.split(", ").filter(Boolean) : [],
    humanReviewRequired: true as const,
  };

  const before = validateListingV5Draft(context, cachedStrategy, draft);
  const draftFingerprint = createHash("sha256").update(JSON.stringify(draft)).digest("hex").slice(0, 16);
  const replayMeta = replayFile ? readReplayArtifact() : null;

  const lines: string[] = [];
  const line = (value = "") => { lines.push(value); };
  line(`=== Targeted AI repair - Case ${caseKey} (${entry.name}) ===`);
  line(`RUN_MODE = ${dryRun ? "dry-run (0 provider calls)" : replayFile ? "frozen-replay (0 provider calls)" : "real-provider (max 1 call)"}`);
  line(`CAPTURE_ARTIFACT = ${dryRun ? "off" : replayFile ? `READ ${replayFile}` : `WRITE ${captureFile}`}`);
  line(`AI_CLIENT_BINDING = ${binding.resolved}`);
  line(`AI_CLIENT_BINDING_OK = ${binding.ok}`);
  if (replayMeta) {
    line(`REPLAY_SECRET_SCAN = ${String(replayMeta.secretScan)}`);
    line(`REPLAY_CAPTURED_AT = ${String(replayMeta.capturedAt)}`);
    line(`REPLAY_FROZEN_PAYLOAD = ${JSON.stringify(replayMeta.payload).slice(0, 800)}`);
  }
  line(`draftFingerprint = ${draftFingerprint}`);
  line(`beforeStatus = ${before.status}`);
  line(`beforeUnsupported = ${JSON.stringify(before.claims.unsupportedClaims)}`);
  line(`beforeProhibited = ${JSON.stringify(before.claims.prohibitedClaims)}`);
  line(`repairAllowed = ${before.repair.allowed}`);
  line(`repairTargets = ${JSON.stringify(before.repair.targets)}`);
  line("");

  if (!before.repair.allowed || before.repair.targets.length === 0) {
    line("STATUS = NO_REPAIR_TARGET, no provider call made");
  } else {
    let calls = 0;
    const onProviderCallStart = () => {
      calls += 1;
      if (calls > MAX_PROVIDER_CALLS) throw new Error(`provider budget exceeded: ${calls} > ${MAX_PROVIDER_CALLS}`);
    };
    const repaired = await repairListingV5Draft({
      context,
      strategy: cachedStrategy,
      validation: before,
      draft,
      useProvider: !dryRun,
      onProviderCallStart,
    });
    line(`repairAttempted = ${repaired.attempted}`);
    line(`repairSucceeded = ${repaired.succeeded}`);
    line(`appliedPaths = ${JSON.stringify(repaired.appliedPaths)}`);
    line(`responseShape = ${repaired.responseShape ?? "n/a"}`);
    line(`repairDiagnostics = ${JSON.stringify(repaired.diagnostics ?? null)}`);
    line(`repairTrace = ${JSON.stringify(repaired.trace)}`);
    let stubCalls: number | null = null;
    try {
      const stub = nodeRequire(AI_CLIENT_CAPTURE) as { __listingV5ProviderCallCount?: () => number };
      stubCalls = typeof stub.__listingV5ProviderCallCount === "function" ? stub.__listingV5ProviderCallCount() : null;
    } catch { stubCalls = null; }
    line(`providerCalls = ${calls} (stub-observed: ${stubCalls === null ? "n/a" : stubCalls})`);
    line(`captureArtifactWritten = ${dryRun || replayFile ? "no" : captureFile}`);
    line("");
    const after = validateListingV5Draft(context, cachedStrategy, repaired.draft);
    line(`afterStatus = ${after.status}`);
    line(`afterUnsupported = ${JSON.stringify(after.claims.unsupportedClaims)}`);
    line(`afterProhibited = ${JSON.stringify(after.claims.prohibitedClaims)}`);
    line(`afterQuality = ${JSON.stringify(after.quality)}`);
    line("");
    line("-- repaired copy --");
    line(`TITLE = ${repaired.draft.title.text}`);
    repaired.draft.bullets.forEach((bullet, index) => { line(`BULLET_${index + 1} = ${bullet.text}`); });
    line(`DESCRIPTION = ${repaired.draft.description.text}`);
    line(`SEARCH_TERMS = ${repaired.draft.backendSearchTerms.join(", ")}`);
    line("");
    const safe = after.claims.unsupportedClaims.length === 0
      && after.claims.prohibitedClaims.length === 0
      && after.claims.competitorOverlap.length === 0;
    line(`CASE_${caseKey}_VERDICT = ${safe && after.status === "PASS" ? "V5_CANDIDATE_VALID" : "V5_LOSS"}`);
  }

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, lines.join("\n"), "utf8");
  process.stdout.write(lines.join("\n"));
  process.stdout.write(`\nwritten: ${outFile}\n`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  process.stderr.write(`repairFrozenCase failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
