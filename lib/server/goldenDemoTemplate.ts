/**
 * V3 UX Closure — Golden Demo Template（元数据 + per-Visitor 副本）
 *
 * GOLDEN_DEMO_TEMPLATE：单一演示商品（THERMOS FUNTAINER B0F2BF31PW）的确定性模板。
 * 每个 Visitor 通过正式 sandbox writer 获得自己的独立副本（不共享 Task）。
 *
 * 标记：resultJson 顶层 `demoTemplate: { demoTemplateId, demoTemplateVersion, sourceProductKey }`。
 * 幂等：ensureVisitorDemoCopy 按标记检查；已有副本（含无标记的历史副本）不重复创建。
 */
import { randomUUID } from "node:crypto";
import { GOLDEN_DEMO_TEMPLATE_RESULT_JSON } from "@/lib/server/goldenDemoTemplateData";
import { computeResearchEvidenceHash } from "@/lib/productResearchRecord";
import {
  createSeededSandboxTaskAndCandidate,
  listSandboxTasks,
  updateSandboxTaskResultJson,
  type SandboxCandidate,
  type SandboxTask,
} from "@/lib/server/demoSandbox";

export const GOLDEN_DEMO_TEMPLATE_ID = "thermos-funtainer-v1" as const;
export const GOLDEN_DEMO_TEMPLATE_VERSION = 1 as const;
export const GOLDEN_DEMO_SOURCE_PRODUCT_KEY = "amazon:US:B0F2BF31PW" as const;
export const GOLDEN_DEMO_CANDIDATE_ID = "fixture-vr-cand-001" as const;
/** 识别历史手动副本（backfill）：productUrl 含该 ASIN 或来源为 demo_acquisition_sample */
const GOLDEN_DEMO_ASIN = "B0F2BF31PW";

export type DemoTemplateMarker = {
  demoTemplateId: typeof GOLDEN_DEMO_TEMPLATE_ID;
  demoTemplateVersion: typeof GOLDEN_DEMO_TEMPLATE_VERSION;
  sourceProductKey: typeof GOLDEN_DEMO_SOURCE_PRODUCT_KEY;
};

