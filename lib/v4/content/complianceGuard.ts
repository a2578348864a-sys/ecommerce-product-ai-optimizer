/**
 * V4 P5 — Listing Compliance Guard：确定性检查（Owner A，D4/D7）。
 *
 * 输出具体失败项列表（无单一合规分数）；blocked = 任一 issue.severity === "error"。
 * 覆盖：字段白名单 / 长度 / 字符 / 重复句 / 禁词 / 商标 / 绝对词 / 引用完整性 /
 *       claim 值一致性（错颜色/错数量）/ 规则版本过期（复用 policyPack.ts checkPolicyPack）。
 * 模型辅助语义审查另置于 Skill 层；本 Guard 只做确定性、可复现的校验。
 */
import "server-only";

import { checkPolicyPack } from "./policyPack";
import type { PolicyPack } from "./policyPack";
import type { ContentHandoff } from "./handoff";
import type { ListingDraft, ListingFactInput } from "./listingSkill";

export type ComplianceSeverity = "error" | "warning" | "info";

export type ComplianceCode =
  | "PACK_STALE"
  | "PACK_UNKNOWN"
  | "PACK_MISMATCH"
  | "FIELD_NOT_ALLOWED"
  | "LENGTH_EXCEEDED"
  | "CHARSET_INVALID"
  | "BANNED_TERM"
  | "TRADEMARK_TERM"
  | "ABSOLUTE_TERM"
  | "DUPLICATE_SENTENCE"
  | "CLAIM_NO_FACTREF"
  | "FACTREF_INVALID"
  | "KEYWORD_NO_EVIDENCE"
  | "CLAIM_VALUE_MISMATCH"
  | "POTENTIAL_INJECTION"
  | "NO_CONFIRMED_FACTS"
  | "FORBIDDEN_TERM_SKIPPED"
  | "HANDOFF_FORBIDDEN_TERM";

export type ComplianceIssue = {
  field: string;
  code: ComplianceCode;
  severity: ComplianceSeverity;
  message: string;
  span?: { text: string };
  ruleId?: string;
};

export type ComplianceGuardResult = {
  issues: ComplianceIssue[];
  /** 任一 error 即 blocked（不发布、不导出）。 */
  blocked: boolean;
};

export type RunComplianceGuardInput = {
  handoff: ContentHandoff;
  draft: ListingDraft;
  facts: ListingFactInput[];
  policyPack: PolicyPack | null;
  now: string;
};

/** 词匹配用：保留标点，只折叠空白与大小写（用于 "100%"、"No.1" 等）。 */
function termNormalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** 一致性/去重用：剥离标点后折叠空白。 */
function looseNormalize(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\uFF0C\uFF0E]+/gu, " ").replace(/\s+/g, " ").trim();
}

function isConfirmed(fact: ListingFactInput | undefined): boolean {
  return !!fact && fact.status === "confirmed" && !!fact.confirmationMethod;
}

const INJECTION_PATTERNS = [
  "ignore previous",
  "ignore all previous",
  "ignore all prior",
  "disregard the above",
  "disregard instructions",
  " you are now ",
  "system prompt",
  "as an ai",
  "pretend to be",
  "reveal your",
  "forget everything",
  "output a json",
  "delete all data",
];

function findInjection(text: string): string | null {
  const t = " " + termNormalize(text) + " ";
  for (const p of INJECTION_PATTERNS) {
    if (t.includes(p)) return p.trim();
  }
  return null;
}

