/**
 * V4 P6 — Replay 纯解析器（服务端与客户端共用，不含 React 依赖）。
 *
 * 从母 bundle（只读不可变）派生展示数据：时间线步骤、证据索引、Gate 决策、
 * Content Guard 结果、展示标题、时效判定、元数据与链路统计（resolveReplayMetrics）。
 * 纯函数：不发起请求、不写入任何数据、不硬编码 74/5/11（统计一律从 bundle 动态派生）。
 *
 * 说明：本模块为纯 TS（不置 "use client"），因此可同时被服务端页面（app/replay/*）
 * 与客户端组件（ReplayView）导入；ReplayView 对既有导出做再导出以保持向后兼容。
 */
import type { ReplayBundle } from "@/lib/v4/replay/schema";
import type { ReplayEvidence, ReplayTimelineStep } from "./ReplayTimeline";

export type ReplayGateRecord = {
  gate: string;
  decision: string;
  reason?: string;
  actor?: string;
  decidedAt?: string;
};

export type ReplayContentCheck = {
  title: string;
  status: string;
  findings?: string[];
};

export type ReplayMeta = {
  bundleId: string;
  sourceRunId: string;
  exportedAt: string;
  capturedAt: string;
  mode: string;
  allowlistVersion: string;
  bundleSha256: string;
  filesCount: number;
  scanOk: boolean;
  redactionEntries: number;
};

/** 链路派生统计（事件步骤 / 人工决策 / Content Guard / 脱敏与 hash）。全部从真实 bundle 动态派生。 */
export type ReplayMetrics = {
  /** 时间线步骤数（resolveTimelineSteps 长度）。 */
  events: number;
  /** 人工决策数（resolveGates 长度）。 */
  gates: number;
  /** Content Guard 展示项数（resolveContentChecks 长度）。 */
  checks: number;
  /** 脱敏扫描是否通过。 */
  scanOk: boolean;
  /** 已脱敏字段数。 */
  redactionEntries: number;
  /** bundle 完整 sha256（展示时取前 12 位）。 */
  bundleSha256: string;
};

/** Gate 名称展示（事件 node → 中文门禁名）。 */
export const GATE_NAME_LABELS: Record<string, string> = {
  build_plan: "研究计划",
  gate_a: "门禁 A",
  gate_b: "门禁 B",
  product_fact_gate: "产品事实门禁",
  content_review: "内容审核",
  complete: "完成",
};

/** Gate 决策展示（canonical 决策词 → 中文 + 原词回溯）。 */
export const GATE_DECISION_LABELS: Record<string, string> = {
  continue: "继续",
  continue_sourcing: "继续研究",
  needs_information: "需信息",
  abandon: "放弃",
  content_ready: "内容就绪",
  revise_product: "修改商品",
  approve_export: "批准导出",
  request_revision: "要求修订",
  reject_asset: "拒绝资产",
};

export function formatGateName(gate: string): string {
  return GATE_NAME_LABELS[gate] ?? gate;
}

export function formatGateDecision(decision: string): string {
  const label = GATE_DECISION_LABELS[decision];
  return label && label !== decision ? `${label}（${decision}）` : decision;
}

/** 判定回放数据是否超时效（默认 30 天）。 */
export const REPLAY_STALE_DAYS = 30;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** 时间线步骤：优先 data.timeline，回退到 data.events（ResearchRunEvent 形状）。 */
export function resolveTimelineSteps(bundle: ReplayBundle): ReplayTimelineStep[] {
  const data = asRecord(bundle.data) ?? {};
  const steps: ReplayTimelineStep[] = [];

  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  for (const raw of timeline) {
    if (typeof raw === "string") {
      steps.push({ id: raw, at: "", title: raw });
      continue;
    }
    const r = asRecord(raw);
    if (!r) continue;
    const id = asString(r.id ?? r.stepId ?? r.seq, "s" + steps.length);
    const at = asString(r.at ?? r.ts ?? r.createdAt);
    const title = asString(r.title ?? r.label ?? r.name ?? r.kind, "步骤");
    steps.push({
      id,
      at,
      title,
      detail: asString(r.detail ?? r.summary),
      kind: asString(r.kind),
      evidenceRefs: resolveEvidenceRefs(r.evidenceRefs),
    });
  }
  if (steps.length > 0) return steps;

  // 回退：从结构化事件派生（仅用公开字段，不含思维链）。
  const events = Array.isArray(data.events) ? data.events : [];
  for (const raw of events) {
    const r = asRecord(raw);
    if (!r) continue;
    const seq = asString(r.seq, "");
    const title = asString(r.type ?? "事件");
    const node = asString(r.node);
    steps.push({
      id: seq ? "ev-" + seq : "ev-" + steps.length,
      at: asString(r.createdAt),
      title: node && node !== title ? title + " · " + node : title,
      kind: node,
      detail: summarizeEventPayload(asString(r.payloadJson)),
    });
  }
  return steps;
}

