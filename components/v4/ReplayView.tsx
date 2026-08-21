"use client";

/**
 * V4 P6 — ReplayView：历史案例回放视图（纯展示 + 本地播放，D6）。
 *
 * 只注入母 bundle（只读不可变），渲染：
 *   - 「真实脱敏历史案例回放」标识与 capturedAt / 时效提示
 *   - 摘要层（回放链路概览）：由真实 bundle 动态派生的统计（时间线步骤 / 人工决策 /
 *     Content Guard / 脱敏字段 / 扫描结果 / bundle hash 前缀），让用户在时间线前先看到完整链路概览
 *   - 时间线（暂停 / 快进 / Evidence 点击展开，见 ReplayTimeline）
 *   - Gate 决策历史记录（只读，不可修改）
 *   - Content Guard 结果展示（只读）
 *
 * 不伪造网络/进度：进度仅由 ReplayTimeline 的离散步骤推进，无连续进度条；
 * 不发起任何请求，也不写入任何运行数据（Visitor 的 Gate 选择/草稿不在本组件）。
 *
 * 说明：时间线/证据/Gate/Guard/统计等纯派生函数在 ./replay-resolvers（服务端与客户端共用），
 * 此处再导出以保持既有导入路径（测试与页面均从 "./ReplayView" 引用）向后兼容。
 */
import type { ReplayBundle } from "@/lib/v4/replay/schema";
import { formatDateTime } from "./labels";
import { ReplayTimeline, formatStepTime } from "./ReplayTimeline";

export {
  GATE_NAME_LABELS,
  GATE_DECISION_LABELS,
  REPLAY_STALE_DAYS,
  formatGateName,
  formatGateDecision,
  isReplayStale,
  resolveContentChecks,
  resolveDisplayTitle,
  resolveEvidenceIndex,
  resolveGates,
  resolveMeta,
  resolveReplayMetrics,
  resolveTimelineSteps,
} from "./replay-resolvers";
export type {
  ReplayContentCheck,
  ReplayGateRecord,
  ReplayMeta,
  ReplayMetrics,
} from "./replay-resolvers";

import {
  REPLAY_STALE_DAYS,
  formatGateDecision,
  formatGateName,
  isReplayStale,
  resolveContentChecks,
  resolveDisplayTitle,
  resolveEvidenceIndex,
  resolveGates,
  resolveMeta,
  resolveReplayMetrics,
  resolveTimelineSteps,
} from "./replay-resolvers";

export type ReplayViewProps = {
  bundle: ReplayBundle;
  /** 服务端渲染时固定快照（stale 判定用；页面传入，保证 SSR/客户端一致）。 */
  now: Date;
};

/**
 * ReplayView：组合时间线 / Gate 决策 / Content Guard / 标识与时效 + 摘要层。
 * 纯展示：props 注入 bundle；播放为本地控制；不发起网络，不写入任何数据。
 */
