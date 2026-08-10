import { createHash } from "node:crypto";
import type {
  ProductCreativeHandoffConfirmedFact,
  ProductCreativeHandoffInternalActor,
} from "@/lib/productCreativeHandoff";

/**
 * 零候选兜底：用户手工确认商品事实（listing 用途）。
 *
 * 安全原则（与 confirmSelectedProductFacts 同构，不放开 Claim Evidence）：
 * - field 必须是受控白名单（8 个商品事实字段），禁止市场信号/内部字段
 * - value 非空、规范化、限长；浏览器不得提交 factId/sourceRef/主体/时间
 * - 服务端构造 confirmedFact：evidenceTier=human_confirmed、
 *   sourceRef.sourceKind=user_confirmation、usageScopes=[internal, listing]
 * - 时间与确认引用由外层服务传入（与候选确认一致）
 * - 纯函数：无 DB/文件/网络/env/随机；同输入同输出
 */

export const MANUAL_FACT_FIELDS = Object.freeze({
  brand: "品牌",
  product_type: "商品类型",
  series_or_model: "系列/型号",
  material: "材质",
  capacity: "容量",
  color_or_variant: "颜色/款式",
  quantity_or_pack_size: "数量/包装",
  functional_feature: "功能特性",
  usage: "使用场景",
  care: "清洁保养",
  construction: "构造/做工",
  included_components: "随附组件",
  operation: "操作方式",
  compatibility: "兼容性",
  other: "其他确定商品事实",
} as const);

export type ManualFactField = keyof typeof MANUAL_FACT_FIELDS;

const MAX_VALUE_LENGTH = 200;

export type ManualFactInput = {
  field: ManualFactField;
  value: string;
};

export type ManualFactConfirmationInput = {
  facts: ManualFactInput[];
  actor: ProductCreativeHandoffInternalActor;
  confirmedAt: string;
  confirmationReference: string;
  candidateId: string;
};

export type ManualFactConfirmationOutput = {
  confirmedFacts: ProductCreativeHandoffConfirmedFact[];
  rejected: { field: string; code: string }[];
};

export function isManualFactField(value: unknown): value is ManualFactField {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MANUAL_FACT_FIELDS, value);
}

export function normalizeManualFactValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, MAX_VALUE_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuidV4FromSeed(seed: string, salt: string): string {
  const digest = createHash("sha256").update(`${salt}:${seed}`, "utf8").digest("hex");
  const hex = digest.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

/**
 * 构造手工确认事实（evidenceTier=human_confirmed, user_confirmation, listing scope）。
 * 非法 field / 空 value 拒绝；重复 field 拒绝。
 */
export function confirmManualProductFacts(input: ManualFactConfirmationInput): ManualFactConfirmationOutput {
  if (!isRecord(input.actor) || typeof input.actor.mode !== "string" || typeof input.actor.subjectFingerprint !== "string") {
    throw new Error("manual_fact_invalid_actor");
  }
  if (typeof input.confirmedAt !== "string" || Number.isNaN(Date.parse(input.confirmedAt))) {
    throw new Error("manual_fact_invalid_confirmed_at");
  }
  if (typeof input.confirmationReference !== "string" || !input.confirmationReference.trim() || input.confirmationReference.length > 240) {
    throw new Error("manual_fact_invalid_confirmation_reference");
  }

  const seenFields = new Set<string>();
  const seenOtherValues = new Set<string>();
  const confirmedFacts: ProductCreativeHandoffConfirmedFact[] = [];
  const rejected: ManualFactConfirmationOutput["rejected"] = [];

  for (const fact of input.facts) {
    if (!isRecord(fact) || !isManualFactField(fact.field)) {
      rejected.push({ field: String((fact as { field?: unknown })?.field ?? "unknown"), code: "invalid_field" });
      continue;
    }
    // Quality.1：other 字段承载多个功能/其他事实（factId 按值派生，天然区分）；
    // 非 other 字段仍按字段去重。
    if (fact.field !== "other" && seenFields.has(fact.field)) {
      rejected.push({ field: fact.field, code: "duplicate_field" });
      continue;
    }
    seenFields.add(fact.field);
    const value = normalizeManualFactValue(fact.value);
    if (!value) {
      rejected.push({ field: fact.field, code: "empty_value" });
      continue;
    }
    if (fact.field === "other" && seenOtherValues.has(value)) {
      rejected.push({ field: fact.field, code: "duplicate_value" });
      continue;
    }
    if (fact.field === "other") seenOtherValues.add(value);
    const field = fact.field;
    const factId = uuidV4FromSeed(
      `manual-confirmed:${input.candidateId}:${field}:${value}:${input.confirmedAt}`,
      "manual-confirmed-fact-v1",
    );
    confirmedFacts.push({
      factId,
      field,
      label: MANUAL_FACT_FIELDS[field],
      value,
      evidenceTier: "human_confirmed",
      usageScopes: ["internal", "listing"],
      sourceRef: {
        sourceKind: "user_confirmation",
        sourceField: field,
        confirmedBy: input.actor,
        confirmedAt: input.confirmedAt,
        confirmationReference: input.confirmationReference,
      },
      confirmedAt: input.confirmedAt,
      confirmedBy: input.actor,
    });
  }

  return { confirmedFacts, rejected };
}
