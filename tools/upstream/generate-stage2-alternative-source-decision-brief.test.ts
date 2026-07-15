import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage2AlternativeSourceDecisionBriefMaterials } from "./generate-stage2-alternative-source-decision-brief";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const roots: string[] = [];
const file = (path: string): string => resolve(PROJECT_ROOT, path);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Stage 2 alternative-source decision materials", () => {
  it("writes an idempotent offline-only three-option handoff", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-alt-source-decision-"));
    roots.push(outputDirectory);
    const input = {
      briefFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
      probe1RunFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-run.v2.json"),
      probe2RunFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-02/stage2-alternative-source-capability-probe-run.v3.json"),
      outputDirectory,
      createdAt: "2026-07-15T04:10:00.000Z",
    };
    const first = generateStage2AlternativeSourceDecisionBriefMaterials(input);
    const second = generateStage2AlternativeSourceDecisionBriefMaterials(input);
    expect(first.decisionBrief).toMatchObject({
      status: "pending_user_decision",
      selectedOption: null,
      sourceCapabilityValidated: false,
    });
    expect(first.summary).toMatchObject({
      realWebsiteAccessedDuringGeneration: false,
      userDecisionRecorded: false,
      supplierFieldsCollected: 0,
    });
    expect(second.artifactWrite).toEqual({ written: [], unchanged: first.summary.files });
    const handoff = readFileSync(resolve(outputDirectory, "01-用户来源决策交接.md"), "utf8");
    expect(handoff).toContain("不原样重试");
    expect(handoff).toContain("供应商子域名");
    expect(handoff).toContain("更换公开来源");
    expect(handoff).toContain("尚未替你选择");
    for (const name of first.summary.files.filter((value) => value.endsWith(".json"))) {
      expect(() => JSON.parse(readFileSync(resolve(outputDirectory, name), "utf8"))).not.toThrow();
    }
  });
});
