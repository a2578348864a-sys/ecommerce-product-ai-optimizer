import "server-only";

import type {
  TaskResultJsonDatabase,
  TaskResultJsonSnapshot,
} from "@/lib/server/taskResultJsonMutation";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadOwnerTaskResultJsonSnapshotInternal(
  database: TaskResultJsonDatabase,
  taskId: string,
): Promise<TaskResultJsonSnapshot | null> {
  const value = await database.viralAnalysisRecord.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      type: true,
      updatedAt: true,
      resultJson: true,
      decisionStatus: true,
    },
  });
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.type !== "string"
    || typeof value.resultJson !== "string"
    || typeof value.decisionStatus !== "string"
    || (!(value.updatedAt instanceof Date) && typeof value.updatedAt !== "string")) {
    return null;
  }
  return value as TaskResultJsonSnapshot;
}

export async function commitOwnerTaskResultJsonMutationInternal(
  database: TaskResultJsonDatabase,
  input: {
    snapshot: TaskResultJsonSnapshot;
    resultJson: string;
    decisionStatus?: string;
    updatedAt: string;
  },
): Promise<boolean> {
  const result = await database.viralAnalysisRecord.updateMany({
    where: {
      id: input.snapshot.id,
      updatedAt: input.snapshot.updatedAt,
      resultJson: input.snapshot.resultJson,
    },
    data: {
      resultJson: input.resultJson,
      ...(input.decisionStatus === undefined ? {} : { decisionStatus: input.decisionStatus }),
      updatedAt: new Date(input.updatedAt),
    },
  });
  return result.count === 1;
}
