/**
 * Fact Authority — Human Confirmed Facts（研究侧 factCandidates.confirmed）唯一权威源。
 *
 * 语义收口（2026-09）：Creative Handoff confirmedFacts 降级为「当次创作实际使用快照」：
 * - 新快照以「当前研究侧人工确认事实」为权威输入，直接写入本次 handoff snapshot；
 * - 旧 handoff 快照值只保留在旧版本中（历史/审计），不参与与最新研究事实的覆盖竞争；
 * - 本轮勾选的 stable 快照候选若与权威 field 同 field → 忽略（reference conflict），不进入事实层；
 * - 本轮手工补充若撞权威 field → 抛错引导回商品研究修改（研究侧已确认的事实不允许创作侧覆盖）；
 * - 研究未覆盖的旧快照字段照常继承（避免丢失此前 Listing/Image 手工补充事实）。
 *
 * 纯函数：无 DB/文件/网络/env/Date.now/随机；不修改输入；同输入同输出。
 */

import type { ProductCreativeHandoffConfirmedFact } from "@/lib/productCreativeHandoff";

export type FactAuthorityReferenceValue = { field: string; label: string; value: string | number | boolean | string[] };

export type ReferenceConflict = {
  field: string;
  label: string;
  confirmedValue: string | number | boolean | string[];
  referenceValue: string | number | boolean | string[];
  resolution: "use_confirmed_fact";
};

export type DroppedOverride = { field: string; label: string; value: string | number | boolean | string[] };

export class FactAuthorityError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FactAuthorityError";
  }
}

