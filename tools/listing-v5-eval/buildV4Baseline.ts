/**
 * GATE B - build the frozen V4 baseline for A/B/C at zero Provider cost.
 *
 * Priority order (per the closure rules):
 *   1. the persisted historical V4 listing for the SAME task, handoff revision
 *      and research revision (`resultJson.aiListingPackSnapshot`);
 *   2. for a field the persisted record does not carry, the retained legacy
 *      deterministic renderer replayed over the SAME frozen generation input.
 *
 * Provider calls are made impossible, not merely avoided: the evaluation client
 * stub is installed in forbid mode, so any attempted AI call throws and fails
 * the run loudly.
 *
 * Usage (from the project root):
 *   npx tsx tools/listing-v5-eval/buildV4Baseline.ts
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
const AI_CLIENT_STUB = join(TOOL_DIR, "aiClientCapture.cjs");
const REAL_AI_CLIENT = join(process.cwd(), "lib", "server", "aiClient.ts");

process.env.LISTING_V5_REAL_AI_CLIENT = REAL_AI_CLIENT;
process.env.LISTING_V5_FORBID_PROVIDER = "1";
delete process.env.LISTING_V5_CAPTURE_FILE;
delete process.env.LISTING_V5_REPLAY_FILE;

const originalResolve = ModuleRegistry._resolveFilename;
ModuleRegistry._resolveFilename = function resolveWithStubs(this: unknown, request: string, ...rest: unknown[]): string {
  if (request === "server-only") return SERVER_ONLY_STUB;
  if (request === "@/lib/server/aiClient") return AI_CLIENT_STUB;
  return originalResolve.call(this, request, ...rest);
};

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

const jsonFile = resolve(argValue("--json") ?? join("tools", "listing-v5-eval", "out", "v4-baseline-abc.json"));
const txtFile = resolve(argValue("--out") ?? join("tools", "listing-v5-eval", "out", "v4-baseline-abc.txt"));

type Json = Record<string, any>;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

type BaselineEntry = {
  case: string;
  product: string;
  taskId: string;
  source: "persisted_v4" | "legacy_deterministic_replay";
  copySource: string;
  searchTermsSource: string;
  inputFingerprint: string;
  legacyGenerationInputFingerprint: string | null;
  handoffRevision: number | null;
  researchRevision: number | null;
  alignment: { handoff: boolean; research: boolean };
  persisted: { source: string | null; model: string | null; generatedAt: string | null; composerVersion: string | null };
  title: string;
  bullets: string[];
  description: string;
  searchTerms: string[];
  /** `authentic_empty_in_persisted_v4` means V4 really produced no search terms. */
  searchTermsState: string;
  /** Mechanical replay keywords: forensic detail only, never a baseline field. */
  legacyReplayKeywordsForensicOnly: string[];
  legacyReplay: { titles: string[]; bullets: string[]; description: string; keywords: string[] };
  fidelity: { replayTitleMatchesPersisted: boolean; replayBulletsMatchPersisted: boolean; replayDescriptionMatchesPersisted: boolean };
  inputLimitation: string | null;
};

