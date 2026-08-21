/**
 * V4 P1 — ResearchRunStore：V4ResearchRun prisma-backed 存取（P1_CONTRACT D2/D6/D9）。
 *
 * - stateJson 严格按 research-run-state.schema.json（schemaVersion researchRun.v4）。
 * - eventsJson 为结构化事件数组（seq 单调递增），不含模型私有思维链。
 * - CAS 语义：每次写携带 expectedRevision，revision++；冲突返回最新 revision。
 * - 终态（cancelled/completed/failed_terminal）后任何写入必须失败（revision 冻结）。
 *
 * 依赖注入 prisma-like db，测试可用临时 sqlite 或内存实现。
 */
import "server-only";

import {
  RESEARCH_GRAPH_VERSION,
  type ResearchRunEvent,
  type ResearchRunNode,
  type ResearchRunState,
  type ResearchRunStatus,
} from "@/lib/v4/contracts";
import { prisma } from "@/lib/server/db";

export type RunRow = {
  id: string;
  candidateId: string;
  ownerScope: string;
  sandboxId: string | null;
  mode: string;
  graphVersion: string;
  status: string;
  currentNode: string;
  revision: number;
  planRevision: number;
  automaticPlanRevisionCount: number;
  stateJson: string;
  eventsJson: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ResearchRunDb = {
  v4ResearchRun: {
    create(args: { data: Record<string, unknown> }): Promise<RunRow>;
    findUnique(args: { where: { id: string } }): Promise<RunRow | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<RunRow>;
  };
};

export type RunStoreErrorCode =
  | "REVISION_CONFLICT"
  | "NOT_FOUND"
  | "TERMINAL_FROZEN"
  | "GRAPH_VERSION_MISMATCH"
  | "RESUME_GATE_FAILED";

export class RunStoreError extends Error {
  readonly code: RunStoreErrorCode;
  readonly latestRevision?: number;
  constructor(
    code: RunStoreErrorCode,
    message: string,
    latestRevision?: number,
  ) {
    super(message);
    this.name = "RunStoreError";
    this.code = code;
    this.latestRevision = latestRevision;
  }
}

/**
 * API 契约：RunStore 接口（Lead 冻结）。面向 ResearchRunState 的读写 + CAS + 事件追加。
 * save 在 expectedRevision 冲突时抛 REVISION_CONFLICT 错误。
 */
// 可注入的 prisma 引用（生产默认全局 prisma；测试可替换为临时库）。
let runPrisma: typeof prisma = prisma;

/** 测试专用：替换 runStore 的 prisma 引用。 */
export function __setRunPrismaForTest(p: typeof prisma): void {
  runPrisma = p;
}

export type RunStore = {
  create(state: ResearchRunState): Promise<void>;
  get(runId: string): Promise<ResearchRunState | null>;
  save(state: ResearchRunState, expectedRevision: number): Promise<void>;
  appendEvent(runId: string, event: ResearchRunEvent, expectedRevision: number): Promise<void>;
};

export type CreateRunInput = {
  id: string;
  candidateId: string;
  ownerScope: string;
  sandboxId: string | null;
  mode: string;
  graphVersion?: string;
};

export type SaveStatePatch = {
  stateJson: string;
  status?: ResearchRunStatus;
  currentNode?: ResearchRunNode;
  planRevision?: number;
  automaticPlanRevisionCount?: number;
};

export class ResearchRunStore {
  private readonly db: ResearchRunDb;
  private readonly graphVersion: string;
  constructor(db: ResearchRunDb, graphVersion: string = RESEARCH_GRAPH_VERSION) {
    this.db = db;
    this.graphVersion = graphVersion;
  }

  async createRun(input: CreateRunInput): Promise<RunRow> {
    return this.db.v4ResearchRun.create({
      data: {
        id: input.id,
        candidateId: input.candidateId,
        ownerScope: input.ownerScope,
        sandboxId: input.sandboxId,
        mode: input.mode,
        graphVersion: input.graphVersion ?? this.graphVersion,
        status: "draft",
        currentNode: "load_context",
        revision: 0,
        planRevision: 0,
        automaticPlanRevisionCount: 0,
        stateJson: "{}",
        eventsJson: "[]",
      },
    });
  }

  async getRun(runId: string): Promise<RunRow | null> {
    return this.db.v4ResearchRun.findUnique({ where: { id: runId } });
  }

  /** 读运行并校验 graphVersion（resume 门禁 fail_closed）。 */
  async assertGraphVersion(runId: string): Promise<RunRow> {
    const run = await this.getRun(runId);
    if (!run) throw new RunStoreError("NOT_FOUND", `Run ${runId} not found`);
    if (run.graphVersion !== this.graphVersion) {
      throw new RunStoreError(
        "GRAPH_VERSION_MISMATCH",
        `Run ${runId} graphVersion ${run.graphVersion} != expected ${this.graphVersion}`,
      );
    }
    return run;
  }

  /**
   * CAS 写状态。expectedRevision 不匹配 → REVISION_CONFLICT（携带最新 revision）。
   * 终态后 → TERMINAL_FROZEN。
   */
  async saveState(
    runId: string,
    expectedRevision: number,
    patch: SaveStatePatch,
  ): Promise<RunRow> {
    const current = await this.getRun(runId);
    if (!current) throw new RunStoreError("NOT_FOUND", `Run ${runId} not found`);
    if (isTerminalRow(current.status)) {
      throw new RunStoreError(
        "TERMINAL_FROZEN",
        `Run ${runId} is terminal (${current.status}); cannot write`,
        current.revision,
      );
    }
    if (current.revision !== expectedRevision) {
      throw new RunStoreError(
        "REVISION_CONFLICT",
        `Run ${runId} revision ${current.revision} != expected ${expectedRevision}`,
        current.revision,
      );
    }
    if (patch.status !== undefined) {
      assertValidStatusTransition(current.status, patch.status);
    }
    return this.db.v4ResearchRun.update({
      where: { id: runId },
      data: {
        stateJson: normalizeStateRevision(patch.stateJson, current.revision + 1),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.currentNode !== undefined ? { currentNode: patch.currentNode } : {}),
        ...(patch.planRevision !== undefined ? { planRevision: patch.planRevision } : {}),
        ...(patch.automaticPlanRevisionCount !== undefined
          ? { automaticPlanRevisionCount: patch.automaticPlanRevisionCount }
          : {}),
        revision: current.revision + 1,
      },
    });
  }

  /**
   * 追加结构化事件（自动分配 seq）。CAS 语义同 saveState。
   * events 传入时不带 seq；runStore 依据当前 eventsJson 长度分配单调 seq。
   */
  async appendEvents(
    runId: string,
    expectedRevision: number,
    events: Omit<ResearchRunEvent, "seq">[],
  ): Promise<RunRow> {
    const current = await this.getRun(runId);
    if (!current) throw new RunStoreError("NOT_FOUND", `Run ${runId} not found`);
    if (isTerminalRow(current.status)) {
      throw new RunStoreError(
        "TERMINAL_FROZEN",
        `Run ${runId} is terminal (${current.status}); cannot write`,
        current.revision,
      );
    }
    if (current.revision !== expectedRevision) {
      throw new RunStoreError(
        "REVISION_CONFLICT",
        `Run ${runId} revision ${current.revision} != expected ${expectedRevision}`,
        current.revision,
      );
    }
    const existing = parseEvents(current.eventsJson);
    const nextSeq = existing.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
    const appended = events.map((e, i) => ({ ...e, seq: nextSeq + i }));
    const merged = [...existing, ...appended];
    return this.db.v4ResearchRun.update({
      where: { id: runId },
      data: {
        eventsJson: JSON.stringify(merged),
        revision: current.revision + 1,
      },
    });
  }

  /**
   * 原子保存状态 + 追加结构化事件（自动分配 seq）。CAS 语义同 saveState。
   * 一次写 = 一个 revision 步进；events 不含 seq。
   */
  async saveRun(
    runId: string,
    expectedRevision: number,
    patch: SaveStatePatch & { events?: Omit<ResearchRunEvent, "seq">[] },
  ): Promise<RunRow> {
    const current = await this.getRun(runId);
    if (!current) throw new RunStoreError("NOT_FOUND", `Run ${runId} not found`);
    if (isTerminalRow(current.status)) {
      throw new RunStoreError(
        "TERMINAL_FROZEN",
        `Run ${runId} is terminal (${current.status}); cannot write`,
        current.revision,
      );
    }
    if (current.revision !== expectedRevision) {
      throw new RunStoreError(
        "REVISION_CONFLICT",
        `Run ${runId} revision ${current.revision} != expected ${expectedRevision}`,
        current.revision,
      );
    }
    if (patch.status !== undefined) {
      assertValidStatusTransition(current.status, patch.status);
    }
    const existing = parseEvents(current.eventsJson);
    const nextSeq = existing.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
    const appended = (patch.events ?? []).map((e, i) => ({ ...e, seq: nextSeq + i }));
    const mergedEvents = [...existing, ...appended];
    const normalizedStateJson = normalizeStateRevision(patch.stateJson, current.revision + 1);
    return this.db.v4ResearchRun.update({
      where: { id: runId },
      data: {
        stateJson: normalizedStateJson,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.currentNode !== undefined ? { currentNode: patch.currentNode } : {}),
        ...(patch.planRevision !== undefined ? { planRevision: patch.planRevision } : {}),
        ...(patch.automaticPlanRevisionCount !== undefined
          ? { automaticPlanRevisionCount: patch.automaticPlanRevisionCount }
          : {}),
        eventsJson: JSON.stringify(mergedEvents),
        revision: current.revision + 1,
      },
    });
  }

  /** 取消运行（revision CAS）。取消后为终态，后续写入被 TERMINAL_FROZEN 拒绝。 */
  async cancel(runId: string, expectedRevision: number): Promise<RunRow> {
    const current = await this.getRun(runId);
    if (!current) throw new RunStoreError("NOT_FOUND", `Run ${runId} not found`);
    if (isTerminalRow(current.status)) {
      throw new RunStoreError(
        "TERMINAL_FROZEN",
        `Run ${runId} is terminal (${current.status}); cannot cancel`,
        current.revision,
      );
    }
    if (current.revision !== expectedRevision) {
      throw new RunStoreError(
        "REVISION_CONFLICT",
        `Run ${runId} revision ${current.revision} != expected ${expectedRevision}`,
        current.revision,
      );
    }
    const existing = parseEvents(current.eventsJson);
    const nextSeq = existing.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
    const cancelledEvent: ResearchRunEvent = {
      seq: nextSeq,
      type: "cancelled",
      node: "cancel",
      payloadJson: JSON.stringify({}),
      createdAt: new Date().toISOString(),
    };
    return this.db.v4ResearchRun.update({
      where: { id: runId },
      data: {
        status: "cancelled",
        currentNode: "cancel",
        eventsJson: JSON.stringify([...existing, cancelledEvent]),
        revision: current.revision + 1,
      },
    });
  }

  /** 读已持久化的状态对象。 */
  readState(run: RunRow): ResearchRunState | null {
    return parseState(run.stateJson);
  }

  /** 读已持久化的事件数组。 */
  readEvents(run: RunRow): ResearchRunEvent[] {
    return parseEvents(run.eventsJson);
  }

  // ---- RunStore 契约实现（state-level，API 用） ----

  /** 从 ResearchRunState 创建运行。 */
  async create(state: ResearchRunState): Promise<void> {
    await this.db.v4ResearchRun.create({
      data: {
        id: state.runId,
        candidateId: state.candidateId,
        ownerScope: state.ownerScope ?? "",
        sandboxId: state.sandboxId ?? null,
        mode: state.mode,
        graphVersion: this.graphVersion,
        status: state.status,
        currentNode: state.currentNode,
        revision: state.revision,
        planRevision: state.planRevision,
        automaticPlanRevisionCount: state.automaticPlanRevisionCount,
        stateJson: JSON.stringify(state),
        eventsJson: "[]",
      },
    });
  }

  /** 读取运行状态（null 若不存在）；revision 以行内（row.revision）为准。 */
  async get(runId: string): Promise<ResearchRunState | null> {
    const row = await this.getRun(runId);
    if (!row) return null;
    const state = this.readState(row);
    if (!state) return null;
    return { ...state, revision: row.revision };
  }

  /** CAS 保存状态；expectedRevision 冲突抛 REVISION_CONFLICT；终态后抛 TERMINAL_FROZEN。 */
  async save(state: ResearchRunState, expectedRevision: number): Promise<void> {
    const current = await this.getRun(state.runId);
    if (!current) throw new RunStoreError("NOT_FOUND", `Run ${state.runId} not found`);
    if (isTerminalRow(current.status)) {
      throw new RunStoreError("TERMINAL_FROZEN", `Run ${state.runId} is terminal (${current.status}); cannot write`, current.revision);
    }
    if (current.revision !== expectedRevision) {
      throw new RunStoreError("REVISION_CONFLICT", `Run ${state.runId} revision ${current.revision} != expected ${expectedRevision}`, current.revision);
    }
    assertValidStatusTransition(current.status, state.status);
    const normalizedState = { ...state, revision: expectedRevision + 1 };
    await this.db.v4ResearchRun.update({
      where: { id: state.runId },
      data: {
        stateJson: JSON.stringify(normalizedState),
        status: state.status,
        currentNode: state.currentNode,
        planRevision: state.planRevision,
        automaticPlanRevisionCount: state.automaticPlanRevisionCount,
        revision: expectedRevision + 1,
      },
    });
  }

  /** CAS 追加单条事件；expectedRevision 冲突抛 REVISION_CONFLICT；终态后抛 TERMINAL_FROZEN。 */
  async appendEvent(runId: string, event: ResearchRunEvent, expectedRevision: number): Promise<void> {
    const current = await this.getRun(runId);
    if (!current) throw new RunStoreError("NOT_FOUND", `Run ${runId} not found`);
    if (isTerminalRow(current.status)) {
      throw new RunStoreError("TERMINAL_FROZEN", `Run ${runId} is terminal (${current.status}); cannot write`, current.revision);
    }
    if (current.revision !== expectedRevision) {
      throw new RunStoreError("REVISION_CONFLICT", `Run ${runId} revision ${current.revision} != expected ${expectedRevision}`, current.revision);
    }
    const existing = parseEvents(current.eventsJson);
    const merged = [...existing, event];
    await this.db.v4ResearchRun.update({
      where: { id: runId },
      data: { eventsJson: JSON.stringify(merged), revision: expectedRevision + 1 },
    });
  }
}

