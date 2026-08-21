"use client";

/**
 * V4 P6 — ReplayTimeline：历史案例回放时间线（纯展示 + 本地播放控制，D6）。
 *
 * 渲染约定（本仓库）：vitest 环境为 node，客户端组件用 react-dom/server 的
 * renderToStaticMarkup 断言初始静态 HTML 与 data-testid；交互逻辑（暂停/快进/
 * Evidence 展开）通过导出的纯函数直接单测。
 *
 * 不伪造进度：推进在既有时间线步骤间离散移动，用「第 N / M 步」指示器与步骤
 * 高亮，绝不渲染连续进度条/百分比。播放仅驱动真实步骤位置（本地状态），
 * 不发起任何网络请求，也不写入任何运行数据。
 */
import { useEffect, useReducer, useState } from "react";
import { formatDateTime } from "./labels";

export type ReplayEvidence = {
  id: string;
  label?: string;
  sourceUrl?: string;
  capturedAt?: string;
  summary?: string;
};

export type ReplayTimelineStep = {
  id: string;
  at: string;
  title: string;
  detail?: string;
  kind?: string;
  evidenceRefs?: ReplayEvidence[];
};

export type ReplayPlaybackState = {
  playing: boolean;
  rate: number;
  position: number;
};

export type ReplayPlaybackAction =
  | { type: "toggle_play" }
  | { type: "set_rate"; rate: number }
  | { type: "step"; delta: number }
  | { type: "jump"; position: number }
  | { type: "reset" };

/** 可选播放倍速（本地播放控制；仅影响相邻步骤推进频率）。 */
export const REPLAY_RATES = [0.5, 1, 2, 4] as const;

export const DEFAULT_PLAYBACK: ReplayPlaybackState = {
  playing: false,
  rate: 1,
  position: 0,
};

/** 位置夹取到合法步骤区间 [0, count-1]；空时间线固定为 0。 */
function clampPosition(position: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  return Math.max(0, Math.min(stepCount - 1, position));
}

/**
 * 播放状态纯 reducer（无副作用，无定时器，便于直接单测）。
 * - toggle_play：暂停⇄播放
 * - set_rate：切换倍速（本地，仅影响相邻步骤推进频率）
 * - step：在离散步骤间前/后移动一步（无百分比）
 * - jump / reset：跳转到指定步骤 / 复位到首步并暂停
 */
export function replayPlaybackReducer(
  state: ReplayPlaybackState,
  action: ReplayPlaybackAction,
  stepCount: number,
): ReplayPlaybackState {
  switch (action.type) {
    case "toggle_play":
      return { ...state, playing: !state.playing };
    case "set_rate":
      return { ...state, rate: action.rate };
    case "step":
      return { ...state, position: clampPosition(state.position + action.delta, stepCount) };
    case "jump":
      return { ...state, position: clampPosition(action.position, stepCount) };
    case "reset":
      return { ...state, position: 0, playing: false };
    default:
      return state;
  }
}

