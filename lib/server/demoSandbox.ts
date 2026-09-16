/**
 * Demo Sandbox Stub
 *
 * All sandbox logic has been migrated to archive/sandbox/.
 * This stub maintains type and function definitions for backward compatibility.
 */

import "server-only";

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
  category?: string | null;
  price?: number | null;
  analysis?: string;
  tags?: string;
  sourceMeta?: string;
  updatedAt?: string;
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

export interface SandboxCandidatePatch {
  status?: string;
  score?: number;
  tags?: string;
  analysis?: string;
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

export function loadDemoSandboxStore() {
  return { tasks: [] as SandboxTask[], candidates: [] as SandboxCandidate[] };
}

export function isSandboxTaskId(id: string): boolean {
  return typeof id === "string" && id.startsWith("sandbox_task_");
}

export function isSandboxCandidateId(id: string): boolean {
  return typeof id === "string" && id.startsWith("sandbox_candidate_");
}

export function getSandboxTask(_demoAccessId?: string, _id?: string): SandboxTask | null {
  return null;
}

export function getSandboxCandidate(_demoAccessId?: string, _id?: string): SandboxCandidate | null {
  return null;
}

export function listSandboxCandidates(_demoAccessId?: string): SandboxCandidate[] {
  return [];
}

export function listSandboxTasks(_demoAccessId?: string): SandboxTask[] {
  return [];
}

export function sandboxCandidateToListItem(c: unknown): unknown {
  return c;
}

export async function createTrustedSandboxTask(
  _demoAccessId: string,
  input: CreateSandboxTaskInput,
): Promise<SandboxTask> {
  const now = new Date().toISOString();
  return {
    id: `sandbox_task_${Date.now()}`,
    demoAccessId: "owner",
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

export async function createSandboxTaskAndLinkCandidateAtomic(
  demoAccessId: string,
  _candidateId: string,
  input: CreateSandboxTaskInput,
  _expected?: unknown,
): Promise<SandboxTask> {
  return createTrustedSandboxTask(demoAccessId, input);
}

export async function createSandboxCandidate(
  _demoAccessId: string,
  input: Record<string, unknown>,
): Promise<SandboxCandidate> {
  const now = new Date().toISOString();
  return {
    id: `sandbox_candidate_${Date.now()}`,
    demoAccessId: "owner",
    name: String(input.name || ""),
    rawInput: String(input.rawInput || input.name || ""),
    link: (input.link as string) || null,
    category: (input.category as string) || null,
    price: (input.price as number) || null,
    source: String(input.source || "manual"),
    score: (input.score as number) || 80,
    keyword: String(input.keyword || ""),
    riskLevel: String(input.riskLevel || "low"),
    riskLabel: String(input.riskLabel || "低风险"),
    summaryLabel: String(input.summaryLabel || ""),
    analysis: (input.analysis as string) || "{}",
    analysisJson: (input.analysisJson as string) || "{}",
    status: (input.status as string) || "pending",
    tags: (input.tags as string) || "[]",
    sourceMeta: (input.sourceMeta as string) || "{}",
    sourceMetaJson: (input.sourceMetaJson as string) || "{}",
    convertedTaskId: null,
    createdAt: now,
    updatedAt: now,
  };
}



export type CreateSandboxProductBatchCandidateInput = any;

export async function createOrReuseSandboxProductBatchCandidate(..._args: any[]): Promise<{ candidate: any; created: boolean }> {
  throw new Error("Sandbox product batch candidates are no longer supported.");
}

export async function updateSandboxTask(): Promise<SandboxTask | null> {
  return null;
}

export async function saveLegacySandboxCandidates(
  _demoAccessId: string,
  items: unknown[],
): Promise<{ items: unknown[]; created: number }> {
  return { items, created: items.length };
}

export async function saveSignedSandboxCandidates(
  _demoAccessId: string,
  items: unknown[],
): Promise<{ items: unknown[]; created: number; unchanged: number }> {
  return { items, created: items.length, unchanged: 0 };
}

export async function importSellerSpriteCandidatesForVisitor(
  _demoAccessId?: string,
  _input?: unknown,
): Promise<{ imported: number; created: number; updated: number; unchanged: number; skipped: number; conflicts: number; items: never[] }> {
  return { imported: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, conflicts: 0, items: [] };
}
