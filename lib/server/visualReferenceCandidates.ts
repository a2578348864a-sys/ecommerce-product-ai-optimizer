import "server-only";

/**
 * V2 Final Integration: 生产视觉参考候选与服务端解析。
 *
 * 正式业务流程（规格六~八节）：
 *   商品研究任务自有图片候选 → Handoff Preview 展示安全候选 → 用户明确选择图片
 *   → 用户勾选「批准作为产品视觉参考」→ 服务器重新解析候选
 *   → 写入当前 Handoff visualReferences（identityBound=true + 批准主体/时间/引用）
 *   → Image 页面可选择其中一张或多张 → product_visual_draft
 *
 * 候选来源（规格七节，允许来源仅限）：
 *   1. 当前 Task 已持久化且可追溯的图片资产（candidateAnalysisContext.productImage，
 *      provenance=task_snapshot/candidate_fallback/product_batch_snapshot，
 *      来自 from-market-screening / product-batch 导入的 productImageSnapshot，含 dataUrl/contentHash）
 *
 * 禁止：Browser 任意 URL / 本地文件路径 / 未绑定 Task 图片 / 跨 Candidate / 跨 Visitor /
 *       AI 已生成图反向作为真实参考 / OCR / 截图自动认定 / 仅文件名匹配。
 *
 * selectionId 服务端确定性绑定：schema + subjectKind + taskId + candidateId + researchRevision
 *   + category=visual + contentFingerprint（contentHash 截断）。
 * Browser 只能提交 selectionId；服务端锁内重新生成候选并匹配。
 */

import { createHash } from "node:crypto";
import { parseCandidateResearchContext, type CandidateResearchContext } from "@/lib/candidateResearchContext";

export const VISUAL_SELECTION_SCHEMA = "creative-handoff-visual-selection-id:v1";

export type VisualReferenceCandidate = {
  selectionId: string;
  sourceKind: "task_snapshot" | "candidate_fallback" | "product_batch_snapshot";
  /** 安全摘要（不含完整 dataUrl；仅 contentHash 前 8 字符） */
  summary: string;
  contentHash: string;
  approvable: true;
};

function hash256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 从 candidateAnalysisContext 提取任务自有图片候选（仅当前 Task/Candidate 可追溯资源） */
export function extractVisualReferenceCandidates(
  context: CandidateResearchContext | null,
  subjectKind: "owner" | "visitor",
  taskId: string,
  researchRevision: number,
): VisualReferenceCandidate[] {
  if (!context?.productImage) return [];
  const image = context.productImage;
  if (!image.dataUrl || !image.contentHash) return [];
  const canonical = JSON.stringify({
    schema: VISUAL_SELECTION_SCHEMA,
    subjectKind,
    taskId,
    candidateId: context.candidateId,
    researchRevision,
    category: "visual",
    contentFingerprint: image.contentHash.slice(0, 24),
  });
  return [{
    selectionId: `visual:${hash256(canonical).slice(0, 24)}`,
    sourceKind: image.provenance,
    summary: `approved visual reference ${image.contentHash.slice(0, 8)}`,
    contentHash: image.contentHash,
    approvable: true,
  }];
}

export type ResolvedVisualReference = {
  selectionId: string;
  contentHash: string;
  sourceKind: "task_snapshot" | "candidate_fallback" | "product_batch_snapshot";
};

/** 服务端锁内解析：重新生成候选并匹配 Browser selectionId（fail-closed） */
export function resolveVisualReferenceSelectionIds(
  selectionIds: string[],
  context: CandidateResearchContext | null,
  subjectKind: "owner" | "visitor",
  taskId: string,
  researchRevision: number,
): ResolvedVisualReference[] {
  if (!selectionIds.length) return [];
  const candidates = extractVisualReferenceCandidates(context, subjectKind, taskId, researchRevision);
  const bySelectionId = new Map(candidates.map((c) => [c.selectionId, c]));
  const resolved: ResolvedVisualReference[] = [];
  for (const id of selectionIds) {
    const candidate = bySelectionId.get(id);
    if (!candidate) {
      throw new Error(`visual_reference_selection_invalid:${id.slice(0, 8)}`);
    }
    resolved.push({
      selectionId: candidate.selectionId,
      contentHash: candidate.contentHash,
      sourceKind: candidate.sourceKind,
    });
  }
  return resolved;
}

/**
 * 从已解析参考构造 Handoff visualReferences 条目。
 * 注意：contract 的 assetFingerprint 必须为 64 位 hex（isHash），identityBound=true，
 * humanApprovedForReference=true，approvedBy/approvedAt/confirmationReference 合法。
 * 不得写入完整 dataUrl / Cookie / Token / 内部路径（contract 无 dataUrl 字段，天然满足）。
 */
export function buildApprovedVisualReference(input: {
  actor: { mode: "owner" | "visitor"; subjectFingerprint: string };
  resolved: ResolvedVisualReference;
  approvedAt: string;
  confirmationReference: string;
}) {
  const { actor, resolved, approvedAt, confirmationReference } = input;
  return {
    assetFingerprint: hash256(`visual-reference:${resolved.contentHash}`),
    sourceTier: "human_confirmed" as const,
    identityBound: true,
    humanApprovedForReference: true,
    approvedBy: { mode: actor.mode, subjectFingerprint: actor.subjectFingerprint },
    approvedAt,
    confirmationReference,
  };
}
