/**
 * DIAGNOSTIC ONLY - never benchmark evidence, never a Provider call.
 *
 * Question it answers: "if this same Provider answer had arrived under the
 * documented `text` key, what would the real normalizer and validator have
 * said?" It rewrites `currentText` -> `text` inside a COPY of the frozen
 * payload, so the pipeline can be replayed over it with zero Provider calls.
 *
 * It cannot change a verdict on its own: the Provider never produced a
 * conforming `{path,text}` answer, so the frozen run stands as the result. This
 * exists to tell an output-contract failure apart from a copy-quality or
 * fact-safety failure when deciding what to fix next.
 *
 * Usage (from the project root):
 *   npx tsx tools/listing-v5-eval/probeRepairAlias.ts --from=<artifact.json> --out=<probe.json>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function argValue(flag: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

const fromFile = argValue("--from");
const outFile = argValue("--out");
if (!fromFile || !outFile) {
  process.stderr.write("usage: --from=<artifact.json> --out=<probe.json>\n");
  process.exitCode = 1;
} else {
  const artifact = JSON.parse(readFileSync(resolve(fromFile), "utf8")) as Record<string, any>;
  if (artifact.secretScan !== "PASS") {
    process.stderr.write(`refusing: source artifact secretScan=${String(artifact.secretScan)}\n`);
    process.exitCode = 1;
  } else {
    const items: unknown[] = Array.isArray(artifact?.payload?.repairs) ? artifact.payload.repairs : [];
    if (items.length === 0) {
      process.stderr.write("refusing: frozen payload has no repairs[] item to probe\n");
      process.exitCode = 1;
    } else if (items.some((item) => typeof (item as Record<string, unknown>)?.text === "string")) {
      process.stderr.write("refusing: payload already carries a text field; probe would be meaningless\n");
      process.exitCode = 1;
    } else {
      const remapped = items.map((item) => {
        const record = item as Record<string, unknown>;
        const alias = typeof record.currentText === "string" ? record.currentText : "";
        return { path: record.path, text: alias };
      });
      const probe = {
        ...artifact,
        artifact: "listing-v5-repair-alias-probe.v1",
        probeOf: resolve(fromFile),
        probeNote: "DIAGNOSTIC ONLY: `currentText` renamed to `text` by hand. Not a valid Provider answer; never benchmark evidence.",
        payload: { repairs: remapped },
        payloadJson: JSON.stringify({ repairs: remapped }, null, 2),
      };
      writeFileSync(resolve(outFile), JSON.stringify(probe, null, 2), "utf8");
      process.stdout.write(`probe artifact written: ${resolve(outFile)}\n`);
      process.stdout.write(`items=${remapped.length} textLengths=${remapped.map((item) => String(item.text).length).join("|")}\n`);
    }
  }
}
