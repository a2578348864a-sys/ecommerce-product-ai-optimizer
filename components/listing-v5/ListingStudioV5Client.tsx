"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  ChevronDown,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  FileText,
} from "lucide-react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { copyPlainText } from "@/lib/client/copyPlainText";

type V5Data = {
  context: {
    researchRevision: number;
    handoffRevision: number;
    factCount: number;
    referenceCounts: {
      voc: number;
      keywords: number;
      competitors: number;
      sourcing: number;
    };
  };
  snapshot: any;
};

const TRACE_REASON_LABELS: Record<string, string> = {
  none: "无失败",
  stage_not_run: "本轮未执行",
  provider_disabled: "未启用真实 AI（确定性回退）",
  provider_not_started: "请求未发出（Provider 配置缺失）",
  provider_request_failed: "Provider 请求失败",
  provider_empty_response: "Provider 返回空内容",
  provider_response_not_json: "返回内容无法解析为 JSON",
  schema_normalization_failed: "返回结构与 Writer Schema 不匹配",
  repair_not_allowed: "校验状态不允许修复",
  repair_target_missing: "没有可修复字段",
  repair_response_shape_invalid: "修复返回结构不符",
  repair_apply_failed: "修复结果无法应用",
};

const TRACE_FALLBACK_LABELS: Record<string, string> = {
  none: "未使用",
  writer_stage_failed: "Writer 阶段失败 → 回退到安全稿",
  validation_blocked: "Validator 阻断 AI 草稿 → 回退到安全稿",
};

function traceConclusion(trace: any) {
  if (!trace) return "";
  const reason = (value: string) => TRACE_REASON_LABELS[value] ?? value;
  if (trace.strategySuccess && trace.writerSuccess && !trace.fallbackUsed) {
    return "AI 调用成功（Strategy + Writer），未使用 fallback。";
  }
  if (trace.fallbackReason === "validation_blocked") {
    return `AI 调用成功，但 Validator 阻断（${trace.validationStatus}）→ 使用安全回退。`;
  }
  if (!trace.writerSuccess && trace.writerAttempted) {
    return `失败发生在 Writer 阶段：${reason(trace.writerFailureReason)} → 使用安全回退。`;
  }
  if (!trace.strategySuccess && trace.strategyAttempted) {
    return `失败发生在 Strategy 阶段：${reason(trace.strategyFailureReason)}${
      trace.writerSuccess ? "（Writer 仍成功）" : " → 使用安全回退"
    }。`;
  }
  if (!trace.strategyAttempted && !trace.writerAttempted) {
    return `未调用 AI：${reason(trace.writerFailureReason)}。`;
  }
  return "请查看下方各阶段结果。";
}

