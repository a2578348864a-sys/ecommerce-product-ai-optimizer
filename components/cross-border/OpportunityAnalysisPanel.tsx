"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { buildAccessHeaders } from "@/lib/client/accessToken";
import {
  DEFAULT_MARKETPLACE,
  MIN_CANDIDATES,
  SUPPORTED_MARKETPLACES,
  type OpportunityCandidateV1,
} from "@/lib/opportunityAnalysisContract";
import type { MarketSignalStats } from "@/lib/marketSignal";

type PanelState = "idle" | "loading" | "ready" | "error";

type MarketSignalView = { provided: boolean; stats: MarketSignalStats };

/** V2：自动信号的可追溯信息（与服务端 OpportunityAutoSignalInfo 对应）。 */
type AutoSignalSourceView = {
  taskId: string;
  title: string;
  matchedTokens?: string[];
  matchedSurfaces?: string[];
  signalCount: number;
  reviewCount?: number;
};

type AutoSignalView = {
  requested: boolean;
  reason: string;
  message: string;
  matchedTaskCount: number;
  totalTaskCount: number;
  signalCount: number;
  sources: AutoSignalSourceView[];
  tokens?: string[];
};

type AnalysisResponse = {
  ok?: boolean;
  category?: string;
  marketplace?: string;
  generatedAt?: string;
  marketSignal?: MarketSignalView;
  autoSignal?: AutoSignalView;
  candidates?: OpportunityCandidateV1[];
  error?: { code?: string; message?: string; recoverable?: boolean };
};

type CandidateListItem = {
  id?: string;
  name?: string;
  status?: string;
  convertedTaskId?: string | null;
};

const READY_STATUSES = new Set(["worth_analyzing", "analyzed"]);

const STORAGE_KEY = "opportunity-analysis:v1:last";
const MAX_MARKET_SIGNAL_INPUT = 12000;

type PersistedState = {
  category: string;
  marketplace: string;
  constraints: string;
  marketSignalText: string;
  autoSignal: boolean;
  candidates: OpportunityCandidateV1[];
  marketSignal: MarketSignalView | null;
  autoSignalInfo: AutoSignalView | null;
  generatedAt: string | null;
};

function normalizeIdentity(value: string): string {
  return value.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

function messageFrom(payload: Record<string, unknown> | null, fallback: string): string {
  const error = payload?.error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    const message = (error as { message: string }).message.trim();
    if (message) return message;
  }
  return fallback;
}

/** 读取上次分析结果，用于刷新后恢复（只在浏览器端调用）。 */
function readPersisted(): PersistedState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState> | null;
    if (!parsed || !Array.isArray(parsed.candidates) || parsed.candidates.length === 0) return null;
    return {
      category: typeof parsed.category === "string" ? parsed.category : "",
      marketplace: typeof parsed.marketplace === "string" ? parsed.marketplace : DEFAULT_MARKETPLACE,
      constraints: typeof parsed.constraints === "string" ? parsed.constraints : "",
      marketSignalText: typeof parsed.marketSignalText === "string" ? parsed.marketSignalText : "",
      autoSignal: typeof parsed.autoSignal === "boolean" ? parsed.autoSignal : true,
      candidates: parsed.candidates,
      marketSignal: parsed.marketSignal ?? null,
      autoSignalInfo: parsed.autoSignalInfo ?? null,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : null,
    };
  } catch {
    return null;
  }
}

function writePersisted(state: PersistedState | null): void {
  try {
    if (!state) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用（隐私模式 / 配额）不影响主流程
  }
}

function formatGeneratedAt(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
}