export function normalizedFactText(value: string | number | boolean | string[]): string {
  const raw = Array.isArray(value) ? value.join(",") : String(value);
  return raw.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function canonicalField(field: string): string {
  return field.normalize("NFC").trim();
}

/**
 * 权威快照解析：research（研究侧当前人工确认）在同 field 上覆盖 previousSnapshot 与 selected；
 * previousSnapshot 仅在 research 未覆盖的 field 继承；selected/manual 只补充 research 未覆盖的 field。
 *
 * - selected 撞 research field → 忽略并记入 droppedOverrides（不抛错；参考冲突不阻断视觉确认）；
 * - manual 撞 research field → 抛 manual_fact_research_authority（409，引导返回商品研究修改）；
 * - manual 与 selected 同 field（同一请求双来源）→ 抛 confirmed_fact_conflict（409，沿用旧跨源语义）；
 * - manual/selected 撞 research 未覆盖的 previousSnapshot 同 field 且值不同 → 抛 confirmed_fact_conflict
 *   （历史真值 vs 本轮新值二义性，宁可直接要求用户走研究/确认流，不静默覆盖）。
 */
export function resolveAuthoritativeFactSnapshot(input: {
  previousSnapshot: ProductCreativeHandoffConfirmedFact[];
  research: ProductCreativeHandoffConfirmedFact[];
  selected: ProductCreativeHandoffConfirmedFact[];
  manual: ProductCreativeHandoffConfirmedFact[];
}): { facts: ProductCreativeHandoffConfirmedFact[]; droppedOverrides: DroppedOverride[] } {
  const { previousSnapshot = [], research = [], selected = [], manual = [] } = input;
  const droppedOverrides: DroppedOverride[] = [];

  // research 权威按 field 唯一（保留同 field 最后一个，杜绝重复）
  const researchByField = new Map<string, ProductCreativeHandoffConfirmedFact>();
  for (const fact of research) researchByField.set(canonicalField(fact.field), fact);
  const researchFields = new Set(researchByField.keys());

  // manual × selected 跨源同 field（同一请求内双来源）→ 409
  const selectedFields = new Set(selected.map((f) => canonicalField(f.field)));
  for (const fact of manual) {
    if (selectedFields.has(canonicalField(fact.field))) {
      throw new FactAuthorityError(
        "confirmed_fact_conflict",
        409,
        "同一商品事实存在来源候选与人工填写两个值，请选择一个后再确认。",
      );
    }
  }

  const facts: ProductCreativeHandoffConfirmedFact[] = [];
  const factMap = new Map<string, ProductCreativeHandoffConfirmedFact>();

  const pushIfAbsent = (fact: ProductCreativeHandoffConfirmedFact): "added" | "same" | "different" => {
    const field = canonicalField(fact.field);
    const existing = factMap.get(field);
    if (!existing) {
      facts.push(fact);
      factMap.set(field, fact);
      return "added";
    }
    return normalizedFactText(existing.value) === normalizedFactText(fact.value) ? "same" : "different";
  };

  // 1) previousSnapshot 继承（仅 research 未覆盖的 field；且该旧值必须具 user_confirmation 人为确认
  //    provenance —— Studio-confirmed supplemental fact。无法证明人为确认的快照值不得自动继承。
  for (const fact of previousSnapshot) {
    const field = canonicalField(fact.field);
    if (researchFields.has(field)) {
      droppedOverrides.push({ field, label: fact.label, value: fact.value });
      continue;
    }
    const provenance = fact.sourceRef?.sourceKind;
    if (provenance !== "user_confirmation") {
      // 无可靠人为确认 provenance → 不继承到当前创作输入（只留历史快照）
      continue;
    }
    pushIfAbsent(fact);
  }

  // 2) selected（本轮 stable 确认；research 覆盖的 field 忽略为 reference conflict）
  for (const fact of selected) {
    const field = canonicalField(fact.field);
    if (researchFields.has(field)) {
      droppedOverrides.push({ field, label: fact.label, value: fact.value });
      continue;
    }
    const result = pushIfAbsent(fact);
    if (result === "different") {
      throw new FactAuthorityError(
        "confirmed_fact_conflict",
        409,
        `“${fact.label}”已有确认值，请保留一个真实值后再提交。`,
      );
    }
  }

  // 3) manual（research 已确认的 field 不允许创作侧覆盖）
  for (const fact of manual) {
    const field = canonicalField(fact.field);
    if (researchFields.has(field)) {
      throw new FactAuthorityError(
        "manual_fact_research_authority",
        409,
        `“${fact.label}”已被商品研究人工确认。创作侧不修改已确认事实；如需修改请返回商品研究，修改并重新人工确认后回来继续。`,
      );
    }
    const result = pushIfAbsent(fact);
    if (result === "different") {
      throw new FactAuthorityError(
        "confirmed_fact_conflict",
        409,
        `“${fact.label}”已有确认值，请保留一个真实值后再提交。`,
      );
    }
  }

  // 4) research 权威事实（无论顺序如何最终占据同 field）
  for (const fact of researchByField.values()) {
    const existing = factMap.get(canonicalField(fact.field));
    if (existing && normalizedFactText(existing.value) !== normalizedFactText(fact.value)) {
      droppedOverrides.push({ field: canonicalField(fact.field), label: existing.label, value: existing.value });
      const index = facts.indexOf(existing);
      facts.splice(index, 1);
    }
    if (!factMap.has(canonicalField(fact.field))) {
      facts.push(fact);
      factMap.set(canonicalField(fact.field), fact);
    }
  }

  return { facts, droppedOverrides };
}

/**
 * 参考冲突（软提示）：参考资料层（stable 来源快照，含参考图候选快照值）与当前研究权威
 * 事实同 field 不同值 → 输出结构列表供 UI 提示；仅供展示，不阻断、不写回、不改任何事实。
 */export function buildReferenceConflicts(input: {
  authority: FactAuthorityReferenceValue[];
  references: Array<FactAuthorityReferenceValue & { sourceKind?: string }>;
}): ReferenceConflict[] {
  const authorityByField = new Map<string, FactAuthorityReferenceValue>();
  for (const item of input.authority) authorityByField.set(canonicalField(item.field), item);
  const conflicts: ReferenceConflict[] = [];
  for (const ref of input.references) {
    const authority = authorityByField.get(canonicalField(ref.field));
    if (!authority) continue;
    if (normalizedFactText(authority.value) === normalizedFactText(ref.value)) continue;
    conflicts.push({
      field: authority.field,
      label: authority.label,
      confirmedValue: authority.value,
      referenceValue: ref.value,
      resolution: "use_confirmed_fact",
    });
  }
  return conflicts;
}

/**
 * 创作页权威统计（唯一口径）：全页面「已确认商品事实 / 待确认候选」都必须出自同一权威 DTO。
 * - confirmedFacts      = currentConfirmedFacts.length（研究侧 Human Confirmed Facts）
 * - confirmableCandidates = confirmableFactCandidates.length（研究未覆盖、真正可勾选确认的来源快照候选）
 * 禁止任何位置沿用旧 candidate/candidateFactOptions 原始数量口径。
 */
export function authorityCounts(input: {
  currentConfirmedFacts?: Array<{ field: string }>;
  confirmableFactCandidates?: Array<{ canonicalField?: string }>;
}): { confirmedFacts: number; confirmableCandidates: number } {
  return {
    confirmedFacts: Array.isArray(input.currentConfirmedFacts) ? input.currentConfirmedFacts.length : 0,
    confirmableCandidates: Array.isArray(input.confirmableFactCandidates) ? input.confirmableFactCandidates.length : 0,
  };
}
