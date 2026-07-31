/**
 * Phase Demo-Sandbox.1-B — Demo Task Sandbox
 *
 * File-based sandbox for demo/访客 task storage.
 * Isolated from Prisma DB — no schema changes, no migrations.
 *
 * Stores data in data/demo-sandbox.json (configurable via DEMO_SANDBOX_STORE_PATH).
 */

import "server-only";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { randomBytes } from "crypto";
import { resolve } from "path";
import {
  assertCandidateSourceUpdateAllowed,
  getCandidateSourceIntegrity,
} from "@/lib/candidateSourceIntegrity";
import { buildCandidateEvidenceReview } from "@/lib/server/candidateEvidenceReview";
import {
  evaluateStoredCandidateResearchEligibility,
} from "@/lib/server/candidateResearchEligibility";
import {
  buildCandidateAnalysisContext,
  createCandidateAnalysisBindingHash,
} from "@/lib/server/candidateAnalysisContext";
import {
  CandidateSourceSaveError,
  normalizeCandidateIdentity,
  parseStoredCandidateSourceMeta,
  type CandidateSaveItem,
} from "@/lib/server/candidateSourceSave";
import {
  parseProductBatchCandidateAnalysis,
  parseProductBatchCandidateSource,
} from "@/lib/server/productBatchCandidateSource";
import {
  buildSellerSpriteCandidateSourceMeta,
  parseSellerSpriteCandidateSourceMeta,
  sellerSpriteCandidateIdentityKey,
  SELLERSPRITE_IMPORT_MARKETPLACE,
  type SellerSpriteImportRow,
  type SellerSpriteImportSummary,
} from "@/lib/server/sellerSpriteImportContract";

// ── Types ───────────────────────────────────────

export interface SandboxTask {
  id: string;
  demoAccessId: string;
  type: string;
  title: string | null;
  decisionStatus: string;
  platform: string;
  productUrl: string | null;
  materialText: string;
  source: string;
  score: number;
  level: string;
  oneLineSummary: string;
  resultJson: string;
  productLifecycle: string;
  createdAt: string;
  updatedAt: string;
}

export interface SandboxCandidate {
  id: string;
  demoAccessId: string;
  name: string;
  rawInput: string;
  link: string | null;
  score: number;
  source: string;
  keyword: string;
  riskLevel: string;
  riskLabel: string;
  summaryLabel: string;
  status: string;
  sourceMetaJson: string;
  analysisJson: string;
  createdAt: string;
  convertedTaskId?: string | null;
  originProductBatchItemId?: string | null;
  lastActionAt?: string | null;
}

export interface DemoSandboxStore {
  version: 1;
  tasks: SandboxTask[];
  candidates: SandboxCandidate[];
}

export interface CreateSandboxTaskInput {
  type?: string;
  title?: string | null;
  decisionStatus?: string;
  platform?: string;
  productUrl?: string | null;
  materialText?: string;
  source?: string;
  score?: number;
  level?: string;
  oneLineSummary?: string;
  resultJson?: string;
  productLifecycle?: string;
}

export interface SandboxTaskPatch {
  decisionStatus?: string;
  title?: string;
  score?: number;
  level?: string;
  oneLineSummary?: string;
  resultJson?: string;
  productLifecycle?: string;
}

export type SandboxCandidateTaskLinkErrorCode =
  | "candidate_not_found"
  | "candidate_not_ready_for_conversion"
  | "candidate_already_converted"
  | "candidate_changed_since_analysis"
  | "candidate_context_changed_since_analysis"
  | "candidate_r22_stage2_blocked"
  | "candidate_product_batch_research_blocked";

export type SandboxCandidateDeleteResult = "deleted" | "not_found" | "linked_task";

export class SandboxCandidateTaskLinkError extends Error {
  constructor(
    public readonly code: SandboxCandidateTaskLinkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SandboxCandidateTaskLinkError";
  }
}

export class SandboxProductBatchCandidateError extends Error {
  constructor(
    public readonly code:
      | "product_batch_candidate_input_invalid"
      | "product_batch_candidate_source_conflict",
    message: string,
  ) {
    super(message);
    this.name = "SandboxProductBatchCandidateError";
  }
}

// ── File path ───────────────────────────────────

function getStorePath(): string {
  if (process.env.DEMO_SANDBOX_STORE_PATH) {
    return process.env.DEMO_SANDBOX_STORE_PATH;
  }
  if (process.env.NODE_ENV === "test") {
    return resolve(process.cwd(), ".next", "test-stores", "demo-sandbox.default.json");
  }
  const dataDir = resolve(process.cwd(), "data");
  return resolve(dataDir, "demo-sandbox.json");
}

