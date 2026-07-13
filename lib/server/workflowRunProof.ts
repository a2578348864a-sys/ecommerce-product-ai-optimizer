import { createHash, createHmac, timingSafeEqual } from "crypto";
import { getProofSigningKey } from "@/lib/server/proofSigningSecret";

export type WorkflowRunStatus =
  | "completed"
  | "partial_failed"
  | "failed"
  | "blocked"
  | "insufficient_evidence";

export type WorkflowRunInput = {
  productName: string;
  source: "manual" | "opportunity" | "task";
  candidateId: string | null;
  contextHash?: string;
};

export type WorkflowRunProofPayload = {
  v: 1;
  runId: string;
  subject: string;
  candidateId: string | null;
  inputHash: string;
  resultHash: string;
  status: WorkflowRunStatus;
  iat: number;
  exp: number;
};

export type VerifiedWorkflowRunProof =
  | { ok: true; payload: WorkflowRunProofPayload }
  | {
      ok: false;
      reason: "missing_key" | "malformed" | "invalid_signature" | "expired" | "invalid_payload";
    };

const RUN_PROOF_PREFIX = "runproof_v1.";
const RUN_PROOF_TTL_MS = 2 * 60 * 60 * 1000;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RUN_ID_PATTERN = /^wf-[a-zA-Z0-9-]{8,100}$/;
const VALID_STATUSES = new Set<WorkflowRunStatus>([
  "completed",
  "partial_failed",
  "failed",
  "blocked",
  "insufficient_evidence",
]);

function getSigningKey(): Buffer | null {
  return getProofSigningKey("qx-agent-workflow-run-proof-v1");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return "null";
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidSubject(value: unknown): value is string {
  return value === "owner"
    || (typeof value === "string" && /^demo:[a-zA-Z0-9_-]{1,120}$/.test(value));
}

function isValidPayload(value: unknown): value is WorkflowRunProofPayload {
  if (!isRecord(value)) return false;
  return value.v === 1
    && typeof value.runId === "string"
    && RUN_ID_PATTERN.test(value.runId)
    && isValidSubject(value.subject)
    && (value.candidateId === null
      || (typeof value.candidateId === "string" && value.candidateId.length > 0 && value.candidateId.length <= 80))
    && typeof value.inputHash === "string"
    && HASH_PATTERN.test(value.inputHash)
    && typeof value.resultHash === "string"
    && HASH_PATTERN.test(value.resultHash)
    && typeof value.status === "string"
    && VALID_STATUSES.has(value.status as WorkflowRunStatus)
    && typeof value.iat === "number"
    && Number.isSafeInteger(value.iat)
    && typeof value.exp === "number"
    && Number.isSafeInteger(value.exp)
    && value.exp > value.iat;
}

export function buildWorkflowRunSubject(context: { mode: "owner" } | { mode: "demo"; demoAccessId: string }): string {
  return context.mode === "owner" ? "owner" : `demo:${context.demoAccessId}`;
}

export function normalizeWorkflowRunInput(input: WorkflowRunInput): WorkflowRunInput {
  const contextHash = input.contextHash?.trim().toLowerCase();
  return {
    productName: input.productName.trim().replace(/\s+/g, " "),
    source: input.source,
    candidateId: input.candidateId?.trim() || null,
    ...(contextHash && HASH_PATTERN.test(contextHash) ? { contextHash } : {}),
  };
}

export function createWorkflowInputHash(input: WorkflowRunInput): string {
  return sha256(normalizeWorkflowRunInput(input));
}

export function createWorkflowResultHash(workflowResult: unknown): string {
  if (!isRecord(workflowResult)) return sha256(workflowResult);
  const { runProof: _runProof, ...unsignedResult } = workflowResult;
  return sha256(unsignedResult);
}

export function createWorkflowRunProof(input: {
  runId: string;
  subject: string;
  candidateId: string | null;
  inputHash: string;
  resultHash: string;
  status: WorkflowRunStatus;
  now?: number;
}): string {
  const key = getSigningKey();
  if (!key) throw new Error("WORKFLOW_RUN_PROOF_KEY_MISSING");

  const now = input.now ?? Date.now();
  const payload: WorkflowRunProofPayload = {
    v: 1,
    runId: input.runId,
    subject: input.subject,
    candidateId: input.candidateId,
    inputHash: input.inputHash,
    resultHash: input.resultHash,
    status: input.status,
    iat: now,
    exp: now + RUN_PROOF_TTL_MS,
  };

  if (!isValidPayload(payload)) throw new Error("WORKFLOW_RUN_PROOF_INVALID_PAYLOAD");

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(encodedPayload).digest("base64url");
  return `${RUN_PROOF_PREFIX}${encodedPayload}.${signature}`;
}

export function verifyWorkflowRunProof(token: unknown, now = Date.now()): VerifiedWorkflowRunProof {
  const key = getSigningKey();
  if (!key) return { ok: false, reason: "missing_key" };
  if (typeof token !== "string" || token.length > 4096 || !token.startsWith(RUN_PROOF_PREFIX)) {
    return { ok: false, reason: "malformed" };
  }

  const tokenBody = token.slice(RUN_PROOF_PREFIX.length);
  const separator = tokenBody.lastIndexOf(".");
  if (separator <= 0 || separator === tokenBody.length - 1) {
    return { ok: false, reason: "malformed" };
  }

  const encodedPayload = tokenBody.slice(0, separator);
  const providedSignature = tokenBody.slice(separator + 1);
  const expectedSignature = createHmac("sha256", key).update(encodedPayload).digest("base64url");
  const providedBuffer = Buffer.from(providedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return { ok: false, reason: "invalid_signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isValidPayload(payload)) return { ok: false, reason: "invalid_payload" };
  if (now > payload.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
