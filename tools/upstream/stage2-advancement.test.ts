import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RankingRun } from "../../lib/upstream/contracts";
import {
  buildStage2CalibrationFromSubmission,
  type Stage2EvidenceGapInventory,
  type Stage2EvidenceSubmission,
} from "./stage2-evidence-intake";
import {
  buildCandidateAdvancementPreview,
  buildStage2HumanDecisionTemplate,
  validateStage2HumanDecisionSubmission,
  type Stage2SourcePacket,
} from "./stage2-advancement";

const ROOT = resolve(TEST_PROJECT_MATERIALS_ROOT, "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sources() {
  const inventory = readJson<Stage2EvidenceGapInventory>(resolve(ROOT, "05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json"));
  const incomplete = readJson<Stage2EvidenceSubmission>(resolve(ROOT, "06-Stage2证据录入/stage2-evidence-submission.template.v1.json"));
  const synthetic = readJson<Stage2EvidenceSubmission>(resolve(ROOT, "06-Stage2证据录入/synthetic-fixture/stage2-evidence-submission.synthetic.v1.json"));
  const stage2Packet = readJson<Stage2SourcePacket>(resolve(ROOT, "02-盲评完成后再打开/stage2-objective-calibration-packet.v1.json"));
  const ranking = readJson<RankingRun>(resolve(TEST_PROJECT_MATERIALS_ROOT, "06_测试与验证/2026-07-14-Phase-Amazon-Human-Assisted-Canary-15/stage1-ranking.v1.json"));
  return { inventory, incomplete, synthetic, stage2Packet, ranking };
}

function decisionTemplateForRealMode() {
  const source = sources();
  const testOnlyRealSubmission = structuredClone(source.synthetic);
  testOnlyRealSubmission.evidenceMode = "real_evidence";
  testOnlyRealSubmission.submissionId = "test-only-real-mode-complete";
  testOnlyRealSubmission.submittedBy = "test_fixture_not_real_business_evidence";
  const calibration = buildStage2CalibrationFromSubmission(source.inventory, testOnlyRealSubmission);
  const decisions = buildStage2HumanDecisionTemplate(calibration, {
    decisionBatchId: "stage2-decision-test-01",
    decidedAt: "2026-07-14T13:00:00.000Z",
    decidedBy: "test_fixture",
  });
  return { ...source, calibration, decisions };
}

function decisionTemplateForPartiallyReadyRealMode() {
  const source = sources();
  const testOnlyPartialSubmission = structuredClone(source.synthetic);
  testOnlyPartialSubmission.evidenceMode = "real_evidence";
  testOnlyPartialSubmission.submissionId = "test-only-real-mode-partially-ready";
  testOnlyPartialSubmission.submittedBy = "test_fixture_not_real_business_evidence";
  for (const sample of testOnlyPartialSubmission.samples.slice(1)) {
    sample.variantIdentity = {
      status: "unknown",
      amazonVariant: null,
      supplierVariant: null,
      confirmedAt: null,
      evidence: null,
    };
    for (const field of Object.keys(sample.fields) as Array<keyof typeof sample.fields>) {
      sample.fields[field] = {
        value: null,
        missingReason: "not_collected",
        evidence: null,
      };
    }
  }
  const calibration = buildStage2CalibrationFromSubmission(source.inventory, testOnlyPartialSubmission);
  const decisions = buildStage2HumanDecisionTemplate(calibration, {
    decisionBatchId: "stage2-decision-partial-test-01",
    decidedAt: "2026-07-15T06:30:00.000Z",
    decidedBy: "test_fixture",
  });
  return { ...source, calibration, decisions };
}

