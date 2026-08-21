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

import { prisma } from "@/lib/server/db";

export type JournalStatus = "recorded" | "committed" | "skipped_duplicate" | "failed";

/** API 契约别名（Lead 冻结）。 */
export type JournalEntryStatus = JournalStatus;

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

/** 副作用已记录但未提交（悬空），且未显式 retry —— 不自动重放。 */
export class IdempotencyPendingError extends Error {
  readonly code = "IDEMPOTENCY_PENDING";
  readonly runId: string;
  readonly idempotencyKey: string;
  constructor(input: { runId: string; idempotencyKey: string }) {
    super(
      `Idempotency entry ${input.idempotencyKey} is recorded but not committed; explicit retry required`,
    );
    this.name = "IdempotencyPendingError";
    this.runId = input.runId;
    this.idempotencyKey = input.idempotencyKey;
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
  | { kind: "pending"; entry: JournalEntry }
  | { kind: "conflict"; entry: JournalEntry };

/**
 * API 契约：Journal 幂等接口（Lead 冻结）。
 * - ensureCommitted：确保副作用恰好提交一次；已提交则返回 skipped_duplicate（不重放）。
 * - markFailed：标记副作用失败。
 */
export type Journal = {
  ensureCommitted(
    runId: string,
    entry: { idempotencyKey: string; inputHash: string; action: string },
  ): Promise<{ status: "committed" | "skipped_duplicate" }>;
  markFailed(
    runId: string,
    entry: { idempotencyKey: string; action?: string },
  ): Promise<void>;
};

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
  async resolve(
    input: {
      runId: string;
      idempotencyKey: string;
      inputHash: string;
      action: string;
    },
    options?: { explicitRetry?: boolean },
  ): Promise<JournalDecision> {
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
    // recorded / failed 悬空：不自动重放；仅显式 retry（resume kind=retry）才允许重执行。
    if (options?.explicitRetry) {
      return { kind: "retry", entry: existing };
    }
    return { kind: "pending", entry: existing };
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

  /** API 契约：确保副作用恰好提交一次。 */
  async ensureCommitted(
    runId: string,
    entry: { idempotencyKey: string; inputHash: string; action: string },
  ): Promise<{ status: "committed" | "skipped_duplicate" }> {
    const decision = await this.resolve({
      runId,
      idempotencyKey: entry.idempotencyKey,
      inputHash: entry.inputHash,
      action: entry.action,
    });
    if (decision.kind === "conflict") {
      throw new IdempotencyConflictError({
        runId,
        idempotencyKey: entry.idempotencyKey,
        existingInputHash: decision.entry.inputHash,
        newInputHash: entry.inputHash,
      });
    }
    if (decision.kind === "skip") return { status: "skipped_duplicate" };
    if (decision.kind === "pending") {
      throw new IdempotencyPendingError({ runId, idempotencyKey: entry.idempotencyKey });
    }
    // apply / retry -> 提交
    await this.commit({ runId, idempotencyKey: entry.idempotencyKey });
    return { status: "committed" };
  }

  /** API 契约：标记副作用失败。 */
  async markFailed(
    runId: string,
    entry: { idempotencyKey: string; action?: string },
  ): Promise<void> {
    await this.fail({ runId, idempotencyKey: entry.idempotencyKey });
  }

  /** 显式 retry：允许对 recorded/failed 悬空条目重新执行（置回 recorded，交由下轮 resolve 重放）。 */
  async retry(runId: string, idempotencyKey: string): Promise<void> {
    await this.db.v4SideEffectJournal.updateMany({
      where: { runId, idempotencyKey },
      data: { status: "recorded" },
    });
  }
}

/**
 * 创建基于全局 prisma 的 Journal（API 契约）。
 */
export function createPrismaJournal(): Journal {
  return new SideEffectJournal(prisma as unknown as JournalDb);
}