export function ReplayView({ bundle, now }: ReplayViewProps) {
  const meta = resolveMeta(bundle);
  const title = resolveDisplayTitle(bundle);
  const steps = resolveTimelineSteps(bundle);
  const evidenceIndex = resolveEvidenceIndex(bundle);
  const gates = resolveGates(bundle);
  const checks = resolveContentChecks(bundle);
  const metrics = resolveReplayMetrics(bundle);
  const stale = isReplayStale(meta.capturedAt, now);

  return (
    <div data-testid="replay-view" className="space-y-4">
      {/* 标识：真实脱敏历史案例回放 */}
      <header className="space-y-2">
        <span
          data-testid="replay-kind-badge"
          className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700"
        >
          真实脱敏历史案例回放
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">
          案例回放：{title}
        </h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span data-testid="replay-captured-at">
            回放时点：{formatDateTime(meta.capturedAt)}
          </span>
          <span data-testid="replay-exported-at">导出于：{formatDateTime(meta.exportedAt)}</span>
          <span data-testid="replay-source-run">来源 Run：{meta.sourceRunId}</span>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          本页展示的是以脱敏方式保存的历史研究案例回放，仅供学习参考。
          回放只读，不进入任何真实的浏览器 / 数据源，也不代表当前市场或经营现况。
        </p>
        {stale ? (
          <p
            data-testid="replay-stale-warning"
            className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700"
          >
            该案例数据可能已过时效（超过 {REPLAY_STALE_DAYS} 天），历史结果仅供参考，不代表当前情况。
          </p>
        ) : null}
      </header>

      {/* 摘要层：链路概览（真实派生统计，只读，不写数据） */}
      <section
        data-testid="replay-summary"
        aria-label="回放链路概览"
        className="rounded-2xl border border-slate-200 bg-white p-4"
      >
        <h2 className="text-sm font-bold text-slate-900">回放链路概览</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          以下数字由本脱敏案例 bundle 动态推导：反映一次完整研究链路的节点数、人工参与点与脱敏结果。
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
          <div
            data-testid="replay-metric-events"
            className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
          >
            <dt className="text-[11px] font-medium text-slate-500">时间线步骤</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{metrics.events}</dd>
          </div>
          <div
            data-testid="replay-metric-gates"
            className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
          >
            <dt className="text-[11px] font-medium text-slate-500">人工决策</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{metrics.gates}</dd>
          </div>
          <div
            data-testid="replay-metric-checks"
            className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
          >
            <dt className="text-[11px] font-medium text-slate-500">Content Guard</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{metrics.checks}</dd>
          </div>
          <div
            data-testid="replay-metric-redaction"
            className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
          >
            <dt className="text-[11px] font-medium text-slate-500">脱敏字段</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{metrics.redactionEntries}</dd>
          </div>
          <div
            data-testid="replay-metric-scan"
            className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
          >
            <dt className="text-[11px] font-medium text-slate-500">脱敏扫描</dt>
            <dd
              className={
                "mt-0.5 text-lg font-bold tabular-nums " +
                (metrics.scanOk ? "text-slate-900" : "text-amber-600")
              }
            >
              {metrics.scanOk ? "通过" : "未通过"}
            </dd>
          </div>
          <div
            data-testid="replay-metric-hash"
            className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
          >
            <dt className="text-[11px] font-medium text-slate-500">bundle hash</dt>
            <dd className="mt-0.5 text-sm font-bold tabular-nums text-slate-900 break-all">
              {metrics.bundleSha256.slice(0, 12)}…
            </dd>
          </div>
        </dl>
      </section>

      {/* 脱敏说明 */}
      <section
        data-testid="replay-redaction"
        className="rounded-2xl border border-slate-200 bg-white p-4"
      >
        <p className="text-sm font-semibold text-slate-800">脱敏与完整性</p>
        <div className="mt-1.5 grid gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
          <span>脱敏扫描：{meta.scanOk ? "通过" : "未通过"}</span>
          <span>已脱敏字段：{meta.redactionEntries} 项</span>
          <span>字段白名单版本：{meta.allowlistVersion}</span>
          <span>bundle 校验：{meta.bundleSha256.slice(0, 12)}…（{meta.filesCount} 个文件）</span>
        </div>
      </section>

      {/* 时间线 */}
      <ReplayTimeline steps={steps} evidenceIndex={evidenceIndex} />

      {/* Gate 决策历史（只读） */}
      <section data-testid="replay-gates" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">Gate 决策记录（历史，不可修改）</h2>
        {gates.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">无 Gate 决策记录。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {gates.map((g, idx) => (
              <li
                key={idx}
                data-testid="replay-gate-record"
                className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">
                      {formatGateName(g.gate)} · {formatGateDecision(g.decision)}
                    </p>
                    {g.reason ? (
                      <p className="mt-0.5 break-words text-xs leading-5 text-slate-600">
                        {g.reason}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    {g.actor ? (
                      <p className="text-[11px] text-slate-500">{g.actor}</p>
                    ) : null}
                    {g.decidedAt ? (
                      <p className="text-[11px] text-slate-400">{formatStepTime(g.decidedAt)}</p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Content Guard 结果（只读） */}
      <section data-testid="replay-content-guard" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">Content Guard 结果（历史）</h2>
        {checks.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">无内容守卫记录。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {checks.map((c, idx) => (
              <li
                key={idx}
                data-testid="replay-content-check"
                className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">{c.title}</p>
                  <span className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                    {c.status}
                  </span>
                </div>
                {c.findings && c.findings.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-5 text-slate-600">
                    {c.findings.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 页脚：再次强调回放非现况 */}
      <p className="text-xs text-slate-400">
        以上为脱敏历史案例回放。它不触发任何真实浏览器 / 数据源访问，也不构成对现况的承诺。
      </p>
    </div>
  );
}
