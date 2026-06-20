"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { useLocalDraft } from "@/hooks/useLocalDraft";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import {
  Search,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  FileDown,
  ChevronDown,
  ChevronUp,
  Target,
  Shield,
  Brain,
  Sparkles,
} from "lucide-react";

type CandidateData = {
  index: number;
  name: string;
  rawInput: string;
  link: string | null;
  status: "pending" | "running" | "completed" | "failed";
  errorMessage?: string;
  score: number;
  level: string;
  levelLabel: string;
  reasons: string[];
  risks: string[];
  nextAction: string;
  sourcing: {
    feasibility: string;
    summary: string;
    searchKeywords: string[];
    moqEstimate: string;
    beginnerFriendly?: boolean;
    beginnerFit?: string;
  } | null;
  risk: {
    overallLevel: string;
    displayLevel?: string;
    summary: string;
    blacklistMatches: string[];
  } | null;
  summary: {
    verdict: string;
    confidence: string;
    summary: string;
    reasons: string[];
    risks: string[];
    nextSteps: string[];
    beginnerTip: string;
    downgraded?: boolean;
    downgradeReasons?: string[];
  } | null;
};

type ApiResponse = {
  ok: true;
  data: {
    candidates: CandidateData[];
    totalCount: number;
    completedCount: number;
    failedCount: number;
  };
} | { ok: false; error: { code: string; message: string } };

const LEVEL_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800 border-emerald-200",
  B: "bg-sky-100 text-sky-800 border-sky-200",
  C: "bg-amber-100 text-amber-800 border-amber-200",
  D: "bg-orange-100 text-orange-800 border-orange-200",
  E: "bg-rose-100 text-rose-800 border-rose-200",
};

const LEVEL_DOT: Record<string, string> = {
  A: "bg-emerald-500",
  B: "bg-sky-500",
  C: "bg-amber-500",
  D: "bg-orange-500",
  E: "bg-rose-500",
};

const RISK_BADGE: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  yellow: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-rose-50 text-rose-700 border-rose-200",
};

const DRAFT_KEY = "qx:opportunities-draft:v1";

function displayRiskLevel(candidate?: Pick<CandidateData, "risk">) {
  return candidate?.risk?.displayLevel || candidate?.risk?.overallLevel || "";
}

const riskOrder: Record<string, number> = { red: 3, yellow: 2, green: 1 };

function riskText(level: string) {
  if (level === "red") return "高";
  if (level === "yellow") return "中";
  if (level === "green") return "低";
  return "—";
}

function riskSummaryText(level: string) {
  if (level === "red") return "高风险";
  if (level === "yellow") return "需注意";
  if (level === "green") return "低风险";
  return "—";
}

function riskColor(level: string) {
  if (level === "red") return "text-rose-600 font-semibold";
  if (level === "yellow") return "text-amber-600";
  return "text-emerald-600";
}

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fallback for focused-window / permission edge cases in local browser tests.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