function ensureDir(): void {
  const p = getStorePath();
  const dir = resolve(p, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function recoverDemoSandboxBackup(storePath: string): void {
  const backupPath = `${storePath}.backup`;
  if (existsSync(storePath)) {
    if (existsSync(backupPath)) unlinkSync(backupPath);
    return;
  }
  if (existsSync(backupPath)) renameSync(backupPath, storePath);
}

const sandboxSubjectLocks = new Map<string, Promise<void>>();

async function withSandboxSubjectLock<T>(
  demoAccessId: string,
  action: () => T | Promise<T>,
): Promise<T> {
  const key = `${getStorePath().toLowerCase()}::${demoAccessId}`;
  const previous = sandboxSubjectLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveLock) => {
    release = resolveLock;
  });
  sandboxSubjectLocks.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (sandboxSubjectLocks.get(key) === current) sandboxSubjectLocks.delete(key);
  }
}

// ── Store I/O ───────────────────────────────────

export function loadDemoSandboxStore(): DemoSandboxStore {
  ensureDir();
  const p = getStorePath();
  recoverDemoSandboxBackup(p);
  if (!existsSync(p)) return { version: 1, tasks: [], candidates: [] };
  try {
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && Array.isArray(parsed.tasks)) {
      return parsed as DemoSandboxStore;
    }
  } catch { /* corrupt — start fresh */ }
  return { version: 1, tasks: [], candidates: [] };
}

function loadDemoSandboxStoreStrict(): DemoSandboxStore {
  ensureDir();
  const p = getStorePath();
  recoverDemoSandboxBackup(p);
  if (!existsSync(p)) return { version: 1, tasks: [], candidates: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    throw new Error("DEMO_SANDBOX_STORE_INVALID");
  }
  if (typeof parsed !== "object"
    || parsed === null
    || (parsed as { version?: unknown }).version !== 1
    || !Array.isArray((parsed as { tasks?: unknown }).tasks)
    || !Array.isArray((parsed as { candidates?: unknown }).candidates)) {
    throw new Error("DEMO_SANDBOX_STORE_INVALID");
  }
  return parsed as DemoSandboxStore;
}

