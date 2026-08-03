import "server-only";

import { isDeepStrictEqual } from "node:util";
import type { AccessContext } from "@/lib/server/accessPassword";
import { prisma } from "@/lib/server/db";
import type { SandboxTask } from "@/lib/server/demoSandbox";
import { mutateSandboxTaskResultJsonInternal } from "@/lib/server/demoSandboxTaskMutation.internal";
import {
  getProductResearchRecord,
  getProductResearchVerification,
  hasProductResearchRecordNamespace,
  verifyProductResearchHash,
} from "@/lib/productResearchRecord";
import {
  commitOwnerTaskResultJsonMutationInternal,
  loadOwnerTaskResultJsonSnapshotInternal,
} from "@/lib/server/taskResultJsonMutation.owner.internal";

export type TaskResultJsonWriter =
  | "research-decision"
  | "legacy-decision"
  | "lifecycle"
  | "listing-pack"
  | "ai-listing"
  | "ai-image";

const OWNED_NAMESPACES: Record<TaskResultJsonWriter, readonly string[]> = {
  "research-decision": ["researchRecord"],
  "legacy-decision": [],
  lifecycle: ["productLifecycle"],
  "listing-pack": ["listingPackSnapshot"],
  "ai-listing": ["aiListingPackSnapshot"],
  "ai-image": ["aiImageDraftSnapshot"],
};

export type TaskResultJsonStorageVersion = {
  resultJson: string;
  updatedAt: Date | string;
};

export type TaskResultJsonSnapshot = TaskResultJsonStorageVersion & {
  id: string;
  type: string;
  decisionStatus: string;
  productLifecycle?: string;
};

type TaskResultJsonMutationOutput<T> = {
  result: Record<string, unknown>;
  value: T;
  decisionStatus?: string;
  visitorProductLifecycle?: string;
  updatedAt?: string;
};

export type TaskResultJsonMutationInput<T> = {
  context: AccessContext;
  taskId: string;
  writer: TaskResultJsonWriter;
  expectedStorageVersion?: TaskResultJsonStorageVersion;
  mutate: (
    current: Readonly<Record<string, unknown>>,
    snapshot: Readonly<TaskResultJsonSnapshot>,
  ) => Promise<TaskResultJsonMutationOutput<T>> | TaskResultJsonMutationOutput<T>;
};