/**
 * 商品机会分析（实验模式）。
 *
 * V1：在 V0「AI 生成候选方向」基础上，接入用户提供的真实市场信号
 * （评论 / 竞品反馈 / 关键词），AI 输出升级为
 * 市场机会描述 / 用户痛点（带信号出处）/ 验证依据 / 风险点 / 是否建议进入 Research。
 *
 * V2：新增「自动加载已有证据」——系统按商品方向从**已有研究任务**的证据
 * （reviewEvidence / vocAnalysis / keywordEvidence / competitorEvidence）自动读取信号，
 * 与手动粘贴的信号合并去重后统一编号。手动输入功能保留不变。
 *
 * 仍然复用现有候选池创建流程 + 现有 start-research 进入 Research，
 * 不新增数据库结构，不改 Research / Listing / Image 主链。
 */
export function OpportunityAnalysisPanel() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [marketplace, setMarketplace] = useState<string>(DEFAULT_MARKETPLACE);
  const [constraints, setConstraints] = useState("");
  const [marketSignalText, setMarketSignalText] = useState("");
  const [autoSignal, setAutoSignal] = useState(true);

  const [state, setState] = useState<PanelState>("idle");
  const [candidates, setCandidates] = useState<OpportunityCandidateV1[]>([]);
  const [marketSignal, setMarketSignal] = useState<MarketSignalView | null>(null);
  const [autoSignalInfo, setAutoSignalInfo] = useState<AutoSignalView | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [busyTitle, setBusyTitle] = useState<string | null>(null);
  const [flowMessage, setFlowMessage] = useState("");
  const [restored, setRestored] = useState(false);

  // 刷新后恢复上次分析（状态恢复验收项）
  useEffect(() => {
    const persisted = readPersisted();
    if (!persisted) return;
    setCategory(persisted.category);
    setMarketplace(persisted.marketplace);
    setConstraints(persisted.constraints);
    setMarketSignalText(persisted.marketSignalText);
    setAutoSignal(persisted.autoSignal);
    setCandidates(persisted.candidates);
    setMarketSignal(persisted.marketSignal);
    setAutoSignalInfo(persisted.autoSignalInfo);
    setGeneratedAt(persisted.generatedAt);
    setState("ready");
    setRestored(true);
  }, []);

  const runAnalysis = useCallback(async () => {
    const trimmedCategory = category.trim();
    if (!trimmedCategory) {
      setState("error");
      setErrorMessage("请先填写商品方向或类目。");
      return;
    }

    setState("loading");
    setErrorMessage("");
    setFlowMessage("");
    setCandidates([]);
    setMarketSignal(null);
    setAutoSignalInfo(null);
    setGeneratedAt(null);
    setRestored(false);

    try {
      const response = await fetch("/api/opportunity-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        cache: "no-store",
        body: JSON.stringify({
          category: trimmedCategory,
          marketplace,
          constraints: constraints.trim(),
          marketSignalText,
          autoSignal,
        }),
      });
      const payload = (await readJson(response)) as AnalysisResponse | null;

      if (!response.ok || !payload?.ok || !Array.isArray(payload.candidates) || payload.candidates.length === 0) {
        setState("error");
        setErrorMessage(
          payload?.error?.message
          || `分析未完成（HTTP ${response.status}），请稍后重试。`,
        );
        return;
      }

      const nextMarketSignal = payload.marketSignal ?? null;
      const nextAutoSignalInfo = payload.autoSignal ?? null;
      const nextGeneratedAt = typeof payload.generatedAt === "string" ? payload.generatedAt : null;

      setState("ready");
      setCandidates(payload.candidates);
      setMarketSignal(nextMarketSignal);
      setAutoSignalInfo(nextAutoSignalInfo);
      setGeneratedAt(nextGeneratedAt);
      if (payload.candidates.length < MIN_CANDIDATES) {
        setFlowMessage(`仅生成 ${payload.candidates.length} 个候选方向，建议换一个更具体的方向再试。`);
      }

      writePersisted({
        category: trimmedCategory,
        marketplace,
        constraints: constraints.trim(),
        marketSignalText,
        autoSignal,
        candidates: payload.candidates,
        marketSignal: nextMarketSignal,
        autoSignalInfo: nextAutoSignalInfo,
        generatedAt: nextGeneratedAt,
      });
    } catch {
      setState("error");
      setErrorMessage("分析请求没有送达服务端，请检查网络后重试。");
    }
  }, [category, marketplace, constraints, marketSignalText, autoSignal]);

  const onSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAnalysis();
  }, [runAnalysis]);

  const clearRestored = useCallback(() => {
    writePersisted(null);
    setCandidates([]);
    setMarketSignal(null);
    setAutoSignalInfo(null);
    setGeneratedAt(null);
    setRestored(false);
    setState("idle");
    setFlowMessage("");
    setErrorMessage("");
  }, []);

  /** 进入研究：复用现有 Candidate 创建流程 + 现有 start-research，不新增链路。 */
  const enterResearch = useCallback(async (candidate: OpportunityCandidateV1) => {
    if (busyTitle) return;
    setBusyTitle(candidate.title);
    setFlowMessage("");

    try {
      const identity = normalizeIdentity(candidate.title);

      // 1) 候选池身份查重（同一方向重复点击不产生重复候选）
      const listResponse = await fetch(
        `/api/opportunity-candidates?q=${encodeURIComponent(candidate.title)}&limit=50`,
        { headers: { ...buildAccessHeaders() }, cache: "no-store" },
      );
      const listPayload = await readJson(listResponse);
      const items = Array.isArray(listPayload?.items) ? (listPayload.items as CandidateListItem[]) : [];
      let existing = items.find((item) => typeof item?.name === "string" && normalizeIdentity(item.name) === identity);

      // 2) 候选池没有该身份 → 复用现有候选创建接口（legacy 未验证来源）
      if (!existing?.id) {
        const createResponse = await fetch("/api/opportunity-candidates", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
          body: JSON.stringify({
            name: candidate.title,
            rawInput: `${marketplace} · ${category.trim() || candidate.title}`,
            link: null,
            source: "商品机会分析",
            keyword: category.trim(),
            riskLabel: "待验证",
            summaryLabel: candidate.reason,
          }),
        });
        const createPayload = await readJson(createResponse);
        const createdItems = Array.isArray(createPayload?.items) ? (createPayload.items as CandidateListItem[]) : [];
        if (!createResponse.ok || createPayload?.ok !== true || !createdItems[0]?.id) {
          setFlowMessage(messageFrom(createPayload, "候选创建未完成，请稍后重试。"));
          return;
        }
        existing = createdItems[0];
      }

      const candidateId = existing.id as string;
      const convertedTaskId = typeof existing.convertedTaskId === "string" ? existing.convertedTaskId : null;

      // 3) 未验证来源进入待研究需要一次明确人工确认 —— 点击「进入研究」即该确认
      if (!convertedTaskId && !(typeof existing.status === "string" && READY_STATUSES.has(existing.status))) {
        const patchResponse = await fetch(`/api/opportunity-candidates/${encodeURIComponent(candidateId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
          body: JSON.stringify({ status: "worth_analyzing", sourceReviewAcknowledged: true }),
        });
        const patchPayload = await readJson(patchResponse);
        if (!patchResponse.ok || patchPayload?.ok !== true) {
          setFlowMessage(messageFrom(patchPayload, "标记为待研究未完成，请刷新后重试。"));
          return;
        }
      }

      // 4) 复用现有 start-research（幂等：已转任务会直接返回既有 taskId）
      const startResponse = await fetch(
        `/api/opportunity-candidates/${encodeURIComponent(candidateId)}/start-research`,
        { method: "POST", headers: { ...buildAccessHeaders() }, cache: "no-store" },
      );
      const startPayload = await readJson(startResponse);
      const data = startPayload?.data && typeof startPayload.data === "object"
        ? startPayload.data as { taskId?: unknown }
        : null;
      const taskId = typeof data?.taskId === "string" ? data.taskId : "";

      if (!startResponse.ok || startPayload?.ok !== true || !taskId) {
        setFlowMessage(messageFrom(startPayload, "进入研究失败，请确认候选状态后重试。"));
        return;
      }

      window.location.assign(`/tasks/${encodeURIComponent(taskId)}`);
    } catch {
      setFlowMessage("进入研究失败，请检查网络后重试。");
    } finally {
      setBusyTitle(null);
    }
  }, [busyTitle, category, marketplace]);

  const signalStats = marketSignal?.provided ? marketSignal.stats : null;

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-4"
      data-testid="opportunity-analysis-section"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">商品机会分析</h2>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
              实验模式
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            输入一个商品方向，可同时粘贴真实市场信号（评论 / 竞品反馈 / 关键词）。
            AI 会输出市场机会、用户痛点、验证依据与风险点；只输出待验证判断，不代表已验证的商业结论。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls="opportunity-analysis-body"
          className="inline-flex h-9 shrink-0 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          data-testid="opportunity-analysis-toggle"
        >
          {open ? "收起" : "打开实验入口"}
        </button>
      </div>

      {open ? (
        <div id="opportunity-analysis-body" className="mt-4" data-testid="opportunity-analysis-panel">
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-1">
              <span className="font-medium text-slate-700">商品方向 / 类目</span>
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value.slice(0, 120))}
                placeholder="例如：户外露营用品"
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-400"
                data-testid="opportunity-analysis-category"
              />
            </label>

            <label className="text-sm sm:col-span-1">
              <span className="font-medium text-slate-700">目标市场</span>
              <select
                value={marketplace}
                onChange={(event) => setMarketplace(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-400"
                data-testid="opportunity-analysis-marketplace"
              >
                {SUPPORTED_MARKETPLACES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>

            <label className="text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">限制条件（可选）</span>
              <textarea
                value={constraints}
                onChange={(event) => setConstraints(event.target.value.slice(0, 500))}
                rows={2}
                placeholder="例如：只考虑体积小、单价 20-40 美元、无电池的商品"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-400"
                data-testid="opportunity-analysis-constraints"
              />
            </label>

            <label className="text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">真实市场信号（可选）</span>
              <span className="ml-2 text-xs text-slate-500">
                每行一条；可加类型前缀 [review] / [competitor] / [keyword] / [pain_point]，
                也可写 [review 2] 表示 2 分评论。留空则退回无数据的假设模式。
              </span>
              <textarea
                value={marketSignalText}
                onChange={(event) => setMarketSignalText(event.target.value.slice(0, MAX_MARKET_SIGNAL_INPUT))}
                rows={6}
                placeholder={"例如：\n[review 2] 卡扣太紧，装了三次才装上，手指都磨红了\n[review 5] 收纳后很省空间，露营车里刚好放下\n[competitor] 同类产品说明书只有英文，退换货流程复杂\n[keyword] 折叠 收纳 便携"}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs leading-5 text-slate-900 outline-none focus:border-emerald-400"
                data-testid="opportunity-analysis-market-signal"
              />
              <span className="mt-1 block text-xs text-slate-500" data-testid="opportunity-analysis-signal-hint">
                {marketSignalText.trim()
                  ? `已输入 ${marketSignalText.split(/\r?\n/).filter((line) => line.trim()).length} 行，服务端会去重并编号（S1、S2…）后交给 AI。`
                  : "未手动提供信号。若开启下方「自动加载已有证据」，系统会按商品方向自动检索。"}
              </span>
            </label>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={autoSignal}
                  onChange={(event) => setAutoSignal(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-400"
                  data-testid="opportunity-analysis-auto-signal-toggle"
                />
                <span>
                  <span className="font-medium text-slate-700">自动加载已有证据</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    按商品方向从已有研究任务里检索真实证据（评论 / VOC 痛点 / 关键词 / 竞品），
                    自动转成带 S 编号的信号。不联网、不抓取、不写库；检索不到就退化为无信号，
                    不会编造数据。与手动信号同时存在时会合并去重。
                  </span>
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <button
                type="submit"
                disabled={state === "loading"}
                className="inline-flex h-10 items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="opportunity-analysis-submit"
              >
                {state === "loading" ? "正在生成候选方向…" : "生成候选方向"}
              </button>
              <span role="status" className="text-xs text-slate-500" data-testid="opportunity-analysis-status">
                {state === "loading"
                  ? "正在调用 AI，通常需要几秒。"
                  : state === "ready"
                    ? `已生成 ${candidates.length} 个候选方向。`
                    : "仅生成待验证的候选方向，不构成选品结论。"}
              </span>
            </div>
          </form>

          {state === "error" ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
              data-testid="opportunity-analysis-error"
            >
              <p className="font-medium">分析未完成</p>
              <p className="mt-1 leading-6">{errorMessage}</p>
              <button
                type="button"
                onClick={() => void runAnalysis()}
                className="mt-2 inline-flex h-9 items-center rounded-lg border border-rose-300 bg-white px-3 text-sm font-medium text-rose-700 hover:bg-rose-100"
                data-testid="opportunity-analysis-retry"
              >
                重试
              </button>
            </div>
          ) : null}

          {flowMessage ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800"
              data-testid="opportunity-analysis-flow-message"
            >
              {flowMessage}
            </p>
          ) : null}

          {state === "ready" && candidates.length > 0 ? (
            <>
              {restored ? (
                <div
                  className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
                  data-testid="opportunity-analysis-restored"
                >
                  <span>
                    已恢复上次分析结果{generatedAt ? `（生成于 ${formatGeneratedAt(generatedAt)}）` : ""}，可直接继续。
                  </span>
                  <button
                    type="button"
                    onClick={clearRestored}
                    className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    data-testid="opportunity-analysis-clear-restored"
                  >
                    清除
                  </button>
                </div>
              ) : null}

              <div
                className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-6 text-sky-900"
                data-testid="opportunity-analysis-signal-summary"
              >
                {signalStats ? (
                  <>
                    <p className="font-semibold">
                      真实市场信号：已接入 {signalStats.acceptedItems} 条
                      {signalStats.duplicateItems > 0 ? `（去重 ${signalStats.duplicateItems} 条）` : ""}
                    </p>
                    <p className="mt-1">
                      类型分布：评论 {signalStats.byKind.review} · 竞品反馈 {signalStats.byKind.competitor} ·
                      关键词 {signalStats.byKind.keyword} · 痛点描述 {signalStats.byKind.pain_point}
                      {signalStats.averageRating !== null
                        ? ` · 评分均值 ${signalStats.averageRating}（${signalStats.withRating} 条带评分）`
                        : ""}
                    </p>
                    <p className="mt-1 text-sky-700">
                      以下「依据」中的 S 编号指向你提供的具体信号；没有 S 编号的条目代表 AI 没有数据依据。
                    </p>
                  </>
                ) : (
                  <p>
                    本次未提供真实市场信号：所有判断均为无数据依据的假设，痛点不带 S 编号。
                    填入信号后重新生成即可对比。
                  </p>
                )}
              </div>

              {autoSignalInfo?.requested ? (
                <div
                  className={`mt-3 rounded-xl border p-3 text-xs leading-6 ${
                    autoSignalInfo.sources.length > 0
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  }`}
                  data-testid="opportunity-analysis-auto-signal"
                >
                  <p className="font-semibold">
                    自动加载已有证据
                    {autoSignalInfo.sources.length > 0
                      ? `：命中 ${autoSignalInfo.sources.length} 个已有研究任务，产出 ${autoSignalInfo.signalCount} 条信号`
                      : "：未取到信号"}
                  </p>
                  {autoSignalInfo.message ? <p className="mt-1">{autoSignalInfo.message}</p> : null}
                  {autoSignalInfo.sources.length > 0 ? (
                    <ul className="mt-2 grid gap-1" data-testid="opportunity-analysis-auto-sources">
                      {autoSignalInfo.sources.map((source) => (
                        <li key={source.taskId} className="flex flex-wrap items-baseline gap-2">
                          <span className="font-medium">{source.title}</span>
                          <span className="text-emerald-700">
                            {source.signalCount} 条信号
                            {typeof source.reviewCount === "number" && source.reviewCount > 0
                              ? ` · 该任务有 ${source.reviewCount} 条评论`
                              : ""}
                          </span>
                          {source.matchedSurfaces?.length ? (
                            <span className="text-emerald-700/80">
                              命中方式：{source.matchedSurfaces.join(" / ")}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-amber-800">
                      本次未使用自动信号（已如实告知，不会用 AI 生成的内容替代真实证据）。
                      可在「真实市场信号」里手动粘贴，或换一个与已有研究任务更接近的商品方向。
                    </p>
                  )}
                </div>
              ) : null}

              <ul className="mt-4 grid gap-3" data-testid="opportunity-analysis-results">
                {candidates.map((candidate) => (
                  <li
                    key={candidate.title}
                    className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                    data-testid="opportunity-analysis-candidate"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-900">{candidate.title}</h3>
                      <button
                        type="button"
                        onClick={() => void enterResearch(candidate)}
                        disabled={busyTitle !== null}
                        className="inline-flex h-9 shrink-0 items-center rounded-lg border border-emerald-300 bg-white px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid="opportunity-analysis-enter-research"
                      >
                        {busyTitle === candidate.title ? "正在进入研究…" : "进入研究"}
                      </button>
                    </div>

                    <div className="mt-3 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-500">市场机会描述</p>
                        <p className="mt-1 text-sm leading-6 text-slate-700" data-testid="opportunity-analysis-market-opportunity">
                          {candidate.marketOpportunity}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-slate-500">用户痛点</p>
                        <ul className="mt-1 space-y-1 text-sm leading-6 text-slate-700" data-testid="opportunity-analysis-user-pain-points">
                          {candidate.userPainPoints.map((point) => (
                            <li key={point.text} className="flex flex-wrap items-baseline gap-1">
                              <span className="text-slate-400">•</span>
                              <span>{point.text}</span>
                              {point.signalRefs.length > 0 ? (
                                point.signalRefs.map((ref) => (
                                  <span
                                    key={ref}
                                    className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700"
                                    data-testid="opportunity-analysis-signal-ref"
                                  >
                                    {ref}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-slate-400" data-testid="opportunity-analysis-no-ref">
                                  （无真实信号依据）
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-500">验证依据</p>
                          {candidate.evidenceBasis.length > 0 ? (
                            <ul
                              className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700"
                              data-testid="opportunity-analysis-evidence-basis"
                            >
                              {candidate.evidenceBasis.map((item) => <li key={item}>{item}</li>)}
                            </ul>
                          ) : (
                            <p className="mt-1 text-sm text-slate-500">（本次未给出依据）</p>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-500">风险点</p>
                          {candidate.risks.length > 0 ? (
                            <ul
                              className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700"
                              data-testid="opportunity-analysis-risks"
                            >
                              {candidate.risks.map((item) => <li key={item}>{item}</li>)}
                            </ul>
                          ) : (
                            <p className="mt-1 text-sm text-slate-500">（本次未给出风险点）</p>
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-slate-500">是否建议进入 Research</p>
                        <p
                          className={`mt-1 text-sm leading-6 ${candidate.researchRecommendation.recommended ? "text-emerald-700" : "text-amber-700"}`}
                          data-testid="opportunity-analysis-recommendation"
                        >
                          <span className="font-semibold">
                            {candidate.researchRecommendation.recommended ? "建议进入" : "暂不建议进入"}
                          </span>
                          ：{candidate.researchRecommendation.reason}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-slate-500">需要进一步验证的问题</p>
                        <ul
                          className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700"
                          data-testid="opportunity-analysis-validation-needed"
                        >
                          {candidate.validationNeeded.map((point) => <li key={point}>{point}</li>)}
                        </ul>
                      </div>
                    </div>

                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      该方向来自 AI 判断，未经外部数据验证；点击「进入研究」即确认把它加入研究池待验证。
                    </p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default OpportunityAnalysisPanel;