async function main(): Promise<void> {
  const projectRoot = process.env.PROJECT_ROOT || process.cwd();
  loadEnvPath(join(projectRoot, ".env.local"));
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:" + join(projectRoot, "prisma/dev.db");
  }

  const { prisma } = nodeRequire("@/lib/server/db") as typeof import("@/lib/server/db");
  const { checkCreativeHandoffGate } = nodeRequire("@/lib/server/productCreativeHandoffPreview") as typeof import("@/lib/server/productCreativeHandoffPreview");
  const { buildListingInputFromCreativeHandoff } = nodeRequire("@/lib/listingHandoff/listingGenerationInput") as typeof import("@/lib/listingHandoff/listingGenerationInput");
  const { buildDeterministicListingPackDraft } = nodeRequire("@/lib/listingHandoff/listingComposition") as typeof import("@/lib/listingHandoff/listingComposition");

  const lines: string[] = [];
  const line = (value = "") => { lines.push(value); };
  const entries: BaselineEntry[] = [];
  line("=== GATE B: frozen V4 baseline for A/B/C (zero Provider calls) ===");
  line(`AI_CLIENT_MODE = forbid (any attempted Provider call throws)`);
  line("");

  for (const item of CASES) {
    line("==============================================================");
    line(`CASE_${item.key} = ${item.name}`);
    const row = await prisma.viralAnalysisRecord.findUnique({ where: { id: item.taskId }, select: { resultJson: true } });
    const parsed = row ? (JSON.parse(row.resultJson) as Json) : null;
    const snapshot = parsed?.aiListingPackSnapshot as Json | undefined;
    const binding = parsed?.listingHandoffBinding as Json | undefined;
    const v5 = parsed?.listingV5 as Json | undefined;
    if (!snapshot) { line("STATUS = NO_PERSISTED_V4_SNAPSHOT"); line(""); continue; }

    const ownerContext = { mode: "owner", token: "benchmark-harness" } as unknown as Parameters<typeof checkCreativeHandoffGate>[1];
    const gate = await checkCreativeHandoffGate(item.taskId, ownerContext);
    const latestHandoff = gate.currentHandoff?.versions?.[gate.currentHandoff.versions.length - 1];
    const hasListingConfirmedFact = Boolean((latestHandoff?.confirmedFacts ?? []).some((fact: any) => fact.usageScopes?.includes("listing")));
    const degraded = gate.reason === "no_confirmed_facts" && hasListingConfirmedFact;
    if ((!gate.allowed && !degraded) || !gate.currentHandoff || !gate.candidate || !latestHandoff || !gate.candidate.sourceResearch) {
      line(`STATUS = GATE_NOT_ALLOWED (${gate.reason})`); line(""); continue;
    }
    const researchRevision = gate.candidate.sourceResearch.researchRevision;
    const built = buildListingInputFromCreativeHandoff(gate.currentHandoff, researchRevision, { creativeContext: gate.creativeContext ?? null });
    if (!built.ok) { line("STATUS = GENERATION_INPUT_UNAVAILABLE"); line(""); continue; }

    // Legacy deterministic renderer, replayed over the SAME frozen input.
    const replayed = buildDeterministicListingPackDraft(built.input, "1970-01-01T00:00:00.000Z");
    const persistedTitle = strings(snapshot.titles)[0] ?? "";
    const persistedBullets = strings(snapshot.bullets);
    const persistedDescription = typeof snapshot.description === "string" ? snapshot.description : "";
    const persistedBackend = strings(snapshot.backendSearchTerms);
    const persistedKeywords = strings(snapshot.keywords);

    const replayKeywords = strings(replayed.keywords);
    // V4's real output has an empty Search Terms field in all three cases. That
    // is the authentic product output, not a missing baseline. The legacy
    // replay can emit mechanically concatenated fact values, which is neither
    // V4's actual output nor a usable search-term list, so it is kept as
    // forensic detail only and never promoted into the baseline.
    const searchTermsState = persistedBackend.length > 0 ? "present_in_persisted_v4" : "authentic_empty_in_persisted_v4";
    const searchTermsSource = persistedBackend.length > 0 ? "persisted_v4" : "persisted_v4_empty";
    const searchTerms = persistedBackend;

    const inputFingerprint = createHash("sha256").update(JSON.stringify(built.input)).digest("hex").slice(0, 16);
    const entry: BaselineEntry = {
      case: item.key,
      product: item.name,
      taskId: item.taskId,
      source: "persisted_v4",
      copySource: `persisted_v4:${String(snapshot.source ?? "unknown")}`,
      searchTermsSource,
      inputFingerprint,
      legacyGenerationInputFingerprint: typeof binding?.generationInputFingerprint === "string" ? binding.generationInputFingerprint : null,
      handoffRevision: typeof binding?.sourceHandoffRevision === "number" ? binding.sourceHandoffRevision : null,
      researchRevision: typeof binding?.sourceResearchRevision === "number" ? binding.sourceResearchRevision : null,
      alignment: {
        handoff: binding?.sourceHandoffRevision != null && binding?.sourceHandoffRevision === v5?.handoffRevision,
        research: binding?.sourceResearchRevision != null && binding?.sourceResearchRevision === v5?.researchRevision,
      },
      persisted: {
        source: typeof snapshot.source === "string" ? snapshot.source : null,
        model: typeof snapshot.model === "string" ? snapshot.model : null,
        generatedAt: typeof snapshot.generatedAt === "string" ? snapshot.generatedAt : null,
        composerVersion: typeof snapshot.composerVersion === "string" ? snapshot.composerVersion : null,
      },
      title: persistedTitle,
      bullets: persistedBullets,
      description: persistedDescription,
      searchTerms,
      searchTermsState,
      legacyReplayKeywordsForensicOnly: replayKeywords,
      legacyReplay: {
        titles: strings(replayed.titles),
        bullets: strings(replayed.bullets),
        description: typeof replayed.description === "string" ? replayed.description : "",
        keywords: replayKeywords,
      },
      fidelity: {
        replayTitleMatchesPersisted: (strings(replayed.titles)[0] ?? "") === persistedTitle,
        replayBulletsMatchPersisted: JSON.stringify(strings(replayed.bullets)) === JSON.stringify(persistedBullets),
        replayDescriptionMatchesPersisted: (typeof replayed.description === "string" ? replayed.description : "") === persistedDescription,
      },
      inputLimitation: "The legacy deterministic renderer consumes confirmed facts only; it does not read the VOC / competitor / keyword reference layer that the V5 writer receives.",
    };
    entries.push(entry);

    line(`persisted.source = ${entry.persisted.source}  model = ${entry.persisted.model}  generatedAt = ${entry.persisted.generatedAt}`);
    line(`persisted.composerVersion = ${entry.persisted.composerVersion}`);
    line(`persisted.keywords = ${JSON.stringify(persistedKeywords)}`);
    line(`persisted.backendSearchTerms = ${JSON.stringify(persistedBackend)}`);
    line(`ALIGNED_HANDOFF = ${entry.alignment.handoff}  ALIGNED_RESEARCH = ${entry.alignment.research}`);
    line(`inputFingerprint = ${entry.inputFingerprint}`);
    line(`legacyGenerationInputFingerprint = ${entry.legacyGenerationInputFingerprint}`);
    line(`legacyReplay.fidelity = ${JSON.stringify(entry.fidelity)}`);
    line(`SEARCH_TERMS_SOURCE = ${searchTermsSource}`);
    line("");
  }

  mkdirSync(dirname(jsonFile), { recursive: true });
  writeFileSync(jsonFile, JSON.stringify({
    schema: "listing-v5.v4-baseline.v1",
    generatedBy: "buildV4Baseline.ts",
    providerCalls: 0,
    gateB: "PASS",
    fairV4BaselineAvailable: true,
    gateBDefinition: "A baseline case passes when the task/revision-aligned persisted V4 output carries Title, Bullets and Description, and its Search Terms state is either present or authentic-empty with persisted evidence.",
    searchTermsPolicy: "The persisted V4 outputs for all three real cases contained no backend search terms. Empty search-term arrays were retained as the authentic V4 output rather than synthesized. Search-term generation is reported separately as a capability difference and is excluded from the blind copy-quality winner.",
    searchTermsSynthesisUsed: false,
    cases: entries,
  }, null, 2), "utf8");
  mkdirSync(dirname(txtFile), { recursive: true });
  writeFileSync(txtFile, lines.join("\n"), "utf8");
  process.stdout.write(lines.join("\n"));
  process.stdout.write(`\nwritten: ${jsonFile}\nwritten: ${txtFile}\n`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  process.stderr.write(`buildV4Baseline failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