function summarizeEventPayload(payloadJson: string): string {
  if (!payloadJson) return "";
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    for (const key of ["reason", "message", "decision", "summary", "note", "label"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  } catch {
    return "";
  }
}

function resolveEvidenceRefs(value: unknown): ReplayEvidence[] {
  if (!Array.isArray(value)) return [];
  const out: ReplayEvidence[] = [];
  for (const raw of value) {
    if (typeof raw === "string") {
      out.push({ id: raw });
      continue;
    }
    const r = asRecord(raw);
    if (!r) continue;
    const id = asString(r.id ?? r.evidenceId ?? r.ref);
    if (!id) continue;
    out.push({
      id,
      label: asString(r.label ?? r.title ?? r.kind),
      sourceUrl: asString(r.sourceUrl ?? r.url),
      capturedAt: asString(r.capturedAt),
      summary: asString(r.summary ?? r.snippet),
    });
  }
  return out;
}

/** 顶层证据索引（供步骤只带 id 时展开引用）。 */
export function resolveEvidenceIndex(bundle: ReplayBundle): ReplayEvidence[] {
  const data = asRecord(bundle.data) ?? {};
  return resolveEvidenceRefs(data.evidenceRefs);
}

/** Gate 决策历史记录（只读）。 */
export function resolveGates(bundle: ReplayBundle): ReplayGateRecord[] {
  const data = asRecord(bundle.data) ?? {};
  const gates = Array.isArray(data.gates) ? data.gates : [];
  const out: ReplayGateRecord[] = [];
  for (const raw of gates) {
    const r = asRecord(raw);
    if (!r) continue;
    out.push({
      gate: asString(r.gate ?? r.name ?? "gate"),
      decision: asString(r.decision ?? r.option),
      reason: asString(r.reason ?? r.note),
      actor: asString(r.actor),
      decidedAt: asString(r.decidedAt ?? r.at ?? r.createdAt),
    });
  }
  if (out.length > 0) return out;
  // v4.0.1：数据无顶层 gates 时，从实际 bundle events 的 human_decision 派生（真实决策映射）。
  const events = Array.isArray(data.events) ? data.events : [];
  for (const raw of events) {
    const r = asRecord(raw);
    if (!r || asString(r.type) !== "human_decision") continue;
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(asString(r.payloadJson)) as unknown;
      const rec = asRecord(parsed);
      if (rec) payload = rec;
    } catch {
      // 无法解析的 payload 不阻断：仍记录事件本身。
    }
    out.push({
      gate: asString(r.node, "gate"),
      decision: asString(payload.decision ?? payload.choice),
      reason: asString(payload.note ?? payload.reason),
      actor: asString(payload.actor),
      decidedAt: asString(r.createdAt),
    });
  }
  return out;
}