export type GoldenDemoCopy = {
  taskId: string;
  demoTemplateId: typeof GOLDEN_DEMO_TEMPLATE_ID;
  demoTemplateVersion: typeof GOLDEN_DEMO_TEMPLATE_VERSION;
  sourceProductKey: typeof GOLDEN_DEMO_SOURCE_PRODUCT_KEY;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResultJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/** 读取任务的 demoTemplate 标记 */
export function readDemoTemplateMarker(resultJson: string): DemoTemplateMarker | null {
  const result = parseResultJson(resultJson);
  const marker = result.demoTemplate;
  if (!isRecord(marker)) return null;
  if (marker.demoTemplateId !== GOLDEN_DEMO_TEMPLATE_ID) return null;
  if (marker.demoTemplateVersion !== GOLDEN_DEMO_TEMPLATE_VERSION) return null;
  return {
    demoTemplateId: GOLDEN_DEMO_TEMPLATE_ID,
    demoTemplateVersion: GOLDEN_DEMO_TEMPLATE_VERSION,
    sourceProductKey: typeof marker.sourceProductKey === "string"
      ? marker.sourceProductKey as typeof GOLDEN_DEMO_SOURCE_PRODUCT_KEY
      : GOLDEN_DEMO_SOURCE_PRODUCT_KEY,
  };
}

function isThermosTask(task: SandboxTask): boolean {
  if (task.source === "demo_acquisition_sample") return true;
  if (typeof task.productUrl === "string" && task.productUrl.includes(GOLDEN_DEMO_ASIN)) return true;
  if (typeof task.title === "string" && task.title.includes("THERMOS")) return true;
  return readDemoTemplateMarker(task.resultJson) !== null;
}

/** 构建带 demoTemplate 标记的模板 resultJson（确定性，无随机时间；注入 completion evidenceHash 启用 staleness） */
function buildTemplateResultJson(): string {
  const result = JSON.parse(JSON.stringify(GOLDEN_DEMO_TEMPLATE_RESULT_JSON)) as Record<string, unknown>;
  result.demoTemplate = {
    demoTemplateId: GOLDEN_DEMO_TEMPLATE_ID,
    demoTemplateVersion: GOLDEN_DEMO_TEMPLATE_VERSION,
    sourceProductKey: GOLDEN_DEMO_SOURCE_PRODUCT_KEY,
  } satisfies DemoTemplateMarker;
  // Staleness 契约：completion 记录当前证据指纹 → 演示采集/新增证据后研究状态自动进入
  // NEEDS_RECONFIRMATION（可体验"重新确认"流程），不会让旧结论冒充当前状态。
  const completion = isRecord(result.researchCompletion) ? result.researchCompletion : null;
  const evidenceHash = computeResearchEvidenceHash(result);
  if (completion && evidenceHash) {
    result.researchCompletion = { ...completion, evidenceHash };
  }
  return JSON.stringify(result);
}

/** 给现有 THERMOS 副本注入 demoTemplate 标记（backfill，幂等；经公开 adapter 写回） */
async function backfillMarker(demoAccessId: string, task: SandboxTask): Promise<boolean> {
  if (readDemoTemplateMarker(task.resultJson)) return false;
  const result = parseResultJson(task.resultJson);
  result.demoTemplate = {
    demoTemplateId: GOLDEN_DEMO_TEMPLATE_ID,
    demoTemplateVersion: GOLDEN_DEMO_TEMPLATE_VERSION,
    sourceProductKey: GOLDEN_DEMO_SOURCE_PRODUCT_KEY,
  } satisfies DemoTemplateMarker;
  return updateSandboxTaskResultJson(demoAccessId, task.id, JSON.stringify(result));
}

/**
 * 确保该 Visitor 拥有 Golden Demo 副本（Lazy Seed + Backfill，幂等）。
 * - 已有带标记副本 → skip；
 * - 有 THERMOS 历史副本（无标记）→ backfill 标记（一次）；
 * - 无 → 通过正式 sandbox writer 创建独立副本（task + candidate，不共享 Task）。
 * 并发安全：创建路径的 check-then-act 已原子化（createSeededSandboxTaskAndCandidate
 * 在物理 Store 写锁内重查固定 id 候选/任务），并发双 seed 不会产生重复副本。
 */
export async function ensureVisitorDemoCopy(demoAccessId: string): Promise<GoldenDemoCopy | null> {
  const tasks = await listSandboxTasks(demoAccessId);

  // 1) 已有标记副本？
  const marked = tasks.find((t) => readDemoTemplateMarker(t.resultJson) !== null);
  if (marked) {
    return {
      taskId: marked.id,
      demoTemplateId: GOLDEN_DEMO_TEMPLATE_ID,
      demoTemplateVersion: GOLDEN_DEMO_TEMPLATE_VERSION,
      sourceProductKey: GOLDEN_DEMO_SOURCE_PRODUCT_KEY,
    };
  }

  // 2) 历史 THERMOS 副本（backfill 标记，幂等）
  const historical = tasks.find((t) => isThermosTask(t));
  if (historical) {
    const changed = await backfillMarker(demoAccessId, historical);
    if (changed) {
      return {
        taskId: historical.id,
        demoTemplateId: GOLDEN_DEMO_TEMPLATE_ID,
        demoTemplateVersion: GOLDEN_DEMO_TEMPLATE_VERSION,
        sourceProductKey: GOLDEN_DEMO_SOURCE_PRODUCT_KEY,
      };
    }
  }

  // 3) 创建独立副本（task + candidate 同一事务，公开 adapter）
  const taskId = `sandbox_task_demo_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const now = new Date().toISOString();
  const resultJson = buildTemplateResultJson();
  const task: Omit<SandboxTask, "demoAccessId"> = {
    id: taskId,
    type: "workflow",
    title: "THERMOS FUNTAINER 儿童保温杯（演示体验）",
    decisionStatus: "continue",
    platform: "amazon",
    productUrl: "https://www.amazon.com/dp/B0F2BF31PW?language=en_US",
    materialText: "",
    source: "demo_acquisition_sample",
    score: 0,
    level: "演示体验",
    oneLineSummary: "演示商品：含 Amazon 页面采集、VOC 评论分析、1688 供应线索的全套真实采集证据，可直接体验研究到创作的完整流程。",
    resultJson,
    productLifecycle: "",
    createdAt: now,
    updatedAt: now,
  };
  const candidate: Omit<SandboxCandidate, "demoAccessId"> = {
    id: GOLDEN_DEMO_CANDIDATE_ID,
    name: "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction",
    rawInput: "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction",
    link: "https://www.amazon.com/dp/B0F2BF31PW?language=en_US",
    score: 0,
    source: "demo_acquisition_sample",
    keyword: "kids water bottle",
    riskLevel: "unknown",
    riskLabel: "演示样本",
    summaryLabel: "演示样本",
    status: "worth_analyzing",
    sourceMetaJson: "{}",
    analysisJson: "{}",
    createdAt: now,
    convertedTaskId: taskId,
  };
  const created = await createSeededSandboxTaskAndCandidate(demoAccessId, task, candidate);

  return {
    taskId: created.taskId,
    demoTemplateId: GOLDEN_DEMO_TEMPLATE_ID,
    demoTemplateVersion: GOLDEN_DEMO_TEMPLATE_VERSION,
    sourceProductKey: GOLDEN_DEMO_SOURCE_PRODUCT_KEY,
  };
}

/** 读取某 Visitor 已存在的 Golden Demo 副本（不创建） */
export async function findVisitorDemoCopy(demoAccessId: string): Promise<GoldenDemoCopy | null> {
  const tasks = await listSandboxTasks(demoAccessId);
  const task = tasks.find((t) => isThermosTask(t));
  if (!task) return null;
  return {
    taskId: task.id,
    demoTemplateId: GOLDEN_DEMO_TEMPLATE_ID,
    demoTemplateVersion: GOLDEN_DEMO_TEMPLATE_VERSION,
    sourceProductKey: GOLDEN_DEMO_SOURCE_PRODUCT_KEY,
  };
}
