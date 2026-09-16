"use client";

import { useCallback, useState, type FormEvent } from "react";

import { buildAccessHeaders } from "@/lib/client/accessToken";
import {
  DEFAULT_MARKETPLACE,
  MIN_CANDIDATES,
  SUPPORTED_MARKETPLACES,
  type OpportunityCandidate,
} from "@/lib/opportunityAnalysisContract";

type PanelState = "idle" | "loading" | "ready" | "error";

type AnalysisResponse = {
  ok?: boolean;
  category?: string;
  marketplace?: string;
  candidates?: OpportunityCandidate[];
  error?: { code?: string; message?: string; recoverable?: boolean };
};

type CandidateListItem = {
  id?: string;
  name?: string;
  status?: string;
  convertedTaskId?: string | null;
};

const READY_STATUSES = new Set(["worth_analyzing", "analyzed"]);

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

/**
 * 商品机会分析（实验模式）。
 *
 * V0 只验证流程：AI 基于"商品方向"生成值得研究的候选方向，
 * 再复用现有候选池创建流程 + 现有 start-research 进入 Research。
 * 不接任何外部数据源，不新增数据库结构，不改 Research / Listing / Image 主链。
 */
export function OpportunityAnalysisPanel() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [marketplace, setMarketplace] = useState<string>(DEFAULT_MARKETPLACE);
  const [constraints, setConstraints] = useState("");

  const [state, setState] = useState<PanelState>("idle");
  const [candidates, setCandidates] = useState<OpportunityCandidate[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [busyTitle, setBusyTitle] = useState<string | null>(null);
  const [flowMessage, setFlowMessage] = useState("");

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

    try {
      const response = await fetch("/api/opportunity-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        cache: "no-store",
        body: JSON.stringify({
          category: trimmedCategory,
          marketplace,
          constraints: constraints.trim(),
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

      setState("ready");
      setCandidates(payload.candidates);
      if (payload.candidates.length < MIN_CANDIDATES) {
        setFlowMessage(`仅生成 ${payload.candidates.length} 个候选方向，建议换一个更具体的方向再试。`);
      }
    } catch {
      setState("error");
      setErrorMessage("分析请求没有送达服务端，请检查网络后重试。");
    }
  }, [category, marketplace, constraints]);

  const onSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAnalysis();
  }, [runAnalysis]);

  /** 进入研究：复用现有 Candidate 创建流程 + 现有 start-research，不新增链路。 */
  const enterResearch = useCallback(async (candidate: OpportunityCandidate) => {
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
            输入一个商品方向，AI 生成若干「值得研究」的候选方向。V0 不接任何外部数据源，
            只输出待验证假设，不代表已验证的商业结论。
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

                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    <span className="font-medium text-slate-600">为什么值得研究：</span>
                    {candidate.reason}
                  </p>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-500">可能的用户痛点</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                        {candidate.painPoints.map((point) => <li key={point}>{point}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500">需要进一步验证的问题</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                        {candidate.validationNeeded.map((point) => <li key={point}>{point}</li>)}
                      </ul>
                    </div>
                  </div>

                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    该方向来自 AI 假设，未经外部数据验证；点击「进入研究」即确认把它加入研究池待验证。
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default OpportunityAnalysisPanel;
