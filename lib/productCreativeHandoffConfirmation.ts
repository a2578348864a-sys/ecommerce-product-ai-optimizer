import { createHash } from "node:crypto";
import type {
  ProductCreativeHandoffConfirmedFact,
  ProductCreativeHandoffInternalActor,
  ProductCreativeHandoffStableSourceFact,
} from "@/lib/productCreativeHandoff";

/**
 * Creative Handoff 服务端事实确认转换模块（Fix.4）
 *
 * 职责：浏览器只能提交 selectionId；服务端在锁内重新投影后，
 * 将用户选中的合法 confirmable 候选转换为符合 PR2-0 合同的 confirmedFacts。
 *
 * 边界：
 * - 浏览器不得提供事实值/field/SourceReference/确认主体/确认时间/确认引用
 * - 来源快照/AI 内容永不自动升级（由候选资格门禁保证）
 * - 选中的 field 从 stableSourceFacts 移除（跨层排他）
 * - 原始来源追溯通过 sourceField + confirmationReference 保留
 *
 * 纯函数：无 DB/文件/网络/env/Date.now/随机；不修改输入；同输入同输出。
 * 时间和确认引用必须由外层服务传入。
 */

export type ConfirmableFactCandidate = {
  selectionKey: string; // stable fact 的 factId（确定性）
  field: string;
  label: string;
  value: string | number | boolean | string[];
  sourceKind: string; // 原始来源类型（candidate_snapshot 等）
  capturedAt: string;
  stabilityRule: "identity_only" | "routing_only" | "human_confirmation_required_for_claim";
  allowedUsageScopes: Array<"listing" | "image" | "internal">;
};

export type ConfirmationInput = {
  stableSourceFacts: ProductCreativeHandoffStableSourceFact[];
  confirmableCandidates: ConfirmableFactCandidate[];
  selectedKeys: string[];
  actor: ProductCreativeHandoffInternalActor;
  confirmedAt: string;
  confirmationReference: string;
  /** 服务端允许的用途范围（默认 internal + listing） */
  allowedUsageScopes?: Array<"listing" | "image" | "internal">;
  /** 用于 factId 确定性派生的候选作用域 */
  candidateId: string;
};

export type ConfirmationOutput = {
  confirmedFacts: ProductCreativeHandoffConfirmedFact[];
  remainingStableSourceFacts: ProductCreativeHandoffStableSourceFact[];
  selected: ConfirmableFactCandidate[];
  rejected: { selectionKey: string; code: string }[];
  audit: { confirmedFields: string[]; retainedStableFields: string[] };
};

export class ConfirmationConversionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ConfirmationConversionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalField(field: string): string {
  return field.normalize("NFC").trim();
}