export function saveDemoSandboxStore(store: DemoSandboxStore): void {
  ensureDir();
  const storePath = getStorePath();
  const backupPath = `${storePath}.backup`;
  const tempPath = `${storePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  recoverDemoSandboxBackup(storePath);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(tempPath, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    try {
      renameSync(tempPath, storePath);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "EPERM" && code !== "EEXIST") throw error;
      let originalMoved = false;
      if (existsSync(storePath)) {
        renameSync(storePath, backupPath);
        originalMoved = true;
      }
      try {
        renameSync(tempPath, storePath);
      } catch (replacementError) {
        if (originalMoved && existsSync(backupPath) && !existsSync(storePath)) {
          try {
            renameSync(backupPath, storePath);
          } catch {
            // Keep the controlled backup for recovery on the next load.
          }
        }
        throw replacementError;
      }
      if (originalMoved && existsSync(backupPath)) unlinkSync(backupPath);
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
}

// ── ID helpers ──────────────────────────────────

const SANDBOX_TASK_PREFIX = "sandbox_task_";

export function isSandboxTaskId(id: string): boolean {
  return id.startsWith(SANDBOX_TASK_PREFIX);
}

function generateSandboxTaskId(): string {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return `${SANDBOX_TASK_PREFIX}${suffix}`;
}

// ── Task CRUD ───────────────────────────────────

function buildSandboxTask(
  demoAccessId: string,
  input: CreateSandboxTaskInput,
  now = new Date().toISOString(),
): SandboxTask {
  return {
    id: generateSandboxTaskId(),
    demoAccessId,
    type: input.type || "workflow",
    title: input.title || null,
    decisionStatus: input.decisionStatus || "pending",
    platform: input.platform || "",
    productUrl: input.productUrl || null,
    materialText: input.materialText || "",
    source: input.source || "agent_run",
    score: input.score ?? 80,
    level: input.level || "",
    oneLineSummary: input.oneLineSummary || "",
    resultJson: input.resultJson || "{}",
    productLifecycle: input.productLifecycle || "{}",
    createdAt: now,
    updatedAt: now,
  };
}

export function createSandboxTask(
  demoAccessId: string,
  input: CreateSandboxTaskInput,
): SandboxTask {
  const store = loadDemoSandboxStore();
  const now = new Date().toISOString();

  const task = buildSandboxTask(demoAccessId, input, now);

  store.tasks.push(task);
  saveDemoSandboxStore(store);
  return task;
}

function createSandboxTaskAndLinkCandidateUnlocked(
  demoAccessId: string,
  candidateId: string,
  input: CreateSandboxTaskInput,
  guard: {
    expectedProductName: string;
    expectedContextHash: string;
  },
): SandboxTask {
  const store = loadDemoSandboxStoreStrict();
  const candidateIndex = store.candidates.findIndex(
    (candidate) => candidate.id === candidateId && candidate.demoAccessId === demoAccessId,
  );
  if (candidateIndex === -1) {
    throw new SandboxCandidateTaskLinkError(
      "candidate_not_found",
      "候选商品不存在或不属于当前访问主体。",
    );
  }

  const candidate = store.candidates[candidateIndex];
  if (candidate.convertedTaskId) {
    throw new SandboxCandidateTaskLinkError(
      "candidate_already_converted",
      "该候选已经转为任务，不能重复创建。",
    );
  }
  const researchEligibility = evaluateStoredCandidateResearchEligibility(candidate);
  if (!researchEligibility.allowed) {
    const productBatch = researchEligibility.originKind === "seller_sprite_product_batch";
    throw new SandboxCandidateTaskLinkError(
      productBatch
        ? "candidate_product_batch_research_blocked"
        : researchEligibility.reasons.includes("candidate_not_ready")
          ? "candidate_not_ready_for_conversion"
          : "candidate_r22_stage2_blocked",
      productBatch
        ? "ProductBatch Candidate 来源或状态已变化，当前不能创建研究任务。"
        : "R2.2 市场晋级状态已变化，当前不能创建商业验证任务。",
    );
  }
  if (normalizeCandidateIdentity(candidate.name) !== normalizeCandidateIdentity(guard.expectedProductName)) {
    throw new SandboxCandidateTaskLinkError(
      "candidate_changed_since_analysis",
      "候选商品在分析后已发生变化，请重新分析后再保存。",
    );
  }
  const currentContext = buildCandidateAnalysisContext(candidate);
  if (createCandidateAnalysisBindingHash(candidate, currentContext) !== guard.expectedContextHash) {
    throw new SandboxCandidateTaskLinkError(
      "candidate_context_changed_since_analysis",
      "候选来源证据在分析后已发生变化，请重新分析后再保存。",
    );
  }

  const now = new Date().toISOString();
  const task = buildSandboxTask(demoAccessId, input, now);
  const linkedCandidate: SandboxCandidate = {
    ...candidate,
    convertedTaskId: task.id,
    lastActionAt: now,
  };
  const nextStore: DemoSandboxStore = {
    version: 1,
    tasks: [...store.tasks, task],
    candidates: store.candidates.map((item, index) => (
      index === candidateIndex ? linkedCandidate : item
    )),
  };

  saveDemoSandboxStore(nextStore);
  return task;
}

export function createSandboxTaskAndLinkCandidate(
  demoAccessId: string,
  candidateId: string,
  input: CreateSandboxTaskInput,
  guard: {
    expectedProductName: string;
    expectedContextHash: string;
  },
): SandboxTask {
  return createSandboxTaskAndLinkCandidateUnlocked(demoAccessId, candidateId, input, guard);
}

export function createSandboxTaskAndLinkCandidateAtomic(
  demoAccessId: string,
  candidateId: string,
  input: CreateSandboxTaskInput,
  guard: {
    expectedProductName: string;
    expectedContextHash: string;
  },
): Promise<SandboxTask> {
  return withSandboxSubjectLock(demoAccessId, () => (
    createSandboxTaskAndLinkCandidateUnlocked(demoAccessId, candidateId, input, guard)
  ));
}

export function listSandboxTasks(demoAccessId: string): SandboxTask[] {
  const store = loadDemoSandboxStore();
  return store.tasks
    .filter((t) => t.demoAccessId === demoAccessId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getSandboxTask(demoAccessId: string, taskId: string): SandboxTask | null {
  const store = loadDemoSandboxStore();
  return store.tasks.find((t) => t.id === taskId && t.demoAccessId === demoAccessId) || null;
}

export function updateSandboxTask(
  demoAccessId: string,
  taskId: string,
  patch: SandboxTaskPatch,
): SandboxTask | null {
  const store = loadDemoSandboxStore();
  const idx = store.tasks.findIndex((t) => t.id === taskId && t.demoAccessId === demoAccessId);
  if (idx === -1) return null;

  const task = store.tasks[idx];
  if (patch.decisionStatus !== undefined) task.decisionStatus = patch.decisionStatus;
  if (patch.title !== undefined) task.title = patch.title;
  if (patch.score !== undefined) task.score = patch.score;
  if (patch.level !== undefined) task.level = patch.level;
  if (patch.oneLineSummary !== undefined) task.oneLineSummary = patch.oneLineSummary;
  if (patch.resultJson !== undefined) task.resultJson = patch.resultJson;
  if (patch.productLifecycle !== undefined) task.productLifecycle = patch.productLifecycle;
  task.updatedAt = new Date().toISOString();

  saveDemoSandboxStore(store);
  return task;
}

export function updateSandboxTaskLifecycle(
  demoAccessId: string,
  taskId: string,
  lifecycle: Record<string, unknown>,
): SandboxTask | null {
  const store = loadDemoSandboxStore();
  const idx = store.tasks.findIndex((t) => t.id === taskId && t.demoAccessId === demoAccessId);
  if (idx === -1) return null;

  store.tasks[idx].productLifecycle = JSON.stringify(lifecycle);
  store.tasks[idx].updatedAt = new Date().toISOString();
  saveDemoSandboxStore(store);
  return store.tasks[idx];
}

export function deleteSandboxTask(demoAccessId: string, taskId: string): boolean {
  const store = loadDemoSandboxStore();
  const idx = store.tasks.findIndex((t) => t.id === taskId && t.demoAccessId === demoAccessId);
  if (idx === -1) return false;
  const now = new Date().toISOString();
  for (const candidate of store.candidates) {
    if (candidate.demoAccessId === demoAccessId && candidate.convertedTaskId === taskId) {
      candidate.convertedTaskId = null;
      candidate.lastActionAt = now;
    }
  }
  store.tasks.splice(idx, 1);
  saveDemoSandboxStore(store);
  return true;
}

// ── Format helpers (for API responses) ──────────

export function sandboxTaskToListItem(task: SandboxTask) {
  return {
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    type: task.type,
    decisionStatus: task.decisionStatus,
    title: task.title,
    platform: task.platform,
    productUrl: task.productUrl,
    materialText: task.materialText,
    source: task.source,
    score: task.score,
    level: task.level,
    oneLineSummary: task.oneLineSummary,
    sourceMode: "demo_sandbox" as const,
    isSandbox: true,
    canEdit: true,
    canDelete: true,
  };
}

export function sandboxTaskToDetail(task: SandboxTask) {
  return {
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    type: task.type,
    decisionStatus: task.decisionStatus,
    title: task.title,
    platform: task.platform,
    productUrl: task.productUrl,
    materialText: task.materialText,
    source: task.source,
    score: task.score,
    level: task.level,
    oneLineSummary: task.oneLineSummary,
    resultJson: (() => { try { return JSON.parse(task.resultJson); } catch { return {}; } })(),
    productLifecycle: (() => { try { return JSON.parse(task.productLifecycle); } catch { return {}; } })(),
    sourceMode: "demo_sandbox" as const,
    isSandbox: true,
    canEdit: true,
    canDelete: true,
  };
}

export function markOfficialTaskReadonly(task: Record<string, unknown>) {
  return {
    ...task,
    sourceMode: "official_readonly" as const,
    isSandbox: false,
    canEdit: false,
    canDelete: false,
  };
}

// ── Candidate types ─────────────────────────────

export interface CreateSandboxCandidateInput {
  name: string;
  rawInput?: string;
  link?: string | null;
  score?: number;
  source?: string;
  keyword?: string;
  riskLevel?: string;
  riskLabel?: string;
  summaryLabel?: string;
  status?: string;
  sourceMetaJson?: string;
  analysisJson?: string;
  originProductBatchItemId?: string | null;
}

export interface SandboxCandidatePatch {
  status?: string;
  score?: number;
  riskLevel?: string;
  riskLabel?: string;
  summaryLabel?: string;
  name?: string;
  link?: string | null;
  analysisJson?: string;
  sourceMetaJson?: string;
}

export interface SandboxCandidateImportInput {
  name: string;
  rawInput?: string;
  link?: string | null;
  source?: string;
  keyword?: string;
}

// ── Candidate ID helpers ────────────────────────

const SANDBOX_CANDIDATE_PREFIX = "sandbox_candidate_";

export function isSandboxCandidateId(id: string): boolean {
  return id.startsWith(SANDBOX_CANDIDATE_PREFIX);
}

function generateSandboxCandidateId(): string {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return `${SANDBOX_CANDIDATE_PREFIX}${suffix}`;
}

// ── Candidate CRUD ──────────────────────────────

export function createSandboxCandidate(
  demoAccessId: string,
  input: CreateSandboxCandidateInput,
): SandboxCandidate {
  const store = loadDemoSandboxStore();
  const now = new Date().toISOString();

  const candidate: SandboxCandidate = {
    id: generateSandboxCandidateId(),
    demoAccessId,
    name: input.name,
    rawInput: input.rawInput || input.name,
    link: input.link || null,
    score: input.score ?? 70,
    source: input.source || "访客输入",
    keyword: input.keyword || "",
    riskLevel: input.riskLevel || "",
    riskLabel: input.riskLabel || "",
    summaryLabel: input.summaryLabel || "",
    status: input.status || "pending",
    sourceMetaJson: input.sourceMetaJson || "{}",
    analysisJson: input.analysisJson || "{}",
    createdAt: now,
    convertedTaskId: null,
    originProductBatchItemId: input.originProductBatchItemId ?? null,
    lastActionAt: null,
  };

  store.candidates.push(candidate);
  saveDemoSandboxStore(store);
  return candidate;
}

export interface CreateSandboxProductBatchCandidateInput extends CreateSandboxCandidateInput {
  name: string;
  rawInput: string;
  link: null;
  score: 0;
  source: "SellerSprite ProductBatch";
  riskLevel: "unknown";
  riskLabel: "需人工核验";
  summaryLabel: "SellerSprite市场研究候选";
  status: "worth_analyzing";
  sourceMetaJson: string;
  analysisJson: string;
  originProductBatchItemId: string;
}

function validateSandboxProductBatchCandidateInput(
  input: CreateSandboxProductBatchCandidateInput,
) {
  const source = parseProductBatchCandidateSource(input.sourceMetaJson);
  const analysis = parseProductBatchCandidateAnalysis(input.analysisJson);
  if (!source
    || !analysis
    || source.serverIdentityScope !== "visitor:sandbox"
    || source.productBatchItemId !== input.originProductBatchItemId
    || source.productName !== input.name
    || analysis.itemHash !== source.itemHash
    || analysis.evidenceHash !== source.evidenceHash
    || input.link !== null
    || input.score !== 0
    || input.source !== "SellerSprite ProductBatch"
    || input.riskLevel !== "unknown"
    || input.riskLabel !== "需人工核验"
    || input.summaryLabel !== "SellerSprite市场研究候选"
    || input.status !== "worth_analyzing") {
    throw new SandboxProductBatchCandidateError(
      "product_batch_candidate_input_invalid",
      "ProductBatch Candidate 输入无效。",
    );
  }
  return { source, analysis };
}

export async function createOrReuseSandboxProductBatchCandidate(
  demoAccessId: string,
  input: CreateSandboxProductBatchCandidateInput,
): Promise<{ candidate: SandboxCandidate; created: boolean }> {
  const incoming = validateSandboxProductBatchCandidateInput(input);
  return withSandboxSubjectLock(demoAccessId, () => {
    const store = loadDemoSandboxStoreStrict();
    const matches = store.candidates.filter((candidate) => (
      candidate.demoAccessId === demoAccessId
      && candidate.originProductBatchItemId === input.originProductBatchItemId
    ));
    if (matches.length > 1) {
      throw new SandboxProductBatchCandidateError(
        "product_batch_candidate_source_conflict",
        "ProductBatch Candidate 关系发生冲突。",
      );
    }
    if (matches.length === 1) {
      const existing = matches[0];
      const storedSource = parseProductBatchCandidateSource(existing.sourceMetaJson);
      const storedAnalysis = parseProductBatchCandidateAnalysis(existing.analysisJson);
      if (!storedSource
        || !storedAnalysis
        || JSON.stringify(storedSource) !== JSON.stringify(incoming.source)
        || JSON.stringify(storedAnalysis) !== JSON.stringify(incoming.analysis)) {
        throw new SandboxProductBatchCandidateError(
          "product_batch_candidate_source_conflict",
          "ProductBatch Candidate 的不可变来源已发生冲突。",
        );
      }
      return { candidate: structuredClone(existing), created: false };
    }

    const now = new Date().toISOString();
    const candidate: SandboxCandidate = {
      id: generateSandboxCandidateId(),
      demoAccessId,
      name: input.name,
      rawInput: input.rawInput,
      link: null,
      score: 0,
      source: input.source,
      keyword: input.keyword || "",
      riskLevel: input.riskLevel,
      riskLabel: input.riskLabel,
      summaryLabel: input.summaryLabel,
      status: input.status,
      sourceMetaJson: input.sourceMetaJson,
      analysisJson: input.analysisJson,
      createdAt: now,
      convertedTaskId: null,
      originProductBatchItemId: input.originProductBatchItemId,
      lastActionAt: null,
    };
    store.candidates.push(candidate);
    saveDemoSandboxStore(store);
    return { candidate: structuredClone(candidate), created: true };
  });
}

export function saveSignedSandboxCandidates(
  demoAccessId: string,
  inputs: CandidateSaveItem[],
): { items: SandboxCandidate[]; created: number; unchanged: number } {
  const store = loadDemoSandboxStoreStrict();
  const existingByIdentity = new Map<string, SandboxCandidate[]>();
  for (const candidate of store.candidates) {
    if (candidate.demoAccessId !== demoAccessId) continue;
    const identity = normalizeCandidateIdentity(candidate.name);
    const matches = existingByIdentity.get(identity);
    if (matches) matches.push(candidate);
    else existingByIdentity.set(identity, [candidate]);
  }

  const decisions: Array<
    | { kind: "unchanged"; candidate: SandboxCandidate }
    | { kind: "create"; input: CandidateSaveItem }
  > = [];
  let unchanged = 0;

  for (const input of inputs) {
    if (!input.evidenceHash || !/^[a-f0-9]{64}$/.test(input.evidenceHash)) {
      throw new CandidateSourceSaveError("candidate_batch_invalid", "Signed Candidate 缺少有效 Evidence Hash。");
    }
    const matches = existingByIdentity.get(normalizeCandidateIdentity(input.name)) ?? [];
    if (matches.length > 1) {
      throw new CandidateSourceSaveError("candidate_source_conflict", "访客候选池已有重复身份，无法安全写入。");
    }
    if (matches.length === 1) {
      const stored = parseStoredCandidateSourceMeta(matches[0].sourceMetaJson);
      if (stored.integrity !== "signed_source_v2" || stored.evidenceHash !== input.evidenceHash) {
        throw new CandidateSourceSaveError("candidate_source_conflict", "同名 Candidate 来源证据冲突。");
      }
      decisions.push({ kind: "unchanged", candidate: matches[0] });
      unchanged += 1;
    } else {
      decisions.push({ kind: "create", input });
    }
  }

  if (decisions.every((decision) => decision.kind === "unchanged")) {
    return {
      items: decisions.map((decision) => (decision as { kind: "unchanged"; candidate: SandboxCandidate }).candidate),
      created: 0,
      unchanged,
    };
  }

  const now = new Date().toISOString();
  const items: SandboxCandidate[] = [];
  let created = 0;
  for (const decision of decisions) {
    if (decision.kind === "unchanged") {
      items.push(decision.candidate);
      continue;
    }
    const input = decision.input;
    const candidate: SandboxCandidate = {
      id: generateSandboxCandidateId(),
      demoAccessId,
      name: input.name,
      rawInput: input.rawInput,
      link: input.link,
      score: input.score,
      source: input.source,
      keyword: input.keyword,
      riskLevel: input.riskLevel,
      riskLabel: input.riskLabel,
      summaryLabel: input.summaryLabel,
      status: "pending",
      sourceMetaJson: input.sourceMetaJson,
      analysisJson: input.analysisJson,
      createdAt: now,
      convertedTaskId: null,
      lastActionAt: null,
    };
    store.candidates.push(candidate);
    items.push(candidate);
    created += 1;
  }
  saveDemoSandboxStore(store);
  return { items, created, unchanged };
}

export function saveLegacySandboxCandidates(
  demoAccessId: string,
  inputs: CandidateSaveItem[],
): { items: SandboxCandidate[]; created: number } {
  const store = loadDemoSandboxStoreStrict();
  const existingByIdentity = new Map<string, SandboxCandidate[]>();
  for (const candidate of store.candidates) {
    if (candidate.demoAccessId !== demoAccessId) continue;
    const identity = normalizeCandidateIdentity(candidate.name);
    const matches = existingByIdentity.get(identity);
    if (matches) matches.push(candidate);
    else existingByIdentity.set(identity, [candidate]);
  }

  const batchIdentities = new Set<string>();
  for (const input of inputs) {
    const identity = normalizeCandidateIdentity(input.name);
    if (batchIdentities.has(identity)) {
      throw new CandidateSourceSaveError("candidate_source_conflict", "Legacy Candidate 批次包含重复身份。");
    }
    batchIdentities.add(identity);
    const matches = existingByIdentity.get(identity) ?? [];
    if (matches.some((candidate) => parseStoredCandidateSourceMeta(candidate.sourceMetaJson).integrity === "signed_source_v2")) {
      throw new CandidateSourceSaveError("candidate_source_conflict", "未验证来源不能覆盖已验证 Candidate。");
    }
    if (matches.some((candidate) => Boolean(candidate.convertedTaskId))) {
      throw new CandidateSourceSaveError("candidate_source_conflict", "已转为任务的 Candidate 不能被同名 Legacy 输入覆盖。");
    }
  }

  const now = new Date().toISOString();
  const items = inputs.map((input): SandboxCandidate => ({
    id: generateSandboxCandidateId(),
    demoAccessId,
    name: input.name,
    rawInput: input.rawInput,
    link: input.link,
    score: input.score,
    source: input.source,
    keyword: input.keyword,
    riskLevel: input.riskLevel,
    riskLabel: input.riskLabel,
    summaryLabel: input.summaryLabel,
    status: input.status,
    sourceMetaJson: input.sourceMetaJson,
    analysisJson: input.analysisJson,
    createdAt: now,
    convertedTaskId: null,
    lastActionAt: null,
  }));
  store.candidates.push(...items);
  saveDemoSandboxStore(store);
  return { items, created: items.length };
}

export function listSandboxCandidates(demoAccessId: string): SandboxCandidate[] {
  const store = loadDemoSandboxStore();
  return store.candidates
    .filter((c) => c.demoAccessId === demoAccessId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getSandboxCandidate(demoAccessId: string, candidateId: string): SandboxCandidate | null {
  const store = loadDemoSandboxStore();
  return store.candidates.find((c) => c.id === candidateId && c.demoAccessId === demoAccessId) || null;
}

export function updateSandboxCandidate(
  demoAccessId: string,
  candidateId: string,
  patch: SandboxCandidatePatch,
  policy: {
    sourceReviewAcknowledged?: unknown;
    requestedFields?: readonly string[];
  } = {},
): SandboxCandidate | null {
  const store = loadDemoSandboxStore();
  const idx = store.candidates.findIndex((c) => c.id === candidateId && c.demoAccessId === demoAccessId);
  if (idx === -1) return null;

  const c = store.candidates[idx];
  assertCandidateSourceUpdateAllowed({
    sourceMetaJson: c.sourceMetaJson,
    reviewIntegrity: buildCandidateEvidenceReview(c).integrity,
    currentStatus: c.status,
    targetStatus: patch.status,
    sourceReviewAcknowledged: policy.sourceReviewAcknowledged,
    requestedFields: policy.requestedFields ?? Object.keys(patch),
  });
  if (patch.status !== undefined) c.status = patch.status;
  if (patch.score !== undefined) c.score = patch.score;
  if (patch.riskLevel !== undefined) c.riskLevel = patch.riskLevel;
  if (patch.riskLabel !== undefined) c.riskLabel = patch.riskLabel;
  if (patch.summaryLabel !== undefined) c.summaryLabel = patch.summaryLabel;
  if (patch.name !== undefined) c.name = patch.name;
  if (patch.link !== undefined) c.link = patch.link;
  if (patch.analysisJson !== undefined) c.analysisJson = patch.analysisJson;
  if (patch.sourceMetaJson !== undefined) c.sourceMetaJson = patch.sourceMetaJson;

  saveDemoSandboxStore(store);
  return c;
}

export function deleteSandboxCandidate(
  demoAccessId: string,
  candidateId: string,
): SandboxCandidateDeleteResult {
  const store = loadDemoSandboxStoreStrict();
  const idx = store.candidates.findIndex((c) => c.id === candidateId && c.demoAccessId === demoAccessId);
  if (idx === -1) return "not_found";
  if (store.candidates[idx].convertedTaskId) return "linked_task";

  saveDemoSandboxStore({
    ...store,
    candidates: store.candidates.filter((_, index) => index !== idx),
  });
  return "deleted";
}

// ── SellerSprite Candidate Authority (Visitor path) ─────────────────────────
// Runs entirely inside one withSandboxSubjectLock: load → scan identity →
// decide created/skipped/conflict → mutate → save once. No nested re-acquire.

export function importSellerSpriteCandidatesForVisitor(
  demoAccessId: string,
  input: {
    rows: SellerSpriteImportRow[];
    sourceFileSha256: string;
    importedAt: string;
  },
): Promise<SellerSpriteImportSummary> {
  return withSandboxSubjectLock(demoAccessId, () => {
    const store = loadDemoSandboxStoreStrict();
    const byKey = new Map<string, SandboxCandidate>();
    for (const candidate of store.candidates) {
      if (candidate.demoAccessId !== demoAccessId) continue;
      const meta = parseSellerSpriteCandidateSourceMeta(candidate.sourceMetaJson);
      if (!meta) continue;
      const key = sellerSpriteCandidateIdentityKey(meta);
      if (!byKey.has(key)) byKey.set(key, candidate);
    }

    const created: SellerSpriteImportSummary["created"] = [];
    const skipped: SellerSpriteImportSummary["skipped"] = [];
    const conflicts: SellerSpriteImportSummary["conflicts"] = [];
    let changed = false;

    for (const row of input.rows) {
      const key = `${SELLERSPRITE_IMPORT_MARKETPLACE}:${row.asin}`;
      const existing = byKey.get(key);
      if (!existing) {
        const sourceMetaJson = buildSellerSpriteCandidateSourceMeta(row, input.sourceFileSha256, input.importedAt);
        const candidate: SandboxCandidate = {
          id: generateSandboxCandidateId(),
          demoAccessId,
          name: row.title,
          rawInput: "",
          link: row.amazonUrl,
          score: 0,
          source: "SellerSprite",
          keyword: "",
          riskLevel: "",
          riskLabel: "",
          summaryLabel: "",
          status: "pending",
          sourceMetaJson,
          analysisJson: "{}",
          createdAt: input.importedAt,
          convertedTaskId: null,
          originProductBatchItemId: null,
          lastActionAt: null,
        };
        store.candidates.push(candidate);
        created.push({ rowHash: row.rowHash, candidateId: candidate.id });
        byKey.set(key, candidate);
        changed = true;
        continue;
      }
      const existingMeta = parseSellerSpriteCandidateSourceMeta(existing.sourceMetaJson);
      const sameSnapshot = Boolean(existingMeta)
        && existingMeta!.source.sourceFileSha256 === input.sourceFileSha256
        && existingMeta!.source.rowHash === row.rowHash;
      if (sameSnapshot) {
        skipped.push({ rowHash: row.rowHash, candidateId: existing.id, reason: "already_imported" });
      } else {
        conflicts.push({
          rowHash: row.rowHash,
          candidateId: existing.id,
          reason: "candidate_exists_with_different_snapshot",
        });
      }
    }

    if (changed) saveDemoSandboxStore(store);
    return { created, skipped, conflicts };
  });
}

export function importSandboxCandidates(
  demoAccessId: string,
  inputs: SandboxCandidateImportInput[],
): { imported: number; skipped: number } {
  const store = loadDemoSandboxStore();
  const now = new Date().toISOString();
  let imported = 0;
  let skipped = 0;

  for (const input of inputs) {
    if (!input.name || !input.name.trim()) { skipped++; continue; }
    store.candidates.push({
      id: generateSandboxCandidateId(),
      demoAccessId,
      name: input.name.trim(),
      rawInput: input.rawInput || input.name.trim(),
      link: input.link || null,
      score: 70,
      source: input.source || "访客导入",
      keyword: input.keyword || "",
      riskLevel: "",
      riskLabel: "",
      summaryLabel: "",
      status: "pending",
      sourceMetaJson: "{}",
      analysisJson: "{}",
      createdAt: now,
      convertedTaskId: null,
      lastActionAt: null,
    });
    imported++;
  }

  if (imported > 0) saveDemoSandboxStore(store);
  return { imported, skipped };
}

// ── Candidate format helpers ────────────────────

export function sandboxCandidateToListItem(candidate: SandboxCandidate) {
  return {
    id: candidate.id,
    name: candidate.name,
    rawInput: candidate.rawInput,
    link: candidate.link,
    score: candidate.score,
    source: candidate.source,
    keyword: candidate.keyword,
    riskLevel: candidate.riskLevel,
    riskLabel: candidate.riskLabel,
    summaryLabel: candidate.summaryLabel,
    status: candidate.status,
    sourceMetaJson: candidate.sourceMetaJson,
    analysisJson: candidate.analysisJson,
    createdAt: candidate.createdAt,
    updatedAt: candidate.createdAt,
    convertedTaskId: candidate.convertedTaskId ?? null,
    originProductBatchItemId: candidate.originProductBatchItemId ?? null,
    lastActionAt: candidate.lastActionAt ?? null,
    sourceIntegrity: getCandidateSourceIntegrity(candidate.sourceMetaJson),
    sourceMode: "demo_sandbox" as const,
    isSandbox: true,
    canEdit: true,
    canDelete: true,
  };
}
