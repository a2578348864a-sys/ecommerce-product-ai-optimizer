"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { CROSS_BORDER_PLATFORMS } from "@/lib/types";
import { useSharedProduct } from "@/hooks/useSharedProduct";
import { useLocalDraft } from "@/hooks/useLocalDraft";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { WorkspaceLockedPrompt } from "@/components/WorkspaceLockedPrompt";
import { WorkflowNextStepCard } from "@/components/WorkflowNextStepCard";
import { ManualReviewChecklist } from "@/components/ManualReviewChecklist";
import { EXAMPLE_SOURCING } from "@/lib/examples";

type SourcingPriceBand = {
  min: string;
  max: string;
  unit: string;
  note: string;
};

type SourcingRisk = {
  title: string;
  description: string;
  suggestion: string;
};

type BeginnerFit = "high" | "medium" | "low";
type BarrierLevel = "low" | "medium" | "high";
type EntryLevel = "beginner" | "intermediate" | "experienced";

type SourcingData = {
  feasibility: "high" | "medium" | "low";
  summary: string;
  searchKeywords: string[];
  alternativeDirections: string[];
  priceBand: SourcingPriceBand;
  moqEstimate: string;
  beginnerFriendly: boolean;
  beginnerFit?: BeginnerFit;
  complianceBarrier?: BarrierLevel;
  logisticsDifficulty?: BarrierLevel;
  afterSalesRisk?: BarrierLevel;
  suggestedEntryLevel?: EntryLevel;
  risks: SourcingRisk[];
  nextSteps: string[];
};

type ApiResponse =
  | { ok: true; data: SourcingData }
  | { ok: false; error: { code: string; message: string } };

type SaveTaskResponse =
  | { ok: true; data: { id: string } }
  | { ok: false; error: { code?: string; message?: string } };

type SourcingDraft = {
  productName: string;
  category: string;
  targetPrice: string;
  targetPlatform: string;
  description: string;
  result: SourcingData | null;
};

const feasibilityLabels: Record<string, string> = { high: "好找货源", medium: "一般", low: "较难找" };
const feasibilityClasses: Record<string, string> = {
  high: "border-emerald-200 bg-emerald-50 text-emerald-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-red-200 bg-red-50 text-red-700",
};

const feasibilityScores: Record<SourcingData["feasibility"], number> = {
  high: 85,
  medium: 60,
  low: 30,
};

const defaultCategories = [
  "服装配饰", "鞋靴箱包", "美妆个护", "3C数码", "家居日用",
  "母婴用品", "食品饮料", "运动户外", "宠物用品", "玩具乐器",
  "汽车用品", "医疗器械", "成人用品", "珠宝首饰", "其他",
];

function isApiResponse(value: unknown): value is ApiResponse {
  return typeof value === "object" && value !== null && "ok" in value;
}

