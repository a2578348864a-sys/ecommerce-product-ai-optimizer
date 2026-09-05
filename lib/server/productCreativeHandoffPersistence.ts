import "server-only";

import { createHash } from "node:crypto";

import type { AccessContext } from "@/lib/server/accessPassword";
import { mutateTaskResultJson } from "@/lib/server/taskResultJsonMutation";
import type { TaskResultJsonSnapshot, TaskResultJsonStorageVersionHash } from "@/lib/server/taskResultJsonMutation";
import {
  createProductCreativeHandoff,
  appendProductCreativeHandoffVersion,
  revokeProductCreativeHandoff,
  parseProductCreativeHandoff,
  type ProductCreativeHandoffV1,
  type ProductCreativeHandoffCandidate,
  type ProductCreativeHandoffConfirmedFact,
} from "@/lib/productCreativeHandoff";
import {
  appendRequestLedgerEntry,
  buildRequestKeyHash,
  buildRequestFingerprint,
  createEmptyRequestLedger,
  lookupRequestLedger,
  parseRequestLedger,
  type CreativeHandoffLedgerAction,
  type CreativeHandoffLedgerOutcomeKind,
  type CreativeHandoffRequestLedgerV1,
} from "@/lib/creativeHandoffRequestLedger";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import { resolveVisualReferenceSelectionIds, buildApprovedVisualReference } from "@/lib/server/visualReferenceCandidates";
import { parseCandidateResearchContext } from "@/lib/candidateResearchContext";
import { getFactCandidates } from "@/lib/factCandidates";
import { mapResearchConfirmedToHandoff } from "@/lib/canonicalFactMapping";
import { resolveAuthoritativeFactSnapshot } from "@/lib/productCreativeHandoffFactAuthority";
import { adaptResearchContextForHandoff } from "@/lib/server/researchContextAdapter";
import { loadCandidateSourceMeta } from "@/lib/server/candidateSourceMeta";
import {
  buildConfirmableCandidates,
  confirmSelectedProductFacts,
  type ConfirmableFactCandidate,
} from "@/lib/productCreativeHandoffConfirmation";
import {
  confirmManualProductFacts,
  type ManualFactInput,
} from "@/lib/server/manualFactConfirmation";

export class CreativeHandoffPersistenceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CreativeHandoffPersistenceError";
  }
}

export type CreateHandoffInput = {
  requestId: string;
  expectedResearchRevision: number;
  expectedCurrentHandoffRevision: number;
  expectedStorageVersion: TaskResultJsonStorageVersionHash;
  /** 浏览器提交的 confirmable selectionIds（服务端锁内重新投影后匹配） */
  selectedFactCandidateIds: string[];
  /** 零候选兜底：用户手工确认的商品事实（受控字段白名单，服务端构造 confirmedFact） */
  manualConfirmedFacts?: ManualFactInput[];
  /** V2 Final Integration: 浏览器提交的视觉参考候选 selectionIds（用户勾选「批准作为产品视觉参考」） */
  selectedVisualReferenceCandidateIds?: string[];
  /** 用户提交的创作偏好（含 additionalRequirements；仅影响表达/视觉风格，不作为商品事实） */
  creativePreferences?: Record<string, string>;
  /** Canonical fingerprint of the request payload (buildRequestFingerprint) */
  requestFingerprint: string;
};

export type RevokeHandoffInput = {
  requestId: string;
  revokeReasonCode: "explicit_user_revoke" | "decision_changed" | "identity_invalid" | "verification_invalid";
  expectedStorageVersion: TaskResultJsonStorageVersionHash;
};

function buildHandoffId(): string {
  // 必须满足合同 isUuid 格式（RFC 4122 v4）
  return crypto.randomUUID();
}

function subjectRefOf(context: AccessContext): { kind: "owner" | "visitor"; ref: string } {
  const ctxAny = context as unknown as Record<string, unknown>;
  if (context.mode === "owner") {
    return { kind: "owner", ref: (ctxAny.ownerRef as string) || "owner" };
  }
  return { kind: "visitor", ref: (ctxAny.demoAccessId as string) || "visitor" };
}

/** 16-hex 内部主体指纹（合同要求 ^[a-f0-9]{16}$），服务端派生，永不返回浏览器 */
function deriveSubjectFingerprint(subject: { kind: "owner" | "visitor"; ref: string }): string {
  const h = createHash("sha256").update(`subject-fingerprint:v1:${subject.kind}:${subject.ref}`).digest("hex");
  return h.slice(0, 16);
}

