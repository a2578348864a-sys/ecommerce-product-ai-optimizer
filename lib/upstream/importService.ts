import type { EvidenceSnapshot, ImportPackage } from "./contracts";
import { buildImportPackageHash } from "./pipeline";

type EvidenceLink = {
  evidenceSnapshotId: string;
  importBatchId: string;
};

type CandidateState = {
  candidateId: string;
  productKey: string;
  variantGroupKey: string;
  createdByImportBatchId: string;
  evidenceSnapshotIds: string[];
  evidenceLinks: EvidenceLink[];
  status: "pending" | "promoted" | "abandoned";
  linkedTaskId: string | null;
  newEvidenceNotice: boolean;
  sourceState: "active" | "revoked" | "source_invalidated";
  importBatchIds: string[];
};

export type ImportResult = {
  importBatchId: string;
  importPackageHash: string;
  createdCandidates: number;
  createdEvidence: number;
  reusedExistingResult: boolean;
  sourceState: "active" | "revoked" | "source_invalidated";
};

type ScopeState = {
  candidates: Map<string, CandidateState>;
  evidence: Map<string, EvidenceSnapshot>;
  importResults: Map<string, ImportResult>;
};

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return value;
}

function cloneScopeState(state: ScopeState): ScopeState {
  return {
    candidates: new Map([...state.candidates].map(([key, value]) => [key, cloneValue(value)])),
    evidence: new Map([...state.evidence].map(([key, value]) => [key, deepFreeze(cloneValue(value))])),
    importResults: new Map([...state.importResults].map(([key, value]) => [key, cloneValue(value)])),
  };
}

function createScopeState(): ScopeState {
  return { candidates: new Map(), evidence: new Map(), importResults: new Map() };
}

export class InMemoryImportStore {
  private readonly scopes = new Map<string, ScopeState>();

  /** Namespace separation for deterministic adapter tests; this is not an authorization boundary. */
  adapterState(scopeId: string): ScopeState {
    const existing = this.scopes.get(scopeId);
    if (existing) return existing;
    const created = createScopeState();
    this.scopes.set(scopeId, created);
    return created;
  }

  replaceAdapterState(scopeId: string, state: ScopeState) {
    this.scopes.set(scopeId, state);
  }

  snapshot(scopeId: string) {
    const state = this.adapterState(scopeId);
    return cloneValue({
      candidates: [...state.candidates.values()],
      evidence: [...state.evidence.values()],
      importResults: [...state.importResults.values()],
    });
  }

  setHumanState(
    scopeId: string,
    productKey: string,
    status: CandidateState["status"],
    linkedTaskId: string | null,
  ) {
    const candidate = this.adapterState(scopeId).candidates.get(productKey);
    if (!candidate) throw new Error("CANDIDATE_NOT_FOUND_IN_SCOPE");
    candidate.status = status;
    candidate.linkedTaskId = linkedTaskId;
  }
}

function validateImportPackage(pkg: ImportPackage) {
  if (pkg.schemaVersion !== "import-package.v1" || !pkg.importPackageHash || !pkg.importIdempotencyKey || !pkg.importBatchId) {
    throw new Error("IMPORT_PACKAGE_INVALID");
  }
  if (!Array.isArray(pkg.candidates)) throw new Error("IMPORT_CANDIDATES_INVALID");
  const recomputedHash = buildImportPackageHash(pkg);
  if (pkg.importPackageHash !== recomputedHash) throw new Error("IMPORT_PACKAGE_HASH_MISMATCH");
  if (pkg.importIdempotencyKey !== `import:${recomputedHash}`) throw new Error("IMPORT_IDEMPOTENCY_KEY_INVALID");
  const candidateIds = new Set<string>();
  const evidenceIds = new Set<string>();
  for (const candidate of pkg.candidates) {
    if (!candidate.candidateId || !candidate.productKey || !candidate.variantGroupKey) throw new Error("IMPORT_CANDIDATE_INVALID");
    if (candidateIds.has(candidate.candidateId)) throw new Error("IMPORT_CANDIDATE_DUPLICATE");
    candidateIds.add(candidate.candidateId);
    if (candidate.importBatchId !== pkg.importBatchId
      || candidate.evidenceSnapshot.importBatchId !== pkg.importBatchId
      || candidate.minimumEvidencePack.importBatchId !== pkg.importBatchId) {
      throw new Error("IMPORT_BATCH_LINK_MISMATCH");
    }
    if (candidate.productKey !== candidate.evidenceSnapshot.productKey
      || candidate.productKey !== candidate.evidenceSnapshot.product.productKey
      || candidate.productKey !== candidate.minimumEvidencePack.productKey
      || candidate.evidenceSnapshot.evidenceSnapshotId !== candidate.minimumEvidencePack.evidenceSnapshotId) {
      throw new Error("IMPORT_CANDIDATE_EVIDENCE_MISMATCH");
    }
    if (candidate.evidenceSnapshot.sourceState !== "active") throw new Error("IMPORT_EVIDENCE_SOURCE_STATE_INVALID");
    if (evidenceIds.has(candidate.evidenceSnapshot.evidenceSnapshotId)) throw new Error("IMPORT_EVIDENCE_DUPLICATE");
    evidenceIds.add(candidate.evidenceSnapshot.evidenceSnapshotId);
  }
}

