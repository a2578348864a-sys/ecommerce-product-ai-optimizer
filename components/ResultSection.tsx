"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, FileText, Info, Lightbulb, ShieldAlert, Target, TrendingUp, Truck, Users } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import type { AlibabaResult, BaseAssessment, ConfidenceLevel, InquiryTemplates, ScoreBreakdown, ScoreDimension } from "@/lib/types";

// ==================== 工具函数 ====================

const CONFIDENCE_FALLBACK_CLASS = "bg-gray-100 text-gray-600 border-gray-300";

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asConfidenceLevel(value: unknown): ConfidenceLevel {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function asFiniteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getScoreColor(score: number | undefined | null): string {
  const safeScore = typeof score === "number" && Number.isFinite(score) ? score : null;
  if (safeScore == null) return "text-slate-400";
  if (safeScore >= 70) return "text-emerald-600";
  if (safeScore >= 40) return "text-amber-600";
  return "text-red-600";
}

export function getScoreBgColor(score: number | undefined | null): string {
  const safeScore = typeof score === "number" && Number.isFinite(score) ? score : null;
  if (safeScore == null) return "bg-slate-50 border-slate-200";
  if (safeScore >= 70) return "bg-emerald-50 border-emerald-200";
  if (safeScore >= 40) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

export function getConfidenceColor(level: ConfidenceLevel | undefined | null): string {
  switch (asConfidenceLevel(level)) {
    case "high": return "bg-green-100 text-green-800 border-green-300";
    case "medium": return "bg-yellow-100 text-yellow-800 border-yellow-300";
    case "low": return "bg-gray-100 text-gray-600 border-gray-300";
    default: return CONFIDENCE_FALLBACK_CLASS;
  }
}

export function getConfidenceLabel(level: ConfidenceLevel | undefined | null): string {
  switch (asConfidenceLevel(level)) {
    case "high": return "高";
    case "medium": return "中";
    case "low": return "低";
    default: return "低";
  }
}

export function isHighRisk(risk: unknown): boolean {
  const text = asString(risk);
  return text.includes("⚠️") || text.includes("高风险");
}

export function formatListValue(value: unknown): string {
  return asStringArray(value).map((item, index) => index + 1 + ". " + item).join("\n");
}

// ==================== 核心组件 ====================

export function ScoreCard({ score, confidenceLevel, recommendation }: {
  score?: number | null;
  confidenceLevel?: ConfidenceLevel;
  recommendation?: { suggestion?: string; dataWarning?: string };
}) {
  const safeScore = clamp(asFiniteNumber(score), 0, 100);
  const suggestion = asString(recommendation?.suggestion);
  const dataWarning = asString(recommendation?.dataWarning);

  return (
    <div className={getScoreBgColor(safeScore) + " rounded-lg border-2 p-6"}>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center">
          <div className={"text-6xl font-bold tracking-tight " + getScoreColor(safeScore)}>
            {safeScore}
          </div>
          <p className="mt-1 text-sm text-slate-500">/ 100 分</p>
        </div>
        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold text-slate-950">产品机会总评分</h2>
            <ConfidenceBadge level={confidenceLevel} />
          </div>
          <p className="text-sm leading-6 text-slate-700">{suggestion}</p>
          {dataWarning ? (
            <div className="flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{dataWarning}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ConfidenceBadge({ level }: { level?: ConfidenceLevel }) {
  const safeLevel = asConfidenceLevel(level);
  return (
    <span className={"inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold " + getConfidenceColor(safeLevel)}>
      置信度 {getConfidenceLabel(safeLevel)}
    </span>
  );
}

export function RiskBadge({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
      <ShieldAlert className="h-3 w-3" />
      {label || "高风险"}
    </span>
  );
}

export function ScoreDimensionCard({ label, maxScore, dimension }: {
  label: string;
  maxScore: number;
  dimension?: ScoreDimension;
}) {
  const [expanded, setExpanded] = useState(false);
  const safeMaxScore = Math.max(asFiniteNumber(maxScore, 1), 1);
  const score = clamp(asFiniteNumber(dimension?.score), 0, safeMaxScore);
  const barColor = score >= safeMaxScore * 0.7 ? "bg-emerald-500" : score >= safeMaxScore * 0.4 ? "bg-amber-500" : "bg-red-500";
  const barWidth = clamp((score / safeMaxScore) * 100, 0, 100);
  const basis = asString(dimension?.basis);
  const mainRisk = asString(dimension?.mainRisk);
  const missingData = asString(dimension?.missingData);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{label}</span>
            <span className="text-xs text-slate-400">/ {safeMaxScore} 分</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className={"h-full rounded-full transition-all " + barColor} style={{ width: barWidth + "%" }} />
            </div>
            <span className={"text-lg font-bold " + getScoreColor(score)}>
              {score}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm leading-6">
          <div>
            <span className="font-medium text-slate-700">依据：</span>
            <span className="text-slate-600">{basis}</span>
          </div>
          <div>
            <span className="font-medium text-slate-700">主要风险：</span>
            <span className={mainRisk ? (isHighRisk(mainRisk) ? "text-red-600" : "text-slate-600") : "text-slate-400"}>
              {mainRisk || "无"}
            </span>
          </div>
          <div>
            <span className="font-medium text-slate-700">缺失数据：</span>
            <span className={missingData ? "text-amber-600" : "text-emerald-600"}>
              {missingData || "无"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function AssessmentCard({ title, assessment, icon }: {
  title: string;
  assessment?: BaseAssessment;
  icon?: React.ReactNode;
}) {
  const conclusion = asString(assessment?.conclusion);
  const basis = asString(assessment?.basis);
  const risk = asString(assessment?.risk);
  const confidence = asConfidenceLevel(assessment?.confidence);
  const verificationStep = asString(assessment?.verificationStep);
  const isRisk = isHighRisk(risk);
  const cardClass = isRisk ? "border-red-200 bg-red-50" : "border-slate-200 bg-white";

  return (
    <div className={"rounded-lg border p-4 " + cardClass + " shadow-sm"}>
      <div className="mb-3 flex items-center gap-2">
        {icon && <span className="text-slate-500">{icon}</span>}
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {isRisk && <RiskBadge />}
      </div>
      <div className="space-y-2 text-sm leading-6">
        <div>
          <span className="font-medium text-slate-700">结论：</span>
          <span className="text-slate-600">{conclusion}</span>
        </div>
        <div>
          <span className="font-medium text-slate-700">依据：</span>
          <span className="text-slate-600">{basis}</span>
        </div>
        <div>
          <span className="font-medium text-slate-700">风险：</span>
          <span className={isRisk ? "font-semibold text-red-700" : "text-slate-600"}>
            {risk || "无"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-700">置信度：</span>
          <ConfidenceBadge level={confidence} />
        </div>
        <div>
          <span className="font-medium text-slate-700">下一步验证：</span>
          <span className="text-slate-600">{verificationStep}</span>
        </div>
      </div>
    </div>
  );
}

export function MissingDataSection({ items }: { items?: string[] | null }) {
  const safeItems = asStringArray(items);

  if (safeItems.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center gap-2 text-emerald-800">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-semibold">数据完整性良好，未发现明显缺失</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="mb-3 flex items-center gap-2 text-amber-800">
        <AlertTriangle className="h-5 w-5" />
        <span className="font-semibold">缺失数据提醒</span>
        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs">{safeItems.length} 项</span>
      </div>
      <p className="mb-2 text-sm text-amber-700">以下数据缺失，会影响 AI 判断的准确度。建议补充后可获得更准确的分析：</p>
      <ul className="space-y-1">
        {safeItems.map((item, index) => (
          <li key={index} className="flex items-start gap-2 text-sm text-amber-800">
            <span className="mt-0.5 shrink-0">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ValidationChecklistSection({ items }: { items?: string[] | null }) {
  const safeItems = asStringArray(items);
  if (safeItems.length === 0) return null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="mb-3 flex items-center gap-2 text-blue-800">
        <ClipboardList className="h-5 w-5" />
        <span className="font-semibold">下一步验证清单</span>
        <span className="rounded-full bg-blue-200 px-2 py-0.5 text-xs">{safeItems.length} 项</span>
      </div>
      <p className="mb-2 text-sm text-blue-700">以下步骤可以帮助你进一步验证产品可行性：</p>
      <ol className="space-y-1.5">
        {safeItems.map((item, index) => (
          <li key={index} className="flex items-start gap-2 text-sm text-blue-800">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-200 text-xs font-semibold">
              {index + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function InquiryTemplatesSection({ templates }: { templates?: InquiryTemplates | null }) {
  const [expanded, setExpanded] = useState(false);
  const labels: Record<string, string> = {
    firstInquiry: "首次询价回复",
    moqReply: "MOQ 回复",
    sampleFeeReply: "样品费用回复",
    oemOdmReply: "OEM/ODM 定制回复",
    priceTooHighReply: "价格太贵回复",
    leadTimeReply: "交期回复",
    shippingReply: "运费/目的港确认回复",
    followUpReply: "客户未回复跟进模板",
  };
  const entries = Object.keys(labels)
    .map((key) => [key, asString(templates?.[key as keyof InquiryTemplates])] as const)
    .filter(([, value]) => value.trim().length > 0);
  const visible = expanded ? entries : entries.slice(0, 2);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-slate-500" />
          <h3 className="text-base font-semibold text-slate-900">询盘回复模板</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{entries.length}个模板</span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      <div className="space-y-3">
        {visible.map(([key, val]) => (
          <div key={key} className="rounded-md bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">{labels[key] || key}</span>
              <CopyButton text={val} label="复制" />
            </div>
            <pre className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{val}</pre>
          </div>
        ))}
      </div>
      {!expanded && entries.length > 2 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 w-full rounded-md border border-slate-200 py-2 text-sm text-slate-500 hover:bg-slate-50"
        >
          展开全部 {entries.length} 个模板
        </button>
      )}
    </div>
  );
}

export function SimpleListSection({ title, icon, items }: {
  title: string;
  icon?: React.ReactNode;
  items?: string[] | null;
}) {
  const safeItems = asStringArray(items);
  if (safeItems.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon && <span className="text-slate-500">{icon}</span>}
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{safeItems.length} 项</span>
        </div>
      </div>
      <ol className="space-y-1.5">
        {safeItems.map((item, index) => (
          <li key={index} className="flex items-start gap-2 text-sm text-slate-700">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
              {index + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TextBlockSection({ title, text, icon }: {
  title: string;
  text?: string | null;
  icon?: React.ReactNode;
}) {
  const safeText = asString(text).trim();
  if (!safeText) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon && <span className="text-slate-500">{icon}</span>}
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>
        <CopyButton text={safeText} label="复制" />
      </div>
      <div className="whitespace-pre-wrap rounded-md bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700">
        {safeText}
      </div>
    </div>
  );
}

export function SectionGroupTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <div className="h-6 w-1 rounded-full bg-teal-500" />
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {count !== undefined && (
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">{count} 项</span>
      )}
    </div>
  );
}