/**
 * 创建基于全局 prisma 的 RunStore（API 契约）。
 */
export function createPrismaRunStore(): RunStore {
  return new ResearchRunStore(runPrisma as unknown as ResearchRunDb);
}

/**
 * 列出某 owner/sandbox 范围内的运行（API 契约）。
 */
export async function listRuns(scope: {
  ownerScope: string;
  sandboxId?: string | null;
}): Promise<ResearchRunState[]> {
  const rows = await runPrisma.v4ResearchRun.findMany({
    where: {
      ownerScope: scope.ownerScope,
      ...(scope.sandboxId !== undefined ? { sandboxId: scope.sandboxId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows
    .map((r) => parseState(r.stateJson))
    .filter((s): s is ResearchRunState => s !== null);
}

/**
 * P1-C 修正（§7.5）：failed_recoverable 不得直接 → completed。
 * 只允许 → revising/running/waiting_*；终态矩阵以 isTerminalStatus 为准。
 */
export function assertValidStatusTransition(from: string, to: string): void {
  if (from === "failed_recoverable" && to === "completed") {
    throw new RunStoreError(
      "RESUME_GATE_FAILED",
      `failed_recoverable cannot transition directly to completed`,
    );
  }
}

function normalizeStateRevision(stateJson: string, revision: number): string {
  if (!stateJson || stateJson === "{}") return stateJson;
  try {
    const state = JSON.parse(stateJson) as Record<string, unknown>;
    state.revision = revision;
    return JSON.stringify(state);
  } catch {
    return stateJson;
  }
}

function isTerminalRow(status: string): boolean {
  return status === "cancelled" || status === "completed" || status === "failed_terminal";
}

export function parseState(stateJson: string): ResearchRunState | null {
  if (!stateJson || stateJson === "{}") return null;
  try {
    return JSON.parse(stateJson) as ResearchRunState;
  } catch {
    return null;
  }
}

export function parseEvents(eventsJson: string): ResearchRunEvent[] {
  if (!eventsJson || eventsJson === "[]") return [];
  try {
    const parsed = JSON.parse(eventsJson) as unknown;
    return Array.isArray(parsed) ? (parsed as ResearchRunEvent[]) : [];
  } catch {
    return [];
  }
}