function uuidV4FromSeed(seed: string, salt: string): string {
  const digest = createHash("sha256").update(`${salt}:${seed}`, "utf8").digest("hex");
  const hex = digest.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

/**
 * 从最新投影的 stable source facts 生成 confirmableFactCandidates。
 * 只有 human_confirmation_required_for_claim 的 stable facts 可确认；
 * AI/unknown/conflict/blocking 永不进入（它们不在 stable 层）。
 */
export function buildConfirmableCandidates(
  stableSourceFacts: ProductCreativeHandoffStableSourceFact[],
): ConfirmableFactCandidate[] {
  const out: ConfirmableFactCandidate[] = [];
  for (const stable of stableSourceFacts) {
    if (stable.stabilityRule !== "human_confirmation_required_for_claim") continue;
    if (stable.evidenceTier !== "source_snapshot") continue;
    const sourceKind = stable.sourceRef.sourceKind;
    const capturedAt = "capturedAt" in stable.sourceRef ? stable.sourceRef.capturedAt : "";
    if (!capturedAt) continue;
    out.push({
      selectionKey: stable.factId,
      field: stable.field,
      label: stable.label,
      value: stable.value,
      sourceKind,
      capturedAt,
      stabilityRule: stable.stabilityRule,
      // V2.1.2：factCategory 决定确认后的用途范围——
      // product_fact → internal + listing + image（共享商品事实，Listing 与 Image 共同消费）；
      // market_signal（价格/评分/评论/类目）→ 仅 internal
      allowedUsageScopes: stable.factCategory === "market_signal" ? ["internal"] : ["internal", "listing", "image"],
    });
  }
  return out;
}

/**
 * 服务端确认转换：选中的候选 → confirmedFacts；同 field 从 stable 层移除。
 */
export function confirmSelectedProductFacts(input: ConfirmationInput): ConfirmationOutput {
  const { stableSourceFacts, confirmableCandidates, selectedKeys, actor, confirmedAt, confirmationReference, candidateId } = input;
  const allowedScopes = input.allowedUsageScopes ?? (["internal", "listing", "image"] as const);

  // 1) 校验输入不变量
  if (!Array.isArray(selectedKeys) || new Set(selectedKeys).size !== selectedKeys.length) {
    throw new ConfirmationConversionError("duplicate_selection", "选择项重复。");
  }
  if (!isRecord(actor) || typeof actor.mode !== "string" || typeof actor.subjectFingerprint !== "string") {
    throw new ConfirmationConversionError("invalid_actor", "服务端主体无效。");
  }
  if (typeof confirmedAt !== "string" || Number.isNaN(Date.parse(confirmedAt))) {
    throw new ConfirmationConversionError("invalid_confirmed_at", "确认时间无效。");
  }
  if (typeof confirmationReference !== "string" || !confirmationReference.trim() || confirmationReference.length > 240) {
    throw new ConfirmationConversionError("invalid_confirmation_reference", "确认引用无效。");
  }

  // 2) 建立查找表
  const candidateByKey = new Map(confirmableCandidates.map((c) => [c.selectionKey, c]));
  // 同 field 多候选：按 factId 精确匹配 stable 事实（不因 field 覆盖导致 value_mismatch 误判）
  const stableByKey = new Map(stableSourceFacts.map((f) => [f.factId, f]));
  const stableByField = new Map(stableSourceFacts.map((f) => [canonicalField(f.field), f]));

  // 3) 校验每个选择
  const selected: ConfirmableFactCandidate[] = [];
  const rejected: ConfirmationOutput["rejected"] = [];
  for (const key of selectedKeys) {
    const confirmable = candidateByKey.get(key);
    if (!confirmable) {
      rejected.push({ selectionKey: key, code: "not_confirmable" });
      continue;
    }
    if (confirmable.stabilityRule !== "human_confirmation_required_for_claim") {
      rejected.push({ selectionKey: key, code: "not_confirmable_rule" });
      continue;
    }
    const field = canonicalField(confirmable.field);
    const stableSameField = stableByKey.get(confirmable.selectionKey) ?? stableByField.get(field);
    if (!stableSameField) {
      rejected.push({ selectionKey: key, code: "field_not_in_stable" });
      continue;
    }
    if (JSON.stringify(confirmable.value) !== JSON.stringify(stableSameField.value)) {
      rejected.push({ selectionKey: key, code: "value_mismatch" });
      continue;
    }
    const requestedScopes = confirmable.allowedUsageScopes.filter((s) => (allowedScopes as readonly string[]).includes(s));
    if (requestedScopes.length < 1) {
      rejected.push({ selectionKey: key, code: "usage_scope_denied" });
      continue;
    }
    selected.push(confirmable);
  }

  if (selected.length !== selectedKeys.length) {
    throw new ConfirmationConversionError(
      "invalid_selection",
      `部分选择项不可确认: ${rejected.map((r) => r.selectionKey).join(",")}`,
    );
  }

  // 4) 生成 confirmedFacts（服务端主体/时间/引用；原始来源经 sourceField + confirmationReference 追溯）
  const confirmedFacts: ProductCreativeHandoffConfirmedFact[] = selected.map((confirmable) => {
    const field = canonicalField(confirmable.field);
    const factId = uuidV4FromSeed(
      `confirmed:${candidateId}:${field}:${JSON.stringify(confirmable.value)}:${confirmedAt}`,
      "confirmed-fact-v1",
    );
    return {
      factId,
      field,
      label: confirmable.label,
      value: confirmable.value,
      evidenceTier: "human_confirmed",
      usageScopes: confirmable.allowedUsageScopes.filter((s) => (allowedScopes as readonly string[]).includes(s)) as Array<"listing" | "image" | "internal">,
      sourceRef: {
        sourceKind: "user_confirmation",
        sourceField: confirmable.sourceKind === "candidate_snapshot" ? field : field,
        confirmedBy: actor,
        confirmedAt,
        confirmationReference,
      },
      confirmedAt,
      confirmedBy: actor,
    };
  });

  // 5) 跨层排他：选中 field 从 stable 移除
  const confirmedFields = new Set(confirmedFacts.map((f) => canonicalField(f.field)));
  const remainingStableSourceFacts = stableSourceFacts.filter(
    (f) => !confirmedFields.has(canonicalField(f.field)),
  );

  return {
    confirmedFacts,
    remainingStableSourceFacts,
    selected,
    rejected,
    audit: {
      confirmedFields: [...confirmedFields],
      retainedStableFields: remainingStableSourceFacts.map((f) => f.field),
    },
  };
}