/** 将字段文本拆成句/行单元（用于重复句检测）。 */
function splitUnits(fieldName: string, text: string): string[] {
  if (fieldName === "bullets") return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return text.split(/[.!?]+|\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * 运行确定性合规检查。
 * - pack：不存在/过期/与 handoff 不匹配 → error。
 * - 字段白名单、长度、字符、禁词、商标、绝对词按 policy pack 规则逐项检查。
 * - 引用完整性：claim 缺 factRef / factRef 无效 / 关键词缺 evidenceRef → error。
 * - claim 值一致性：值敏感字段（颜色/数量/材质等）claim 文本必须包含事实值 → 否则 error。
 * - 重复句、注入样本 → warning（不阻断，但可见）。
 */
export function runComplianceGuard(input: RunComplianceGuardInput): ComplianceGuardResult {
  const { handoff, draft, facts, policyPack, now } = input;
  const issues: ComplianceIssue[] = [];
  const factById = new Map<string, ListingFactInput>();
  for (const f of facts) factById.set(f.id, f);

  const fields = draft.fields ?? [];
  const fieldNames = new Set(fields.map((f) => f.name));

  // 1. 规则包：存在性、过期、版本/站点/类目匹配。
  const packStatus = checkPolicyPack(policyPack, now);
  if (!packStatus.ok) {
    issues.push({
      field: "pack",
      code: packStatus.code === "PACK_STALE" ? "PACK_STALE" : "PACK_UNKNOWN",
      severity: "error",
      message: packStatus.message,
    });
  } else {
    const pack = packStatus.pack;
    const mismatches: string[] = [];
    if (pack.version !== handoff.policyPackVersion) mismatches.push("version: " + pack.version + " != " + handoff.policyPackVersion);
    if (pack.marketplace !== handoff.marketplace) mismatches.push("marketplace: " + pack.marketplace + " != " + handoff.marketplace);
    if (pack.category !== handoff.category) mismatches.push("category: " + pack.category + " != " + handoff.category);
    if (mismatches.length > 0) {
      issues.push({
        field: "pack",
        code: "PACK_MISMATCH",
        severity: "error",
        message: "policy pack 与 handoff 不匹配：" + mismatches.join("; "),
      });
    }
  }

  // 2. 按规则逐项检查。
  const rules = policyPack?.rules ?? [];
  const allowlistRule = rules.find((r) => r.kind === "field_allowlist");
  if (allowlistRule?.terms) {
    for (const f of fields) {
      if (!allowlistRule.terms.includes(f.name)) {
        issues.push({
          field: f.name,
          code: "FIELD_NOT_ALLOWED",
          severity: allowlistRule.severity,
          message: "字段 " + f.name + " 不在当前站点/类目白名单中",
          ruleId: allowlistRule.id,
        });
      }
    }
  }

  const lengthRules = rules.filter((r) => r.kind === "length_limit");
  for (const rule of lengthRules) {
    for (const f of fields) {
      if (rule.field && rule.field !== f.name) continue;
      if (typeof rule.maxLength === "number" && f.text.length > rule.maxLength) {
        issues.push({
          field: f.name,
          code: "LENGTH_EXCEEDED",
          severity: rule.severity,
          message: "字段 " + f.name + " 长度 " + f.text.length + " 超过上限 " + rule.maxLength,
          ruleId: rule.id,
        });
      }
    }
  }

  const charsetRules = rules.filter((r) => r.kind === "charset" && r.pattern);
  for (const rule of charsetRules) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(rule.pattern as string);
    } catch {
      re = null;
    }
    if (!re) continue;
    for (const f of fields) {
      if (rule.field && rule.field !== f.name) continue;
      if (!re.test(f.text)) {
        issues.push({
          field: f.name,
          code: "CHARSET_INVALID",
          severity: rule.severity,
          message: "字段 " + f.name + " 含不符合字符集规则的字符",
          ruleId: rule.id,
          span: { text: f.text },
        });
      }
    }
  }

  const termRuleKinds = [
    { kind: "banned_terms", code: "BANNED_TERM" as ComplianceCode },
    { kind: "trademark_terms", code: "TRADEMARK_TERM" as ComplianceCode },
    { kind: "absolute_terms", code: "ABSOLUTE_TERM" as ComplianceCode },
  ];
  for (const { kind, code } of termRuleKinds) {
    for (const rule of rules.filter((r) => r.kind === kind)) {
      for (const term of rule.terms ?? []) {
        const nt = termNormalize(term);
        for (const f of fields) {
          if (termNormalize(f.text).includes(nt)) {
            issues.push({
              field: f.name,
              code,
              severity: rule.severity,
              message: "字段 " + f.name + " 命中" + kindLabel(kind) + "：" + term,
              ruleId: rule.id,
              span: { text: term },
            });
          }
        }
      }
    }
  }

  // 3. handoff.forbidden：任何字段文本不得命中。
  for (const forbiddenTerm of handoff.forbidden ?? []) {
    const nf = termNormalize(forbiddenTerm);
    if (!nf) continue;
    for (const f of fields) {
      if (termNormalize(f.text).includes(nf)) {
        issues.push({
          field: f.name,
          code: "HANDOFF_FORBIDDEN_TERM",
          severity: "error",
          message: "字段 " + f.name + " 命中 handoff 禁止词：" + forbiddenTerm,
          span: { text: forbiddenTerm },
        });
      }
    }
  }

  // 4. 引用完整性 + claim 值一致性。
  for (const f of fields) {
    for (const claim of f.claims ?? []) {
      if (!claim.factRefs || claim.factRefs.length === 0) {
        issues.push({
          field: f.name,
          code: "CLAIM_NO_FACTREF",
          severity: "error",
          message: "引用了产品主张但缺 factRef：" + claim.text,
          span: { text: claim.text },
        });
        continue;
      }
      for (const ref of claim.factRefs) {
        const fact = factById.get(ref);
        if (!fact || !isConfirmed(fact)) {
          issues.push({
            field: f.name,
            code: "FACTREF_INVALID",
            severity: "error",
            message: "factRef " + ref + " 指向不存在/未确认事实",
            span: { text: claim.text },
          });
          continue;
        }
        if (isValueSensitive(fact.field) && !looseNormalize(claim.text).includes(looseNormalize(fact.value))) {
          issues.push({
            field: f.name,
            code: "CLAIM_VALUE_MISMATCH",
            severity: "error",
            message:
              "claim 与已确认事实值不一致（" +
              fact.field +
              " 应为 " +
              fact.value +
              "）：" +
              claim.text,
            span: { text: claim.text },
          });
        }
      }
    }
    // search_terms 必须有证据引用的关键词。
    if (f.name === "search_terms" && f.text.trim() && (!f.keywordRefs || f.keywordRefs.length === 0)) {
      issues.push({
        field: f.name,
        code: "KEYWORD_NO_EVIDENCE",
        severity: "error",
        message: "search_terms 含关键词但缺 evidenceRefs",
        span: { text: f.text },
      });
    }
  }
  for (const kw of draft.keywords ?? []) {
    if (!Array.isArray(kw.evidenceRefs) || kw.evidenceRefs.length === 0) {
      issues.push({
        field: "search_terms",
        code: "KEYWORD_NO_EVIDENCE",
        severity: "error",
        message: "关键词 " + kw.term + " 缺 evidenceRefs",
        span: { text: kw.term },
      });
    }
  }

  // 5. 重复句。
  for (const f of fields) {
    const seen = new Map<string, number>();
    for (const unit of splitUnits(f.name, f.text)) {
      const n = looseNormalize(unit);
      if (!n) continue;
      const count = (seen.get(n) ?? 0) + 1;
      seen.set(n, count);
      if (count === 2) {
        issues.push({
          field: f.name,
          code: "DUPLICATE_SENTENCE",
          severity: "warning",
          message: "字段 " + f.name + " 出现重复句：" + unit,
          span: { text: unit },
        });
      }
    }
  }

  // 6. 潜在 prompt 注入（仅作数据告警，不阻断）。
  for (const f of fields) {
    const hit = findInjection(f.text);
    if (hit) {
      issues.push({
        field: f.name,
        code: "POTENTIAL_INJECTION",
        severity: "warning",
        message: "字段 " + f.name + " 含疑似指令文本（仅作数据处理）：" + hit,
        span: { text: hit },
      });
    }
  }

  const blocked = issues.some((i) => i.severity === "error");
  return { issues, blocked };
}

function kindLabel(kind: string): string {
  if (kind === "banned_terms") return "禁词";
  if (kind === "trademark_terms") return "商标词";
  if (kind === "absolute_terms") return "绝对词";
  return kind;
}

function isValueSensitive(field: string): boolean {
  const f = field.toLowerCase().replace(/[\s_-]+/g, "").trim();
  return [
    "color", "colour", "quantity", "count", "packagecount", "packagequantity",
    "capacity", "weight", "dimensions", "size", "material", "accessorycount", "packcount",
  ].includes(f);
}
