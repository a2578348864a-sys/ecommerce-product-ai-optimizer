import "server-only";

import { createHash } from "node:crypto";

import {
  applyTaskResultJsonMutation,
  TaskResultJsonMutationError,
  type TaskResultJsonDatabase,
  type TaskResultJsonSnapshot,
  type TaskResultJsonStorageVersionInput,
  type TaskResultJsonWriter,
} from "@/lib/server/taskResultJsonMutation";
import {
  commitOwnerTaskResultJsonMutationInternal,
  loadOwnerTaskResultJsonSnapshotInternal,
} from "@/lib/server/taskResultJsonMutation.owner.internal";

type TestMutationInput<T> = {
  taskId: string;
  writer: TaskResultJsonWriter;
  expectedStorageVersion?: TaskResultJsonStorageVersionInput;
  mutate: Parameters<typeof applyTaskResultJsonMutation<T>>[0]["mutate"];
};

function storageVersionMatchesTest(
  snapshot: TaskResultJsonSnapshot,
  expected: TaskResultJsonStorageVersionInput | undefined,
): boolean {
  if (!expected) return true;
  if (storageTime(snapshot.updatedAt) !== storageTime(expected.updatedAt)) return false;
  if ("resultJson" in expected) return snapshot.resultJson === expected.resultJson;
  return createHash("sha256").update(snapshot.resultJson, "utf8").digest("hex") === expected.resultJsonHash;
}

function storageTime(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export const loadOwnerTaskResultJsonSnapshotForTest = loadOwnerTaskResultJsonSnapshotInternal;
export const commitOwnerTaskResultJsonMutationForTest = commitOwnerTaskResultJsonMutationInternal;

export async function mutateOwnerTaskResultJsonForTest<T>(
  database: TaskResultJsonDatabase,
  input: TestMutationInput<T>,
) {
  const snapshot = await loadOwnerTaskResultJsonSnapshotInternal(database, input.taskId);
  if (!snapshot) throw new TaskResultJsonMutationError("not_found", 404, "任务不存在。");
  if (!storageVersionMatchesTest(snapshot, input.expectedStorageVersion)) {
    throw new TaskResultJsonMutationError("task_result_conflict", 409, "任务已在其他页面更新，请刷新后重试。");
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
    throw new TaskResultJsonMutationError("task_result_conflict", 409, "任务已在其他页面更新，请刷新后重试。");
  }
  return { ...next, snapshot };
}
