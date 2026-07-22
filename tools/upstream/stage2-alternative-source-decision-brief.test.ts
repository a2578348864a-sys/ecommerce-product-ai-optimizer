import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import { projectMaterialPath } from "../../tests/helpers/project-materials";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import {
  buildStage2AlternativeSourceDecisionBrief,
  validateStage2AlternativeSourceDecisionBrief,
} from "./stage2-alternative-source-decision-brief";

const readJson = <T>(path: string): T => JSON.parse(readFileSync(projectMaterialPath(path), "utf8")) as T;
const brief = readJson<Stage2AlternativeSourceBrief>(
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json",
);
const probe1Run = readJson<Record<string, unknown>>(
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-run.v2.json",
);
const probe2Run = readJson<Record<string, unknown>>(
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-02/stage2-alternative-source-capability-probe-run.v3.json",
);

describe("Stage 2 alternative-source decision brief after Probe-02", () => {
  it("turns the two authoritative failures into a pending decision without expanding policy", () => {
    const result = buildStage2AlternativeSourceDecisionBrief({
      brief, probe1Run, probe2Run, createdAt: "2026-07-15T04:10:00.000Z",
    });
    expect(result).toMatchObject({
      schemaVersion: "stage2-alternative-source-decision-brief.v1",
      status: "pending_user_decision",
      briefHash: brief.briefHash,
      probe1RunEvidenceHash: probe1Run.evidenceHash,
      probe2RunEvidenceHash: probe2Run.evidenceHash,
      currentConclusion: "unchanged_capability_probe_retry_not_supported",
      selectedOption: null,
      approvedBy: null,
      sourceCapabilityValidated: false,
      supplierSubdomainPolicyAuthorized: false,
      realSupplierEvidenceCollected: false,
    });
    expect(result.observedFacts).toMatchObject({
      probe1: { status: "failed_closed", classification: "unknown_page", allowedProductUrlCount: 0 },
      probe2: {
        status: "failed_closed",
        classification: "unknown_page",
        allowedProductUrlCount: 0,
        diagnosticStatus: "diagnostic_evidence_present",
        exactAllowedProductPathCount: 0,
        supplierSubdomainProductPathCount: expect.any(Number),
      },
    });
    expect(result.options.map((option) => option.optionId)).toEqual([
      "stop_made_in_china_current_policy",
      "design_supplier_subdomain_policy_probe",
      "select_different_public_source",
    ]);
    expect(result.options[1]).toMatchObject({ requiresNewAuthorization: true, automaticallySelected: false });
    expect(result.boundaries).toContain("supplier_subdomain_observation_is_not_policy_approval");
    const { evidenceHash, ...body } = result;
    expect(evidenceHash).toBe(stableHash(body));
    expect(validateStage2AlternativeSourceDecisionBrief({
      decisionBrief: result, brief, probe1Run, probe2Run,
    })).toMatchObject({ status: "valid_pending_user_decision", reasonCodes: [] });
  });

  it("fails closed when either authoritative run is changed or the brief claims a selected option", () => {
    expect(() => buildStage2AlternativeSourceDecisionBrief({
      brief,
      probe1Run,
      probe2Run: { ...probe2Run, evidenceHash: "0".repeat(64) },
      createdAt: "2026-07-15T04:10:00.000Z",
    })).toThrow("STAGE2_ALTERNATIVE_SOURCE_DECISION_EVIDENCE_INVALID");
    const result = buildStage2AlternativeSourceDecisionBrief({
      brief, probe1Run, probe2Run, createdAt: "2026-07-15T04:10:00.000Z",
    });
    const { evidenceHash: _hash, ...body } = result;
    const forgedBody = { ...body, selectedOption: "design_supplier_subdomain_policy_probe" };
    const forged = { ...forgedBody, evidenceHash: stableHash(forgedBody) };
    expect(validateStage2AlternativeSourceDecisionBrief({
      decisionBrief: forged, brief, probe1Run, probe2Run,
    }).reasonCodes).toContain("decision_must_remain_unselected");
  });
});