export function ListingStudioV5Client({ taskId }: { taskId: string }) {
  const [data, setData] = useState<V5Data | null>(null);
  const [pendingAction, setPendingAction] = useState<null | "analyze_strategy" | "generate">(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [confirmRealAi, setConfirmRealAi] = useState(false);
  // Server-authoritative: the checkbox can only ever confirm a provider call the
  // server is actually willing to make.
  const [realAiEnabled, setRealAiEnabled] = useState<boolean | null>(null);
  const busy = pendingAction !== null;

  const load = useCallback(async () => {
    if (!taskId) return;
    setError("");
    try {
      const response = await fetch(
        `/api/tasks/${encodeURIComponent(taskId)}/listing-v5`,
        { cache: "no-store", headers: buildAccessHeaders() }
      );
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        setError(json?.error?.message || "无法读取 Listing V5。");
        return;
      }
      setData(json.data);
      setRealAiEnabled(json.data?.realAiEnabled === true);
    } catch {
      setError("网络异常，无法读取 Listing V5。请重试。");
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: "analyze_strategy" | "generate") => {
    setPendingAction(action);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/tasks/${encodeURIComponent(taskId)}/listing-v5`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildAccessHeaders(),
          },
          body: JSON.stringify({
            action,
            ...(action === "analyze_strategy" ? { forceStrategy: true } : {}),
            ...(confirmRealAi && realAiEnabled === true ? { confirmRealAi: true } : {}),
          }),
        }
      );
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        setError(json?.error?.message || "操作失败，请刷新后重试。");
        return;
      }
      await load();
      setNotice(
        action === "analyze_strategy"
          ? `策略已重新分析完成（${new Date().toLocaleTimeString()}）`
          : `Listing 已生成（${new Date().toLocaleTimeString()}）`
      );
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setPendingAction(null);
    }
  };

  const handleCopy = async (text: string, key: string, label = "已复制") => {
    if (!text) return;
    const ok = await copyPlainText(text);
    if (ok) {
      setCopiedKey(key);
      setCopyStatus(label);
      setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
        setCopyStatus("");
      }, 2000);
    } else {
      setCopyStatus("复制失败，请手动选择文案");
      setTimeout(() => setCopyStatus(""), 3000);
    }
  };

  if (!taskId) {
    return (
      <div className="mt-4 w-full rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        <p className="font-semibold">请从研究任务进入 Listing Studio。</p>
        <p className="mt-1 text-xs text-amber-800">
          当前地址没有 taskId，无法确定要为哪个商品生成 Listing。
        </p>
        <Link
          href="/tasks"
          className="mt-3 inline-flex h-9 items-center justify-center rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100"
        >
          返回研究记录
        </Link>
      </div>
    );
  }

  const snapshot = data?.snapshot;
  const strategy = snapshot?.strategy;
  const listing = snapshot?.listing;
  const validation = snapshot?.validation;
  const provider = snapshot?.provider;
  const trace = snapshot?.trace;
  const traceStages: Array<[string, any]> = trace
    ? [
        ["Strategy", trace.stages?.strategy],
        ["Writer", trace.stages?.writer],
        ["Repair", trace.stages?.repair],
      ]
    : [];

  const copyFullListing = async () => {
    if (!listing) return;
    const text = [
      listing.title?.text,
      ...(listing.bullets ?? []).map((item: any) => item.text),
      listing.description?.text,
      (listing.backendSearchTerms ?? []).join(", "),
    ]
      .filter(Boolean)
      .join("\n\n");
    await handleCopy(text, "full", "已复制完整 Listing");
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-16 pt-1 sm:gap-5">
      {/* 阶段导航条 (Workflow Progress Rail) */}
      <div className="grid w-full min-w-0 grid-cols-3 gap-2 rounded-2xl border border-slate-200/90 bg-white p-2 shadow-xs">
        <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-semibold text-emerald-800">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] text-white">
            ✓
          </span>
          <span className="truncate">01 资料确认</span>
        </div>
        <div
          className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
            strategy
              ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
              : "border-slate-200 bg-slate-50 text-slate-500"
          }`}
        >
          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
              strategy ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"
            }`}
          >
            {strategy ? "✓" : "02"}
          </span>
          <span className="truncate">02 营销策略</span>
        </div>
        <div
          className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
            listing
              ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
              : "border-slate-200 bg-slate-50 text-slate-500"
          }`}
        >
          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
              listing ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"
            }`}
          >
            {listing ? "✓" : "03"}
          </span>
          <span className="truncate">03 生成草稿</span>
        </div>
      </div>

      {/* 模块 1：已确认事实与研究资料摘要 */}
      <section className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-emerald-200/80 bg-emerald-50/80 px-2 py-0.5 text-xs font-bold text-emerald-700">
              研究依据
            </span>
            <span className="text-xs font-medium text-slate-500">
              来自商品研究确认事实，禁止虚构
            </span>
          </div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            待人工复核
          </span>
        </div>

        {data ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">
              创作资料已确认
            </span>
            <span className="rounded-md border border-slate-200/80 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
              已确认事实: <strong className="font-mono text-slate-900">{data.context.factCount}</strong>
            </span>
            <span className="rounded-md border border-slate-200/80 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
              VOC 洞察: <strong className="font-mono text-slate-900">{data.context.referenceCounts.voc}</strong>
            </span>
            <span className="rounded-md border border-slate-200/80 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
              关键词: <strong className="font-mono text-slate-900">{data.context.referenceCounts.keywords}</strong>
            </span>
            <span className="rounded-md border border-slate-200/80 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
              竞品参考: <strong className="font-mono text-slate-900">{data.context.referenceCounts.competitors}</strong>
            </span>
            <span className="rounded-md border border-slate-200/80 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
              1688 货源: <strong className="font-mono text-slate-900">{data.context.referenceCounts.sourcing}</strong>
            </span>
            <span className="font-medium text-amber-700">
              最终人工复核: 必须
            </span>
          </div>
        ) : null}
      </section>

      {/* 模块 2：营销文案策略 (白底 + 结构化信息框，彻底消除大紫卡) */}
      <section className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">
                营销文案策略
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              来自 VOC / 关键词 / 竞品研究，仅用于指导表达策略，不属于商品事实。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void run("analyze_strategy")}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${pendingAction === "analyze_strategy" ? "animate-spin text-emerald-600" : "text-slate-500"}`}
            />
            {pendingAction === "analyze_strategy" ? "分析中…" : "重新分析策略"}
          </button>
        </div>

        <label className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200/70 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={confirmRealAi}
            disabled={realAiEnabled !== true}
            onChange={(event) => setConfirmRealAi(event.target.checked)}
            className="size-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
          />
          <span>
            {realAiEnabled === true
              ? "确认本次可以调用已配置的真实 AI；未勾选时仅使用确定性安全回退。"
              : "服务端未启用真实 AI（OPENAI_LISTING_ENABLED != true），本次只能使用确定性安全回退，勾选不会调用 AI。"}
          </span>
        </label>

        {notice ? (
          <p role="status" className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
            {notice}
          </p>
        ) : null}

        {strategy ? (
          <div className="mt-3.5 space-y-3">
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col justify-between rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
                <span className="text-[11px] font-semibold text-slate-400">
                  目标买家
                </span>
                <p className="mt-1 text-xs font-medium text-slate-800 leading-relaxed">
                  {strategy.targetAudience?.join("、") || "通用消费者"}
                </p>
              </div>
              <div className="flex flex-col justify-between rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
                <span className="text-[11px] font-semibold text-slate-400">
                  核心需求 / 痛点
                </span>
                <p className="mt-1 text-xs font-medium text-slate-800 leading-relaxed">
                  {strategy.purchaseMotivations?.join("、") || "按已确认资料表达"}
                </p>
              </div>
              <div className="flex flex-col justify-between rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
                <span className="text-[11px] font-semibold text-slate-400">
                  主表达角度
                </span>
                <p className="mt-1 text-xs font-medium text-slate-800 leading-relaxed">
                  {strategy.primaryAngle || "事实优先"}
                </p>
              </div>
              <div className="flex flex-col justify-between rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
                <span className="text-[11px] font-semibold text-slate-400">
                  文案语气
                </span>
                <p className="mt-1 text-xs font-medium text-slate-800 leading-relaxed">
                  {strategy.tone?.join("、") || "清晰、专业"}
                </p>
              </div>
              <div className="flex flex-col justify-between rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
                <span className="text-[11px] font-semibold text-slate-400">
                  使用场景
                </span>
                <p className="mt-1 text-xs font-medium text-slate-800 leading-relaxed">
                  {strategy.useCases?.join("、") || "日常使用"}
                </p>
              </div>
              <div className="flex flex-col justify-between rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
                <span className="text-[11px] font-semibold text-rose-500">
                  避免表达
                </span>
                <p className="mt-1 text-xs font-medium text-slate-800 leading-relaxed">
                  {strategy.avoidClaims?.join("、") || "避免夸大或未经核实声明"}
                </p>
              </div>
            </div>

            <details className="group rounded-xl border border-slate-200/70 bg-slate-50/30 p-2.5 text-xs">
              <summary className="flex cursor-pointer select-none items-center justify-between font-semibold text-slate-700 hover:text-emerald-700">
                <span>展开详细策略指南</span>
                <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2 text-slate-600">
                <p>
                  <strong className="text-slate-800">Bullet 表达方式：</strong>
                  根据已确认事实与营销策略组织不同卖点表达，不强制单一结构。
                </p>
                <p>
                  <strong className="text-slate-800">标题方法：</strong>
                  先说清产品类型和已确认主属性，再自然带出核心场景。
                </p>
                <p>
                  <strong className="text-slate-800">描述方法：</strong>
                  产品是什么 → 对用户的价值与体验 → 合理使用场景。
                </p>
              </div>
            </details>
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">
            尚未分析营销策略。点击上方“重新分析策略”生成参考策略。
          </p>
        )}
      </section>

      {/* 模块 3：Listing 草稿核心工作台 (V4 编辑器质感) */}
      <section className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">Listing 草稿</h2>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              Listing 交付结果
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {listing ? (
              <span className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                <Check className="h-3 w-3 text-emerald-600" />
                安全检查通过
              </span>
            ) : null}
            {provider?.fallbackUsed ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                Safe Fallback · 基础安全稿
              </span>
            ) : null}
          </div>
        </div>

        {/* 操作栏 */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {listing
              ? `基于 ${data?.context?.factCount ?? 0} 项已确认商品事实 · ${
                  listing.bullets?.length ?? 0
                } 条五点 · 需人工复核，不得直接发布`
              : "准备就绪后点击生成 Listing 草稿"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void run("generate")}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${pendingAction === "generate" ? "animate-spin text-emerald-600" : "text-slate-500"}`}
              />
              {pendingAction === "generate" ? "生成中…" : listing ? "重新生成" : "生成 Listing"}
            </button>
            <button
              type="button"
              onClick={() => void copyFullListing()}
              disabled={!listing}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-800 disabled:opacity-50"
            >
              {copiedKey === "full" ? (
                <Check className="h-3.5 w-3.5 text-emerald-200" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copiedKey === "full" ? "已复制全部" : "复制完整 Listing"}
            </button>
            {copyStatus && copiedKey !== "full" ? (
              <span role="status" className="text-xs font-medium text-emerald-600">
                {copyStatus}
              </span>
            ) : null}
          </div>
        </div>

        {listing ? (
          <div className="mt-4 space-y-4">
            {/* 策略落位摘要条 */}
            {strategy ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-xs text-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-800">
                    本次采用策略:
                  </span>
                  <span>{strategy.primaryAngle || "事实优先"}</span>
                  <span className="text-slate-400">·</span>
                  <span>主打 {strategy.targetAudience?.[0] || "目标人群"}</span>
                  <span className="text-slate-400">·</span>
                  <span>语气 {strategy.tone?.[0] || "专业"}</span>
                </div>
                <span className="rounded border border-emerald-200 bg-emerald-100/70 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                  ✓ 已应用到本次 Listing
                </span>
              </div>
            ) : null}

            {/* Title 分区 */}
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 transition-colors hover:border-slate-300">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                    Listing 标题 TITLE
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                    {listing.title?.text?.length ?? 0} 字符
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void handleCopy(listing.title?.text, "title", "标题已复制")
                  }
                  className="flex items-center gap-1 rounded-md border border-slate-200/80 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                  {copiedKey === "title" ? (
                    <Check className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copiedKey === "title" ? "已复制" : "复制标题"}
                </button>
              </div>
              <p className="mt-2.5 text-sm font-semibold leading-relaxed text-slate-900 sm:text-base">
                {listing.title?.text || "暂无标题"}
              </p>
            </div>

            {/* Bullet Points 分区 */}
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 transition-colors hover:border-slate-300">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                    五点描述 BULLET POINTS
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                    {listing.bullets?.length ?? 0} 条要点
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const allBullets = (listing.bullets ?? [])
                      .map((b: any) => b.text)
                      .join("\n");
                    void handleCopy(allBullets, "bullets", "五点已复制");
                  }}
                  className="flex items-center gap-1 rounded-md border border-slate-200/80 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                  {copiedKey === "bullets" ? (
                    <Check className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copiedKey === "bullets" ? "已复制" : "复制五点描述"}
                </button>
              </div>

              <div className="mt-2.5 space-y-2">
                {(listing.bullets ?? []).map((bullet: any, idx: number) => (
                  <div
                    key={`${idx}-${bullet.text?.slice(0, 20)}`}
                    className="group relative flex items-start gap-2.5 rounded-lg border border-slate-100 bg-slate-50/40 p-2.5 transition-colors hover:border-slate-200 hover:bg-slate-50/80"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-emerald-200 bg-emerald-50 font-mono text-xs font-bold text-emerald-700">
                      {idx + 1}
                    </span>
                    <p className="flex-1 text-xs font-medium leading-relaxed text-slate-800 sm:text-sm">
                      {bullet.text}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        void handleCopy(
                          bullet.text,
                          `bullet-${idx}`,
                          `第 ${idx + 1} 点已复制`
                        )
                      }
                      title="复制此条"
                      className="shrink-0 rounded p-1 text-slate-400 opacity-60 transition-opacity hover:bg-slate-200/60 hover:text-slate-700 group-hover:opacity-100"
                    >
                      {copiedKey === `bullet-${idx}` ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Description 分区 */}
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 transition-colors hover:border-slate-300">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                    商品描述 PRODUCT DESCRIPTION
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                    {listing.description?.text?.length ?? 0} 字符
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void handleCopy(
                      listing.description?.text,
                      "description",
                      "描述已复制"
                    )
                  }
                  className="flex items-center gap-1 rounded-md border border-slate-200/80 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                  {copiedKey === "description" ? (
                    <Check className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copiedKey === "description" ? "已复制" : "复制商品描述"}
                </button>
              </div>
              <p className="mt-2.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-800 sm:text-sm">
                {listing.description?.text || "暂无商品描述"}
              </p>
            </div>

            {/* Search Terms 分区 */}
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 transition-colors hover:border-slate-300">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                    搜索关键词 KEYWORDS
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                    {(listing.backendSearchTerms ?? []).length} 个词
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void handleCopy(
                      (listing.backendSearchTerms ?? []).join(", "),
                      "keywords",
                      "搜索词已复制"
                    )
                  }
                  className="flex items-center gap-1 rounded-md border border-slate-200/80 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                  {copiedKey === "keywords" ? (
                    <Check className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copiedKey === "keywords" ? "已复制" : "复制关键词"}
                </button>
              </div>
              <div className="mt-2.5">
                {(listing.backendSearchTerms ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {listing.backendSearchTerms.map((term: string) => (
                      <span
                        key={term}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs font-medium text-slate-700"
                      >
                        {term}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    由已确认关键词方案提供。
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-8 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 p-8 text-center">
            <FileText className="h-8 w-8 text-slate-300" />
            <p className="mt-2 text-xs font-semibold text-slate-700">
              尚未生成 Listing 草稿
            </p>
            <p className="mt-1 text-xs text-slate-500">
              点击上方“生成 Listing”基于确认事实生成标题、五点、描述与关键词。
            </p>
          </div>
        )}
      </section>

      {/* 模块 4：事实安全与人工复核 */}
      <section className="w-full min-w-0 rounded-2xl border border-emerald-200/80 bg-emerald-50/30 p-4 shadow-xs sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900 sm:text-base">
              事实安全与人工复核
            </h2>
          </div>
          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
            已校验
          </span>
        </div>

        <div className="mt-3 grid gap-2 text-xs font-medium text-slate-700 sm:grid-cols-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200/60 bg-white/80 px-3 py-2 text-emerald-800">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-[10px] text-emerald-700 font-bold">
              ✓
            </span>
            <span>仅使用已确认事实</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200/60 bg-white/80 px-3 py-2 text-emerald-800">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-[10px] text-emerald-700 font-bold">
              ✓
            </span>
            <span>Claim / Runtime / Copy 校验</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-200/60 bg-white/80 px-3 py-2 text-amber-800">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-[10px] text-amber-700 font-bold">
              !
            </span>
            <span>需要人工复核后发布</span>
          </div>
        </div>

        {validation ? (
          <details className="group mt-3 rounded-xl border border-emerald-200/60 bg-white/80 p-3 text-xs text-slate-700">
            <summary className="flex cursor-pointer select-none items-center justify-between font-semibold text-slate-800 hover:text-emerald-700">
              <span>查看审核依据与校验细节</span>
              <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2 text-slate-600">
              <p>
                <strong>校验状态：</strong>
                {validation.status === "PASS"
                  ? "校验通过"
                  : validation.status === "REPAIRABLE"
                  ? "已自动修复，仍需人工复核"
                  : "需要人工处理"}
              </p>
              <p>
                <strong>人工复核提示：</strong>
                {(validation.bulletIssueCount ?? 0) +
                  (validation.unsupportedClaimCount ?? 0) +
                  (validation.prohibitedClaimCount ?? 0) +
                  (validation.competitorOverlapCount ?? 0)}{" "}
                项注意点
              </p>
              <p>
                <strong>生成方式：</strong>
                {provider?.fallbackUsed ? "基础安全稿" : "AI 草稿"}
                ；所有事实仍以已确认资料为准。
              </p>
            </div>
          </details>
        ) : null}

        {snapshot?.qualityEvaluation ? (
          <details
            data-testid="listing-v5-quality-evaluation"
            open
            className="group mt-3 rounded-xl border border-sky-200/60 bg-white/80 p-3 text-xs text-slate-700"
          >
            <summary className="flex cursor-pointer select-none items-center justify-between font-semibold text-slate-800 hover:text-sky-700">
              <span>
                转化质量评分 · {snapshot.qualityEvaluation.grade}（{snapshot.qualityEvaluation.total}/{snapshot.qualityEvaluation.max}）
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2.5 space-y-2.5 border-t border-slate-100 pt-2.5">
              {snapshot.qualityEvaluation.dimensions.map((dimension: any) => (
                <div key={dimension.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-700">{dimension.label}</span>
                    <span className="tabular-nums text-slate-500">
                      {dimension.score}/{dimension.max}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-1.5 rounded-full bg-sky-500"
                      style={{ width: `${dimension.max > 0 ? Math.round((dimension.score / dimension.max) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
              {snapshot.qualityEvaluation.notes?.length ? (
                <ul className="list-disc space-y-1 pl-4 text-slate-500">
                  {snapshot.qualityEvaluation.notes.map((note: string) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
              <p className="text-slate-400">评分仅用于展示转化质量，不改变 Validator 的通过或阻断结论。</p>
            </div>
          </details>
        ) : null}

        {snapshot?.conversionBlueprint ? (
          <details
            data-testid="listing-v5-conversion-blueprint"
            className="group mt-3 rounded-xl border border-indigo-200/60 bg-white/80 p-3 text-xs text-slate-700"
          >
            <summary className="flex cursor-pointer select-none items-center justify-between font-semibold text-slate-800 hover:text-indigo-700">
              <span>转化蓝图（买家意图 · 痛点 · 竞品差异）</span>
              <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2.5 space-y-2 border-t border-slate-100 pt-2.5">
              <p>
                <strong>买家意图：</strong>
                {snapshot.conversionBlueprint.buyerIntent?.primary || "按关键词意图"}
                {snapshot.conversionBlueprint.buyerIntent?.stage ? `（${snapshot.conversionBlueprint.buyerIntent.stage}）` : ""}
              </p>
              <p>
                <strong>转化角度：</strong>
                {snapshot.conversionBlueprint.conversionAngle?.angle || "事实优先"}
              </p>
              <div>
                <strong>买家痛点：</strong>
                {snapshot.conversionBlueprint.painPoints?.length ? (
                  <ul className="mt-1 space-y-1">
                    {snapshot.conversionBlueprint.painPoints.map((pain: any, index: number) => (
                      <li key={`${pain.pain}-${index}`} className="flex flex-wrap items-center gap-1.5">
                        <span>{pain.pain}</span>
                        <span
                          className={
                            pain.factBacked
                              ? "rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                              : "rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                          }
                        >
                          {pain.factBacked ? `有事实支撑 ${pain.proofFactCount}` : "无事实支撑 · 不得承诺"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  "未从研究资料中提取到痛点"
                )}
              </div>
              <p>
                <strong>竞品差异点：</strong>
                {snapshot.conversionBlueprint.competitorGaps?.length
                  ? snapshot.conversionBlueprint.competitorGaps.map((gap: any) => gap.dimension).join("、")
                  : "无可用对比属性"}
              </p>
              <p>
                <strong>证据点：</strong>
                {snapshot.conversionBlueprint.proofPointCount} 条已确认事实；卖点顺序{" "}
                {snapshot.conversionBlueprint.benefitOrder?.map((item: any) => item.role).join(" → ") || "默认顺序"}
              </p>
              {snapshot.conversionBlueprint.disallowedTemptations?.length ? (
                <p className="text-slate-500">
                  <strong>本商品无事实支撑的表述（禁止使用）：</strong>
                  {snapshot.conversionBlueprint.disallowedTemptations.slice(0, 8).join("、")}
                  {snapshot.conversionBlueprint.disallowedTemptations.length > 8 ? " 等" : ""}
                </p>
              ) : null}
              <p className="text-slate-400">蓝图仅用于组织卖点与表达，事实仍以已确认资料为唯一依据。</p>
            </div>
          </details>
        ) : null}

        {snapshot?.stale ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>研究资料已更新，当前草稿可能滞后，建议重新生成。</span>
          </div>
        ) : null}
      </section>

      {/* 模块 5：AI Execution Trace (调试与追踪，低干扰紧凑设计) */}
      {trace ? (
        <section
          className="w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-slate-700 shadow-xs sm:p-5"
          data-testid="listing-v5-trace"
        >
          <div className="border-b border-slate-200/80 pb-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              AI Execution Trace · 仅开发/测试环境
            </span>
            <h3 className="mt-0.5 text-sm font-bold text-slate-900">
              AI 调用轨迹
            </h3>
            <p
              className="mt-1 text-xs font-medium text-slate-700"
              data-testid="listing-v5-trace-conclusion"
            >
              {traceConclusion(trace)}
            </p>
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">阶段</th>
                  <th className="px-3 py-2 font-semibold">是否调用</th>
                  <th className="px-3 py-2 font-semibold">结果</th>
                  <th className="px-3 py-2 font-semibold">失败原因</th>
                  <th className="px-3 py-2 font-semibold">错误码</th>
                  <th className="px-3 py-2 font-semibold">模型</th>
                  <th className="px-3 py-2 font-semibold">finishReason</th>
                  <th className="px-3 py-2 font-semibold">返回字符</th>
                  <th className="px-3 py-2 font-semibold">tokens</th>
                  <th className="px-3 py-2 font-semibold">耗时</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {traceStages.map(([label, stage]) => (
                  <tr key={label} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-semibold text-slate-900">
                      {label}
                    </td>
                    <td className="px-3 py-2">{stage?.attempted ? "是" : "否"}</td>
                    <td className="px-3 py-2">
                      {stage?.attempted ? (
                        stage?.success ? (
                          <span className="font-semibold text-emerald-700">
                            成功
                          </span>
                        ) : (
                          <span className="font-semibold text-rose-700">
                            失败
                          </span>
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {TRACE_REASON_LABELS[stage?.failureReason] ??
                        stage?.failureReason ??
                        "—"}
                    </td>
                    <td className="px-3 py-2">
                      {stage?.providerErrorCode ?? "—"}
                    </td>
                    <td className="px-3 py-2">{stage?.model ?? "—"}</td>
                    <td className="px-3 py-2">{stage?.finishReason ?? "—"}</td>
                    <td className="px-3 py-2 font-mono">
                      {typeof stage?.responseCharLength === "number"
                        ? stage.responseCharLength
                        : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {typeof stage?.completionTokens === "number"
                        ? `${stage.completionTokens} / ${
                            stage.reasoningTokens ?? "—"
                          }`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {typeof stage?.elapsedMs === "number"
                        ? `${stage.elapsedMs} ms`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200/70 bg-white p-2">
              <dt className="text-[11px] font-semibold text-slate-400">
                AI 首轮校验
              </dt>
              <dd
                className="mt-0.5 font-medium text-slate-800"
                data-testid="listing-v5-trace-validation"
              >
                {trace.validationStatus}
                {(trace.validationBlockReasons ?? []).length > 0
                  ? ` · ${trace.validationBlockReasons.join("、")}`
                  : ""}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200/70 bg-white p-2">
              <dt className="text-[11px] font-semibold text-slate-400">
                最终稿校验
              </dt>
              <dd className="mt-0.5 font-medium text-slate-800">
                {trace.finalValidationStatus}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200/70 bg-white p-2">
              <dt className="text-[11px] font-semibold text-slate-400">
                Safe Fallback
              </dt>
              <dd
                className="mt-0.5 font-medium text-slate-800"
                data-testid="listing-v5-trace-fallback"
              >
                {trace.fallbackUsed
                  ? `是 · ${
                      TRACE_FALLBACK_LABELS[trace.fallbackReason] ??
                      trace.fallbackReason
                    }`
                  : "否"}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200/70 bg-white p-2">
              <dt className="text-[11px] font-semibold text-slate-400">
                生成时间
              </dt>
              <dd className="mt-0.5 font-medium text-slate-800">
                {trace.generatedAt}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="rounded-lg border border-rose-300 bg-white px-3 py-1 text-xs font-semibold text-rose-800 transition-colors hover:bg-rose-100 disabled:opacity-50"
          >
            重试
          </button>
        </div>
      ) : null}
    </div>
  );
}
