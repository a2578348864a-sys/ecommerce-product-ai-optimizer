"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import type { MaterialAgentResult } from "@/lib/types";
import { useSharedProduct } from "@/hooks/useSharedProduct";
import { useLocalDraft } from "@/hooks/useLocalDraft";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { WorkflowNextStepCard } from "@/components/WorkflowNextStepCard";
import { ManualReviewChecklist } from "@/components/ManualReviewChecklist";
import { EXAMPLE_PRODUCT } from "@/lib/examples";

type ApiResponse =
  | { result: MaterialAgentResult }
  | { error: string };

type MaterialsDraft = {
  keyword: string;
  manualText: string;
  linksText: string;
  result: MaterialAgentResult | null;
};

const completenessLabels: Record<string, string> = {
  "完整": "素材完整",
  "一般": "一般",
  "不完整": "素材偏少",
};

const completenessClasses: Record<string, string> = {
  "完整": "border-emerald-200 bg-emerald-50 text-emerald-700",
  "一般": "border-amber-200 bg-amber-50 text-amber-700",
  "不完整": "border-red-200 bg-red-50 text-red-700",
};

function isApiError(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value;
}

export function MaterialsForm() {
  const [sharedProduct, updateShared] = useSharedProduct();
  const { draftValue, setDraftValue, clearDraft, restored } = useLocalDraft<MaterialsDraft>({
    storageKey: "qx:draft:materials:v1",
    initialValue: {
      keyword: sharedProduct.productName,
      manualText: sharedProduct.description,
      linksText: "",
      result: null,
    },
  });
  const { keyword, manualText, linksText, result } = draftValue;
  const updateDraft = (patch: Partial<MaterialsDraft>) => {
    setDraftValue((current) => ({ ...current, ...patch }));
  };
  const setKeyword = (value: string) => updateDraft({ keyword: value });
  const setManualText = (value: string) => updateDraft({ manualText: value });
  const setLinksText = (value: string) => updateDraft({ linksText: value });
  const setResult = (value: MaterialAgentResult | null) => updateDraft({ result: value });
  const [accessPassword, setAccessPassword, isAccessPasswordReady] = useAccessPassword();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingToTasks, setSavingToTasks] = useState(false);
  const [tasksSaveMessage, setTasksSaveMessage] = useState<string | null>(null);

  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncToShared = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      updateShared({ productName: keyword, description: manualText });
    }, 500);
  }, [keyword, manualText, updateShared]);

  useEffect(() => {
    syncToShared();
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [syncToShared]);

  function fillExample() {
    setKeyword(EXAMPLE_PRODUCT.productName);
    setManualText(
      "TikTok viral post:\n\nTitle: This foldable camping cup is genius!\n\nBody: Food-grade silicone foldable cup, 350ml capacity, folds to just 5cm thick. Metal carabiner clips right onto your backpack. IPX4 waterproof, half the weight of regular cups.\n\nPrice: $14.99\n\nTop comments:\n- Does it actually not leak?\n- Can I use it for hot drinks?\n- How long does the silicone last?\n- Link please!!",
    );
    setLinksText("https://www.tiktok.com/@example/video/foldable-camping-cup");
    setError(null);
    setTasksSaveMessage(null);
  }

  async function handleSubmit() {
    if (loading) return;
    if (!isAccessPasswordReady) {
      setError("正在读取访问状态，请稍后再试。");
      return;
    }

    if (!manualText.trim() && !linksText.trim() && !keyword.trim()) {
      setError("请至少填写关键词、商品描述或链接中的一项。");
      return;
    }

    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setError("访问密码缺失或已过期，请先在首页输入访问密码。");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/agents/material", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          manualText: manualText.trim(),
          linksText: linksText.trim(),
          accessPassword: accessPassword.trim(),
        }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!payload || typeof payload !== "object") {
        setError("服务端返回格式异常。");
        return;
      }

      if (isApiError(payload)) {
        setError(response.status === 401 || response.status === 403 ? "访问密码不正确，请重新输入。" : payload.error || "AI 请求失败，请稍后重试。");
        return;
      }

      if ("result" in payload && payload.result) {
        setResult(payload.result as MaterialAgentResult);
        return;
      }

      setError("服务端返回格式异常。");
    } catch {
      setError("AI 请求失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  const hasResult = Boolean(result);

  async function handleSaveToTaskCenter() {
    if (savingToTasks || !result) return;
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setTasksSaveMessage("请先输入访问密码后保存到任务中心。");
      return;
    }
    setSavingToTasks(true);
    setTasksSaveMessage(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessPassword,
          type: "material",
          title: keyword.trim() || manualText.trim().slice(0, 30) || "未命名素材",
          platform: "manual",
          source: "ai",
          materialText: manualText.trim() || keyword.trim(),
          result: {
            oneLineSummary: result.summary,
            level: result.materialCompleteness,
            score: result.materialCompleteness === "完整" ? 80 : result.materialCompleteness === "一般" ? 50 : 20,
            productType: result.productType,
            sellingPoints: result.sellingPoints,
            targetUsers: result.targetUsers,
            painPoints: result.painPoints,
            riskWords: result.riskWords,
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (payload?.ok) {
        setTasksSaveMessage("已保存到任务中心。");
      } else {
        setTasksSaveMessage("保存失败，请稍后重试。");
      }
    } catch {
      setTasksSaveMessage("保存失败，请稍后重试。");
    } finally {
      setSavingToTasks(false);
    }
  }

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="min-w-0 space-y-6">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">Qingxuan Workspace</p>
              <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">素材接收</h1>
              <p className="muted-text mt-1 text-sm">
                粘贴商品链接、截图描述或选品想法，AI 自动提取商品信息，帮你快速整理素材。
              </p>
            </div>
            <WorkspaceMobileNav />
          </header>

          {/* Form */}
          <section className="surface-card rounded-[28px] p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-950">素材信息</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  可以粘贴海外平台内容、商品详情、1688/阿里国际站链接或选品想法，AI 会提取关键信息。
                </p>
              </div>
              <button
                type="button"
                onClick={fillExample}
                className="inline-flex h-9 items-center justify-center rounded-full border border-teal-200 bg-teal-50 px-4 text-xs font-semibold text-teal-700 transition hover:bg-teal-100"
              >
                填入示例
              </button>
            </div>
            {restored ? (
              <p className="mb-4 rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-sm text-teal-700">
                已恢复上次未完成内容
              </p>
            ) : null}

            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">关键词 / 品类</span>
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="例如：折叠水杯、桌面收纳盒"
                  className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">商品描述 / 素材原文</span>
                <textarea
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  rows={5}
                  placeholder="粘贴海外平台素材全文、商品详情页描述、或者你对这个品类的想法。AI 会从中提取商品类型、卖点、目标人群、使用场景等信息。"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
                <p className="mt-1 text-xs text-slate-400">支持多段文字，AI 会自动整理结构。</p>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">商品链接</span>
                <textarea
                  value={linksText}
                  onChange={(e) => setLinksText(e.target.value)}
                  rows={3}
                  placeholder="粘贴商品链接，每行一个。支持 1688、阿里国际站、Amazon、TikTok 等平台的公开链接。"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
                <p className="mt-1 text-xs text-slate-400">V1 阶段不自动抓取页面内容，链接用于辅助判断商品来源和平台。</p>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">访问密码</span>
                <input
                  type="password"
                  value={accessPassword}
                  onChange={(e) => setAccessPassword(e.target.value)}
                  placeholder="输入服务端配置的访问密码"
                  className="h-11 w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </label>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="glass-button-primary inline-flex h-11 items-center justify-center px-6 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "识别中..." : hasResult ? "重新识别" : "开始识别"}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearDraft();
                  setError(null);
                  setTasksSaveMessage(null);
                }}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:border-red-200 hover:text-red-700"
              >
                清空当前内容
              </button>
            </div>
          </section>

          {/* Error */}
          {error ? (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-700">{error}</p>
            </section>
          ) : null}

          {/* Loading */}
          {loading ? (
            <section className="surface-card rounded-[28px] p-5">
              <p className="text-sm text-slate-500">AI 正在提取素材信息，请稍等...</p>
            </section>
          ) : null}

          {/* No result yet */}
          {!hasResult && !loading ? (
            <section className="surface-card rounded-[28px] p-5">
              <div className="max-w-2xl">
                <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                  待识别
                </span>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  填写关键词、商品描述或链接后，点击「开始识别」。AI 会提取商品类型、卖点、目标人群、使用场景、痛点和评论需求。
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  素材识别结果为 AI 自动提取，仅供运营参考。原始链接和截图仍需人工保存备查。
                </p>
              </div>
            </section>
          ) : null}

          {/* Results */}
          {result ? (
            <section className="surface-card rounded-[28px] p-5">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">识别结果</h2>
                  <p className="mt-1 text-sm text-slate-500">AI 从素材中提取的结构化信息。</p>
                </div>
                <span
                  className={`inline-flex shrink-0 rounded-full border px-4 py-1.5 text-sm font-bold ${completenessClasses[result.materialCompleteness] || completenessClasses["不完整"]}`}
                >
                  {completenessLabels[result.materialCompleteness] || result.materialCompleteness}
                </span>
              </div>

              {/* Summary */}
              <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">一句话总结</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{result.summary}</p>
              </div>

              {/* Core info grid */}
              <div className="mb-5 grid gap-3 sm:grid-cols-2">
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-semibold text-slate-500">商品类型</p>
                  <p className="mt-1 text-sm font-bold text-slate-950">{result.productType}</p>
                </div>
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-semibold text-slate-500">参考价格带</p>
                  <p className="mt-1 text-sm font-bold text-slate-950">{result.priceRange}</p>
                </div>
              </div>

              {/* Selling points */}
              {result.sellingPoints.length ? (
                <div className="mb-5">
                  <p className="text-sm font-bold text-slate-950">卖点提取</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.sellingPoints.map((sp) => (
                      <span key={sp} className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800">
                        {sp}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Target users */}
              {result.targetUsers.length ? (
                <div className="mb-5">
                  <p className="text-sm font-bold text-slate-950">目标人群</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.targetUsers.map((u) => (
                      <span key={u} className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700">
                        {u}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Usage scenarios */}
              {result.usageScenarios.length ? (
                <div className="mb-5">
                  <p className="text-sm font-bold text-slate-950">使用场景</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.usageScenarios.map((s) => (
                      <span key={s} className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-700">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Pain points */}
              {result.painPoints.length ? (
                <div className="mb-5">
                  <p className="text-sm font-bold text-slate-950">用户痛点</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.painPoints.map((p) => (
                      <span key={p} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-sm font-semibold text-rose-700">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Comment demands */}
              {result.commentDemands.length ? (
                <div className="mb-5">
                  <p className="text-sm font-bold text-slate-950">评论需求 / 用户诉求</p>
                  <ul className="mt-2 space-y-1.5">
                    {result.commentDemands.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
                        <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-slate-400" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Risk words */}
              {result.riskWords.length ? (
                <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-900">⚠️ 敏感词 / 风险词</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.riskWords.map((w) => (
                      <span key={w} className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800">
                        {w}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-amber-700">这些词在素材中出现，请对照平台规则确认是否需要修改。</p>
                </div>
              ) : null}

              {/* Missing info */}
              {result.missingInfo.length ? (
                <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-bold text-slate-900">建议补充的信息</p>
                  <ul className="mt-2 space-y-1">
                    {result.missingInfo.map((m, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-6 text-slate-600">
                        <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-slate-400" />
                        {m}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {/* 工作流建议与人工确认 */}
          {result ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <WorkflowNextStepCard taskType="material" />
              <ManualReviewChecklist />
            </div>
          ) : null}

          {/* Save to task center */}
          {result ? (
            <section className="surface-card rounded-[28px] p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-600">保存分析结果</p>
                  <p className="mt-1 text-sm text-slate-500">将素材识别结果保存到任务中心，方便后续查阅。</p>
                </div>
                <button
                  type="button"
                  onClick={handleSaveToTaskCenter}
                  disabled={savingToTasks}
                  className="glass-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingToTasks ? "保存中" : "保存到任务中心"}
                </button>
              </div>
              {tasksSaveMessage ? (
                <p className={`mt-3 rounded-lg border px-3 py-1.5 text-xs ${tasksSaveMessage.includes("失败") ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                  {tasksSaveMessage}
                </p>
              ) : null}
            </section>
          ) : null}

          {/* 下一步 */}
          <section className="surface-card rounded-[28px] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-600">素材整理完成 → 下一步</p>
                <p className="mt-1 text-sm text-slate-500">素材识别完了，去判断这个品类能不能进货。</p>
              </div>
              <Link
                href="/sourcing"
                className="glass-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold"
              >
                货源判断 → Step 1
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
