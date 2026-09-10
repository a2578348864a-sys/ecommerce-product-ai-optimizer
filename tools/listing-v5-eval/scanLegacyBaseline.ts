/**
 * GATE B - zero-Provider search for a legitimate V4/legacy listing baseline.
 *
 * Read-only. It never calls a Provider and never prints credentials. It lists
 * the top-level keys of each benchmark task's persisted resultJson and dumps
 * every listing-shaped snapshot it finds (title / bullets / description /
 * search terms) with its provenance, so a baseline can be chosen on evidence
 * instead of guessing field names.
 *
 * Usage (from the project root):
 *   npx tsx tools/listing-v5-eval/scanLegacyBaseline.ts
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

const LISTING_KEY = /listing|draft|pack|snapshot|compos/i;

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

const outFile = resolve(argValue("--out") ?? join("tools", "listing-v5-eval", "out", "legacy-baseline-scan.txt"));

type Json = Record<string, any>;

function strList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
}

/** Collects title/bullets/description/search-terms from any plausible shape. */
function extractCopy(node: unknown): { title?: string; bullets: string[]; description?: string; keywords: string[]; backendSearchTerms: string[] } | null {
  if (typeof node !== "object" || node === null) return null;
  const record = node as Json;
  const title = [record.title, record.productTitle, ...(strList(record.titles) ?? [])].find((item) => typeof item === "string" && item.trim()) as string | undefined;
  const bullets = (strList(record.bullets) ?? strList(record.bulletPoints) ?? strList(record.keyPoints) ?? [])
    .filter((item) => item.trim().length > 0);
  const description = [record.description, record.productDescription, record.longDescription].find((item) => typeof item === "string" && item.trim()) as string | undefined;
  // Keep the two keyword channels apart: the legacy pack uses `backendSearchTerms`
  // for the real search terms and `keywords` for on-page keywords.
  const keywords = (strList(record.keywords) ?? []).filter((item) => item.trim().length > 0);
  const backendSearchTerms = (strList(record.backendSearchTerms) ?? strList(record.searchTerms) ?? []).filter((item) => item.trim().length > 0);
  if (!title && bullets.length === 0 && !description && keywords.length === 0 && backendSearchTerms.length === 0) return null;
  return { title, bullets, description, keywords, backendSearchTerms };
}


