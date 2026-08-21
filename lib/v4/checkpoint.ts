/**
 * V4 P1 — Checkpoint adapter（P1_CONTRACT D3）。
 *
 * Checkpoint = SqliteSaver 独立 DB，只存控制流（graph 状态/中断），不存业务记录。
 * - 生产默认 .tmp/v4-graph/checkpoints-<runId>.db（gitignored）。
 * - 测试用 mkdtemp 路径。
 *
 * 仅提供编译 graph 所需的 BaseCheckpointSaver + 生命周期句柄；业务记录在 runStore。
 */
import "server-only";

import path from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

export type CheckpointHandle = {
  saver: BaseCheckpointSaver;
  dbPath: string;
  close(): void;
};

/** 生产默认 checkpoint DB 路径（.tmp/ 已 gitignored）。 */
export function defaultCheckpointPath(runId: string): string {
  return path.join(".tmp", "v4-graph", `checkpoints-${runId}.db`);
}

/**
 * API 契约：checkpoint DB 路径。
 * 默认 .tmp/v4-graph/checkpoints-<runId>.db；baseDir 可覆盖（测试用 mkdtemp）。
 */
export function checkpointDbPath(runId: string, baseDir?: string): string {
  const dir = baseDir ?? path.join(".tmp", "v4-graph");
  return path.join(dir, `checkpoints-${runId}.db`);
}

/** 打开（或创建）一个 SqliteSaver checkpoint DB。 */
export function openCheckpoint(dbPath: string): CheckpointHandle {
  const saver = SqliteSaver.fromConnString(dbPath);
  const rawSaver = saver as unknown as { db?: { close(): void } };
  return {
    saver,
    dbPath,
    close() {
      rawSaver.db?.close();
    },
  };
}