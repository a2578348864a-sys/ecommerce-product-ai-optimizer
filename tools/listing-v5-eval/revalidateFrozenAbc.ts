/**
 * Zero-provider re-validation of the frozen Case A/B/C writer output.
 *
 * The three writers were already called (budget spent) and their copy is frozen
 * in out/benchmark-abc.txt. This script re-runs ONLY the validator over that
 * frozen text, so a validator fix can be evaluated without spending a single
 * provider call.
 *
 * Why re-validating from text is faithful: claim anchoring and the quality
 * checks read the text and the confirmed-fact values only. A bullet's factIds
 * feed the structural checks, so they are re-attached from the case's own fact
 * list (the same values the writer was given) and the structural result is the
 * one already recorded in the frozen run (bulletIssues = []).
 *
 * Usage (from the project root):
 *   npx tsx tools/listing-v5-eval/revalidateFrozenAbc.ts
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

type FrozenCase = { title: string; bullets: string[]; description: string; searchTerms: string };

/** Parses the frozen report written by regenerateCaseWriter.ts. */
function parseFrozen(text: string): Map<string, FrozenCase> {
  const out = new Map<string, FrozenCase>();
  let currentKey: string | null = null;
  const value = (line: string, label: string) => {
    const prefix = `${label} = `;
    return line.startsWith(prefix) ? line.slice(prefix.length) : null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const caseMatch = /^CASE_([A-Z]) = /.exec(line);
    if (caseMatch) {
      currentKey = caseMatch[1]!;
      out.set(currentKey, { title: "", bullets: [], description: "", searchTerms: "" });
      continue;
    }
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

const frozenFile = resolve(argValue("--frozen") ?? join("tools", "listing-v5-eval", "out", "benchmark-abc.txt"));
const outFile = resolve(argValue("--out") ?? join("tools", "listing-v5-eval", "out", "benchmark-abc-revalidated.txt"));

async function main(): Promise<void> {
  loadEnvPath(join("D:\\Workspace\\projects\\project-001-跨境电商AI工具\\电商工具", ".env.local"));
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:D:/Workspace/projects/project-001-跨境电商AI工具/电商工具/prisma/dev.db";
  }

  const frozen = parseFrozen(readFileSync(frozenFile, "utf8"));
  const { prisma } = nodeRequire("@/lib/server/db") as typeof import("@/lib/server/db");
  const { checkCreativeHandoffGate } = nodeRequire("@/lib/server/productCreativeHandoffPreview") as typeof import("@/lib/server/productCreativeHandoffPreview");
  const { buildListingInputFromCreativeHandoff } = nodeRequire("@/lib/listingHandoff/listingGenerationInput") as typeof import("@/lib/listingHandoff/listingGenerationInput");
  const { buildListingV5Context } = nodeRequire("@/lib/listingV5/context") as typeof import("@/lib/listingV5/context");
  const { validateListingV5Draft } = nodeRequire("@/lib/listingV5/validation") as typeof import("@/lib/listingV5/validation");

  const lines: string[] = [];
  const line = (value = "") => { lines.push(value); };
  line("=== Listing V5 - frozen A/B/C writer output, re-validated with the V2 validator ===");
  line("PROVIDER_CALLS = 0 (frozen copy from the previous run)");
  line("");

  for (const entry of CASES) {
    const copy = frozen.get(entry.key);
    line("==============================================================");
    line(`CASE_${entry.key} = ${entry.name}`);
    if (!copy || !copy.title || copy.bullets.length === 0 || !copy.description) {
      line("STATUS = FROZEN_COPY_NOT_FOUND");
      line("");
      continue;
    }

    const row = await prisma.viralAnalysisRecord.findUnique({ where: { id: entry.taskId }, select: { resultJson: true } });
    const parsed = row ? (JSON.parse(row.resultJson) as Record<string, any>) : null;
    const cachedStrategy = parsed?.listingV5?.strategy;
    if (!cachedStrategy) { line("STATUS = NO_CACHED_STRATEGY"); line(""); continue; }

    const ownerContext = { mode: "owner", token: "benchmark-harness" } as unknown as Parameters<typeof checkCreativeHandoffGate>[1];
    const gate = await checkCreativeHandoffGate(entry.taskId, ownerContext);
    const latestHandoff = gate.currentHandoff?.versions?.[gate.currentHandoff.versions.length - 1];
    const hasListingConfirmedFact = Boolean((latestHandoff?.confirmedFacts ?? []).some((fact: any) => fact.usageScopes?.includes("listing")));
    const degraded = gate.reason === "no_confirmed_facts" && hasListingConfirmedFact;
    if ((!gate.allowed && !degraded) || !gate.currentHandoff || !gate.candidate || !latestHandoff || !gate.candidate.sourceResearch) {
      line(`STATUS = GATE_NOT_ALLOWED (reason=${gate.reason})`); line(""); continue;
    }
    const researchRevision = gate.candidate.sourceResearch.researchRevision;
    const built = buildListingInputFromCreativeHandoff(gate.currentHandoff, researchRevision, { creativeContext: gate.creativeContext ?? null });
    if (!built.ok) { line("STATUS = GENERATION_INPUT_UNAVAILABLE"); line(""); continue; }
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
    if (anchorFactIds.length === 0) { line("STATUS = NO_CONFIRMED_FACTS"); line(""); continue; }

    const draft = {
      version: "listing-v5.writer-draft.v1" as const,
      title: { text: copy.title, factIds: anchorFactIds },
      bullets: copy.bullets.filter(Boolean).map((text, index) => ({
        text,
        factIds: single,
        strategyRole: cachedStrategy.bulletAngles?.[index]?.role ?? "core_outcome",
      })),
      description: { text: copy.description, factIds: single },
      backendSearchTerms: copy.searchTerms ? copy.searchTerms.split(", ").filter(Boolean) : [],
      humanReviewRequired: true as const,
    };

    const report = validateListingV5Draft(context, cachedStrategy, draft);
    line(`validation = ${report.status}`);
    line(`unsupportedClaims = ${JSON.stringify(report.claims.unsupportedClaims)}`);
    line(`prohibitedClaims = ${JSON.stringify(report.claims.prohibitedClaims)}`);
    line(`competitorOverlap = ${JSON.stringify(report.claims.competitorOverlap)}`);
    line(`quality = ${JSON.stringify(report.quality)}`);
    line(`repairAllowed = ${report.repair.allowed}`);
    line(`repairTargets = ${JSON.stringify(report.repair.targets)}`);
    line(`descriptionIssues = ${JSON.stringify(report.description.issues)}`);
    line(`bulletIssues = ${JSON.stringify(report.bullets.map((b: any, i: number) => ({ i, valid: b.valid, issues: b.issues })).filter((r: any) => !r.valid))}`);
    const safe = report.claims.unsupportedClaims.length === 0
      && report.claims.prohibitedClaims.length === 0
      && report.claims.competitorOverlap.length === 0;
    line(`CASE_${entry.key}_VERDICT = ${safe && report.status === "PASS" ? "V5_CANDIDATE_VALID" : safe ? "REPAIR_REQUIRED" : "V5_LOSS_FACT_SAFETY"}`);
    line("");
  }

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, lines.join("\n"), "utf8");
  process.stdout.write(lines.join("\n"));
  process.stdout.write(`\nwritten: ${outFile}\n`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  process.stderr.write(`revalidateFrozenAbc failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