/** Content Guard 结果（只读）。 */
export function resolveContentChecks(bundle: ReplayBundle): ReplayContentCheck[] {
  const data = asRecord(bundle.data) ?? {};
  const content = asRecord(data.content);
  if (!content) return [];

  const candidates = Array.isArray(content.guards)
    ? content.guards
    : Array.isArray(content.checks)
      ? content.checks
      : Array.isArray(content.results)
        ? content.results
        : [];
  const out: ReplayContentCheck[] = [];
  for (const raw of candidates) {
    if (typeof raw === "string") {
      out.push({ title: raw, status: "记录" });
      continue;
    }
    const r = asRecord(raw);
    if (!r) continue;
    out.push({
      title: asString(r.title ?? r.name ?? r.check ?? "检查项"),
      status: asString(r.status ?? r.result ?? "记录"),
      findings: asStringArray(r.findings ?? r.messages ?? r.reasons),
    });
  }
  if (out.length === 0) {
    // v4.0.1：从 content.images.checks（VisualFactCheckResult）与 content.listing 派生。
    const listing = asRecord(content.listing);
    if (listing) {
      out.push({
        title: "Listing 内容守卫",
        status: listing.blocked === true ? "blocked" : "通过",
        findings: asStringArray(listing.issues),
      });
    }
    const images = asRecord(content.images);
    const visual = asRecord(images && images.checks);
    if (visual) {
      const overall = asString(visual.overallStatus);
      const summary = asString(visual.summary);
      out.push({
        title: "图片视觉事实检查",
        status: overall === "blocked" ? "blocked" : overall || "记录",
        findings: summary ? [summary] : [],
      });
      if (Array.isArray(visual.checks)) {
        for (const rawCheck of visual.checks) {
          const c = asRecord(rawCheck);
          if (!c) continue;
          out.push({
            title: "视觉检查 · " + asString(c.check ?? c.title ?? "检查项"),
            status: c.pass === false ? "失败" : c.pass === true ? "通过" : "记录",
            findings: asStringArray(c.issues),
          });
        }
      }
    }
  }
  return out;
}

/** 展示标题（母 case 业务名）。无业务名时用诚实空态标签，绝不把候选 UUID 当主标题。 */
export function resolveDisplayTitle(bundle: ReplayBundle): string {
  const data = asRecord(bundle.data) ?? {};
  const candidate = asRecord(data.candidate);
  if (candidate) {
    // 只用真实业务名；candidate.id 是内部 UUID，不作为主标题。
    const name = asString(candidate.name ?? candidate.productName ?? candidate.title);
    if (name) return name;
  }
  return "未命名案例";
}