function actorOf(context: AccessContext): { mode: "owner" | "visitor"; subjectFingerprint: string } {
  const subject = subjectRefOf(context);
  return { mode: subject.kind, subjectFingerprint: deriveSubjectFingerprint(subject) };
}

/** 与 Preview 一致的 selectionId 编码（confirm 前缀 + 域分隔 SHA-256） */
function encodeConfirmSelectionId(
  actor: { mode: "owner" | "visitor"; subjectFingerprint: string },
  taskId: string,
  researchRevision: number,
  stableFactId: string,
): string {
  const canonical = JSON.stringify({
    schema: "creative-handoff-selection-id:v1",
    subjectKind: actor.mode,
    taskId,
    researchRevision,
    category: "confirm",
    contentFingerprint: stableFactId,
  });
  return `confirm:${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 24)}`;
}

/** 解析浏览器 selectionId → 匹配的候选（枚举最新候选重新计算匹配） */
function resolveConfirmSelectionIds(
  selectionIds: string[],
  actor: { mode: "owner" | "visitor"; subjectFingerprint: string },
  taskId: string,
  researchRevision: number,
  confirmables: ConfirmableFactCandidate[],
): string[] {
  const idToKey = new Map<string, string>();
  for (const candidate of confirmables) {
    idToKey.set(encodeConfirmSelectionId(actor, taskId, researchRevision, candidate.selectionKey), candidate.selectionKey);
  }
  const resolved: string[] = [];
  for (const selectionId of selectionIds) {
    const key = idToKey.get(selectionId);
    if (!key) return [];
    resolved.push(key);
  }
  return resolved;
}

/** 服务端确认引用：从 requestKeyHash 安全派生，不暴露 requestId */
function buildConfirmationReference(requestKeyHash: string, confirmedAt: string): string {
  const digest = createHash("sha256").update(`confirmation-ref:v1:${requestKeyHash}:${confirmedAt}`, "utf8").digest("hex");
  return `confirm:${digest.slice(0, 32)}`;
}

