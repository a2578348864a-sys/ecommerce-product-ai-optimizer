/**
 * Blind copy-quality pairs (zero Provider calls).
 *
 * Copies the frozen V4 baseline and the frozen V5 candidate of one case into two
 * anonymised candidates, on the copy surface the two products genuinely share:
 * Title / Bullets / Description. Backend search terms are excluded on purpose -
 * the persisted V4 output never produced them, so scoring them would hand V5 a
 * free advantage that is not a copy-quality difference.
 *
 * Round 1 and Round 2 contain the same two texts with the labels swapped, so a
 * winner that survives the swap is real and a winner that follows the label is
 * a TIE. The mapping is written to a separate file so the pair files themselves
 * stay anonymous.
 *
 * Usage (from the project root):
 *   npx tsx tools/listing-v5-eval/buildBlindPairs.ts [--cases=A,C]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function argValue(flag: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

const baselineFile = resolve(argValue("--baseline") ?? join("tools", "listing-v5-eval", "out", "v4-baseline-abc.json"));
const frozenFile = resolve(argValue("--frozen") ?? join("tools", "listing-v5-eval", "out", "benchmark-abc.txt"));
const pairsFile = resolve(argValue("--pairs") ?? join("tools", "listing-v5-eval", "out", "blind-pairs.json"));
const mapFile = resolve(argValue("--map") ?? join("tools", "listing-v5-eval", "out", "blind-mapping.json"));
const caseFilter = (argValue("--cases") ?? "A,C").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);

type Copy = { title: string; bullets: string[]; description: string };
type FrozenCase = Copy & { searchTerms: string };

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
    if (searchTerms !== null) { entry.searchTerms = searchTerms; }
  }
  return out;
}

const baseline = JSON.parse(readFileSync(baselineFile, "utf8")) as {
  cases: Array<{ case: string; product: string; title: string; bullets: string[]; description: string; searchTermsState?: string; searchTerms: string[] }>;
};
const frozen = parseFrozen(readFileSync(frozenFile, "utf8"));

if (!existsSync(pairsFile)) mkdirSync(dirname(pairsFile), { recursive: true });

const rounds: Array<{ round: number; case: string; product: string; candidateA: Copy; candidateB: Copy }> = [];
const mapping: Record<string, Record<string, string>> = { round1: {}, round2: {} };
const report: string[] = [];
report.push("=== Blind copy-quality pairs (copy surface: Title / Bullets / Description) ===");
report.push("SEARCH_TERMS_INCLUDED = NO (persisted V4 produced none; excluded from the blind winner)");
report.push("");

for (const entry of baseline.cases) {
  if (!caseFilter.includes(entry.case)) continue;
  const v5 = frozen.get(entry.case);
  if (!v5 || !v5.title || v5.bullets.length === 0 || !v5.description) {
    report.push(`CASE_${entry.case}: SKIPPED (frozen V5 copy not found)`);
    continue;
  }
  const v4Copy: Copy = { title: entry.title, bullets: entry.bullets, description: entry.description };
  const v5Copy: Copy = { title: v5.title, bullets: v5.bullets.filter(Boolean), description: v5.description };

  rounds.push({ round: 1, case: entry.case, product: entry.product, candidateA: v4Copy, candidateB: v5Copy });
  rounds.push({ round: 2, case: entry.case, product: entry.product, candidateA: v5Copy, candidateB: v4Copy });
  mapping.round1![entry.case] = "A=v4,B=v5";
  mapping.round2![entry.case] = "A=v5,B=v4";

  report.push(`CASE_${entry.case} = ${entry.product}   v4Bullets=${v4Copy.bullets.length}  v5Bullets=${v5Copy.bullets.length}`);
}

writeFileSync(pairsFile, JSON.stringify({ schema: "listing-v5.blind-pairs.v1", copySurface: ["title", "bullets", "description"], searchTermsIncluded: false, rounds }, null, 2), "utf8");
writeFileSync(mapFile, JSON.stringify({ schema: "listing-v5.blind-mapping.v1", note: "Sealed mapping for the pair files. Do not read while scoring.", mapping }, null, 2), "utf8");
process.stdout.write(report.join("\n"));
process.stdout.write(`\nwritten: ${pairsFile}\nwritten: ${mapFile}\n`);
