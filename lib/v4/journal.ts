/**
 * V4 P1 — SideEffectJournal：V4SideEffectJournal 语义（P1_CONTRACT D7）。
 *
 * - UNIQUE(runId, idempotencyKey)：每个副作用键最多一条记录。
 * - idempotencyKey = sha256(runId + questionId + toolName + inputHash)。
 * - status：recorded（已记录未确认）/ committed（已成功应用）/
 *   skipped_duplicate（已应用过，本次跳过不重放）/ failed（应用失败）。
 * - 同 key 同 inputHash 且已 committed → skipped_duplicate 不重放；
 *   同 key 不同 inputHash → 冲突错误。
 *
 * 依赖注入 prisma-like db，测试可用临时 sqlite 或内存实现。
 */
import "server-only";

import { createHash } from "node:crypto";

export type JournalStatus = "recorded" | "committed" | "skipped_duplicate" | "failed";

export type JournalEntry = {
  id: string;
  runId: string;
  idempotencyKey: string;
  inputHash: string;
  action: string;
  status: JournalStatus;
  detailJson: string;
  createdAt: string;
};

/** prisma-like db 最小接口（V4SideEffectJournal delegate）。 */
export type JournalDb = {
  v4SideEffectJournal: {
    findFirst(args: {
      where: { runId: string; idempotencyKey: string };
    }): Promise<JournalEntry | null>;
    create(args: {
      data: {
        runId: string;
        idempotencyKey: string;
        inputHash: string;
        action: string;
        status: JournalStatus;
        detailJson?: string;
      };
    }): Promise<JournalEntry>;
    updateMany(args: {
      where: { runId: string; idempotencyKey: string };
      data: { status: JournalStatus; detailJson?: string };
    }): Promise<{ count: number }>;
  };
};

/** 副作用键冲突错误。 */
export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly existingInputHash: string;
  readonly newInputHash: string;
  constructor(input: {
    runId: string;
    idempotencyKey: string;
    existingInputHash: string;
    newInputHash: string;
  }) {
    super(
      `Idempotency conflict for key ${input.idempotencyKey} (existing inputHash differs from new inputHash)`,
    );
    this.name = "IdempotencyConflictError";
    this.runId = input.runId;
    this.idempotencyKey = input.idempotencyKey;
    this.existingInputHash = input.existingInputHash;
    this.newInputHash = input.newInputHash;
  }
}

/** 稳定的 JSON 字符串化（按键排序），用于计算 inputHash。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify(record[k])).join(",")}}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 计算 idempotencyKey = sha256(runId + questionId + toolName + inputHash)。 */
export function buildIdempotencyKey(input: {
  runId: string;
  questionId: string;
  toolName: string;
  inputHash: string;
}): string {
  return sha256(
    `${input.runId}|${input.questionId}|${input.toolName}|${input.inputHash}`,
  );
}

/** 计算确定性 inputHash（对输入做稳定字符串化后取 sha256）。 */
export function computeInputHash(input: unknown): string {
  return sha256(stableStringify(input));
}

export type JournalDecision =
  | { kind: "apply"; entry: JournalEntry | null }
  | { kind: "retry"; entry: JournalEntry }
  | { kind: "skip"; entry: JournalEntry }
  | { kind: "conflict"; entry: JournalEntry };

export class SideEffectJournal {
  private readonly db: JournalDb;
  constructor(db: JournalDb) {
    this.db = db;
  }

  /**
   * 决定是否应用某个副作用。
   * - 无记录 → apply（先记录，应用后 commit）。
   * - 已 committed 且同 inputHash → skip（更新为 skipped_duplicate，不重放）。
   * - 已 committed / recorded / failed 且不同 inputHash → conflict。
   * - recorded / failed 且同 inputHash → retry（崩溃/失败恢复，可重放）。
   * - skipped_duplicate 且同 inputHash → skip。
   */
  async resolve(input: {
    runId: string;
    idempotencyKey: string;
    inputHash: string;
    action: string;
  }): Promise<JournalDecision> {
    const existing = await this.db.v4SideEffectJournal.findFirst({
      where: { runId: input.runId, idempotencyKey: input.idempotencyKey },
    });
    if (!existing) {
      const created = await this.db.v4SideEffectJournal.create({
        data: {
          runId: input.runId,
          idempotencyKey: input.idempotencyKey,
          inputHash: input.inputHash,
          action: input.action,
          status: "recorded",
          detailJson: "{}",
        },
      });
      return { kind: "apply", entry: created };
    }
    if (existing.inputHash !== input.inputHash) {
      return { kind: "conflict", entry: existing };
    }
    if (existing.status === "committed") {
      await this.db.v4SideEffectJournal.updateMany({
        where: { runId: input.runId, idempotencyKey: input.idempotencyKey },
        data: { status: "skipped_duplicate" },
      });
      return { kind: "skip", entry: { ...existing, status: "skipped_duplicate" } };
    }
    if (existing.status === "skipped_duplicate") {
      return { kind: "skip", entry: existing };
    }
    // recorded 或 failed → 允许重放（崩溃/失败恢复）
    return { kind: "retry", entry: existing };
  }

  /** 应用成功后标记 committed。 */
  async commit(input: { runId: string; idempotencyKey: string }): Promise<void> {
    await this.db.v4SideEffectJournal.updateMany({
      where: { runId: input.runId, idempotencyKey: input.idempotencyKey },
      data: { status: "committed" },
    });
  }

  /** 应用失败后标记 failed。 */
  async fail(input: { runId: string; idempotencyKey: string }): Promise<void> {
    await this.db.v4SideEffectJournal.updateMany({
      where: { runId: input.runId, idempotencyKey: input.idempotencyKey },
      data: { status: "failed" },
    });
  }
}
