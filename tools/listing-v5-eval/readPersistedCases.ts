/**
 * Reads the persisted Listing V5 snapshots for the real benchmark cases
 * (Owala / LE TAUCI / ukeetap) out of the local database.
 *
 * Benchmark tooling only - never imported by the application. It prints only
 * bounded listing fields, never credentials, and never the whole resultJson.
 *
 * Usage (from the project root):
 *   npx tsx tools/listing-v5-eval/readPersistedCases.ts
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

/** Text produced by the deterministic residual rewrite that was deleted. */
const MECHANICAL_MARKERS = [
  "for a clear product detail",
  "It supports everyday comparison with confirmed information",
  "shoppers comparing practical options",
  "simple product choice",
  "fits their routine",
  "The product includes",
  "helps shoppers understand the product at a glance",
  "clear detail to compare",
];

function markersIn(text: string): string[] {
  return MECHANICAL_MARKERS.filter((marker) => text.toLowerCase().includes(marker.toLowerCase()));
}

function argValue(flag: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

const outFile = resolve(argValue("--out") ?? join("tools", "listing-v5-eval", "out", "persisted-cases.txt"));

async function main(): Promise<void> {
  const envArg = argValue("--env");
  if (envArg) for (const file of envArg.split(";").filter(Boolean)) loadEnvPath(file);
  else loadEnvPath(join("D:\\Workspace\\projects\\project-001-跨境电商AI工具\\电商工具", ".env.local"));

  const { prisma } = nodeRequire("@/lib/server/db") as typeof import("@/lib/server/db");

  const rows = await prisma.viralAnalysisRecord.findMany({
    select: { id: true, title: true, updatedAt: true, resultJson: true },
    orderBy: { updatedAt: "desc" },
  });

  const lines: string[] = [];
  const line = (value = "") => { lines.push(value); };
  line("=== persisted Listing V5 snapshots ===");
  line(`records scanned = ${rows.length}`);
  line("");

  let found = 0;
  for (const row of rows) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(row.resultJson) as Record<string, unknown>; } catch { continue; }
    const snapshot = parsed.listingV5;
    if (!snapshot || typeof snapshot !== "object") continue;
    const s = snapshot as Record<string, any>;
    const listing = s.listing ?? null;
    const validation = s.validation ?? null;
    const provider = s.provider ?? null;
    found += 1;

    const copyText = listing
      ? [listing.title?.text ?? "", ...(listing.bullets ?? []).map((b: any) => b.text ?? ""), listing.description?.text ?? ""].join("\n")
      : "";
    const markers = markersIn(copyText);

    line("--------------------------------------------------------------");
    line(`taskId = ${row.id}`);
    line(`title = ${row.title ?? "(none)"}`);
    line(`updatedAt = ${row.updatedAt.toISOString()}`);
    line(`versions = strategy:${s.strategyPromptVersion} writer:${s.writerPromptVersion} validator:${s.validatorVersion} repair:${s.repairPromptVersion}`);
    line(`provider = ${JSON.stringify(provider)}`);
    line(`repairApplied = ${s.repairApplied}`);
    line(`validation.status = ${validation?.status ?? "(none)"}`);
    line(`validation.claims = ${JSON.stringify(validation?.claims ?? null)}`);
    line(`validation.quality = ${JSON.stringify(validation?.quality ?? null)}`);
    line(`MECHANICAL_MARKERS = ${markers.length === 0 ? "NONE" : JSON.stringify(markers)}`);
    line(`CONTAMINATED_BY_DELETED_REWRITE = ${markers.length > 0 ? "YES" : "NO"}`);
    if (listing) {
      line(`TITLE = ${listing.title?.text ?? ""}`);
      (listing.bullets ?? []).forEach((b: any, i: number) => { line(`BULLET_${i + 1} = ${b.text ?? ""}`); });
      line(`DESCRIPTION = ${listing.description?.text ?? ""}`);
      line(`SEARCH_TERMS = ${(listing.backendSearchTerms ?? []).join(", ")}`);
    }
    line("");
  }

  line(`records with a Listing V5 snapshot = ${found}`);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, lines.join("\n"), "utf8");
  process.stdout.write(lines.join("\n"));
  process.stdout.write(`\nwritten: ${outFile}\n`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  process.stderr.write(`readPersistedCases failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
