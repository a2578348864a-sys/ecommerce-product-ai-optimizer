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
import { assertGenericTaskResultAllowed } from "@/lib/server/taskResultNamespacePolicy";
import { resolveTaskProductUrlFromCandidate } from "@/lib/server/taskIdentityInheritance";
import {
  mutateDemoSandboxStore,
  readDemoSandboxStore,
} from "@/lib/server/demoSandboxStore.internal";

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
  title?: string;
  score?: number;
  level?: string;
  oneLineSummary?: string;
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

export function loadDemoSandboxStore(): DemoSandboxStore {
  return readDemoSandboxStore();
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

export function createTrustedSandboxTask(
  demoAccessId: string,
  input: CreateSandboxTaskInput,
): Promise<SandboxTask> {
  return mutateDemoSandboxStore<SandboxTask>((store) => {
    const task = buildSandboxTask(demoAccessId, input);
    store.tasks.push(task);
    return { value: structuredClone(task), changed: true };
  });
}

function linkCandidateAndCreateTask(
  store: DemoSandboxStore,
  demoAccessId: string,
  candidateId: string,
  input: CreateSandboxTaskInput,
  guard?: { expectedProductName: string; expectedContextHash: string } | null,
): SandboxTask {
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
  // 保存端 name 比对：与研究运行端（product-analysis 先将 productName
  // trim+slice(0,120) 再 normalize）保持完全相同的转换顺序，避免
  // Amazon 长标题保存时被误判为"候选商品在分析后已发生变化"。
  // F1：guard 可选——研究骨架创建（start-research）没有 AI 结果，跳过绑定校验；
  //     后续研究保存（save-task update）时仍由 candidate 一致性校验保护。
  if (guard) {
    if (normalizeCandidateIdentity(candidate.name.trim().slice(0, 120))
      !== normalizeCandidateIdentity(guard.expectedProductName.trim().slice(0, 120))) {
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
  }

  const now = new Date().toISOString();
  const task = buildSandboxTask(demoAccessId, {
    ...input,
    // F4：Candidate → Task identity 继承（与 Owner 路径同一 Authority；fail-closed）
    productUrl: input.productUrl ?? resolveTaskProductUrlFromCandidate({
      link: candidate.link,
      sourceMetaJson: candidate.sourceMetaJson,
    }),
  }, now);
  const linkedCandidate: SandboxCandidate = {
    ...candidate,
    convertedTaskId: task.id,
    lastActionAt: now,
  };
  store.tasks.push(task);
  store.candidates[candidateIndex] = linkedCandidate;
  return task;
}

export function createSandboxTaskAndLinkCandidate(
  demoAccessId: string,
  candidateId: string,
  input: CreateSandboxTaskInput,
  guard?: {
    expectedProductName: string;
    expectedContextHash: string;
  } | null,
): Promise<SandboxTask> {
  return createSandboxTaskAndLinkCandidateAtomic(demoAccessId, candidateId, input, guard);
}

export function createSandboxTaskAndLinkCandidateAtomic(
  demoAccessId: string,
  candidateId: string,
  input: CreateSandboxTaskInput,
  guard?: {
    expectedProductName: string;
    expectedContextHash: string;
  } | null,
): Promise<SandboxTask> {
  return mutateDemoSandboxStore((store) => {
    const task = linkCandidateAndCreateTask(store, demoAccessId, candidateId, input, guard);
    return { value: structuredClone(task), changed: true };
  });
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
): Promise<SandboxTask | null> {
  return mutateDemoSandboxStore((store) => {
    const idx = store.tasks.findIndex((t) => t.id === taskId && t.demoAccessId === demoAccessId);
    if (idx === -1) return { value: null, changed: false };
    const task = store.tasks[idx];
    if (patch.title !== undefined) task.title = patch.title;
    if (patch.score !== undefined) task.score = patch.score;
    if (patch.level !== undefined) task.level = patch.level;
    if (patch.oneLineSummary !== undefined) task.oneLineSummary = patch.oneLineSummary;
    task.updatedAt = new Date().toISOString();
    return { value: structuredClone(task), changed: true };
  });
}

export function createGenericSandboxTask(
  demoAccessId: string,
  input: CreateSandboxTaskInput,
): Promise<SandboxTask> {
  let result: unknown;
  try { result = JSON.parse(input.resultJson || "{}"); } catch { throw new Error("TASK_RESULT_JSON_INVALID"); }
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error("TASK_RESULT_JSON_INVALID");
  }
  assertGenericTaskResultAllowed(result as Record<string, unknown>);
  return createTrustedSandboxTask(demoAccessId, input);
}

export function deleteSandboxTask(demoAccessId: string, taskId: string): Promise<boolean> {
  return mutateDemoSandboxStore((store) => {
    const idx = store.tasks.findIndex((t) => t.id === taskId && t.demoAccessId === demoAccessId);
    if (idx === -1) return { value: false, changed: false };
    const now = new Date().toISOString();
    for (const candidate of store.candidates) {
      if (candidate.demoAccessId === demoAccessId && candidate.convertedTaskId === taskId) {
        candidate.convertedTaskId = null;
        candidate.lastActionAt = now;
      }
    }
    store.tasks.splice(idx, 1);
    return { value: true, changed: true };
  });
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
): Promise<SandboxCandidate> {
  return mutateDemoSandboxStore((store) => {
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
    return { value: structuredClone(candidate), changed: true };
  });
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
  return mutateDemoSandboxStore<{ candidate: SandboxCandidate; created: boolean }>((store) => {
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
      return { value: { candidate: structuredClone(existing), created: false }, changed: false };
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
    return { value: { candidate: structuredClone(candidate), created: true }, changed: true };
  });
}

export function saveSignedSandboxCandidates(
  demoAccessId: string,
  inputs: CandidateSaveItem[],
): Promise<{ items: SandboxCandidate[]; created: number; unchanged: number }> {
  return mutateDemoSandboxStore((store) => {
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
    return { value: {
      items: decisions.map((decision) => structuredClone((decision as { kind: "unchanged"; candidate: SandboxCandidate }).candidate)),
      created: 0,
      unchanged,
    }, changed: false };
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
  return { value: { items: structuredClone(items), created, unchanged }, changed: created > 0 };
  });
}

export function saveLegacySandboxCandidates(
  demoAccessId: string,
  inputs: CandidateSaveItem[],
): Promise<{ items: SandboxCandidate[]; created: number }> {
  return mutateDemoSandboxStore((store) => {
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
  return { value: { items: structuredClone(items), created: items.length }, changed: items.length > 0 };
  });
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
): Promise<SandboxCandidate | null> {
  return mutateDemoSandboxStore((store) => {
  const idx = store.candidates.findIndex((c) => c.id === candidateId && c.demoAccessId === demoAccessId);
  if (idx === -1) return { value: null, changed: false };

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

  return { value: structuredClone(c), changed: true };
  });
}

export function deleteSandboxCandidate(
  demoAccessId: string,
  candidateId: string,
): Promise<SandboxCandidateDeleteResult> {
  return mutateDemoSandboxStore((store) => {
  const idx = store.candidates.findIndex((c) => c.id === candidateId && c.demoAccessId === demoAccessId);
  if (idx === -1) return { value: "not_found" as const, changed: false };
  if (store.candidates[idx].convertedTaskId) return { value: "linked_task" as const, changed: false };
  store.candidates.splice(idx, 1);
  return { value: "deleted" as const, changed: true };
  });
}

export function removeSandboxCandidateFromResearchPool(
  demoAccessId: string,
  candidateId: string,
): Promise<"removed" | "not_found"> {
  return mutateDemoSandboxStore((store) => {
    const candidate = store.candidates.find(
      (item) => item.id === candidateId && item.demoAccessId === demoAccessId,
    );
    if (!candidate) return { value: "not_found" as const, changed: false };
    if (candidate.status === "rejected") {
      return { value: "removed" as const, changed: false };
    }
    candidate.status = "rejected";
    candidate.lastActionAt = new Date().toISOString();
    return { value: "removed" as const, changed: true };
  });
}

// ── SellerSprite Candidate Authority (Visitor path) ─────────────────────────
// Runs entirely inside the physical Store mutation lock: strict re-read → scan
// identity → decide created/skipped/conflict → mutate → atomic save once.

export function importSellerSpriteCandidatesForVisitor(
  demoAccessId: string,
  input: {
    rows: SellerSpriteImportRow[];
    sourceFileSha256: string;
    importedAt: string;
  },
): Promise<SellerSpriteImportSummary> {
  return mutateDemoSandboxStore(async (store) => {
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
        // 商品主图不在导入时下载：URL 仅作为 external_visual_reference_candidate，
        // 用户点击「使用此图作为商品参考图」后服务器才受控获取（visual-reference-import route）。
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

    return { value: { created, skipped, conflicts }, changed };
  });
}

export function importSandboxCandidates(
  demoAccessId: string,
  inputs: SandboxCandidateImportInput[],
): Promise<{ imported: number; skipped: number }> {
  return mutateDemoSandboxStore((store) => {
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

  return { value: { imported, skipped }, changed: imported > 0 };
  });
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
