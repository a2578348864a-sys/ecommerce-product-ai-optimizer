import "server-only";

import {
  applyTaskResultJsonMutation,
  TaskResultJsonMutationError,
  type TaskResultJsonDatabase,
  type TaskResultJsonStorageVersion,
  type TaskResultJsonWriter,
} from "@/lib/server/taskResultJsonMutation";
import {
  commitOwnerTaskResultJsonMutationInternal,
  loadOwnerTaskResultJsonSnapshotInternal,
} from "@/lib/server/taskResultJsonMutation.owner.internal";

type TestMutationInput<T> = {
  taskId: string;
  writer: TaskResultJsonWriter;
  expectedStorageVersion?: TaskResultJsonStorageVersion;
  mutate: Parameters<typeof applyTaskResultJsonMutation<T>>[0]["mutate"];
};

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
  if (input.expectedStorageVersion
    && (snapshot.resultJson !== input.expectedStorageVersion.resultJson
      || storageTime(snapshot.updatedAt) !== storageTime(input.expectedStorageVersion.updatedAt))) {
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