export function importApprovedPackage(
  store: InMemoryImportStore,
  scopeId: string,
  pkg: ImportPackage,
): ImportResult {
  validateImportPackage(pkg);
  const current = store.adapterState(scopeId);
  const prior = current.importResults.get(pkg.importIdempotencyKey);
  if (prior) {
    if (prior.importPackageHash !== pkg.importPackageHash) throw new Error("IMPORT_IDEMPOTENCY_KEY_CONFLICT");
    return { ...cloneValue(prior), reusedExistingResult: true };
  }

  const next = cloneScopeState(current);
  let createdCandidates = 0;
  let createdEvidence = 0;
  for (const incoming of pkg.candidates) {
    const evidenceId = incoming.evidenceSnapshot.evidenceSnapshotId;
    if (!next.evidence.has(evidenceId)) {
      next.evidence.set(evidenceId, deepFreeze(cloneValue(incoming.evidenceSnapshot)));
      createdEvidence += 1;
    }
    const evidenceLink = { evidenceSnapshotId: evidenceId, importBatchId: pkg.importBatchId };
    const existing = next.candidates.get(incoming.productKey);
    if (existing) {
      if (!existing.evidenceSnapshotIds.includes(evidenceId)) {
        existing.evidenceSnapshotIds.push(evidenceId);
        existing.evidenceLinks.push(evidenceLink);
        existing.newEvidenceNotice = true;
      }
      if (!existing.importBatchIds.includes(pkg.importBatchId)) existing.importBatchIds.push(pkg.importBatchId);
      continue;
    }
    next.candidates.set(incoming.productKey, {
      candidateId: incoming.candidateId,
      productKey: incoming.productKey,
      variantGroupKey: incoming.variantGroupKey,
      createdByImportBatchId: pkg.importBatchId,
      evidenceSnapshotIds: [evidenceId],
      evidenceLinks: [evidenceLink],
      status: "pending",
      linkedTaskId: null,
      newEvidenceNotice: false,
      sourceState: "active",
      importBatchIds: [pkg.importBatchId],
    });
    createdCandidates += 1;
  }
  const result: ImportResult = {
    importBatchId: pkg.importBatchId,
    importPackageHash: pkg.importPackageHash,
    createdCandidates,
    createdEvidence,
    reusedExistingResult: false,
    sourceState: "active",
  };
  next.importResults.set(pkg.importIdempotencyKey, result);
  store.replaceAdapterState(scopeId, next);
  return cloneValue(result);
}

function updateImportResultState(state: ScopeState, importBatchId: string, sourceState: ImportResult["sourceState"]) {
  for (const [key, result] of state.importResults) {
    if (result.importBatchId === importBatchId) state.importResults.set(key, { ...result, sourceState });
  }
}

export function revokeImportBatch(store: InMemoryImportStore, scopeId: string, importBatchId: string) {
  const current = store.adapterState(scopeId);
  const next = cloneScopeState(current);
  const affected = [...next.candidates.values()].filter((item) => item.importBatchIds.includes(importBatchId));
  const hasDownstreamReference = affected.some((item) => item.status !== "pending" || item.linkedTaskId !== null);
  if (hasDownstreamReference) {
    for (const item of affected) item.sourceState = "source_invalidated";
    for (const [evidenceId, evidence] of next.evidence) {
      if (evidence.importBatchId === importBatchId) {
        next.evidence.set(evidenceId, deepFreeze({ ...cloneValue(evidence), sourceState: "source_invalidated" }));
      }
    }
    updateImportResultState(next, importBatchId, "source_invalidated");
    store.replaceAdapterState(scopeId, next);
    return { status: "source_invalidated" as const, affectedCandidateIds: affected.map((item) => item.candidateId) };
  }

  for (const item of affected) {
    item.evidenceLinks = item.evidenceLinks.filter((link) => link.importBatchId !== importBatchId);
    item.evidenceSnapshotIds = item.evidenceLinks.map((link) => link.evidenceSnapshotId);
    item.importBatchIds = item.importBatchIds.filter((batchId) => batchId !== importBatchId);
    if (item.createdByImportBatchId === importBatchId && item.evidenceLinks.length === 0) {
      next.candidates.delete(item.productKey);
    }
  }
  const referencedEvidenceIds = new Set(
    [...next.candidates.values()].flatMap((candidate) => candidate.evidenceLinks.map((link) => link.evidenceSnapshotId)),
  );
  for (const [evidenceId, evidence] of next.evidence) {
    if (evidence.importBatchId === importBatchId && !referencedEvidenceIds.has(evidenceId)) next.evidence.delete(evidenceId);
  }
  updateImportResultState(next, importBatchId, "revoked");
  store.replaceAdapterState(scopeId, next);
  return { status: "revoked" as const, affectedCandidateIds: affected.map((item) => item.candidateId) };
}
