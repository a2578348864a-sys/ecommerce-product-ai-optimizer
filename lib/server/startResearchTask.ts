/**
 * V3 Final Product Integration — F1 Start Research（创建/获取研究任务骨架）
 *
 * 用户点击「开始研究」→ create or get Research Task → 前端直接 redirect /tasks/[taskId]。
 * - 幂等：候选已转任务 → 返回既有 taskId（continue）。
 * - 骨架 resultJson：身份快照（candidateToTask + candidateAnalysisContext + sourceMeta 简化），
 *   不含 researchRecord（AI 研究尚未执行；后续由研究执行页 save-task update 写入）。
 * - productUrl 走 F4 身份继承（resolveTaskProductUrlFromCandidate）。
 * - Demo 路径复用 demoSandbox link（guard 可选：骨架无 AI 绑定校验）。
 */
import "server-only";

import { prisma } from "@/lib/server/db";
import type { AccessContext } from "@/lib/server/accessPassword";
import { isSandboxTaskId, getSandboxCandidate, createSandboxTaskAndLinkCandidateAtomic } from "@/lib/server/demoSandbox";
import { resolveTaskProductUrlFromCandidate } from "@/lib/server/taskIdentityInheritance";
import { buildCandidateAnalysisContext } from "@/lib/server/candidateAnalysisContext";
import { evaluateStoredCandidateResearchEligibility } from "@/lib/server/candidateResearchEligibility";

export class StartResearchError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "StartResearchError";
  }
}

function fail(code: string, status: number, message: string): never {
  throw new StartResearchError(code, status, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 研究骨架所需的候选投影（Owner select 与 SandboxCandidate 均兼容） */
export type ResearchCandidateRecord = {
  id: string;
  name: string;
  link: string | null;
  status: string;
  sourceMetaJson: string;
  analysisJson: string;
  convertedTaskId?: string | null;
  score?: number | null;
  riskLevel?: string;
};

/** 骨架 resultJson：候选身份快照（无 researchRecord） */
function buildSkeletonResultJson(input: {
  candidateId: string;
  candidateName: string;
  candidate: ResearchCandidateRecord;
}): Record<string, unknown> {
  return {
    type: "workflow",
    productName: input.candidateName,
    candidateToTask: {
      version: 1,
      candidateId: input.candidateId,
      confirmation: "research_started",
      confirmedAt: new Date().toISOString(),
    },
    candidateAnalysisContext: buildCandidateAnalysisContext(input.candidate),
  };
}

/** Demo：创建或获取研究任务骨架 */
async function createOrGetResearchTaskDemo(
  context: Extract<AccessContext, { mode: "demo" }>,
  candidateId: string,
): Promise<{ taskId: string; mode: "created" | "existing" }> {
  const candidate = getSandboxCandidate(context.demoAccessId, candidateId);
  if (!candidate) fail("candidate_not_found", 404, "候选商品不存在或不属于当前访问主体。");
  if (candidate.convertedTaskId) {
    return { taskId: candidate.convertedTaskId, mode: "existing" };
  }
  const eligibility = evaluateStoredCandidateResearchEligibility(candidate);
  if (!eligibility.allowed) {
    fail("candidate_not_ready", 409, "候选商品当前不满足开始研究的条件（来源或状态已变化）。");
  }
  const task = await createSandboxTaskAndLinkCandidateAtomic(
    context.demoAccessId,
    candidateId,
    {
      type: "workflow",
      title: `${candidate.name} 商品研究`,
      platform: "manual",
      source: "candidate_research",
      score: candidate.score ?? 0,
      level: candidate.riskLevel ?? "",
      oneLineSummary: "",
      decisionStatus: "pending",
      productUrl: resolveTaskProductUrlFromCandidate({
        link: candidate.link,
        sourceMetaJson: candidate.sourceMetaJson,
      }),
      resultJson: JSON.stringify(buildSkeletonResultJson({
        candidateId,
        candidateName: candidate.name,
        candidate,
      })),
    },
    null,
  );
  return { taskId: task.id, mode: "created" };
}

/** Owner：创建或获取研究任务骨架（单事务：校验 + 创建 + convertedTaskId 回写） */
async function createOrGetResearchTaskOwner(
  candidateId: string,
): Promise<{ taskId: string; mode: "created" | "existing" }> {
  const task = await prisma.$transaction(async (tx) => {
    const storedCandidate = await tx.opportunityCandidate.findUnique({
      where: { id: candidateId },
      select: {
        id: true,
        name: true,
        link: true,
        status: true,
        sourceMetaJson: true,
        analysisJson: true,
        convertedTaskId: true,
        originProductBatchItemId: true,
        score: true,
        riskLevel: true,
      },
    });
    if (!storedCandidate) {
      fail("candidate_not_found", 404, "候选商品不存在或不属于当前访问主体。");
    }
    if (storedCandidate.convertedTaskId) {
      return { taskId: storedCandidate.convertedTaskId, mode: "existing" as const };
    }
    const eligibility = evaluateStoredCandidateResearchEligibility(storedCandidate);
    if (!eligibility.allowed) {
      fail("candidate_not_ready", 409, "候选商品当前不满足开始研究的条件（来源或状态已变化）。");
    }
    const task = await tx.viralAnalysisRecord.create({
      data: {
        type: "workflow",
        title: `${storedCandidate.name} 商品研究`,
        platform: "manual",
        productUrl: resolveTaskProductUrlFromCandidate({
          link: storedCandidate.link,
          sourceMetaJson: storedCandidate.sourceMetaJson,
        }),
        materialText: storedCandidate.name,
        source: "candidate_research",
        score: storedCandidate.score,
        level: storedCandidate.riskLevel,
        oneLineSummary: "",
        decisionStatus: "pending",
        resultJson: JSON.stringify(buildSkeletonResultJson({
          candidateId,
          candidateName: storedCandidate.name,
          candidate: storedCandidate,
        })),
      },
    });
    const linked = await tx.opportunityCandidate.updateMany({
      where: {
        id: candidateId,
        convertedTaskId: null,
        name: storedCandidate.name,
        status: storedCandidate.status,
        sourceMetaJson: storedCandidate.sourceMetaJson,
        analysisJson: storedCandidate.analysisJson,
      },
      data: { convertedTaskId: task.id, lastActionAt: new Date() },
    });
    if (linked.count !== 1) {
      fail("candidate_conversion_conflict", 409, "候选状态刚刚发生变化，请刷新后重试。");
    }
    return { taskId: task.id, mode: "created" as const };
  });
  return task;
}

/** 统一入口：创建或获取研究任务（幂等；主体由调用方 guard 校验） */
export async function createOrGetResearchTask(
  context: AccessContext,
  candidateId: string,
): Promise<{ taskId: string; mode: "created" | "existing" }> {
  const normalized = candidateId.trim().slice(0, 80);
  if (!normalized) fail("invalid_candidate_id", 400, "缺少有效候选商品 ID。");
  if (context.mode === "demo") {
    return createOrGetResearchTaskDemo(context, normalized);
  }
  return createOrGetResearchTaskOwner(normalized);
}

/** 判断 taskId 是否 sandbox 任务（供 route 使用） */
export { isSandboxTaskId };
