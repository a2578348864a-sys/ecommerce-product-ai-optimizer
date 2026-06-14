"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  ClipboardList,
  FileSearch,
  Lightbulb,
  Search,
  ShieldAlert,
  TrafficCone,
  XCircle,
} from "lucide-react";
import type {
  CandidateProduct,
  ConfidenceLevel,
  EvidenceCard,
  FinalDecision,
  HotProductRadarResult,
  PlatformSearchStatus,
  TrafficLightRisk,
} from "@/lib/types";

export function getConfidenceLabel(level: ConfidenceLevel | undefined | null): string {
  switch (level) {
    case "high": return "高";
    case "medium": return "中";
    case "low": return "低";
    default: return "低";
  }
}

export function getDecisionLabel(decision: FinalDecision | undefined | null): string {
  switch (decision) {
    case "recommend": return "推荐做";
    case "caution": return "谨慎做";
    case "reject": return "不建议做";
    default: return "谨慎做";
  }
}

export function getDecisionClass(decision: FinalDecision | undefined | null): string {
  switch (decision) {
    case "recommend": return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "reject": return "border-red-200 bg-red-50 text-red-700";
    default: return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function getLightClass(level: TrafficLightRisk["level"]) {
  switch (level) {
    case "green": return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "red": return "border-red-200 bg-red-50 text-red-800";
    default: return "border-amber-200 bg-amber-50 text-amber-800";
  }
}

function getLightLabel(level: TrafficLightRisk["level"]) {
  switch (level) {
    case "green": return "绿";
    case "red": return "红";
    default: return "黄";
  }
}

export function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white">
        <ClipboardList className="h-4 w-4" />
      </span>
      <h2 className="text-lg font-bold text-slate-950">{title}</h2>
      {typeof count === "number" ? (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{count}</span>
      ) : null}
    </div>
  );
}

function getBeginnerDecisionLabel(decision: FinalDecision | undefined | null): string {
  switch (decision) {
    case "recommend": return "建议做";
    case "reject": return "不建议做";
    default: return "谨慎做";
  }
}

function getNoSourceFit(result: HotProductRadarResult) {
  switch (result.finalDecision) {
    case "recommend":
      return {
        label: "适合先小批量测试",
        text: "可以先找同款或平替款，小库存试单，不要一开始重仓。",
        className: "border-emerald-200 bg-emerald-50 text-emerald-900",
      };
    case "reject":
      return {
        label: "不适合新手无货源",
        text: "风险或证据不足，先不要直接上架，避免侵权、售后或利润踩坑。",
        className: "border-red-200 bg-red-50 text-red-900",
      };
    default:
      return {
        label: "可以观察，别急着做",
        text: "同款、价格、热度或风险还要核实，建议先补证据再决定。",
        className: "border-amber-200 bg-amber-50 text-amber-900",
      };
  }
}

function getViralPotential(result: HotProductRadarResult) {
  const score = result.candidateProducts[0]?.hotScore ?? 0;
  const label = score >= 70 ? "高" : score >= 40 ? "中" : "低";
  const text = result.candidateProducts[0]?.hotReason
    || result.summary
    || "当前热度证据不足，建议补充小红书互动、评论需求或平台来源。";
  return { label, text };
}