function normalizedFactValue(value: string | number | boolean | string[]): string {
  return String(value).normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

/**
 * 已确认事实是追加式事实账本：新版本继承旧事实，只允许补充尚未占用的 canonical field。
 * 同一 field 的来源候选与人工输入不得同时成为真值；同值重放不新增，不同值 fail-closed。
 * V3 Final PHASE 1：research 入参 = 研究侧已确认事实（factCandidates 权威）经 Canonical
 * Adapter 桥接而来；与 selected/manual 同一冲突语义（已有研究确认值 → 创作侧不得再填不同值）。
 */
export function mergeConfirmedProductFacts(input: {
  existing: ProductCreativeHandoffConfirmedFact[];
  selected: ProductCreativeHandoffConfirmedFact[];
  manual: ProductCreativeHandoffConfirmedFact[];
  research?: ProductCreativeHandoffConfirmedFact[];
}): ProductCreativeHandoffConfirmedFact[] {
  const selectedFields = new Set(input.selected.map((fact) => fact.field));
  const crossSourceConflict = input.manual.find((fact) => selectedFields.has(fact.field));
  if (crossSourceConflict) {
    throw new CreativeHandoffPersistenceError(
      "confirmed_fact_conflict",
      409,
      "同一商品事实存在来源候选与人工填写两个值，请选择一个后再确认。",
    );
  }

  const merged = [...input.existing];
  const byField = new Map(merged.map((fact) => [fact.field, fact]));
  for (const fact of [...input.selected, ...input.manual, ...(input.research ?? [])]) {
    const existing = byField.get(fact.field);
    if (!existing) {
      merged.push(fact);
      byField.set(fact.field, fact);
      continue;
    }
    if (normalizedFactValue(existing.value) === normalizedFactValue(fact.value)) continue;
    throw new CreativeHandoffPersistenceError(
      "confirmed_fact_conflict",
      409,
      `“${existing.label}”已有确认值，请保留一个真实值后再提交。`,
    );
  }
  return merged;
}

function readLedgerRaw(result: Readonly<Record<string, unknown>>): unknown {
  return result.creativeHandoffRequestLedger;
}

/**
 * Fail-closed 读取 Handoff：resultJson 中不存在 → null（未创建）；
 * 存在但严格 Parser 失败 → handoff_contract_invalid（不当作 null 覆盖）。
 */
function readHandoffOrThrow(
  result: Readonly<Record<string, unknown>>,
  taskId: string,
): ProductCreativeHandoffV1 | null {
  const raw = result.creativeHandoff;
  if (raw === undefined) return null;
  const parsed = parseProductCreativeHandoff(raw);
  if (!parsed) {
    throw new CreativeHandoffPersistenceError("handoff_contract_invalid", 500, "创作交接合同结构异常，已阻止覆盖。");
  }
  if (parsed.taskId !== taskId) {
    throw new CreativeHandoffPersistenceError("handoff_contract_invalid", 500, "创作交接任务绑定异常。");
  }
  return parsed;
}

function readLedgerOrThrow(result: Readonly<Record<string, unknown>>): CreativeHandoffRequestLedgerV1 {
  const raw = readLedgerRaw(result);
  if (raw === undefined) return createEmptyRequestLedger();
  const parsed = parseRequestLedger(raw);
  if (!parsed) {
    throw new CreativeHandoffPersistenceError("idempotency_ledger_invalid", 500, "幂等账本合同结构异常，已阻止写入。");
  }
  return parsed;
}

/**
 * storageVersion 比较（浏览器哈希格式）— 在 mutate 回调内、幂等查找之后执行。
 * 幂等重放命中 Ledger 时跳过本检查（Fix.2 第十节顺序：先 Ledger 后 expected）。
 */
function assertStorageVersionMatches(
  snapshot: TaskResultJsonSnapshot,
  expected: TaskResultJsonStorageVersionHash,
): void {
  const snapshotTime = snapshot.updatedAt instanceof Date ? snapshot.updatedAt.toISOString() : new Date(snapshot.updatedAt).toISOString();
  const expectedTime = expected.updatedAt instanceof Date ? expected.updatedAt.toISOString() : new Date(expected.updatedAt).toISOString();
  if (snapshotTime !== expectedTime) {
    throw new CreativeHandoffPersistenceError("task_result_conflict", 409, "任务已在其他页面更新，请刷新后重试。");
  }
  const hash = createHash("sha256").update(snapshot.resultJson, "utf8").digest("hex");
  if (hash !== expected.resultJsonHash) {
    throw new CreativeHandoffPersistenceError("task_result_conflict", 409, "任务已在其他页面更新，请刷新后重试。");
  }
}

// ─── Create / Append ─────────────────────────────────────

export async function createOrAppendCreativeHandoff(
  taskId: string,
  context: AccessContext,
  input: CreateHandoffInput,
): Promise<{ handoff: ProductCreativeHandoffV1; isNewRevision: boolean; idempotentReplay: boolean }> {
  const now = new Date().toISOString();
  const actor = actorOf(context);
  const handoffId = buildHandoffId();

  const requestKeyHash = buildRequestKeyHash({
    subjectKind: actor.mode,
    subjectRef: actor.subjectFingerprint,
    taskId,
    action: "create",
    requestId: input.requestId,
  });

  const result = await mutateTaskResultJson<{ handoff: ProductCreativeHandoffV1; isNewRevision: boolean; idempotentReplay: boolean }>({
    context,
    taskId,
    writer: "creative-handoff",
    // expectedStorageVersion 不在外层传入 — 幂等重放必须先命中 Ledger（第十节顺序），
    // storageVersion 校验在回调内、幂等查找之后执行（同一 CAS 快照内）
    async mutate(current, snapshot) {
      // ── 1) Fail-closed 读取 Handoff 与 Ledger（同一 CAS/lock 快照内）──
      const currentHandoff = readHandoffOrThrow(current, taskId);
      const ledger = readLedgerOrThrow(current);

      // ── 1b) Gate（幂等查找前也执行，因为 Gate 同时解析最新 Ledger 状态）──
      const gate = await checkCreativeHandoffGate(taskId, context);
      if (gate.handoffContractInvalid) {
        throw new CreativeHandoffPersistenceError("handoff_contract_invalid", 500, "创作交接合同结构异常，已阻止覆盖。");
      }
      if (gate.ledgerInvalid) {
        throw new CreativeHandoffPersistenceError("idempotency_ledger_invalid", 500, "幂等账本合同结构异常，已阻止写入。");
      }

      // ── 2) 幂等查找（先于 expected 版本校验，见 Fix.2 第十节顺序）──
      const lookup = lookupRequestLedger(ledger, requestKeyHash, input.requestFingerprint);

      if (lookup.kind === "replay") {
        // 验证 outcomeRevision 仍能在 Handoff 历史中找到
        const outcome = currentHandoff?.versions.find((v) => v.revision === lookup.entry.outcomeRevision);
        if (!outcome) {
          throw new CreativeHandoffPersistenceError("idempotency_outcome_missing", 409, "幂等结果已不存在，请重新发起请求。");
        }
        return {
          result: current as Record<string, unknown>,
          value: { handoff: currentHandoff as ProductCreativeHandoffV1, isNewRevision: false, idempotentReplay: true },
        };
      }
      if (lookup.kind === "conflict") {
        throw new CreativeHandoffPersistenceError("idempotency_conflict", 409, "相同请求ID但内容不同。");
      }
      if (lookup.kind === "outcome_missing") {
        throw new CreativeHandoffPersistenceError("idempotency_outcome_missing", 409, "幂等结果已不存在，请重新发起请求。");
      }

      // ── 2b) storageVersion 校验（幂等查找之后，新请求才执行）──
      assertStorageVersionMatches(snapshot, input.expectedStorageVersion);

      // ── 3) Gate（CAS/lock 内重执行）──
      if (gate.handoffContractInvalid) {
        throw new CreativeHandoffPersistenceError("handoff_contract_invalid", 500, "创作交接合同结构异常，已阻止覆盖。");
      }
      if (gate.ledgerInvalid) {
        throw new CreativeHandoffPersistenceError("idempotency_ledger_invalid", 500, "幂等账本合同结构异常，已阻止写入。");
      }
      // 无人工确认事实（no_confirmed_facts）→ 由输入候选的 confirmedFacts 决定；
      // 研究数据本身合法时允许走写入，Route 层已按选择过滤（无选择 → no_facts_selected）。
      if (!gate.allowed && gate.reason !== "no_confirmed_facts") {
        throw new CreativeHandoffPersistenceError("research_gate_failed", 422, "当前研究状态不允许创建创作交接。");
      }
      if (!gate.candidate) {
        throw new CreativeHandoffPersistenceError("research_gate_failed", 422, "当前研究状态不允许创建创作交接。");
      }
      // 锁内重新生成 confirmable 候选 → 匹配浏览器 selectionId → 服务端确认转换
      const gateCandidate = gate.candidate as ProductCreativeHandoffCandidate;
      const confirmables = buildConfirmableCandidates(gateCandidate.stableSourceFacts);
      const resolvedKeys = resolveConfirmSelectionIds(
        input.selectedFactCandidateIds,
        actor,
        taskId,
        gateCandidate.sourceResearch.researchRevision,
        confirmables,
      );
      if (resolvedKeys.length !== input.selectedFactCandidateIds.length) {
        throw new CreativeHandoffPersistenceError("invalid_selection", 400, "选择项与最新研究状态不匹配，请刷新后重试。");
      }
      // 零候选兜底：无候选 selectionId 时允许仅手工事实、纯视觉批准，或研究已确认事实（Research Human Confirmed Facts）；均不提供才拒绝
      const manualFacts = input.manualConfirmedFacts ?? [];
      const visualApprovalOnly = (input.selectedVisualReferenceCandidateIds ?? []).length > 0;
      const researchConfirmed = getFactCandidates(current)?.confirmed ?? [];
      const hasResearchConfirmed = researchConfirmed.length > 0;
      if (
        resolvedKeys.length < 1 &&
        manualFacts.length < 1 &&
        !visualApprovalOnly &&
        !hasResearchConfirmed
      ) {
        throw new CreativeHandoffPersistenceError("no_facts_selected", 400, "请至少选择一项或填写一项可用的商品事实。");
      }
      const conversion = confirmSelectedProductFacts({
        stableSourceFacts: gateCandidate.stableSourceFacts,
        confirmableCandidates: confirmables,
        selectedKeys: resolvedKeys,
        actor,
        confirmedAt: now,
        confirmationReference: buildConfirmationReference(requestKeyHash, now),
        candidateId: gateCandidate.sourceResearch.candidateId,
      });
      if (conversion.confirmedFacts.length !== resolvedKeys.length) {
        throw new CreativeHandoffPersistenceError("invalid_selection", 400, "部分选择项不可确认。");
      }
      // 手工事实确认（受控字段白名单；与候选确认同一 revision/CAS 原子写入）
      let manualConfirmed: Array<ReturnType<typeof confirmManualProductFacts>["confirmedFacts"][number]> = [];
      if (manualFacts.length > 0) {
        const manualResult = confirmManualProductFacts({
          facts: manualFacts,
          actor,
          confirmedAt: now,
          confirmationReference: buildConfirmationReference(requestKeyHash, now),
          candidateId: gateCandidate.sourceResearch.candidateId,
        });
        if (manualResult.rejected.length > 0) {
          throw new CreativeHandoffPersistenceError(
            "invalid_manual_fact",
            400,
            `手工事实无效: ${manualResult.rejected.map((r) => `${r.field}:${r.code}`).join(",")}`,
          );
        }
        manualConfirmed = manualResult.confirmedFacts;
      }
      // 跨层排他后的最终候选（候选确认 + 手工确认合并；手工确认的 field 同样从 stable 移除，
      // 满足 parseCandidate P1-3 跨层排他：confirmed 与 stable 不得共享 field）
      const manualConfirmedFields = new Set(manualConfirmed.map((f) => f.field));
      // 纯视觉参考批准 append（无新事实确认）时：继承当前 handoff 最新版本 confirmedFacts，
      // 否则 confirmedFacts 为空 → parseCandidate（≥1）失败
      const existingConfirmedFacts = currentHandoff && currentHandoff.versions.length > 0
        ? currentHandoff.versions[currentHandoff.versions.length - 1].confirmedFacts
        : [];
      // V3 Final PHASE 1：研究侧已确认事实（factCandidates 权威）经唯一 Canonical Adapter 桥接
      // ——已有 Confirmed Fact 自动进入 Listing 链，不再要求用户重复输入（SHARED_CONTRACT_FREEZE §8/§9）
      const researchBridge = researchConfirmed.length > 0
        ? mapResearchConfirmedToHandoff({
            confirmed: researchConfirmed,
            actor,
            candidateId: gateCandidate.sourceResearch.candidateId,
            confirmedAt: now,
          })
        : { facts: [], skipped: [] };
      // V4 Fact Authority：Human Confirmed Facts（研究侧 factCandidates）为当前事实唯一权威源。
      // 旧 handoff 快照值只作历史（previousSnapshot 在 research 未覆盖的 field 才继承），
      // 不与最新研究事实做覆盖竞争；本轮 stable 勾选撞 research field → 忽略（reference conflict）；
      // manual 撞 research field → manual_fact_research_authority（回研究修改）。不再抛 confirmed_fact_conflict。
      const effectiveConfirmed = resolveAuthoritativeFactSnapshot({
        previousSnapshot: existingConfirmedFacts,
        selected: conversion.confirmedFacts,
        manual: manualConfirmed,
        research: researchBridge.facts,
      }).facts;
      // 跨层排他：无论新确认或继承，stable 必须剔除 confirmed 已占用的 field
      const confirmedFieldSet = new Set(effectiveConfirmed.map((f) => f.field));
      const finalCandidate: ProductCreativeHandoffCandidate = {
        ...gateCandidate,
        confirmedFacts: effectiveConfirmed,
        stableSourceFacts: conversion.remainingStableSourceFacts
          .filter((f) => !manualConfirmedFields.has(f.field))
          .filter((f) => !confirmedFieldSet.has(f.field)),
      };

      // ── V2 Final Integration: 视觉参考批准（锁内重新解析候选 → 校验 → 写入 visualReferences）──
      // 用户勾选「批准作为产品视觉参考」时：服务器重新解析任务自有图片候选（selectionId 绑定
      // Task/Candidate/researchRevision/contentHash），校验仍属于当前 Task/Candidate/Revision，
      // 写入 identityBound=true + 批准主体/时间/引用。未选择时 visualReferences=[]（合法，仅 composition）。
      let approvedVisualReferences: ProductCreativeHandoffCandidate["visualReferences"] = [];
      const selectedVisualIds = input.selectedVisualReferenceCandidateIds ?? [];
      if (selectedVisualIds.length > 0) {
        const currentJson = current as Record<string, unknown>;
        const contextRaw = currentJson.candidateAnalysisContext;
        // V2 BLOCKER 修复：真实 save-task 写入 V1 格式，经 Adapter 转换（兼容格式原样通过）
        const candidateToTask = (currentJson.candidateToTask ?? {}) as Record<string, unknown>;
        const candidateSourceMetaForImage = await loadCandidateSourceMeta(context, typeof candidateToTask.candidateId === "string" ? candidateToTask.candidateId : null);
        const adaptedContext = contextRaw !== undefined
          ? adaptResearchContextForHandoff(currentJson, { candidateSourceMetaJson: candidateSourceMetaForImage })
          : null;
        const researchContext = adaptedContext?.ok === true ? adaptedContext.context : null;
        const resolvedVisuals = resolveVisualReferenceSelectionIds(
          selectedVisualIds,
          researchContext,
          actor.mode,
          taskId,
          input.expectedResearchRevision,
        );
        approvedVisualReferences = resolvedVisuals.map((resolved) => ({
          ...buildApprovedVisualReference({
            actor,
            resolved,
            approvedAt: now,
            confirmationReference: buildConfirmationReference(requestKeyHash, now),
          }),
          identityBound: true as const,
          humanApprovedForReference: true as const,
        }));
      }
      const finalCandidateWithVisuals: ProductCreativeHandoffCandidate = {
        ...finalCandidate,
        visualReferences: approvedVisualReferences,
      };

      // ── 创作偏好落地：合并用户提交的偏好（含 additionalRequirements）到候选 → 写入 Handoff 版本。
      // 仅影响表达/视觉风格，不作为商品事实；参与指纹与 Revision（指纹含 creativePreferences）。
      let finalCandidateWithPrefs = finalCandidateWithVisuals;
      if (input.creativePreferences && Object.keys(input.creativePreferences).length > 0) {
        finalCandidateWithPrefs = {
          ...finalCandidateWithVisuals,
          creativePreferences: {
            ...(finalCandidateWithVisuals.creativePreferences as Record<string, unknown>),
            ...input.creativePreferences,
          } as ProductCreativeHandoffCandidate["creativePreferences"],
        };
      }

      // 版本校验（用锁内最新投影）
      const gateRevision = gateCandidate.sourceResearch.researchRevision;
      if (input.expectedResearchRevision !== gateRevision) {
        throw new CreativeHandoffPersistenceError("research_revision_changed", 409, "研究数据已更新，请刷新后重新确认。");
      }

      // ── 4) expected Handoff revision 校验 ──
      if (currentHandoff && input.expectedCurrentHandoffRevision !== currentHandoff.currentRevision) {
        throw new CreativeHandoffPersistenceError("creative_handoff_conflict", 409, "创作交接已有新版本。");
      }
      if (!currentHandoff && input.expectedCurrentHandoffRevision !== 0) {
        throw new CreativeHandoffPersistenceError("creative_handoff_conflict", 409, "交接版本状态异常。");
      }

      // ── 5) Candidate 身份绑定（用锁内最新投影候选）──
      const effectiveCandidateId = gateCandidate.sourceResearch.candidateId;
      if (currentHandoff && currentHandoff.candidateId !== effectiveCandidateId) {
        throw new CreativeHandoffPersistenceError("candidate_identity_mismatch", 409, "候选人身份不匹配。");
      }

      // ── 6) Create / Append ──
      let handoff: ProductCreativeHandoffV1;
      let outcomeKind: CreativeHandoffLedgerOutcomeKind;
      if (!currentHandoff) {
        handoff = createProductCreativeHandoff({
          handoffId,
          taskId,
          candidateId: effectiveCandidateId,
          createdAt: now,
          createdBy: actor,
          candidate: finalCandidateWithPrefs,
        });
        outcomeKind = "created";
      } else {
        handoff = appendProductCreativeHandoffVersion({
          handoff: currentHandoff,
          createdAt: now,
          createdBy: actor,
          candidate: finalCandidateWithPrefs,
        });
        outcomeKind = "appended";
      }

      // ── 7) Ledger 条目（Handoff 与 Ledger 同一 result 内原子提交）──
      const nextLedger = appendRequestLedgerEntry(ledger, {
        requestKeyHash,
        requestFingerprint: input.requestFingerprint,
        action: "create",
        outcomeKind,
        outcomeRevision: handoff.currentRevision,
        recordedAt: now,
      });

      return {
        result: {
          ...current,
          creativeHandoff: handoff as unknown as Record<string, unknown>,
          creativeHandoffRequestLedger: nextLedger as unknown as Record<string, unknown>,
        },
        value: { handoff, isNewRevision: !currentHandoff, idempotentReplay: false },
      };
    },
  });

  return result.value;
}

// ─── Revoke ──────────────────────────────────────────────

export async function revokeCreativeHandoffAction(
  taskId: string,
  context: AccessContext,
  input: RevokeHandoffInput,
): Promise<{ handoff: ProductCreativeHandoffV1; idempotentReplay: boolean }> {
  const now = new Date().toISOString();
  const actor = actorOf(context);

  const requestKeyHash = buildRequestKeyHash({
    subjectKind: actor.mode,
    subjectRef: actor.subjectFingerprint,
    taskId,
    action: "revoke",
    requestId: input.requestId,
  });

  const result = await mutateTaskResultJson<{ handoff: ProductCreativeHandoffV1; idempotentReplay: boolean }>({
    context,
    taskId,
    writer: "creative-handoff",
    // 同上：幂等重放优先，storageVersion 在回调内校验
    async mutate(current, snapshot) {
      // ── 1) Fail-closed 读取 ──
      const currentHandoff = readHandoffOrThrow(current, taskId);
      const ledger = readLedgerOrThrow(current);
      if (!currentHandoff) {
        throw new CreativeHandoffPersistenceError("not_found", 404, "没有可撤回的创作交接。");
      }

      // ── 1b) Gate（fail-closed + 最新 Ledger 状态）──
      const gate = await checkCreativeHandoffGate(taskId, context);
      if (gate.handoffContractInvalid) {
        throw new CreativeHandoffPersistenceError("handoff_contract_invalid", 500, "创作交接合同结构异常，已阻止撤回。");
      }
      if (gate.ledgerInvalid) {
        throw new CreativeHandoffPersistenceError("idempotency_ledger_invalid", 500, "幂等账本合同结构异常，已阻止写入。");
      }

      // ── 2) 幂等查找（先于其它校验）──
      const requestFingerprint = buildRequestFingerprint({
        action: "revoke",
        revokeReasonCode: input.revokeReasonCode,
        expectedStorageVersion: input.expectedStorageVersion,
        expectedCurrentHandoffRevision: currentHandoff.currentRevision,
      });
      const lookup = lookupRequestLedger(ledger, requestKeyHash, requestFingerprint);

      if (lookup.kind === "replay") {
        return {
          result: current as Record<string, unknown>,
          value: { handoff: currentHandoff, idempotentReplay: true },
        };
      }
      if (lookup.kind === "conflict") {
        throw new CreativeHandoffPersistenceError("idempotency_conflict", 409, "相同请求ID但撤回原因不同。");
      }
      if (lookup.kind === "outcome_missing") {
        throw new CreativeHandoffPersistenceError("idempotency_outcome_missing", 409, "幂等结果已不存在，请重新发起请求。");
      }

      // ── 2b) storageVersion 校验（新请求才执行）──
      assertStorageVersionMatches(snapshot, input.expectedStorageVersion);

      // ── 4) 已撤回状态（不同 requestId）→ 稳定业务结果，不伪造重放 ──
      if (currentHandoff.controlState !== "active") {
        throw new CreativeHandoffPersistenceError("already_revoked", 409, "创作交接已撤回。");
      }

      // ── 5) Revoke ──
      const revoked = revokeProductCreativeHandoff(currentHandoff, {
        revokedAt: now,
        reasonCode: input.revokeReasonCode,
      });

      // ── 6) Ledger 条目 ──
      const nextLedger = appendRequestLedgerEntry(ledger, {
        requestKeyHash,
        requestFingerprint,
        action: "revoke",
        outcomeKind: "revoked",
        outcomeRevision: currentHandoff.currentRevision,
        recordedAt: now,
      });

      return {
        result: {
          ...current,
          creativeHandoff: revoked as unknown as Record<string, unknown>,
          creativeHandoffRequestLedger: nextLedger as unknown as Record<string, unknown>,
        },
        value: { handoff: revoked, idempotentReplay: false },
      };
    },
  });

  return result.value;
}