describe("Stage 2 人工晋级和 Candidate 导入前预览", () => {
  it("真实证据仍不完整时只生成空白决定材料，不允许提前晋级", () => {
    const { inventory, incomplete } = sources();
    const calibration = buildStage2CalibrationFromSubmission(inventory, incomplete);
    const decisions = buildStage2HumanDecisionTemplate(calibration, {
      decisionBatchId: "stage2-decision-empty-01",
      decidedAt: "2026-07-14T13:00:00.000Z",
      decidedBy: "project_owner",
    });
    const validation = validateStage2HumanDecisionSubmission(calibration, decisions);

    expect(decisions.decisions).toHaveLength(7);
    expect(decisions.decisions.every((item) => item.decision === null && item.reason === null)).toBe(true);
    expect(validation.status).toBe("blocked_by_evidence");
    expect(validation.summary.readyCount).toBe(0);
  });

  it("一条样本证据就绪时只要求该条人工决定并允许生成该条预览", () => {
    const { calibration, decisions, ranking, stage2Packet } = decisionTemplateForPartiallyReadyRealMode();
    expect(calibration.status).toBe("profit_insufficient_evidence");
    expect(calibration.samples.filter((sample) => sample.evidenceStatus === "ready_for_calibration")).toHaveLength(1);

    decisions.decisions[0].decision = "continue";
    decisions.decisions[0].reason = "测试：只继续证据已齐的样本。";
    decisions.decisions[0].evidenceReviewed = true;

    const validation = validateStage2HumanDecisionSubmission(calibration, decisions);
    const preview = buildCandidateAdvancementPreview({ ranking, stage2Packet, calibration, decisions });

    expect(validation.status).toBe("ready_for_advancement_preview");
    expect(validation.summary).toMatchObject({
      eligibleSampleCount: 1,
      blockedByEvidenceCount: 6,
      readyCount: 1,
      pendingCount: 6,
    });
    expect(preview.status).toBe("preview_ready_not_persisted");
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0].productKey).toBe(decisions.decisions[0].productKey);
  });

  it("未就绪样本不能通过人工决定绕过证据门禁", () => {
    const { calibration, decisions, ranking, stage2Packet } = decisionTemplateForPartiallyReadyRealMode();
    decisions.decisions[1].decision = "continue";
    decisions.decisions[1].reason = "测试：尝试绕过证据门禁。";
    decisions.decisions[1].evidenceReviewed = true;

    const validation = validateStage2HumanDecisionSubmission(calibration, decisions);
    const preview = buildCandidateAdvancementPreview({ ranking, stage2Packet, calibration, decisions });

    expect(validation.status).toBe("rejected");
    expect(validation.items[1].reasonCodes).toContain("decision_for_ineligible_sample");
    expect(preview.status).toBe("blocked_by_human_decision");
    expect(preview.candidates).toEqual([]);
  });

  it("证据就绪后仍要求每条人工明确 continue/stop/hold 和理由", () => {
    const { calibration, decisions } = decisionTemplateForRealMode();
    decisions.decisions.forEach((item, index) => {
      item.decision = index === 0 ? "continue" : index === 1 ? "stop" : "hold";
      item.reason = index === 0 ? "测试：证据齐全，继续进入正式导入前复核。" : "测试：保持停止或待定。";
      item.evidenceReviewed = true;
    });
    const validation = validateStage2HumanDecisionSubmission(calibration, decisions);

    expect(validation.status).toBe("ready_for_advancement_preview");
    expect(validation.summary).toMatchObject({ continueCount: 1, stopCount: 1, holdCount: 5, readyCount: 7 });
  });

  it("只为人工 continue 的样本生成未落库 Candidate 预览，并保留全链追溯", () => {
    const { calibration, decisions, ranking, stage2Packet } = decisionTemplateForRealMode();
    decisions.decisions.forEach((item, index) => {
      item.decision = index === 0 ? "continue" : "hold";
      item.reason = index === 0 ? "测试继续。" : "测试待补事实。";
      item.evidenceReviewed = true;
    });
    const rankingBefore = JSON.stringify(ranking);
    const preview = buildCandidateAdvancementPreview({ ranking, stage2Packet, calibration, decisions });

    expect(preview.status).toBe("preview_ready_not_persisted");
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0]).toMatchObject({
      formalCandidateId: null,
      persistenceStatus: "not_written",
      sourceIntegrity: "pending_server_proof",
      requestedCandidateStatus: "worth_analyzing",
    });
    expect(preview.candidates[0].trace).toMatchObject({
      briefId: ranking.briefId,
      collectionRunId: ranking.collectionRunId,
      rankingRunId: ranking.rankingRunId,
      stage1EvidenceHash: stage2Packet.samples[0].calibration.candidateId
        ? ranking.results.find((item) => item.productKey === preview.candidates[0].productKey)!.inputEvidenceHash
        : "",
    });
    expect(preview.boundary).toMatchObject({ databaseWritten: false, apiCalled: false, authorizationProven: false });
    expect(JSON.stringify(ranking)).toBe(rankingBefore);
  });

  it("合成 Fixture 即使完成计算也绝不生成 Candidate 预览", () => {
    const { inventory, synthetic, ranking, stage2Packet } = sources();
    const calibration = buildStage2CalibrationFromSubmission(inventory, synthetic);
    const decisions = buildStage2HumanDecisionTemplate(calibration, {
      decisionBatchId: "stage2-synthetic-decision-01",
      decidedAt: "2026-07-14T13:00:00.000Z",
      decidedBy: "test_fixture",
    });
    decisions.decisions.forEach((item) => {
      item.decision = "continue";
      item.reason = "仅测试。";
      item.evidenceReviewed = true;
    });

    const preview = buildCandidateAdvancementPreview({ ranking, stage2Packet, calibration, decisions });
    expect(preview.status).toBe("blocked_non_real_evidence");
    expect(preview.candidates).toEqual([]);
  });

  it("决定缺失、未复核或 Hash 变化均可检测", () => {
    const { calibration, decisions } = decisionTemplateForRealMode();
    const before = validateStage2HumanDecisionSubmission(calibration, decisions);
    decisions.decisions[0].decision = "continue";
    decisions.decisions[0].reason = "测试继续。";
    decisions.decisions[0].evidenceReviewed = true;
    const after = validateStage2HumanDecisionSubmission(calibration, decisions);

    expect(before.status).toBe("pending_user_input");
    expect(after.status).toBe("pending_user_input");
    expect(after.inputHash).not.toBe(before.inputHash);
    expect(after.summary.readyCount).toBe(1);
  });

  it("决定样本与校准样本不一致时整包 fail-closed", () => {
    const { calibration, decisions } = decisionTemplateForRealMode();
    decisions.decisions.pop();
    expect(() => validateStage2HumanDecisionSubmission(calibration, decisions)).toThrow("STAGE2_DECISION_SAMPLE_MISMATCH");
  });

  it("人工 continue 不能绕过 Stage 1 promoted 与 Hard Gate 资格", () => {
    const { calibration, decisions, ranking, stage2Packet } = decisionTemplateForRealMode();
    const ineligible = stage2Packet.samples.find((sample) => {
      const result = ranking.results.find((item) => item.productKey === sample.productKey);
      return result && (result.promotionDecision !== "promoted" || !result.hardGateResult.passed);
    });
    expect(ineligible).toBeDefined();
    decisions.decisions.forEach((item) => {
      item.decision = item.productKey === ineligible!.productKey ? "continue" : "hold";
      item.reason = item.decision === "continue" ? "测试尝试继续。" : "测试待定。";
      item.evidenceReviewed = true;
    });

    const preview = buildCandidateAdvancementPreview({ ranking, stage2Packet, calibration, decisions });
    expect(preview.candidates).toEqual([]);
    expect(preview.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({ productKey: ineligible!.productKey, reasonCode: "stage1_not_promoted" }),
    ]));
  });

  it("人工决定包拒绝隐藏字段", () => {
    const { calibration, decisions } = decisionTemplateForRealMode();
    (decisions.decisions[0] as unknown as Record<string, unknown>).autoDecision = "continue";
    const validation = validateStage2HumanDecisionSubmission(calibration, decisions);
    expect(validation.status).toBe("rejected");
    expect(validation.items[0].reasonCodes).toContain("unexpected_decision_field");
  });
});