/** Evidence 引用展开集合切换（不改变数组来源；纯函数）。 */
export function toggleEvidence(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** 时间线步骤时间格式化（缺失/非法 → "—"）。 */
export function formatStepTime(iso: string): string {
  return formatDateTime(iso || null);
}

export type ReplayTimelineProps = {
  /** 回放步骤（由母 bundle 派生；只读，播放不修改）。 */
  steps: ReplayTimelineStep[];
  /** 顶层证据索引，用于步骤只带 id 时展开引用详情。 */
  evidenceIndex?: ReplayEvidence[];
  /** 测试/受控：初始播放状态。 */
  initialState?: Partial<ReplayPlaybackState>;
  /** 测试/受控：初始展开的证据引用 id。 */
  initialEvidenceOpen?: string[];
};

/** 依据证据 id 解析展示详情（顶层索引优先，其次步骤内联引用）。 */
function findEvidence(
  id: string,
  step: ReplayTimelineStep,
  evidenceIndex: ReplayEvidence[],
): ReplayEvidence | undefined {
  const fromStep = step.evidenceRefs?.find((e) => e.id === id);
  if (fromStep) return fromStep;
  return evidenceIndex.find((e) => e.id === id);
}

/**
 * ReplayTimeline：时间线 + 本地播放控制 + Evidence 引用展开。
 * 纯展示（props 注入步骤数据）；暂停/快进为本地播放控制；无网络/无写入。
 */
export function ReplayTimeline({
  steps,
  evidenceIndex = [],
  initialState,
  initialEvidenceOpen,
}: ReplayTimelineProps) {
  const [playback, dispatch] = useReducer(
    (state: ReplayPlaybackState, action: ReplayPlaybackAction) =>
      replayPlaybackReducer(state, action, steps.length),
    { ...DEFAULT_PLAYBACK, ...initialState },
  );
  const [openEvidence, setOpenEvidence] = useState<string[]>(
    initialEvidenceOpen ?? [],
  );

  const stepCount = steps.length;
  const atEnd = stepCount > 0 && playback.position >= stepCount - 1;

  // 播放：按倍速推进相邻步骤（仅推进真实步骤，无伪造进度）。
  useEffect(() => {
    if (!playback.playing || stepCount <= 0) return;
    const intervalMs = Math.max(300, Math.round(3000 / playback.rate));
    const id = setInterval(() => {
      dispatch({ type: "step", delta: 1 });
    }, intervalMs);
    return () => clearInterval(id);
  }, [playback.playing, playback.rate, stepCount]);

  // 到达末步自动暂停。
  useEffect(() => {
    if (playback.playing && stepCount > 0 && playback.position >= stepCount - 1) {
      dispatch({ type: "toggle_play" });
    }
  }, [playback.playing, playback.position, stepCount]);

  function handleToggleEvidence(id: string) {
    setOpenEvidence((ids) => toggleEvidence(ids, id));
  }

  if (stepCount === 0) {
    return (
      <section
        data-testid="replay-timeline"
        data-empty="true"
        className="rounded-2xl border border-slate-200 bg-white p-4"
      >
        <h2 className="text-sm font-bold text-slate-900">回放时间线</h2>
        <p className="mt-2 text-sm text-slate-400">暂无回放步骤记录。</p>
      </section>
    );
  }

  const toggleClass =
    "inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition disabled:opacity-40";

  return (
    <section
      data-testid="replay-timeline"
      className="rounded-2xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">回放时间线</h2>
        {/* 离散步骤指示器：不伪造百分比/进度条 */}
        <span
          data-testid="replay-step-indicator"
          className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600"
        >
          第 {playback.position + 1} / {stepCount} 步
        </span>
      </div>

      <div data-testid="replay-controls" className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="replay-toggle-play"
          onClick={() => dispatch({ type: "toggle_play" })}
          className={toggleClass + " border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100"}
        >
          {playback.playing ? "暂停" : "播放"}
        </button>
        <button
          type="button"
          data-testid="replay-step-back"
          onClick={() => dispatch({ type: "step", delta: -1 })}
          disabled={playback.position <= 0}
          className={toggleClass + " border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}
        >
          上一步
        </button>
        <button
          type="button"
          data-testid="replay-step-forward"
          onClick={() => dispatch({ type: "step", delta: 1 })}
          disabled={atEnd}
          className={toggleClass + " border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}
        >
          快进
        </button>
        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
          倍速
          <select
            data-testid="replay-rate"
            value={playback.rate}
            onChange={(e) => dispatch({ type: "set_rate", rate: Number(e.target.value) })}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700"
          >
            {REPLAY_RATES.map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-testid="replay-reset"
          onClick={() => dispatch({ type: "reset" })}
          className={toggleClass + " border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}
        >
          复位
        </button>
      </div>

      <ol className="mt-4 space-y-2" data-testid="replay-steps">
        {steps.map((step, index) => {
          const active = index === playback.position;
          return (
            <li
              key={step.id}
              data-step-index={index}
              data-active={active ? "true" : "false"}
              className={
                "rounded-lg border px-3 py-2 " +
                (active
                  ? "border-teal-300 bg-teal-50/60"
                  : "border-slate-100 bg-slate-50/60")
              }
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "jump", position: index })}
                  className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                >
                  #{index + 1}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800">{step.title}</p>
                  {step.detail ? (
                    <p className="mt-0.5 break-words text-xs leading-5 text-slate-600">
                      {step.detail}
                    </p>
                  ) : null}
                </div>
                <time className="shrink-0 text-[11px] text-slate-400">
                  {formatStepTime(step.at)}
                </time>
              </div>

              {step.evidenceRefs && step.evidenceRefs.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {step.evidenceRefs.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      data-testid={"replay-evidence-chip-" + ev.id}
                      data-open={openEvidence.includes(ev.id) ? "true" : "false"}
                      onClick={() => handleToggleEvidence(ev.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-teal-300"
                    >
                      <span className="text-teal-600">◇</span>
                      {ev.label || ("证据 " + ev.id)}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Evidence 展开区：显示选中步骤中已展开引用的来源详情 */}
      <div className="mt-3 space-y-2">
        {steps
          .filter((step) => step.id === steps[playback.position]?.id)
          .map((step) =>
            step.evidenceRefs?.filter((ev) => openEvidence.includes(ev.id)).map((ev) => {
              const detail = findEvidence(ev.id, step, evidenceIndex) ?? ev;
              return (
                <div
                  key={ev.id}
                  data-testid={"replay-evidence-detail-" + ev.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <p className="text-xs font-semibold text-slate-800">
                    {detail.label || ("证据 " + detail.id)}
                  </p>
                  {detail.summary ? (
                    <p className="mt-0.5 break-words text-xs leading-5 text-slate-600">
                      {detail.summary}
                    </p>
                  ) : null}
                  {detail.sourceUrl ? (
                    <p className="mt-0.5 break-words text-[11px] text-slate-500">
                      来源：{detail.sourceUrl}
                    </p>
                  ) : null}
                  {detail.capturedAt ? (
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      采集：{formatStepTime(detail.capturedAt)}
                    </p>
                  ) : null}
                </div>
              );
            }),
          )}
      </div>
    </section>
  );
}