async function main(): Promise<void> {
  loadEnvPath(join("D:\\Workspace\\projects\\project-001-跨境电商AI工具\\电商工具", ".env.local"));
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:D:/Workspace/projects/project-001-跨境电商AI工具/电商工具/prisma/dev.db";
  }

  const { prisma } = nodeRequire("@/lib/server/db") as typeof import("@/lib/server/db");
  const lines: string[] = [];
  const line = (value = "") => { lines.push(value); };
  line("=== GATE B: zero-Provider scan for an existing V4/legacy listing baseline ===");
  line("PROVIDER_CALLS = 0");
  line("");

  for (const entry of CASES) {
    line("==============================================================");
    line(`CASE_${entry.key} = ${entry.name} (${entry.taskId})`);
    const row = await prisma.viralAnalysisRecord.findUnique({ where: { id: entry.taskId }, select: { resultJson: true, title: true, updatedAt: true } });
    if (!row) { line("STATUS = RECORD_NOT_FOUND"); line(""); continue; }
    let parsed: Json;
    try {
      parsed = JSON.parse(row.resultJson) as Json;
    } catch {
      line("STATUS = RESULT_JSON_UNPARSEABLE"); line(""); continue;
    }
    line(`updatedAt = ${row.updatedAt.toISOString()}`);
    const keys = Object.keys(parsed);
    line(`topLevelKeys(${keys.length}) = ${keys.join(", ")}`);
    line("");

    for (const key of keys) {
      const value = parsed[key];
      const isObject = typeof value === "object" && value !== null;
      if (!LISTING_KEY.test(key)) continue;
      line(`-- KEY ${key} :: ${Array.isArray(value) ? `array(${value.length})` : isObject ? "object" : typeof value}`);
      if (isObject) {
        const inner = Array.isArray(value) ? value[0] : value;
        if (typeof inner === "object" && inner !== null) {
          line(`   innerKeys = ${Object.keys(inner as Json).slice(0, 30).join(", ")}`);
        }
        const meta = value as Json;
        for (const metaKey of ["source", "model", "version", "generatedAt", "savedAt", "savedBy", "snapshotType", "humanReviewRequired"]) {
          if (metaKey in meta) line(`   ${metaKey} = ${JSON.stringify(meta[metaKey])}`);
        }
        for (const rawKey of ["keywords", "backendSearchTerms", "usedKeywordIds", "usedFactIds", "factSafe", "listingUnqualified", "copyQuality", "qualityReport", "generationInputFactCount", "generationInputResearchReferenceCount", "providerAttempted", "providerSucceeded", "fallbackApplied", "fallbackReason", "polishApplied", "polishModel", "draftKind"]) {
          if (rawKey in meta) {
            const shown = JSON.stringify(meta[rawKey]);
            line(`   RAW ${rawKey} (${Array.isArray(meta[rawKey]) ? `array(${meta[rawKey].length})` : typeof meta[rawKey]}) = ${(shown ?? "undefined").slice(0, 400)}`);
          }
        }
        const copy = extractCopy(value);
        if (copy) {
          line(`   COPY_FOUND titleChars=${copy.title?.length ?? 0} bullets=${copy.bullets.length} descriptionChars=${copy.description?.length ?? 0} keywords=${copy.keywords.length} backendSearchTerms=${copy.backendSearchTerms.length}`);
          if (copy.title) line(`   TITLE = ${copy.title}`);
          copy.bullets.slice(0, 8).forEach((bullet, index) => line(`   BULLET_${index + 1} = ${bullet}`));
          if (copy.description) line(`   DESCRIPTION = ${copy.description}`);
          if (copy.keywords.length) line(`   KEYWORDS = ${copy.keywords.join(", ")}`);
          if (copy.backendSearchTerms.length) line(`   SEARCH_TERMS = ${copy.backendSearchTerms.join(", ")}`);
        } else {
          line("   COPY_FOUND = no (no title/bullets/description/search terms at this level)");
        }
      }
      line("");
    }

    // Evidence alignment: a baseline is only fair if it came from the same
    // handoff/research revision as the V5 run it will be compared against.
    const binding = parsed.listingHandoffBinding as Json | undefined;
    const v5 = parsed.listingV5 as Json | undefined;
    line("-- EVIDENCE ALIGNMENT");
    line(`   legacy.sourceHandoffRevision = ${JSON.stringify(binding?.sourceHandoffRevision ?? null)}`);
    line(`   legacy.sourceResearchRevision = ${JSON.stringify(binding?.sourceResearchRevision ?? null)}`);
    line(`   legacy.generationInputFingerprint = ${JSON.stringify(binding?.generationInputFingerprint ?? null)}`);
    line(`   legacy.generationSource = ${JSON.stringify(binding?.generationSource ?? null)}`);
    line(`   legacy.composerVersion = ${JSON.stringify(binding?.composerVersion ?? null)}`);
    line(`   v5.researchRevision = ${JSON.stringify(v5?.researchRevision ?? null)}`);
    line(`   v5.handoffRevision = ${JSON.stringify(v5?.handoffRevision ?? null)}`);
    line(`   v5.contextFingerprint = ${JSON.stringify(v5?.contextFingerprint ?? null)}`);
    line(`   ALIGNED_HANDOFF = ${String(binding?.sourceHandoffRevision != null && binding?.sourceHandoffRevision === v5?.handoffRevision)}`);
    line(`   ALIGNED_RESEARCH = ${String(binding?.sourceResearchRevision != null && binding?.sourceResearchRevision === v5?.researchRevision)}`);
    line("");
  }

  // Legacy Listing Studio persistence: an older copy history table that may
  // still hold V4-era listing text for the same products.
  line("==============================================================");
  line("LEGACY TABLE: ListingCopyHistory");
  try {
    const total = await (prisma as unknown as { listingCopyHistory: { count: () => Promise<number> } }).listingCopyHistory.count();
    line(`rows = ${total}`);
    const rows = await (prisma as unknown as {
      listingCopyHistory: { findMany: (args: unknown) => Promise<Array<Record<string, any>>> };
    }).listingCopyHistory.findMany({ orderBy: { updatedAt: "desc" }, take: 50 });
    for (const row of rows) {
      line("--------------------------------------------------------------");
      line(`id = ${String(row.id)}`);
      line(`productName = ${JSON.stringify(row.productName)}`);
      line(`productId = ${JSON.stringify(row.productId ?? null)}`);
      line(`createdAt = ${String(row.createdAt)}  updatedAt = ${String(row.updatedAt)}`);
      line(`TITLE = ${String(row.title ?? "").slice(0, 300)}`);
      line(`BULLETS = ${String(row.bulletPoints ?? "").slice(0, 700)}`);
      line(`DESCRIPTION = ${String(row.description ?? "").slice(0, 700)}`);
      line(`KEYWORDS = ${String(row.keywords ?? "").slice(0, 500)}`);
      line(`LONG_TAIL_KEYWORDS = ${String(row.longTailKeywords ?? "").slice(0, 500)}`);
      line(`SOURCE_INPUT = ${String(row.sourceInput ?? "").slice(0, 300)}`);
    }
  } catch (error) {
    line(`SCAN_ERROR = ${error instanceof Error ? error.message : String(error)}`);
  }
  line("");

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, lines.join("\n"), "utf8");
  process.stdout.write(lines.join("\n"));
  process.stdout.write(`\nwritten: ${outFile}\n`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  process.stderr.write(`scanLegacyBaseline failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