export function SourcingForm() {
  const [sharedProduct, updateShared] = useSharedProduct();
  const { draftValue, setDraftValue, clearDraft, restored } = useLocalDraft<SourcingDraft>({
    storageKey: "qx:draft:sourcing:v1",
    initialValue: {
      productName: sharedProduct.productName,
      category: sharedProduct.category,
      targetPrice: sharedProduct.targetPrice,
      targetPlatform: sharedProduct.targetPlatform,
      description: sharedProduct.description,
      result: null,
    },
  });
  const { productName, category, targetPrice, targetPlatform, description, result } = draftValue;
  const updateDraft = (patch: Partial<SourcingDraft>) => {
    setDraftValue((current) => ({ ...current, ...patch }));
  };
  const setProductName = (value: string) => updateDraft({ productName: value });
  const setCategory = (value: string) => updateDraft({ category: value });
  const setTargetPrice = (value: string) => updateDraft({ targetPrice: value });
  const setTargetPlatform = (value: string) => updateDraft({ targetPlatform: value });
  const setDescription = (value: string) => updateDraft({ description: value });
  const setResult = (value: SourcingData | null) => updateDraft({ result: value });
  const [accessPassword, setAccessPassword, isAccessPasswordReady] = useAccessPassword();
  const unlocked = isAccessPasswordReady && accessPassword.trim().length > 0;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync back to shared product on change (debounced)
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncToShared = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      updateShared({ productName, category, targetPlatform, description, targetPrice });
    }, 500);
  }, [productName, category, targetPlatform, description, targetPrice, updateShared]);

  useEffect(() => {
    syncToShared();
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [syncToShared]);

  function fillExample() {
    setProductName(EXAMPLE_SOURCING.productName);
    setCategory(EXAMPLE_SOURCING.category);
    setTargetPrice(EXAMPLE_SOURCING.targetPrice);
    setTargetPlatform(EXAMPLE_SOURCING.targetPlatform);
    setDescription(EXAMPLE_SOURCING.description);
    setSaveMessage(null);
    setSaveError(null);
    setError(null);
  }

  async function handleSubmit() {
    if (loading) return;
    if (!isAccessPasswordReady) { setError("正在读取访问状态，请稍后再试。"); return; }
    if (!productName.trim()) { setError("请先填写商品名称。"); return; }
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) { setError("访问密码缺失或已过期，请先在首页输入访问密码。"); return; }

    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/agents/sourcing", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({
          productName: productName.trim(),
          category: category.trim(),
          targetPrice: targetPrice.trim(),
          targetPlatform,
          description: description.trim(),
          accessPassword: accessPassword.trim(),
        }),
      });

      let payload: unknown;
      try { payload = await response.json(); } catch { setError("服务端返回格式异常。"); return; }
      if (!isApiResponse(payload)) { setError("服务端返回格式异常。"); return; }
      if (payload.ok) {
        setResult(payload.data);
        setSaveMessage(null);
        setSaveError(null);
        return;
      }
      setError(response.status === 401 || response.status === 403 ? "访问密码不正确，请重新输入。" : payload.error.message || "AI 请求失败，请稍后重试。");
    } catch {
      setError("AI 请求失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveToTaskCenter() {
    if (!result || savingTask) return;
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setSaveError("请先输入访问密码后保存到任务中心。");
      return;
    }

    setSavingTask(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({
          accessPassword,
          type: "sourcing",
          title: productName.trim(),
          productName: productName.trim(),
          platform: targetPlatform || "manual",
          source: "ai",
          materialText: description.trim() || productName.trim(),
          result: {
            ...result,
            productName: productName.trim(),
            category: category.trim(),
            targetPrice: targetPrice.trim(),
            targetPlatform,
            description: description.trim(),
            score: feasibilityScores[result.feasibility],
            level: result.feasibility,
            oneLineSummary: result.summary,
          },
        }),
      });
      const data = await response.json() as SaveTaskResponse;
      if (!response.ok || !data.ok) {
        setSaveError(data.ok ? "保存到任务中心失败。" : data.error?.message || "保存到任务中心失败。");
        return;
      }
      setSaveMessage("已保存到任务中心");
    } catch {
      setSaveError("网络异常，保存到任务中心失败。");
    } finally {
      setSavingTask(false);
    }
  }

  if (!unlocked) {
    return <WorkspaceLockedPrompt pageName="货源判断" returnUrl="/sourcing" />;
  }

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="min-w-0 space-y-6">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">轻选工作台</p>
              <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">货源判断</h1>
              <p className="muted-text mt-1 text-sm">判断货源可行性、搜索关键词、价格带和新手可操作性，仅供参考不做采购决策。</p>
            </div>
            <WorkspaceMobileNav />
          </header>

          {/* Form */}
          <section className="surface-card rounded-[28px] p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-950">商品货源信息</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  填写商品基本信息后，AI 会给出 1688 搜索词、替代品方向、价格带和新手建议。
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
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">商品名称 *</span>
                  <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)}
                    placeholder="例如：硅胶折叠水杯、铝合金折叠桌" className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">商品品类</span>
                  <input type="text" list="sourcing-category-list" value={category} onChange={(e) => setCategory(e.target.value)}
                    placeholder="例如：家居日用、户外用品、宠物用品" className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
                  <datalist id="sourcing-category-list">
                    {defaultCategories.map((cat) => (<option key={cat} value={cat} />))}
                  </datalist>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">目标售价</span>
                  <input type="text" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)}
                    placeholder="例如：19.99 USD"
                    className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
                  <p className="mt-1 text-xs text-slate-400">填写计划售价，AI 会据此估算采购成本是否有利润空间。</p>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">目标平台</span>
                  <select value={targetPlatform} onChange={(e) => setTargetPlatform(e.target.value)}
                    className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100">
                    {CROSS_BORDER_PLATFORMS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">商品描述</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
                  placeholder="简单描述商品材质、规格、功能和目标客群。" className="w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
              </label>

              {/* Access password — removed from this page, now only on home */}

              <button type="button" onClick={handleSubmit} disabled={loading}
                className="glass-button-primary inline-flex h-11 items-center justify-center px-6 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60">
                {loading ? "分析中..." : result ? "重新判断" : "开始货源判断"}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearDraft();
                  setError(null);
                  setSaveMessage(null);
                  setSaveError(null);
                }}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:border-red-200 hover:text-red-700"
              >
                清空当前内容
              </button>
            </div>
          </section>

          {error ? (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-sm text-red-700">{error}</p></section>
          ) : null}

          {loading ? (
            <section className="surface-card rounded-[28px] p-5"><p className="text-sm text-slate-500">AI 正在分析货源可行性，请稍等...</p></section>
          ) : null}

          {!result && !loading ? (
            <section className="surface-card rounded-[28px] p-5">
              <div className="max-w-2xl">
                <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">待判断</span>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  填写商品名称、品类和目标售价后，点击「开始货源判断」。AI 会从 1688 搜索词、替代品方向、价格带、MOQ 和采购风险等维度做分析。
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-400">AI 结果仅供运营参考，采购前必须人工联系供应商核实价格、品质和交期。</p>
              </div>
            </section>
          ) : null}

          {result ? (
            <section className="surface-card rounded-[28px] p-5">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">货源判断结果</h2>
                  <p className="mt-1 text-sm text-slate-500">AI 辅助分析，最终决策需人工核实供应商。</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full border px-4 py-1.5 text-sm font-bold ${feasibilityClasses[result.feasibility]}`}>
                    {feasibilityLabels[result.feasibility]}
                  </span>
                  <button
                    type="button"
                    onClick={handleSaveToTaskCenter}
                    disabled={savingTask}
                    className="glass-button-primary inline-flex h-10 items-center justify-center px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingTask ? "保存中..." : "保存到任务中心"}
                  </button>
                </div>
              </div>

              {saveMessage ? (
                <p className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{saveMessage}</p>
              ) : null}
              {saveError ? (
                <p className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</p>
              ) : null}

              <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">综合判断</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{result.summary}</p>
              </div>

              {/* Search keywords */}
              {result.searchKeywords.length ? (
                <div className="mb-5">
                  <p className="text-sm font-bold text-slate-950">1688 搜索关键词</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.searchKeywords.map((kw) => (
                      <span key={kw} className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800">{kw}</span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Alternatives */}
              {result.alternativeDirections.length ? (
                <div className="mb-5">
                  <p className="text-sm font-bold text-slate-950">替代品 / 近似品方向</p>
                  <ul className="mt-2 space-y-2">
                    {result.alternativeDirections.map((d, i) => (
                      <li key={i} className="surface-card-soft rounded-[18px] p-3 text-sm leading-6 text-slate-700">{d}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Price + MOQ */}
              <div className="mb-5 grid gap-3 sm:grid-cols-2">
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-semibold text-slate-500">估算采购价格带</p>
                  <p className="mt-1 text-xl font-bold text-slate-950">
                    {result.priceBand.min === result.priceBand.max ? result.priceBand.min : `${result.priceBand.min} - ${result.priceBand.max}`} {result.priceBand.unit}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{result.priceBand.note}</p>
                </div>
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-semibold text-slate-500">起订量 / MOQ 估计</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{result.moqEstimate}</p>
                </div>
              </div>

              {/* Risks */}
              {result.risks.length ? (
                <div className="mb-5">
                  <p className="text-sm font-bold text-slate-950">采购风险提示</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {result.risks.map((r, i) => (
                      <div key={i} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-sm font-bold text-amber-900">{r.title}</p>
                        <p className="mt-1 text-sm leading-6 text-amber-800">{r.description}</p>
                        <p className="mt-1 text-xs leading-5 text-amber-700"><span className="font-semibold">建议：</span>{r.suggestion}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Next steps */}
              {result.nextSteps.length ? (
                <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-4">
                  <p className="text-sm font-bold text-teal-900">下一步行动</p>
                  <ul className="mt-2 space-y-1.5">
                    {result.nextSteps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-6 text-teal-800">
                        <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-teal-500" />
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${result.beginnerFriendly ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {result.beginnerFriendly ? "适合新手操作" : "建议有经验者操作"}
                  </span>
                  <span className="text-xs text-slate-500">
                    {result.beginnerFriendly ? "小白运营可以独立完成选品和采购。" : "该品类采购复杂度较高，建议找有经验的采购或服务商。"}
                  </span>
                </div>

                {result.beginnerFit || result.complianceBarrier || result.logisticsDifficulty || result.afterSalesRisk || result.suggestedEntryLevel ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {result.beginnerFit ? (
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                        <p className="text-[11px] font-semibold text-slate-400">新手适合度</p>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                          result.beginnerFit === "high" ? "bg-emerald-50 text-emerald-700" :
                          result.beginnerFit === "medium" ? "bg-amber-50 text-amber-700" :
                          "bg-red-50 text-red-700"
                        }`}>
                          {result.beginnerFit === "high" ? "高" : result.beginnerFit === "medium" ? "中" : "低"}
                        </span>
                      </div>
                    ) : null}
                    {result.complianceBarrier ? (
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                        <p className="text-[11px] font-semibold text-slate-400">合规门槛</p>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                          result.complianceBarrier === "low" ? "bg-emerald-50 text-emerald-700" :
                          result.complianceBarrier === "medium" ? "bg-amber-50 text-amber-700" :
                          "bg-red-50 text-red-700"
                        }`}>
                          {result.complianceBarrier === "low" ? "低" : result.complianceBarrier === "medium" ? "中" : "高"}
                        </span>
                      </div>
                    ) : null}
                    {result.logisticsDifficulty ? (
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                        <p className="text-[11px] font-semibold text-slate-400">物流难度</p>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                          result.logisticsDifficulty === "low" ? "bg-emerald-50 text-emerald-700" :
                          result.logisticsDifficulty === "medium" ? "bg-amber-50 text-amber-700" :
                          "bg-red-50 text-red-700"
                        }`}>
                          {result.logisticsDifficulty === "low" ? "低" : result.logisticsDifficulty === "medium" ? "中" : "高"}
                        </span>
                      </div>
                    ) : null}
                    {result.afterSalesRisk ? (
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                        <p className="text-[11px] font-semibold text-slate-400">售后风险</p>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                          result.afterSalesRisk === "low" ? "bg-emerald-50 text-emerald-700" :
                          result.afterSalesRisk === "medium" ? "bg-amber-50 text-amber-700" :
                          "bg-red-50 text-red-700"
                        }`}>
                          {result.afterSalesRisk === "low" ? "低" : result.afterSalesRisk === "medium" ? "中" : "高"}
                        </span>
                      </div>
                    ) : null}
                    {result.suggestedEntryLevel ? (
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                        <p className="text-[11px] font-semibold text-slate-400">建议入门级别</p>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                          result.suggestedEntryLevel === "beginner" ? "bg-emerald-50 text-emerald-700" :
                          result.suggestedEntryLevel === "intermediate" ? "bg-amber-50 text-amber-700" :
                          "bg-red-50 text-red-700"
                        }`}>
                          {result.suggestedEntryLevel === "beginner" ? "小白可做" : result.suggestedEntryLevel === "intermediate" ? "有经验可做" : "需资深运营"}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* 工作流建议与人工确认 */}
          {result ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <WorkflowNextStepCard taskType="sourcing" />
              <ManualReviewChecklist />
            </div>
          ) : null}

          {/* 下一步 */}
          <section className="surface-card rounded-[28px] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-600">Step 1 完成 → 下一步</p>
                <p className="mt-1 text-sm text-slate-500">知道货源了，接下来检查这个品类有没有坑。</p>
              </div>
              <Link href="/risk" className="glass-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold">
                风险排查 → Step 2
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