export function OpportunitiesForm() {
  const [rawText, setRawText] = useState("");
  const [candidates, setCandidates] = useState<CandidateData[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState("");
  const [error, setError] = useState("");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [accessPassword, , isAccessPasswordReady] = useAccessPassword();
  const { draftValue: draftVal, setDraftValue: setDraft, restored: draftRestored } = useLocalDraft<string>({
    storageKey: DRAFT_KEY,
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    initialValue: "",
  });

  // Restore draft on mount (only once)
  const didRestore = useRef(false);
  useEffect(() => {
    if (!didRestore.current && draftRestored && draftVal) {
      setRawText(draftVal);
      didRestore.current = true;
    }
  }, [draftRestored, draftVal]);

  const handleInputChange = useCallback((value: string) => {
    setRawText(value);
    setDraft(value);
  }, [setDraft]);

  const lines = rawText.split("\n").filter((l) => l.trim());
  const validCount = lines.length;
  const overLimit = validCount > 30;

  const handleAnalyze = useCallback(async () => {
    setError("");
    if (!rawText.trim()) {
      setError("请至少输入一个候选商品。");
      return;
    }
    if (overLimit) {
      setError(`每次最多分析 30 个候选品，当前输入 ${validCount} 个。请删减后重试。`);
      return;
    }
    if (!isAccessPasswordReady) {
      setError("正在读取访问状态，请稍后再试。");
      return;
    }
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setError("访问密码缺失或已过期，请先在首页输入访问密码。");
      return;
    }

    setLoading(true);
    setError("");
    setCandidates([]);
    setExpandedIndex(null);
    setCurrentStep("正在启动机会雷达...");

    try {
      const res = await fetch("/api/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText,
          accessPassword: accessPassword.trim(),
        }),
      });

      const json: ApiResponse = await res.json();

      if (!json.ok) {
        setError(json.error.message);
        setLoading(false);
        return;
      }

      const { data } = json;
      // Simulate progress updates
      setCurrentStep(`分析完成：${data.completedCount}/${data.totalCount} 成功，${data.failedCount} 失败`);
      setCandidates(data.candidates);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络请求失败，请检查服务是否在运行。");
      setLoading(false);
    }
  }, [rawText, accessPassword, isAccessPasswordReady, overLimit, validCount]);

  const handleExportMarkdown = useCallback(() => {
    const lines: string[] = [
      "# 机会雷达 · 候选品排行榜",
      "",
      `分析时间：${new Date().toLocaleString("zh-CN")}`,
      `总计：${candidates.length} 个候选品`,
      "",
      "---",
      "",
      "## 排行榜",
      "",
      "| 排名 | 等级 | 商品 | 分数 | 主要理由 | 主要风险 |",
      "|------|------|------|------|----------|----------|",
    ];

    candidates.forEach((c, i) => {
      const reasons = c.reasons.slice(0, 2).join("，") || "—";
      const risks = c.risks.slice(0, 2).join("，") || "—";
      lines.push(`| ${i + 1} | ${c.levelLabel} | ${c.name} | ${c.score} | ${reasons} | ${risks} |`);
    });

    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("## 详情");
    lines.push("");

    candidates.forEach((c) => {
      lines.push(`### ${c.levelLabel} · ${c.name}（${c.score}分）`);
      lines.push("");
      lines.push(`- **状态**：${c.status === "completed" ? "已完成" : c.status === "failed" ? "失败" : "待分析"}`);
      lines.push(`- **推荐等级**：${c.levelLabel}`);
      lines.push(`- **下一步**：${c.nextAction}`);
      if (c.reasons.length) lines.push(`- **推荐理由**：${c.reasons.join("；")}`);
      if (c.risks.length) lines.push(`- **风险提示**：${c.risks.join("；")}`);
      if (c.sourcing) {
        lines.push(`- **货源判断**：${c.sourcing.summary}`);
        if (c.sourcing.searchKeywords.length) lines.push(`- **找货关键词**：${c.sourcing.searchKeywords.join("、")}`);
      }
      if (c.risk) {
        lines.push(`- **风险等级**：${riskText(displayRiskLevel(c))}`);
        lines.push(`- **风险摘要**：${c.risk.summary}`);
      }
      if (c.summary) {
        lines.push(`- **综合结论**：${c.summary.verdict}`);
        lines.push(`- **小白提示**：${c.summary.beginnerTip}`);
      }
      if (c.errorMessage) lines.push(`- **错误信息**：${c.errorMessage}`);
      lines.push("");
    });

    lines.push("");
    lines.push("> ⚠️ 本报告由 AI 自动生成，仅供初筛参考。关键决策需人工复核认证、合规、利润和平台规则。");

    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `机会雷达_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [candidates]);

  const handleCopyResults = useCallback(() => {
    const text = candidates.map((c, i) =>
      `${i + 1}. [${c.levelLabel}] ${c.name}（${c.score}分）\n   理由：${c.reasons.slice(0, 2).join("，") || "暂无"}\n   风险：${c.risks.slice(0, 2).join("，") || "暂无"}\n   下一步：${c.nextAction}`
    ).join("\n\n");
    copyTextToClipboard(text);
  }, [candidates]);

  const hasResults = candidates.length > 0;
  const isSingle = candidates.length === 1;

  // Score helper
  const scoreLabel = (s: number) => s >= 80 ? "优先测试" : s >= 65 ? "可小单验证" : s >= 50 ? "谨慎观察" : "暂不建议";
  const scoreColor = (s: number) => s >= 80 ? "text-emerald-600" : s >= 65 ? "text-sky-600" : s >= 50 ? "text-amber-600" : "text-rose-600";

  // Feasibility label in Chinese
  const feasibilityLabel = (f: string) => f === "high" ? "易找" : f === "medium" ? "一般" : "较难";
  const feasibilityColor = (f: string) => f === "high" ? "text-emerald-600" : f === "medium" ? "text-amber-600" : "text-rose-600";

  // Beginner fit label
  const beginnerLabel = (f: string | undefined) => {
    if (!f) return "—";
    if (f === "high") return "友好";
    if (f === "medium") return "一般";
    return "不友好";
  };

  // Top summary data
  const topByScore = candidates.filter(c => c.status === "completed").slice(0, 1)[0];
  const bestForBeginner = [...candidates].filter(c => c.status === "completed").sort((a, b) => {
    const aFriendly = a.sourcing?.beginnerFriendly ? 1 : 0;
    const bFriendly = b.sourcing?.beginnerFriendly ? 1 : 0;
    return bFriendly - aFriendly || b.score - a.score;
  })[0];
  const highestRisk = [...candidates].filter(c => c.status === "completed").sort((a, b) => {
    return (riskOrder[displayRiskLevel(b)] || 0) - (riskOrder[displayRiskLevel(a)] || 0);
  })[0];
  const completedCandidates = candidates.filter(c => c.status === "completed");

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="min-w-0 space-y-5">
          <header className="workspace-header">
            <div className="flex items-center gap-3">
              <div className="linear-icon size-10 shrink-0 rounded-xl">
                <Target className="size-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-slate-950">机会雷达</h1>
                <p className="muted-text mt-1 text-sm">先看排序，再看风险，最后人工确认。分数不是采购建议，只是初筛参考。</p>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

        {/* Input Area */}
        {!hasResults ? (
          <div className="surface-card p-5">
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              候选商品列表
              <span className="ml-2 text-xs font-normal text-slate-400">
                每行一个商品标题、描述或链接（最多 30 个）
              </span>
            </label>
            <textarea
              ref={textareaRef}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
              rows={10}
              placeholder={`宠物慢食碗\n儿童电动牙刷\n桌面手机支架\n硅胶折叠水杯\n宠物饮水机`}
              value={rawText}
              onChange={(e) => handleInputChange(e.target.value)}
              disabled={loading}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className={`text-xs ${overLimit ? "font-semibold text-rose-600" : "text-slate-400"}`}>
                {overLimit
                  ? `⚠️ 超过上限：${validCount} 个（最多 30 个）`
                  : validCount > 0
                  ? `已输入 ${validCount} 个候选品（上限 30 个）`
                  : "请输入候选商品"}
              </span>
              <button type="button" onClick={handleAnalyze} disabled={loading}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? <><Loader2 className="size-4 animate-spin" />分析中...</> : <><Sparkles className="size-4" />开始分析</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="surface-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">
                已分析 {validCount} 个候选品
              </p>
              <button type="button" onClick={handleAnalyze} disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                重新分析
              </button>
            </div>
            <textarea
              ref={textareaRef}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 focus:border-teal-400 focus:outline-none"
              rows={3}
              value={rawText}
              onChange={(e) => handleInputChange(e.target.value)}
              disabled={loading}
            />
            {overLimit && (
              <p className="mt-1 text-xs font-semibold text-rose-600">⚠️ 超过上限 30 个，超出的已被截断</p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="surface-card rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertTriangle className="mr-2 inline size-4" />
            {error}
          </div>
        )}

        {/* Progress */}
        {loading && (
          <div className="surface-card p-8 text-center">
            <Loader2 className="mx-auto mb-3 size-8 animate-spin text-teal-500" />
            <p className="text-sm font-semibold text-slate-700">{currentStep || "分析中..."}</p>
            <p className="mt-1 text-xs text-slate-400">正在逐个分析候选商品，请耐心等待...</p>
          </div>
        )}

        {/* Results */}
        {hasResults && !loading && (
          <>
            {/* Top Summary Card */}
            {completedCandidates.length > 0 && (
              <div className="surface-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="size-4 text-teal-600" />
                  <p className="text-sm font-semibold text-slate-800">机会雷达摘要</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                  <div>
                    <p className="text-slate-400">共分析</p>
                    <p className="text-sm font-bold text-slate-900">{candidates.length} 个候选品</p>
                    <p className="text-[11px] text-slate-400">{candidates.filter(c => c.status === "completed").length} 完成 · {candidates.filter(c => c.status === "failed").length} 失败</p>
                  </div>
                  <div>
                    <p className="text-slate-400">最高分</p>
                    <p className="text-sm font-bold text-slate-900 truncate">{topByScore?.name || "—"}</p>
                    <p className={`text-[11px] font-semibold ${scoreColor(topByScore?.score ?? 0)}`}>{topByScore?.score ?? "—"} 分 · {scoreLabel(topByScore?.score ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">新手最适合</p>
                    <p className="text-sm font-bold text-slate-900 truncate">{bestForBeginner?.name || "—"}</p>
                    <p className="text-[11px] text-slate-400">{bestForBeginner?.levelLabel || "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">风险最高</p>
                    <p className="text-sm font-bold text-slate-900 truncate">{highestRisk?.name || "—"}</p>
                    <p className={`text-[11px] font-semibold ${riskColor(displayRiskLevel(highestRisk))}`}>
                      {riskSummaryText(displayRiskLevel(highestRisk))}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-slate-400 border-t border-slate-100 pt-3">
                  ⚠ 仅作初筛，最终仍需人工确认成本、认证、侵权、物流。高风险品类不要因为利润看起来好就直接做。
                </p>
              </div>
            )}

            {/* Results Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {isSingle ? "单品机会分析" : `机会排行榜 · ${candidates.length} 个候选品`}
                </h2>
                {isSingle && (
                  <p className="text-xs text-slate-400 mt-0.5">机会雷达更适合 3 个以上候选品对比，当前仅作单品判断。</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleCopyResults}
                  className="surface-card inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
                  <Copy className="size-3.5" /> 复制
                </button>
                <button onClick={handleExportMarkdown}
                  className="surface-card inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
                  <FileDown className="size-3.5" /> 导出
                </button>
              </div>
            </div>

            {/* Leaderboard */}
            <div className="space-y-2">
              {candidates.map((c, i) => {
                const isExpanded = expandedIndex === i;
                const oneLiner = c.summary?.verdict || c.reasons.slice(0, 1).join("") || "分析中...";
                return (
                  <div key={c.index}
                    className={`surface-card overflow-hidden transition ${c.status === "failed" ? "opacity-50" : ""}`}>
                    {/* Compact row */}
                    <button
                      onClick={() => setExpandedIndex(isExpanded ? null : i)}
                      className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-slate-50/50">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-bold text-slate-500">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">{c.name}</p>
                          <span className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${LEVEL_COLORS[c.level] || ""}`}>
                            <span className={`inline-block size-1.5 rounded-full ${LEVEL_DOT[c.level] || ""}`} />
                            {c.levelLabel}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{oneLiner.slice(0, 40)}</p>
                        {/* Mini indicators */}
                        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-400">
                          <span title="货源难度">📦 货源：<span className={feasibilityColor(c.sourcing?.feasibility || "")}>{feasibilityLabel(c.sourcing?.feasibility || "")}</span></span>
                          <span title="风险等级">🛡 风险：<span className={riskColor(displayRiskLevel(c))}>{riskText(displayRiskLevel(c))}</span></span>
                          <span title="新手适合度">👤 新手：<span className={c.sourcing?.beginnerFriendly ? "text-emerald-600" : "text-rose-600"}>{beginnerLabel(c.sourcing?.beginnerFit)}</span></span>
                        </div>
                        {/* Reason tags */}
                        {c.reasons.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {c.reasons.slice(0, 3).map((r, ri) => (
                              <span key={ri} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{r}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-sm font-bold ${scoreColor(c.score)}`}>{c.score}</p>
                        <p className="text-[10px] text-slate-400">{scoreLabel(c.score)}</p>
                      </div>
                      {isExpanded ? <ChevronUp className="size-4 shrink-0 text-slate-400" /> : <ChevronDown className="size-4 shrink-0 text-slate-400" />}
                    </button>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50/50 p-4">
                        <div className="grid gap-3 md:grid-cols-3">
                          {c.sourcing && (
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <Search className="size-3.5 text-teal-600" />
                                <p className="text-xs font-semibold text-slate-700">货源判断</p>
                              </div>
                              <p className="text-xs text-slate-600">{c.sourcing.summary}</p>
                              {c.sourcing.searchKeywords.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {c.sourcing.searchKeywords.slice(0, 5).map(kw => (
                                    <span key={kw} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{kw}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {c.risk && (
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <Shield className={`size-3.5 ${displayRiskLevel(c) === "red" ? "text-rose-500" : displayRiskLevel(c) === "yellow" ? "text-amber-500" : "text-emerald-500"}`} />
                                <p className="text-xs font-semibold text-slate-700">风险排查</p>
                                <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${RISK_BADGE[displayRiskLevel(c)] || ""}`}>{riskText(displayRiskLevel(c))}</span>
                              </div>
                              <p className="text-xs text-slate-600">{c.risk.summary}</p>
                              {c.risk.blacklistMatches.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {c.risk.blacklistMatches.map(m => (
                                    <span key={m} className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] text-rose-600">{m}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {c.summary && (
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <Brain className="size-3.5 text-violet-600" />
                                <p className="text-xs font-semibold text-slate-700">综合结论</p>
                                {c.summary.downgraded && (
                                  <span className="ml-auto rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">已降级</span>
                                )}
                              </div>
                              <p className="text-xs font-semibold text-slate-800">{c.summary.verdict}</p>
                              <p className="mt-1 text-[11px] text-slate-600">{c.summary.summary}</p>
                            </div>
                          )}
                        </div>
                        <div className="mt-3 flex items-center gap-2 rounded-lg border border-teal-100 bg-teal-50/60 p-2.5 text-xs">
                          <TrendingUp className="size-3.5 text-teal-600 shrink-0" />
                          <span className="font-semibold text-teal-700">下一步：</span>
                          <span className="text-teal-700">{c.nextAction}</span>
                        </div>
                        {c.summary?.downgradeReasons && c.summary.downgradeReasons.length > 0 && (
                          <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50/50 p-2">
                            {c.summary.downgradeReasons.map((r, idx) => (
                              <p key={idx} className="text-[11px] text-amber-700">⚠ {r}</p>
                            ))}
                          </div>
                        )}
                        {c.status === "failed" && c.errorMessage && (
                          <div className="mt-2 rounded-lg border border-rose-100 bg-rose-50 p-2 text-xs text-rose-600">
                            <XCircle className="mr-1 inline size-3.5" />{c.errorMessage}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Score scale */}
            <div className="surface-card p-3">
              <p className="mb-2 text-[11px] font-semibold text-slate-500">分数参考</p>
              <div className="flex gap-3 text-[10px] text-slate-400">
                <span><span className="font-bold text-emerald-600">80-100</span> 优先测试</span>
                <span><span className="font-bold text-sky-600">65-79</span> 可小单验证</span>
                <span><span className="font-bold text-amber-600">50-64</span> 谨慎观察</span>
                <span><span className="font-bold text-rose-600">0-49</span> 暂不建议</span>
              </div>
            </div>

            {/* Disclaimer */}
            <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">可信度与人工确认</p>
                  <p className="mt-1 text-xs text-amber-700">
                    AI 分析结果仅供初筛参考，不代表采购建议。高风险商品如果出现在高分段，请以风险排查和硬规则降级标记为准。
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Empty state */}
        {!hasResults && !loading && (
          <div className="surface-card p-8 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-slate-100">
              <Target className="size-8 text-slate-300" />
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-600">还没有分析结果</p>
            <p className="mt-1 text-xs text-slate-400">在上方输入候选商品（每行一个），点击「开始分析」即可。</p>
            <p className="mt-1 text-xs text-slate-400">支持商品标题、描述或链接（链接仅作文本，不自动访问）。</p>
          </div>
        )}
      </div>
      </div>
    </main>
  );
}