function uniqueTexts(items: string[]) {
  const seen = new Set<string>();
  return items
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function getMainRisks(result: HotProductRadarResult) {
  const fromWarnings = result.riskWarnings.map((risk) => risk.reason || risk.riskType);
  const fromLights = result.trafficLightRisks
    .filter((risk) => risk.level !== "green")
    .map((risk) => risk.explanation || risk.name);
  const fromProducts = result.candidateProducts.flatMap((product) => product.riskTags || []);
  const risks = uniqueTexts([...fromWarnings, ...fromLights, ...fromProducts]);
  const fallback = [
    "当前证据不足，建议补充价格、热度或平台来源。",
    "核对是否有品牌/IP、违禁词或虚假宣传风险。",
    "先确认售后、运费和利润空间，不要直接重仓。",
  ];
  return uniqueTexts([...risks, ...fallback]).slice(0, 5);
}

function getNextSuggestions(result: HotProductRadarResult) {
  const suggestions = uniqueTexts([
    ...result.nextActions.map((item) => item.action),
    ...result.nextActions.flatMap((item) => item.checklist || []),
    ...result.sourcingKeywords.map((keyword) => `去 1688、拼多多或淘宝搜：${keyword}`),
    ...result.differentiationIdeas.map((idea) => idea.contentSuggestion),
  ]);
  const fallback = [
    "先补充价格、热度、平台来源。",
    "先只分析一个商品，结果更准，也更省分析次数。",
    "确认没有侵权、违禁和高售后风险。",
  ];
  return uniqueTexts([...suggestions, ...fallback]).slice(0, 3);
}

export function SummaryCard({ result }: { result: HotProductRadarResult }) {
  const fallback = "当前证据不足，建议补充价格、热度或平台来源。";
  const reasons = [
    result.summary,
    result.agentConclusion,
    ...result.candidateProducts.map((item) => item.reason || item.hotReason || item.evidenceText),
  ].filter((item): item is string => Boolean(item?.trim())).slice(0, 3);
  const noSourceFit = getNoSourceFit(result);
  const viralPotential = getViralPotential(result);
  const mainRisks = getMainRisks(result);
  const nextSuggestions = getNextSuggestions(result);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-rose-600">小白体检报告</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-950">{getBeginnerDecisionLabel(result.finalDecision)}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            {reasons[0] || fallback}
          </p>
        </div>
        <span className={"rounded-full border px-3 py-1 text-sm font-bold " + getDecisionClass(result.finalDecision)}>
          最终判断：{getBeginnerDecisionLabel(result.finalDecision)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-bold text-slate-950">最终判断</p>
          {reasons.length ? (
            <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
              {reasons.map((reason, index) => (
                <li key={reason} className="flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white">{index + 1}</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm leading-6 text-slate-700">{fallback}</p>
          )}
        </div>
        <div className={"rounded-lg border p-3 " + noSourceFit.className}>
          <p className="text-sm font-bold">适合无货源吗</p>
          <h3 className="mt-1 text-lg font-bold">{noSourceFit.label}</h3>
          <p className="mt-1 text-sm leading-6">{noSourceFit.text}</p>
        </div>
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-indigo-950">
          <p className="text-sm font-bold">爆款潜力</p>
          <h3 className="mt-1 text-2xl font-bold">{viralPotential.label}</h3>
          <p className="mt-1 text-sm leading-6">{viralPotential.text}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-950">
          <p className="text-sm font-bold">主要风险</p>
          <ul className="mt-2 space-y-2 text-sm leading-6">
            {mainRisks.map((risk) => (
              <li key={risk} className="flex gap-2">
                <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-red-600" />
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-950 lg:col-span-2">
          <p className="text-sm font-bold">下一步建议</p>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {nextSuggestions.map((suggestion, index) => (
              <div key={suggestion} className="rounded-md bg-white/70 p-2.5 text-sm leading-6">
                <span className="mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">{index + 1}</span>
                <p>{suggestion}</p>
              </div>
            ))}
          </div>
          {!reasons.length ? (
            <p className="mt-3 text-xs leading-5">你可以补充价格、热度、平台来源，或先只分析一个商品。</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function TrafficLightPanel({ risks }: { risks: TrafficLightRisk[] }) {
  const names = ["热度", "新手适配", "同质化", "利润空间", "侵权/IP", "售后", "物流", "最终判断"];
  const normalizedRisks = names.map((name) => {
    const found = risks.find((risk) => risk.name.includes(name) || name.includes(risk.name));
    return found || {
      name,
      level: "yellow" as const,
      explanation: "当前证据不足，建议补充价格、热度或平台来源。",
    };
  });

  return (
    <div>
      <SectionTitle title="风险红黄绿灯" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {normalizedRisks.map((risk) => (
          <div key={risk.name} className={"rounded-lg border p-3 " + getLightClass(risk.level)}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold">{risk.name}</p>
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-bold">{getLightLabel(risk.level)}</span>
            </div>
            <p className="mt-2 text-xs leading-5">{risk.explanation}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlatformStatusList({ statuses }: { statuses: PlatformSearchStatus[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {statuses.map((item) => (
        <div key={item.platform} className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900">{item.platform}</span>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">{item.status}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-600">{item.message}</p>
          <p className="mt-1 text-xs text-slate-400">数量：{item.itemCount}</p>
        </div>
      ))}
    </div>
  );
}

function ScoreLine({ label, value }: { label: string; value: number }) {
  const safeValue = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span>{safeValue}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-teal-500" style={{ width: safeValue + "%" }} />
      </div>
    </div>
  );
}

function InfoBlock({ title, text }: { title: string; text?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-700">{text || "未提供"}</p>
    </div>
  );
}

export function ProductCard({ product }: { product: CandidateProduct }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-slate-950">{product.productName || "未命名商品"}</h3>
            <span className={"rounded-full border px-2 py-0.5 text-xs font-semibold " + getDecisionClass(product.finalDecision)}>
              {getDecisionLabel(product.finalDecision)}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {product.platform || product.sourcePlatform || "manual"} · {product.priceText || "价格未提供"} · {product.rankText || product.salesText || "热度未提供"}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-950">{product.finalScore || 0}</div>
          <div className="text-xs text-slate-400">综合分</div>
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-700">{product.reason || product.hotReason}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <ScoreLine label="热度证据" value={product.hotScore} />
        <ScoreLine label="新手适配" value={product.beginnerFitScore} />
        <ScoreLine label="竞争可控" value={product.competitionScore} />
        <ScoreLine label="利润空间" value={product.grossMarginPotentialScore} />
      </div>

      {product.riskTags.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {product.riskTags.map((tag) => (
            <span key={tag} className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 text-sm leading-6 md:grid-cols-2">
        <InfoBlock title="热度理由" text={product.hotReason} />
        <InfoBlock title="差异化角度" text={product.differentiationAngle} />
        <InfoBlock title="售后风险" text={product.afterSalesRisk} />
        <InfoBlock title="侵权/IP风险" text={product.ipRisk} />
      </div>
    </article>
  );
}

export function ProductGroup({ title, products, type }: {
  title: string;
  products: CandidateProduct[];
  type: "recommend" | "caution" | "reject";
}) {
  const icon = type === "recommend"
    ? <CheckCircle2 className="h-4 w-4" />
    : type === "reject"
      ? <XCircle className="h-4 w-4" />
      : <CircleHelp className="h-4 w-4" />;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={"flex h-7 w-7 items-center justify-center rounded-md " + getDecisionClass(type === "recommend" ? "recommend" : type === "reject" ? "reject" : "caution")}>
          {icon}
        </span>
        <h3 className="font-bold text-slate-950">{title}</h3>
        <span className="text-xs text-slate-400">{products.length} 个</span>
      </div>
      <div className="space-y-3">
        {products.length ? products.map((product, index) => (
          <div key={product.productName + index} className="rounded-md bg-slate-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">{product.productName || "未命名商品"}</p>
              <span className="text-xs font-bold text-slate-500">{product.finalScore || 0}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-600">{product.reason || product.evidenceText}</p>
          </div>
        )) : (
          <p className="text-sm text-slate-500">暂无商品进入这一类。</p>
        )}
      </div>
    </div>
  );
}

export function EvidenceCardList({ cards }: { cards: EvidenceCard[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {cards.length ? cards.map((card, index) => (
        <div key={card.id || index} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-teal-600" />
            <h3 className="font-semibold text-slate-950">素材 {index + 1}：{card.productName || card.sourceUrl || card.materialType}</h3>
          </div>
          <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-700">
            <p>平台：{card.platform}</p>
            <p>类型：{card.detectedMaterialType}</p>
            <p>识别状态：{card.status}</p>
            <p>识别信息：{card.priceText || "价格未识别"} · {card.salesText || card.ratingText || card.rankText || "热度未识别"}</p>
            <p>缺失：{card.missingFields.length ? card.missingFields.join("、") : "无"}</p>
            <p className="text-slate-500">{card.message}</p>
          </div>
        </div>
      )) : (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">暂无证据卡片。</p>
      )}
    </div>
  );
}

export function EvidenceSection({ result }: { result: HotProductRadarResult }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {result.platformEvidence.length ? result.platformEvidence.map((item, index) => (
        <div key={item.platform + index} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <TrafficCone className="h-4 w-4 text-teal-600" />
            <h3 className="font-semibold text-slate-950">{item.platform || "未知平台"}</h3>
          </div>
          <InfoBlock title="证据" text={item.evidenceSummary} />
          <InfoBlock title="可信度" text={item.credibility} />
          <InfoBlock title="不足" text={item.gaps} />
        </div>
      )) : (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">暂无平台热度证据，请补充更多榜单或商品信息。</p>
      )}
    </div>
  );
}

export function RiskAndIdeas({ result }: { result: HotProductRadarResult }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-red-600" />
          <h3 className="font-bold text-slate-950">风险提醒</h3>
        </div>
        <div className="space-y-3">
          {result.riskWarnings.length ? result.riskWarnings.map((risk, index) => (
            <div key={risk.riskType + index} className={"rounded-md border p-3 " + getLightClass(risk.level)}>
              <p className="text-sm font-semibold">{risk.riskType} · {getLightLabel(risk.level)}</p>
              <p className="mt-1 text-sm leading-6">{risk.reason}</p>
              <p className="mt-1 text-xs leading-5">{risk.suggestion}</p>
            </div>
          )) : (
            <p className="text-sm text-slate-500">暂无明显风险，但仍需人工复核。</p>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-teal-600" />
          <h3 className="font-bold text-slate-950">差异化方案</h3>
        </div>
        <div className="space-y-3">
          {result.differentiationIdeas.length ? result.differentiationIdeas.map((idea, index) => (
            <div key={idea.productDirection + index} className="rounded-md bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">{idea.productDirection}</p>
              <p className="mt-1 text-sm leading-6 text-slate-700">{idea.angle}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{idea.contentSuggestion}</p>
            </div>
          )) : (
            <p className="text-sm text-slate-500">暂无差异化方案，请补充更多商品信息。</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function KeywordAndDirectionPanel({ result }: { result: HotProductRadarResult }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-4 w-4 text-teal-600" />
          <h3 className="font-bold text-slate-950">找货关键词</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {result.sourcingKeywords.length ? result.sourcingKeywords.map((keyword) => (
            <span key={keyword} className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">{keyword}</span>
          )) : <p className="text-sm text-slate-500">暂无关键词。</p>}
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-teal-600" />
          <h3 className="font-bold text-slate-950">同类扩展方向</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {result.similarProductDirections.length ? result.similarProductDirections.map((direction) => (
            <span key={direction} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{direction}</span>
          )) : <p className="text-sm text-slate-500">暂无同类方向。</p>}
        </div>
      </div>
    </div>
  );
}

export function NextActions({ result }: { result: HotProductRadarResult }) {
  return (
    <div className="space-y-3">
      {result.nextActions.length ? result.nextActions.map((item, index) => (
        <div key={item.productDirection + index} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold text-slate-950">{item.productDirection || "下一步"}</h3>
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">{item.testSuggestion}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700">{item.action}</p>
          {item.checklist.length ? (
            <ul className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
              {item.checklist.map((step) => (
                <li key={step} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )) : (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">暂无下一步行动，请补充更多信息后重新生成。</p>
      )}
    </div>
  );
}
