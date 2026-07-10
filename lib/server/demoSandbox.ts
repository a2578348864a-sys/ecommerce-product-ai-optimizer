/**
 * Phase Demo-Sandbox.1-B — Demo Task Sandbox
 *
 * File-based sandbox for demo/访客 task storage.
 * Isolated from Prisma DB — no schema changes, no migrations.
 *
 * Stores data in data/demo-sandbox.json (configurable via DEMO_SANDBOX_STORE_PATH).
 */

import "server-only";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { randomBytes } from "crypto";
import { resolve } from "path";

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

// ── File path ───────────────────────────────────

function getStorePath(): string {
  if (process.env.DEMO_SANDBOX_STORE_PATH) {
    return process.env.DEMO_SANDBOX_STORE_PATH;
  }
  const dataDir = resolve(process.cwd(), "data");
  return resolve(dataDir, "demo-sandbox.json");
}

function ensureDir(): void {
  const p = getStorePath();
  const dir = resolve(p, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Store I/O ───────────────────────────────────

export function loadDemoSandboxStore(): DemoSandboxStore {
  ensureDir();
  const p = getStorePath();
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

export function saveDemoSandboxStore(store: DemoSandboxStore): void {
  ensureDir();
  const storePath = getStorePath();
  const tempPath = `${storePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf-8");
    try {
      renameSync(tempPath, storePath);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "EPERM" && code !== "EEXIST") throw error;
      if (existsSync(storePath)) unlinkSync(storePath);
      renameSync(tempPath, storePath);
    }
  } finally {
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

export function createSandboxTask(
  demoAccessId: string,
  input: CreateSandboxTaskInput,
): SandboxTask {
  const store = loadDemoSandboxStore();
  const now = new Date().toISOString();

  const task: SandboxTask = {
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

  store.tasks.push(task);
  saveDemoSandboxStore(store);
  return task;
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
  };

  store.candidates.push(candidate);
  saveDemoSandboxStore(store);
  return candidate;
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
): SandboxCandidate | null {
  const store = loadDemoSandboxStore();
  const idx = store.candidates.findIndex((c) => c.id === candidateId && c.demoAccessId === demoAccessId);
  if (idx === -1) return null;

  const c = store.candidates[idx];
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

export function deleteSandboxCandidate(demoAccessId: string, candidateId: string): boolean {
  const store = loadDemoSandboxStore();
  const idx = store.candidates.findIndex((c) => c.id === candidateId && c.demoAccessId === demoAccessId);
  if (idx === -1) return false;
  store.candidates.splice(idx, 1);
  saveDemoSandboxStore(store);
  return true;
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
    sourceMode: "demo_sandbox" as const,
    isSandbox: true,
    canEdit: true,
    canDelete: true,
  };
}
