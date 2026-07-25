/**
 * Phase 3F Reset-A2-2A — Bound Backend implementations for A2-1 write service.
 *
 * Owner backend: operates within a Prisma transaction (caller provides tx).
 * Visitor backend: operates on a single Sandbox JSON snapshot.
 *
 * Neither backend re-implements Target Contract C — all business rules
 * remain solely in planLegacyCandidateWriteBatch / executeLegacyCandidateWrite.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeCandidateIdentity } from "@/lib/server/candidateSourceSave";
import type { ExistingLegacyCandidate } from "@/lib/server/legacyCandidateWriteTypes";
import type { LegacyCandidateWriteDecision } from "@/lib/server/legacyCandidateWriteTypes";
import type { LegacyCandidateWriteResult } from "@/lib/server/legacyCandidateWriteTypes";
import type { LegacyCandidateWriteResultItem } from "@/lib/server/legacyCandidateWriteTypes";
import type { BoundLegacyCandidateWriteBackend } from "@/lib/server/legacyCandidateWriteTypes";
import { loadDemoSandboxStore, saveDemoSandboxStore } from "@/lib/server/demoSandbox";
import type { SandboxCandidate } from "@/lib/server/demoSandbox";
import { parseStoredCandidateSourceMeta } from "@/lib/server/candidateSourceSave";

// ── Helpers ──────────────────────────────────────

function detectSourceIntegrity(sourceMetaJson: string): ExistingLegacyCandidate["sourceIntegrity"] {
  const meta = parseStoredCandidateSourceMeta(sourceMetaJson);
  return meta.integrity === "signed_source_v2" ? "signed_source_v2" : "legacy_unverified";
}

function generateOwnerCandidateId(): string {
  return `candidate_${createHash("sha256").update(randomUUID()).digest("hex").slice(0, 12)}`;
}

function generateSandboxCandidateId(): string {
  return `sandbox_candidate_${createHash("sha256").update(randomUUID()).digest("hex").slice(0, 12)}`;
}

// ── Owner Backend ────────────────────────────────

type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export function createOwnerLegacyWriteBackend(
  tx: PrismaTx,
): BoundLegacyCandidateWriteBackend {
  return {
    async loadByIdentityKeys(identityKeys) {
      const allRecords = await tx.opportunityCandidate.findMany({
        select: {
          id: true,
          name: true,
          status: true,
          convertedTaskId: true,
          sourceMetaJson: true,
          score: true,
          rawInput: true,
          link: true,
          source: true,
          keyword: true,
          riskLevel: true,
          riskLabel: true,
          summaryLabel: true,
        },
      });

      const map = new Map<string, ExistingLegacyCandidate[]>();
      for (const record of allRecords) {
        const identity = normalizeCandidateIdentity(record.name);
        if (!map.has(identity)) map.set(identity, []);
        map.get(identity)!.push({
          id: record.id,
          name: record.name,
          status: record.status,
          convertedTaskId: record.convertedTaskId,
          sourceIntegrity: detectSourceIntegrity(record.sourceMetaJson),
          mutableFingerprint: computeLegacyFingerprintFromRecord(record),
        });
      }

      // Filter to only requested keys
      const result = new Map<string, readonly ExistingLegacyCandidate[]>();
      for (const key of identityKeys) {
        const records = map.get(key);
        if (records && records.length > 0) result.set(key, records);
      }
      return result;
    },

    async commitPlan(plan) {
      const items: LegacyCandidateWriteResultItem[] = [];
      let created = 0;
      let updated = 0;
      let unchanged = 0;

      for (const decision of plan) {
        if (decision.kind === "unchanged") {
          unchanged++;
          items.push({
            decision: "unchanged",
            identityKey: normalizeCandidateIdentity(""),
            candidateId: decision.candidateId,
          });
          continue;
        }

        const input = decision.input;
        const sourceMetaJson = JSON.stringify({
          integrity: "legacy_unverified",
          version: "candidate-source-legacy-v1",
        });
        const now = new Date();

        if (decision.kind === "update") {
          await tx.opportunityCandidate.update({
            where: { id: decision.candidateId },
            data: {
              score: clampScore(input.score),
              rawInput: input.rawInput,
              link: input.link,
              source: input.source,
              keyword: input.keyword,
              riskLevel: input.riskLevel,
              riskLabel: input.riskLabel,
              summaryLabel: input.summaryLabel,
              sourceMetaJson,
              status: "pending",
              lastActionAt: now,
              updatedAt: now,
            },
          });
          updated++;
          items.push({
            decision: "updated",
            identityKey: normalizeCandidateIdentity(input.name),
            candidateId: decision.candidateId,
          });
        } else {
          // create
          const id = generateOwnerCandidateId();
          await tx.opportunityCandidate.create({
            data: {
              id,
              name: input.name,
              rawInput: input.rawInput,
              link: input.link,
              score: clampScore(input.score),
              source: input.source,
              keyword: input.keyword,
              riskLevel: input.riskLevel,
              riskLabel: input.riskLabel,
              summaryLabel: input.summaryLabel,
              sourceMetaJson,
              analysisJson: "{}",
              status: "pending",
              convertedTaskId: null,
              lastActionAt: now,
            },
          });
          created++;
          items.push({
            decision: "created",
            identityKey: decision.identityKey,
            candidateId: id,
          });
        }
      }

      return { created, updated, unchanged, items };
    },
  };
}

// ── Visitor Backend ──────────────────────────────

export function createVisitorLegacyWriteBackend(
  demoAccessId: string,
  snapshot: SandboxCandidate[],
  onCommit: (updatedCandidates: SandboxCandidate[]) => void,
): BoundLegacyCandidateWriteBackend {
  // Build initial identity index from snapshot
  const identityIndex = new Map<string, SandboxCandidate[]>();
  for (const c of snapshot) {
    if (c.demoAccessId !== demoAccessId) continue;
    const key = normalizeCandidateIdentity(c.name);
    if (!identityIndex.has(key)) identityIndex.set(key, []);
    identityIndex.get(key)!.push(c);
  }

  let committed = false;

  return {
    async loadByIdentityKeys(identityKeys) {
      const result = new Map<string, readonly ExistingLegacyCandidate[]>();
      for (const key of identityKeys) {
        const matches = identityIndex.get(key);
        if (!matches || matches.length === 0) continue;
        result.set(key, matches.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          convertedTaskId: c.convertedTaskId ?? null,
          sourceIntegrity: detectSourceIntegrity(c.sourceMetaJson),
          mutableFingerprint: computeLegacyFingerprintFromSandboxCandidate(c),
        })));
      }
      return result;
    },

    async commitPlan(plan) {
      if (committed) {
        throw new Error("Visitor Backend: commitPlan already called — single-shot contract violated.");
      }
      committed = true;

      const items: LegacyCandidateWriteResultItem[] = [];
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      const now = new Date().toISOString();

      for (const decision of plan) {
        if (decision.kind === "unchanged") {
          unchanged++;
          items.push({ decision: "unchanged", identityKey: normalizeCandidateIdentity(""), candidateId: decision.candidateId });
          continue;
        }

        const input = decision.input;
        const sourceMetaJson = JSON.stringify({ integrity: "legacy_unverified" });

        if (decision.kind === "update") {
          const idx = snapshot.findIndex((c) => c.id === decision.candidateId && c.demoAccessId === demoAccessId);
          if (idx === -1) throw new Error(`Visitor Backend: update target ${decision.candidateId} not found.`);
          snapshot[idx] = {
            ...snapshot[idx],
            name: input.name,
            rawInput: input.rawInput,
            link: input.link,
            score: input.score,
            source: input.source,
            keyword: input.keyword,
            riskLevel: input.riskLevel,
            riskLabel: input.riskLabel,
            summaryLabel: input.summaryLabel,
            sourceMetaJson,
            status: "pending",
            lastActionAt: null,
          };
          updated++;
          items.push({ decision: "updated", identityKey: normalizeCandidateIdentity(input.name), candidateId: decision.candidateId });
        } else {
          // create
          const id = generateSandboxCandidateId();
          snapshot.push({
            id,
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
            sourceMetaJson,
            analysisJson: "{}",
            createdAt: now,
            convertedTaskId: null,
            lastActionAt: null,
          });
          created++;
          items.push({ decision: "created", identityKey: decision.identityKey, candidateId: id });
        }
      }

      // Publish once
      onCommit(snapshot);

      return { created, updated, unchanged, items };
    },
  };
}

// ── Fingerprint helpers (read-only, no duplicate of A2-1 rules) ──

const MUTABLE_FIELDS = ["score", "rawInput", "link", "source", "keyword", "riskLevel", "riskLabel", "summaryLabel"] as const;

function computeLegacyFingerprintFromRecord(record: {
  score: number;
  rawInput: string;
  link: string | null;
  source: string;
  keyword: string;
  riskLevel: string;
  riskLabel: string;
  summaryLabel: string;
}): string {
  return computeLegacyFingerprint(record);
}

function computeLegacyFingerprintFromSandboxCandidate(c: SandboxCandidate): string {
  return computeLegacyFingerprint(c as unknown as Record<string, unknown>);
}

function computeLegacyFingerprint(data: Record<string, unknown>): string {
  const canonical: unknown[] = MUTABLE_FIELDS.map((field) => {
    const value = data[field];
    if (value === null || value === undefined) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    }
    return value;
  });
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}
