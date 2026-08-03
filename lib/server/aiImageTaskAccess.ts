import "server-only";

import type { NextRequest } from "next/server";
import type { AccessContext } from "@/lib/server/accessPassword";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { getSandboxTask, isSandboxTaskId } from "@/lib/server/demoSandbox";
import type { AiImageAccessMode, AiImageTaskContext } from "@/lib/aiImageDraft";
import { prisma } from "@/lib/server/db";
import { mutateTaskResultJson } from "@/lib/server/taskResultJsonMutation";
import { createAiImageResultMutation } from "@/lib/server/taskResultWriterServices";

export type LoadedAiImageTask = {
  taskId: string;
  accessMode: AiImageAccessMode;
  accessContext: AccessContext;
  visitorAccessId?: string;
  task: AiImageTaskContext;
  persistResult: (result: Record<string, unknown>) => Promise<void>;
};

export type LoadAiImageTaskResult =
  | { ok: true; data: LoadedAiImageTask }
  | { ok: false; status: number; code: string; message: string };

export async function loadAiImageTask(input: {
  request: NextRequest;
  taskId: string;
  body?: Record<string, unknown>;
}): Promise<LoadAiImageTaskResult> {
  const auth = requireAuthenticated(input.request, input.body);
  if (!auth.ok) return { ok: false, status: auth.status, code: auth.code, message: auth.message };

  if (isSandboxTaskId(input.taskId)) {
    if (auth.context.mode !== "demo") {
      return { ok: false, status: 404, code: "task_not_found", message: "当前任务不存在。" };
    }
    const task = getSandboxTask(auth.context.demoAccessId, input.taskId);
    if (!task) return { ok: false, status: 404, code: "task_not_found", message: "当前任务不存在。" };
    const visitorAccessId = auth.context.demoAccessId;
    const storageVersion = { resultJson: task.resultJson, updatedAt: task.updatedAt };
    return {
      ok: true,
      data: {
        taskId: input.taskId,
        accessMode: "visitor",
        accessContext: auth.context,
        visitorAccessId,
        task: {
          title: task.title,
          materialText: task.materialText,
          level: task.level,
          oneLineSummary: task.oneLineSummary,
          resultJson: task.resultJson,
        },
        persistResult: async (result) => {
          if (!Object.prototype.hasOwnProperty.call(result, "aiImageDraftSnapshot")) {
            throw new Error("AI_IMAGE_SNAPSHOT_MISSING");
          }
          await mutateTaskResultJson({
            context: auth.context,
            taskId: input.taskId,
            writer: "ai-image",
            expectedStorageVersion: storageVersion,
            mutate: createAiImageResultMutation(result.aiImageDraftSnapshot),
          });
        },
      },
    };
  }

  if (auth.context.mode !== "owner") {
    return { ok: false, status: 404, code: "task_not_found", message: "当前任务不存在。" };
  }

  const task = await prisma.viralAnalysisRecord.findUnique({
    where: { id: input.taskId },
    select: {
      title: true,
      materialText: true,
      level: true,
      oneLineSummary: true,
      resultJson: true,
      updatedAt: true,
    },
  });
  if (!task) return { ok: false, status: 404, code: "task_not_found", message: "当前任务不存在。" };
  return {
    ok: true,
    data: {
      taskId: input.taskId,
      accessMode: "owner",
      accessContext: auth.context,
      task: {
        title: task.title,
        materialText: task.materialText,
        level: task.level,
        oneLineSummary: task.oneLineSummary,
        resultJson: task.resultJson,
      },
      persistResult: async (result) => {
        if (!Object.prototype.hasOwnProperty.call(result, "aiImageDraftSnapshot")) {
          throw new Error("AI_IMAGE_SNAPSHOT_MISSING");
        }
        await mutateTaskResultJson({
          context: auth.context,
          taskId: input.taskId,
          writer: "ai-image",
          expectedStorageVersion: { resultJson: task.resultJson, updatedAt: task.updatedAt },
          mutate: createAiImageResultMutation(result.aiImageDraftSnapshot),
        });
      },
    },
  };
}
