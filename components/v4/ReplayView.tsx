"use client";

/**
 * V4 P6 — ReplayView：历史案例回放视图（纯展示 + 本地播放，D6）。
 *
 * 只注入母 bundle（只读不可变），渲染：
 *   - 「真实脱敏历史案例回放」标识与 capturedAt / 时效提示
 *   - 业务信息（商品名/关键词/市场/结论/风险/缩略图；无 → 诚实空态）
 *   - 摘要层（回放链路概览）：由真实 bundle 动态派生的统计（时间线步骤/人工决策/
 *     Content Guard/脱敏字段/扫描结果/bundle hash 前缀），让用户在时间线前先看到完整链路概览
 *   - 研究链路（业务阶段）：市场证据 → Gate A → 供应商 → 产品事实 → 商业 → Gate B →
 *     Listing/Image → Content Review（默认展示；74 条原始技术事件收进「高级详情」折叠区）
 *   - 证据来源：点击展开来源类型 / 实体 / 时间 / 原始定位 / 权威字段 / warnings / 冲突
 *   - 时间线（暂停/快进/Evidence 展开，见 ReplayTimeline）→ 收进「高级详情」折叠区
 *   - Gate 决策历史记录（只读）与 Content Guard 结果（只读）
 *
 * 不伪造网络/进度：进度仅由 ReplayTimeline 的离散步骤推进，无连续进度条；
 * 不发起任何请求，也不写入任何运行数据（Visitor 的 Gate 选择/草稿不在本组件）。
 *
 * 说明：时间线/证据/Gate/Guard/业务/统计等纯派生函数在 ./replay-resolvers（服务端与客户端共用），
 * 此处再导出以保持既有导入路径（测试与页面均从 "./ReplayView" 引用）向后兼容。
 */
import type { ReplayBundle } from "@/lib/v4/replay/schema";
import { useState } from "react";
import { formatDateTime } from "./labels";
import { ReplayTimeline, formatStepTime } from "./ReplayTimeline";

export {
  BUSINESS_STAGE_ORDER,
  GATE_NAME_LABELS,
  GATE_DECISION_LABELS,
  REPLAY_STALE_DAYS,
  formatGateDecision,
  formatGateName,
  isReplayStale,
  resolveBusinessFields,
  resolveBusinessStages,
  resolveContentChecks,
  resolveDisplayTitle,
  resolveEvidenceIndex,
  resolveEvidenceItems,
  resolveGates,
  resolveMeta,
  resolveReplayMetrics,
  resolveTimelineSteps,
} from "./replay-resolvers";
export type {
  ReplayBusinessFields,
  ReplayBusinessStage,
  ReplayContentCheck,
  ReplayEvidenceItem,
  ReplayGateRecord,
  ReplayMeta,
  ReplayMetrics,
} from "./replay-resolvers";

