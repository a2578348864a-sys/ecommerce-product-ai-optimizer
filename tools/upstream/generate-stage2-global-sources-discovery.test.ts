import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage2GlobalSourcesDiscoveryMaterials } from "./generate-stage2-global-sources-discovery";

const PROJECT_ROOT = TEST_PROJECT_MATERIALS_ROOT;
const roots: string[] = [];
const file = (path: string): string => resolve(PROJECT_ROOT, path);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function input(outputDirectory: string) {
  return {
    decisionBriefFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Decision-Brief-03/stage2-alternative-source-decision-brief.v1.json"),
    researchFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-research.v1.json"),
    probe1RunFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-run.v2.json"),
    probe2RunFile: file("06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-02/stage2-alternative-source-capability-probe-run.v3.json"),
    outputDirectory,
    approvedAt: "2026-07-15T04:38:56.901Z",
    createdAt: "2026-07-15T04:38:56.901Z",
  };
}

describe("Global Sources C1A material generator", () => {
  it("writes an idempotent offline-only pending-authorization package", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-global-sources-discovery-"));
    roots.push(outputDirectory);
    const first = generateStage2GlobalSourcesDiscoveryMaterials(input(outputDirectory));
    const second = generateStage2GlobalSourcesDiscoveryMaterials(input(outputDirectory));

    expect(first.selection.status).toBe("selected_pending_source_discovery");
    expect(first.discoveryBrief.status).toBe("pending_user_authorization");
    expect(first.validation.status).toBe("valid_pending_user_authorization");
    expect(first.summary).toMatchObject({
      realWebsiteAccessedDuringGeneration: false,
      externalAuthorizationGranted: false,
      productPagesAccessed: 0,
      supplierFieldsCollected: 0,
      stage2SubmissionGenerated: false,
      candidateGenerated: false,
      databaseWritten: false,
    });
    expect(second.artifactWrite).toEqual({ written: [], unchanged: first.summary.files });
    for (const name of first.summary.files.filter((value) => value.endsWith(".json"))) {
      expect(() => JSON.parse(readFileSync(resolve(outputDirectory, name), "utf8"))).not.toThrow();
    }
    const handoff = readFileSync(resolve(outputDirectory, "01-Global-Sources来源发现授权交接.md"), "utf8");
    expect(handoff).toContain("本文件不是授权");
    expect(handoff).toContain("robots 1 次");
    expect(handoff).toContain("商品页 0");
  });

  it("rejects a conflicting package before recreating another missing artifact", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-global-sources-conflict-"));
    roots.push(outputDirectory);
    const first = generateStage2GlobalSourcesDiscoveryMaterials(input(outputDirectory));
    const conflict = resolve(outputDirectory, first.summary.files[0]);
    const missing = resolve(outputDirectory, first.summary.files[1]);
    writeFileSync(conflict, "user-edited\n", "utf8");
    rmSync(missing);

    expect(() => generateStage2GlobalSourcesDiscoveryMaterials(input(outputDirectory)))
      .toThrow("STAGE2_GLOBAL_SOURCES_DISCOVERY_OUTPUT_CONFLICT");
    expect(existsSync(missing)).toBe(false);
  });
});