export type TaskResultJsonDatabase = {
  viralAnalysisRecord: {
    findUnique(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export type TaskResultJsonMutator = <T>(
  input: TaskResultJsonMutationInput<T>,
) => Promise<{
  resultJson: string;
  value: T;
  decisionStatus?: string;
  visitorProductLifecycle?: string;
  updatedAt: string;
  snapshot: TaskResultJsonSnapshot;
}>;

export class TaskResultJsonMutationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TaskResultJsonMutationError";
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseResultJson(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TaskResultJsonMutationError(
      "invalid_result_json",
      409,
      "任务结果结构异常，无法安全保存。",
    );
  }
  if (!isRecord(parsed)) {
    throw new TaskResultJsonMutationError(
      "invalid_result_json",
      409,
      "任务结果结构异常，无法安全保存。",
    );
  }
  return parsed;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertResearchNamespaceValid(result: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(result, "researchRecord")) return;
  if (!hasProductResearchRecordNamespace(result)) {
    throw new TaskResultJsonMutationError(
      "invalid_research_record",
      409,
      "版本化研究记录结构异常，已阻止其他功能覆盖。",
    );
  }
  const record = getProductResearchRecord(result);
  const verification = getProductResearchVerification(result);
  if (!record || !verification || !verifyProductResearchHash(record, verification)) {
    throw new TaskResultJsonMutationError(
      "invalid_research_record",
      409,
      "版本化研究记录结构异常，已阻止其他功能覆盖。",
    );
  }
}

function storageTime(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function storageVersionMatches(
  snapshot: TaskResultJsonSnapshot,
  expected: TaskResultJsonStorageVersion | undefined,
): boolean {
  if (!expected) return true;
  return snapshot.resultJson === expected.resultJson
    && storageTime(snapshot.updatedAt) === storageTime(expected.updatedAt);
}

function validateColumnChanges<T>(
  writer: TaskResultJsonWriter,
  output: TaskResultJsonMutationOutput<T>,
): void {
  if (output.decisionStatus !== undefined
    && writer !== "research-decision"
    && writer !== "legacy-decision") {
    throw new TaskResultJsonMutationError(
      "namespace_contract_invalid",
      500,
      "当前写入器无权修改研究决定兼容列。",
    );
  }
  if (output.visitorProductLifecycle !== undefined && writer !== "lifecycle") {
    throw new TaskResultJsonMutationError(
      "namespace_contract_invalid",
      500,
      "当前写入器无权修改 Visitor 生命周期兼容字段。",
    );
  }
}

export function applyTaskResultJsonMutation<T>(input: {
  currentResultJson: string;
  writer: TaskResultJsonWriter;
  snapshot: TaskResultJsonSnapshot;
  mutate: TaskResultJsonMutationInput<T>["mutate"];
}): Promise<{
  resultJson: string;
  value: T;
  decisionStatus?: string;
  visitorProductLifecycle?: string;
  updatedAt: string;
}> {
  return Promise.resolve().then(async () => {
    const current = parseResultJson(input.currentResultJson);
    assertResearchNamespaceValid(current);
    const output = await input.mutate(cloneJson(current), Object.freeze({ ...input.snapshot }));
    if (!isRecord(output.result)) {
      throw new TaskResultJsonMutationError(
        "namespace_contract_invalid",
        500,
        "写入器返回了无效的任务结果。",
      );
    }
    validateColumnChanges(input.writer, output);
    const proposed = cloneJson(output.result);
    const owned = new Set(OWNED_NAMESPACES[input.writer]);
    const allKeys = new Set([...Object.keys(current), ...Object.keys(proposed)]);
    for (const key of allKeys) {
      if (!owned.has(key) && !isDeepStrictEqual(current[key], proposed[key])) {
        throw new TaskResultJsonMutationError(
          "namespace_contract_invalid",
          500,
          `写入器越权修改了未拥有的 namespace：${key}`,
        );
      }
    }
    const next = cloneJson(current);
    for (const key of owned) {
      if (Object.prototype.hasOwnProperty.call(proposed, key)) next[key] = proposed[key];
      else delete next[key];
    }
    assertResearchNamespaceValid(next);
    return {
      resultJson: JSON.stringify(next),
      value: output.value,
      ...(output.decisionStatus === undefined ? {} : { decisionStatus: output.decisionStatus }),
      ...(output.visitorProductLifecycle === undefined
        ? {}
        : { visitorProductLifecycle: output.visitorProductLifecycle }),
      updatedAt: output.updatedAt ?? new Date().toISOString(),
    };
  });
}
async function mutateOwnerTaskResultJson<T>(
  database: TaskResultJsonDatabase,
  input: TaskResultJsonMutationInput<T>,
) {
  const snapshot = await loadOwnerTaskResultJsonSnapshotInternal(database, input.taskId);
  if (!snapshot) {
    throw new TaskResultJsonMutationError("not_found", 404, "任务不存在。");
  }
  if (!storageVersionMatches(snapshot, input.expectedStorageVersion)) {
    throw new TaskResultJsonMutationError(
      "task_result_conflict",
      409,
      "任务已在其他页面更新，请刷新后重试。",
    );
  }
  const next = await applyTaskResultJsonMutation({
    currentResultJson: snapshot.resultJson,
    writer: input.writer,
    snapshot,
    mutate: input.mutate,
  });
  const committed = await commitOwnerTaskResultJsonMutationInternal(database, {
    snapshot,
    resultJson: next.resultJson,
    decisionStatus: next.decisionStatus,
    updatedAt: next.updatedAt,
  });
  if (!committed) {
    throw new TaskResultJsonMutationError(
      "task_result_conflict",
      409,
      "任务已在其他页面更新，请刷新后重试。",
    );
  }
  return { ...next, snapshot };
}

async function mutateVisitorTaskResultJson<T>(input: TaskResultJsonMutationInput<T>) {
  if (input.context.mode !== "demo") {
    throw new TaskResultJsonMutationError("not_found", 404, "任务不存在。");
  }
  const result = await mutateSandboxTaskResultJsonInternal(
    input.context.demoAccessId,
    input.taskId,
    async (task: SandboxTask) => {
      const snapshot: TaskResultJsonSnapshot = {
        id: task.id,
        type: task.type,
        updatedAt: task.updatedAt,
        resultJson: task.resultJson,
        decisionStatus: task.decisionStatus,
        productLifecycle: task.productLifecycle,
      };
      if (!storageVersionMatches(snapshot, input.expectedStorageVersion)) {
        throw new TaskResultJsonMutationError(
          "task_result_conflict",
          409,
          "任务已在其他页面更新，请刷新后重试。",
        );
      }
      const next = await applyTaskResultJsonMutation({
        currentResultJson: task.resultJson,
        writer: input.writer,
        snapshot,
        mutate: input.mutate,
      });
      return {
        task: {
          ...task,
          resultJson: next.resultJson,
          ...(next.decisionStatus === undefined ? {} : { decisionStatus: next.decisionStatus }),
          ...(next.visitorProductLifecycle === undefined
            ? {}
            : { productLifecycle: next.visitorProductLifecycle }),
          updatedAt: next.updatedAt,
        },
        value: { ...next, snapshot },
      };
    },
  );
  if (result.status === "not_found") {
    throw new TaskResultJsonMutationError("not_found", 404, "任务不存在。");
  }
  return result.value;
}

export function createTaskResultJsonMutator(input: {
  ownerDatabase?: TaskResultJsonDatabase;
} = {}): TaskResultJsonMutator {
  const ownerDatabase = input.ownerDatabase ?? prisma as unknown as TaskResultJsonDatabase;
  return async <T>(mutation: TaskResultJsonMutationInput<T>) => (
    mutation.context.mode === "demo"
      ? mutateVisitorTaskResultJson(mutation)
      : mutateOwnerTaskResultJson(ownerDatabase, mutation)
  );
}

export const mutateTaskResultJson = createTaskResultJsonMutator();

export async function updateLegacySandboxTaskDecisionStatusAtomic(input: {
  context: Extract<AccessContext, { mode: "demo" }>;
  taskId: string;
  decisionStatus: string;
}) {
  return mutateVisitorTaskResultJson({
    context: input.context,
    taskId: input.taskId,
    writer: "legacy-decision",
    mutate: (current) => {
      if (["researchRecord", "researchVerification", "researchHash", "decisionEvents"]
        .some((key) => Object.prototype.hasOwnProperty.call(current, key))) {
        throw new TaskResultJsonMutationError(
          "versioned_research_decision_route_required",
          409,
          "新版研究记录必须使用正式研究决定接口更新。",
        );
      }
      return { result: current, decisionStatus: input.decisionStatus, value: null };
    },
  });
}