import {
  BUSINESS_STAGE_ORDER,
  REPLAY_STALE_DAYS,
  formatGateDecision,
  formatGateName,
  isReplayStale,
  resolveBusinessFields,
  resolveBusinessStages,
  resolveContentChecks,
  resolveDisplayTitle,
  resolveEvidenceIndex,
  resolveEvidenceItems,
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

function fieldText(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(fieldText).join("，");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * ReplayView：组合业务信息 / 链路统计 / 业务阶段 / 证据来源 / 时间线 / Gate 决策 /
 * Content Guard / 标识与时效。纯展示：props 注入 bundle；播放为本地控制；不发起网络，不写数据。
 */
export function ReplayView({ bundle, now }: ReplayViewProps) {
  const meta = resolveMeta(bundle);
  const title = resolveDisplayTitle(bundle);
  const steps = resolveTimelineSteps(bundle);
  const evidenceIndex = resolveEvidenceIndex(bundle);
  const gates = resolveGates(bundle);
  const checks = resolveContentChecks(bundle);
  const metrics = resolveReplayMetrics(bundle);
  const business = resolveBusinessFields(bundle);
  const stages = resolveBusinessStages(bundle);
  const evidenceItems = resolveEvidenceItems(bundle);
  const stale = isReplayStale(meta.capturedAt, now);
  const [openEvidence, setOpenEvidence] = useState<string[]>([]);

  function toggleEvidence(id: string) {
    setOpenEvidence((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  const businessCells: { testid: string; label: string; value: string }[] = [
    { testid: "replay-business-product", label: "商品名", value: business.productName || "未提供" },
    { testid: "replay-business-keyword", label: "关键词", value: business.keyword || "未提供" },
    { testid: "replay-business-market", label: "市场", value: business.market || "未提供" },
    { testid: "replay-business-risk", label: "风险", value: business.risk || "未提供" },
  ];
  const metricCells: { testid: string; label: string; value: string; hint?: string }[] = [
    { testid: "replay-metric-events", label: "时间线步骤", value: String(metrics.events) },
    { testid: "replay-metric-gates", label: "人工决策", value: String(metrics.gates) },
    { testid: "replay-metric-checks", label: "Content Guard", value: String(metrics.checks) },
    { testid: "replay-metric-redaction", label: "脱敏字段", value: String(metrics.redactionEntries) },
    { testid: "replay-metric-scan", label: "脱敏扫描", value: metrics.scanOk ? "通过" : "未通过" },
    { testid: "replay-metric-hash", label: "bundle hash", value: metrics.bundleSha256.slice(0, 12) + "…" },
  ];

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

      {/* 业务信息（商品名/关键词/市场/结论/风险/缩略图；无 → 诚实空态） */}
      <section
        data-testid="replay-business"
        aria-label="业务信息"
        className="rounded-2xl border border-slate-200 bg-white p-4"
      >
        <h2 className="text-sm font-bold text-slate-900">业务信息</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {businessCells.map((cell) => (
            <div key={cell.testid} data-testid={cell.testid}>
              <dt className="text-[11px] font-medium text-slate-500">{cell.label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900">{cell.value}</dd>
            </div>
          ))}
          <div data-testid="replay-business-conclusion" className="sm:col-span-2">
            <dt className="text-[11px] font-medium text-slate-500">结论</dt>
            <dd className="mt-0.5 break-words text-sm leading-5 text-slate-800">
              {business.conclusion || "未提供"}
            </dd>
          </div>
          <div data-testid="replay-business-thumbnail">
            <dt className="text-[11px] font-medium text-slate-500">缩略图</dt>
            <dd className="mt-1">
              {business.thumbnail ? (
                <div
                  role="img"
                  aria-label={business.productName || "案例缩略图"}
                  className="h-16 w-16 rounded-lg border border-slate-200 bg-slate-100 bg-cover bg-center"
                  style={{ backgroundImage: 'url("' + business.thumbnail + '")' }}
                />
              ) : (
                <span className="text-xs text-slate-400">暂无缩略图</span>
              )}
            </dd>
          </div>
          <div data-testid="replay-business-link" className="sm:col-span-3">
            <dt className="text-[11px] font-medium text-slate-500">商品链接</dt>
            <dd className="mt-0.5 break-words text-xs text-slate-600">
              {business.link ? (
                <a href={business.link} target="_blank" rel="noopener noreferrer" className="text-teal-700 underline">
                  {business.link}
                </a>
              ) : (
                "未提供"
              )}
            </dd>
          </div>
        </dl>
      </section>

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
          {metricCells.map((cell) => (
            <div
              key={cell.testid}
              data-testid={cell.testid}
              className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
            >
              <dt className="text-[11px] font-medium text-slate-500">{cell.label}</dt>
              <dd
                className={
                  "mt-0.5 text-lg font-bold tabular-nums " +
                  (cell.label === "脱敏扫描" && cell.value === "未通过" ? "text-amber-600" : "text-slate-900")
                }
              >
                {cell.value}
              </dd>
            </div>
          ))}
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

      {/* 研究链路（业务阶段，默认展示） */}
      <section
        data-testid="replay-stages"
        aria-label="研究链路业务阶段"
        className="rounded-2xl border border-slate-200 bg-white p-4"
      >
        <h2 className="text-sm font-bold text-slate-900">研究链路（业务阶段）</h2>
        <ol className="mt-3 space-y-2">
          {stages.map((s, idx) => (
            <li
              key={s.key}
              data-testid={"replay-stage-" + s.key}
              className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-teal-50 text-[10px] font-bold text-teal-700">
                    {idx + 1}
                  </span>
                  {s.label}
                </p>
                <span
                  data-testid={"replay-stage-badge-" + s.key}
                  className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                >
                  {s.badge || s.status}
                </span>
              </div>
              <p className="mt-1 break-words text-xs leading-5 text-slate-600">{s.summary}</p>
              {s.details.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-5 text-slate-500">
                  {s.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {/* 证据来源（可展开：来源类型/实体/时间/原始定位/权威字段/warnings/冲突） */}
      <section
        data-testid="replay-evidence"
        aria-label="证据来源"
        className="rounded-2xl border border-slate-200 bg-white p-4"
      >
        <h2 className="text-sm font-bold text-slate-900">证据来源</h2>
        {evidenceItems.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">暂无证据来源记录。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {evidenceItems.map((ev) => {
              const open = openEvidence.includes(ev.id);
              const fieldEntries = Object.entries(ev.fields);
              return (
                <li
                  key={ev.id}
                  data-testid="replay-evidence-item"
                  className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">
                        {ev.type || "证据"} · {ev.entity || "未知实体"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        采集：{formatDateTime(ev.observedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid={"replay-evidence-toggle-" + ev.id}
                      aria-expanded={open}
                      onClick={() => toggleEvidence(ev.id)}
                      className="shrink-0 rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                    >
                      {open ? "收起" : "展开"}
                    </button>
                  </div>
                  <p className="mt-1 break-words text-[11px] text-slate-500">
                    原始定位：{ev.sourceRef || "—"}
                  </p>
                  {open ? (
                    <div className="mt-2 space-y-1 rounded-md border border-slate-100 bg-white px-3 py-2">
                      <p className="text-[11px] font-semibold text-slate-700">权威字段</p>
                      {fieldEntries.length > 0 ? (
                        <dl className="grid grid-cols-1 gap-y-0.5 text-[11px] text-slate-600 sm:grid-cols-2 sm:gap-x-3">
                          {fieldEntries.map(([k, v]) => (
                            <div key={k}>
                              <dt className="inline font-medium">{k}：</dt>
                              <dd className="inline break-words">{fieldText(v)}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="text-[11px] text-slate-400">无已披露权威字段</p>
                      )}
                      {ev.warnings.length > 0 ? (
                        <p className="break-words text-[11px] text-slate-600">
                          <span className="font-medium">警告：</span>
                          {ev.warnings.join("；")}
                        </p>
                      ) : null}
                      {ev.conflicts.length > 0 ? (
                        <p className="break-words text-[11px] text-amber-600">
                          <span className="font-medium">冲突：</span>
                          {ev.conflicts.join("；")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

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

      {/* 高级详情：原始运行时间线（74 条 raw 技术事件收进折叠区，保留 74/5/11 派生统计与 hash/脱敏展示） */}
      <details
        data-testid="replay-advanced-details"
        className="rounded-2xl border border-slate-200 bg-white p-4"
      >
        <summary className="cursor-pointer select-none text-sm font-bold text-slate-900">
          高级详情：原始运行时间线（{steps.length} 步）
        </summary>
        <div className="mt-3">
          <ReplayTimeline steps={steps} evidenceIndex={evidenceIndex} />
        </div>
      </details>

      {/* 页脚：再次强调回放非现况 */}
      <p className="text-xs text-slate-400">
        以上为脱敏历史案例回放。它不触发任何真实浏览器 / 数据源访问，也不构成对现况的承诺。
      </p>
    </div>
  );
}