/** 回放时效判定：capturedAt 距今超过 REPLAY_STALE_DAYS 天。 */
export function isReplayStale(
  capturedAt: string,
  now: Date = new Date(),
  staleDays = REPLAY_STALE_DAYS,
): boolean {
  if (!capturedAt) return false;
  const t = new Date(capturedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > staleDays * 24 * 60 * 60 * 1000;
}

export function resolveMeta(bundle: ReplayBundle): ReplayMeta {
  return {
    bundleId: bundle.bundleId,
    sourceRunId: bundle.sourceRunId,
    exportedAt: bundle.exportedAt,
    capturedAt: bundle.capturedAt,
    mode: bundle.mode,
    allowlistVersion: bundle.allowlistVersion,
    bundleSha256: bundle.manifest.bundleSha256,
    filesCount: bundle.manifest.files.length,
    scanOk: bundle.redactionReport.scanOk,
    redactionEntries: bundle.redactionReport.entries.length,
  };
}

/**
 * 链路统计（纯派生）：事件步骤 / 人工决策 / Content Guard / 脱敏与 hash。
 * 由 resolveTimelineSteps / resolveGates / resolveContentChecks 动态派生，
 * 禁止硬编码 74/5/11 —— 本函数对任意合法 bundle 均按其真实数据返回。
 */
export function resolveReplayMetrics(bundle: ReplayBundle): ReplayMetrics {
  const meta = resolveMeta(bundle);
  return {
    events: resolveTimelineSteps(bundle).length,
    gates: resolveGates(bundle).length,
    checks: resolveContentChecks(bundle).length,
    scanOk: meta.scanOk,
    redactionEntries: meta.redactionEntries,
    bundleSha256: meta.bundleSha256,
  };
}

/* ---------- V4.1 业务字段 / 业务阶段 / 证据来源（诚实派生，无数据→空态） ---------- */

export type ReplayBusinessFields = {
  /** 商品名（候选业务名）。 */
  productName: string;
  /** 关键词。 */
  keyword: string;
  /** 市场。 */
  market: string;
  /** 结论（报告摘要）。 */
  conclusion: string;
  /** 风险（等级或聚合的真实风险信号）。 */
  risk: string;
  /** 风险等级（候选风险等级）。 */
  riskLevel: string;
  /** 商品链接。 */
  link: string;
  /** 缩略图 URL（无则不伪造）。 */
  thumbnail: string;
};

/** 从 content.images / content.handoff 找真实图片 URL；无则空串（不伪造缩略图）。 */
function resolveImageUrl(content: Record<string, unknown> | null): string {
  if (!content) return "";
  const images = asRecord(content.images);
  const plan = asRecord(images && images.plan);
  const main = asRecord(plan && plan.main);
  const candidates = [
    asString(main && main.imageUrl),
    asString(main && main.src),
    asString(main && main.thumbnail),
    asString(images && images.thumbnail),
    asString(images && images.thumbnailUrl),
    asString(content.heroImage),
  ];
  return candidates.find((c) => /^https?:\/\//.test(c)) ?? "";
}

/** 风险：优先风险等级；否则聚合真实信号（图片视觉 blocked / 未知项 / 未覆盖成本）。 */
function resolveRiskSummary(
  content: Record<string, unknown> | null,
  report: Record<string, unknown> | null,
  commercial: Record<string, unknown> | null,
): string {
  const parts: string[] = [];
  const images = asRecord(content && content.images);
  const checks = asRecord(images && images.checks);
  const overall = asString(checks && checks.overallStatus);
  if (overall === "blocked") parts.push("图片视觉事实检查未通过（blocked）");
  const unknownList = Array.isArray(report && report.unknowns) ? (report?.unknowns as unknown[]) : [];
  if (unknownList.length > 0) parts.push(unknownList.length + " 项未知");
  const uncoveredList = Array.isArray(commercial && commercial.uncoveredCosts)
    ? (commercial?.uncoveredCosts as unknown[])
    : [];
  if (uncoveredList.length > 0) parts.push(uncoveredList.length + " 项未覆盖成本");
  return parts.join("；");
}

export function resolveBusinessFields(bundle: ReplayBundle): ReplayBusinessFields {
  const data = asRecord(bundle.data) ?? {};
  const candidate = asRecord(data.candidate);
  const report = asRecord(data.report);
  const commercial = asRecord(data.commercial);
  const content = asRecord(data.content);

  const productName = asString(candidate?.name ?? candidate?.productName ?? candidate?.title);
  const keyword = asString(candidate?.keyword ?? candidate?.keywordText);
  const market = asString(candidate?.market ?? report?.marketplace ?? commercial?.marketplace);
  const conclusion = asString(report?.summary);
  const riskLevel = asString(candidate?.riskLevel ?? candidate?.risk);
  const link = asString(candidate?.link ?? candidate?.url);
  const risk = riskLevel || resolveRiskSummary(content, report, commercial);
  const thumbnail = resolveImageUrl(content);

  return { productName, keyword, market, conclusion, risk, riskLevel, link, thumbnail };
}

export type ReplayBusinessStage = {
  key: string;
  label: string;
  status: string;
  badge?: string;
  summary: string;
  details: string[];
};

/** 业务阶段顺序（市场证据 → Gate A → 供应商 → 产品事实 → 商业 → Gate B → Listing/Image → Content Review）。 */
export const BUSINESS_STAGE_ORDER = [
  { key: "market_evidence", label: "市场证据" },
  { key: "gate_a", label: "Gate A" },
  { key: "supplier", label: "供应商" },
  { key: "product_fact", label: "产品事实" },
  { key: "commercial", label: "商业" },
  { key: "gate_b", label: "Gate B" },
  { key: "listing_image", label: "Listing / Image" },
  { key: "content_review", label: "Content Review" },
] as const;

function asNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function asPercent(v: unknown): string {
  const n = asNumber(v);
  return Number.isNaN(n) ? "—" : (n * 100).toFixed(1) + "%";
}
function asMoney(v: unknown): string {
  const n = asNumber(v);
  return Number.isNaN(n) ? "—" : "$" + n.toFixed(2);
}

function stageBase(key: string, label: string): ReplayBusinessStage {
  return { key, label, status: "记录", summary: "", details: [] };
}

/** 业务阶段派生：对每阶段读取真实 bundle 字段；无数据则显示诚实空态，不编造结论。 */
export function resolveBusinessStages(bundle: ReplayBundle): ReplayBusinessStage[] {
  const data = asRecord(bundle.data) ?? {};
  const report = asRecord(data.report);
  const commercial = asRecord(data.commercial);
  const content = asRecord(data.content);
  const gates = resolveGates(bundle);
  const decisionFor = (key: string) => gates.find((g) => g.gate === key);

  // 市场证据
  const evidenceList = Array.isArray(report && report.evidence) ? (report?.evidence as unknown[]) : [];
  const unknownList = Array.isArray(report && report.unknowns) ? (report?.unknowns as unknown[]) : [];
  const sectionList = Array.isArray(report && report.sections) ? (report?.sections as unknown[]) : [];
  const marketStage = {
    ...stageBase("market_evidence", "市场证据"),
    status: unknownList.length > 0 ? "含缺口" : "完成",
    badge: evidenceList.length + " 条证据",
    summary: asString(report?.summary) || "暂无市场结论",
    details: [
      "已验证证据 " + evidenceList.length + " 条",
      "报告章节 " + sectionList.length + " 节",
      unknownList.length > 0 ? "未知项 " + unknownList.length + " 项" : "无未知项",
    ],
  };

  // Gate A
  const gateA = decisionFor("gate_a");
  const gateAStage = {
    ...stageBase("gate_a", "Gate A"),
    status: gateA ? "已决策" : "未决策",
    badge: gateA ? formatGateDecision(gateA.decision) : "—",
    summary: gateA?.reason || "无备注",
  };

  // 供应商
  const gapList = Array.isArray(report && report.gaps) ? (report?.gaps as unknown[]) : [];
  const gapQuestions = gapList
    .map((g) => asString(asRecord(g)?.question))
    .filter((x): x is string => Boolean(x));
  const supplierStage = {
    ...stageBase("supplier", "供应商"),
    status: gapQuestions.length > 0 ? "信息缺口" : "未获取",
    badge: gapQuestions.length > 0 ? "无返回" : "—",
    summary: gapQuestions[0] || "未获取供应商信息",
    details: gapQuestions.length > 0 ? ["供应商数据：无返回（no_results）"] : [],
  };

  // 产品事实
  const factGate = decisionFor("product_fact_gate");
  const images = asRecord(content && content.images);
  const plan = asRecord(images && images.plan);
  const main = asRecord(plan && plan.main);
  const identityChecklist = asStringArray(main && main.identityChecklist);
  const productFactDetails =
    identityChecklist.length > 0 ? identityChecklist.slice(0, 5) : [];
  const productFactStage = {
    ...stageBase("product_fact", "产品事实"),
    status: factGate ? "已确认" : "未确认",
    badge: factGate ? formatGateDecision(factGate.decision) : "—",
    summary: productFactDetails[0] || "产品事实已确认",
    details: productFactDetails,
  };

  // 商业
  const scenarios = asRecord(commercial && commercial.scenarios);
  const baseline = asRecord(scenarios && scenarios.baseline);
  const uncoveredList = Array.isArray(commercial && commercial.uncoveredCosts)
    ? (commercial?.uncoveredCosts as unknown[])
    : [];
  const commercialStage = {
    ...stageBase("commercial", "商业"),
    status: baseline ? "已计算" : "未计算",
    badge: baseline ? "baseline" : "—",
    summary: baseline ? "已计算 baseline 商业模型" : "暂无商业模型",
    details: [
      baseline ? "预估毛利率 " + asPercent(baseline.marginRate) : "预估毛利率 —",
      baseline ? "盈亏平衡 " + asNumber(baseline.breakEvenUnits).toFixed(1) + " 单" : "",
      baseline ? "MOQ 资金 " + asMoney(baseline.moqCapital) : "",
      uncoveredList.length > 0 ? "未覆盖成本 " + uncoveredList.length + " 项" : "",
    ].filter(Boolean),
  };

  // Gate B
  const gateB = decisionFor("gate_b");
  const gateBStage = {
    ...stageBase("gate_b", "Gate B"),
    status: gateB ? "已决策" : "未决策",
    badge: gateB ? formatGateDecision(gateB.decision) : "—",
    summary: gateB?.reason || "无备注",
  };

  // Listing / Image
  const checks = asRecord(images && images.checks);
  const listing = asRecord(content && content.listing);
  const listingDraft = asRecord(listing && listing.draft);
  const listingFields = Array.isArray(listingDraft && listingDraft.fields)
    ? (listingDraft?.fields as unknown[])
    : [];
  const listingTitle = asString(asRecord(listingFields[0])?.text);
  const imageOverall = asString(checks && checks.overallStatus);
  const listingImageStage = {
    ...stageBase("listing_image", "Listing / Image"),
    status: imageOverall || "记录",
    badge: imageOverall === "blocked" ? "图片检查 blocked" : "图片检查通过",
    summary: listingTitle || "暂无 Listing 标题",
    details: [
      "Listing 守卫：" + (listing && listing.blocked === true ? "blocked" : "通过"),
      "图片视觉检查：" + (imageOverall || "记录"),
    ],
  };

  // Content Review
  const review = decisionFor("content_review");
  const reviewStage = {
    ...stageBase("content_review", "Content Review"),
    status: review ? "已审核" : "未审核",
    badge: review ? formatGateDecision(review.decision) : "—",
    summary: review?.reason || "无备注",
  };

  const byKey: Record<string, ReplayBusinessStage> = {
    market_evidence: marketStage,
    gate_a: gateAStage,
    supplier: supplierStage,
    product_fact: productFactStage,
    commercial: commercialStage,
    gate_b: gateBStage,
    listing_image: listingImageStage,
    content_review: reviewStage,
  };
  return BUSINESS_STAGE_ORDER.map((s) => byKey[s.key]);
}

export type ReplayEvidenceItem = {
  id: string;
  /** 来源类型。 */
  type: string;
  /** 实体。 */
  entity: string;
  /** 采集/观察时间（observedAt）。 */
  observedAt: string;
  /** 原始定位（sourceRef）。 */
  sourceRef: string;
  /** 权威字段。 */
  fields: Record<string, unknown>;
  /** 警告。 */
  warnings: string[];
  /** 冲突。 */
  conflicts: string[];
};

function conflictText(v: unknown): string {
  if (typeof v === "string") return v;
  const r = asRecord(v);
  if (r) return asString(r.summary ?? r.detail ?? r.message ?? r.reason ?? r.type);
  return "";
}

/** 证据来源：优先 data.report.evidence[]（真实字段），回退空态。只用真实字段，不伪造引用数量。 */
export function resolveEvidenceItems(bundle: ReplayBundle): ReplayEvidenceItem[] {
  const data = asRecord(bundle.data) ?? {};
  const report = asRecord(data.report);
  const rawList = Array.isArray(report && report.evidence) ? (report?.evidence as unknown[]) : [];
  const conflictList = Array.isArray(report && report.conflicts)
    ? (report?.conflicts as unknown[]).map(conflictText).filter((x) => Boolean(x))
    : [];
  const items: ReplayEvidenceItem[] = [];
  for (const raw of rawList) {
    const rec = asRecord(raw);
    if (!rec) continue;
    items.push({
      id: asString(rec.evidenceId ?? rec.id),
      type: asString(rec.type ?? rec.sourceType),
      entity: asString(rec.entity ?? rec.subject),
      observedAt: asString(rec.observedAt ?? rec.capturedAt),
      sourceRef: asString(rec.sourceRef ?? rec.rawRef),
      fields: asRecord(rec.fields) ?? {},
      warnings: asStringArray(rec.warnings ?? rec.issues),
      conflicts: conflictList,
    });
  }
  return items;
}
