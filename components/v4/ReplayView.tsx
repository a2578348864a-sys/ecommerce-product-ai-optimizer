"use client";

/**
 * V4 P6 — ReplayView：历史案例回放视图（纯展示 + 本地播放，D6）。
 *
 * 只注入母 bundle（只读不可变），渲染：
 *   - 「真实脱敏历史案例回放」标识与 capturedAt / 时效提示
 *   - 时间线（暂停 / 快进 / Evidence 点击展开，见 ReplayTimeline）
 *   - Gate 决策历史记录（只读，不可修改）
 *   - Content Guard 结果展示（只读）
 *
 * 不伪造网络/进度：进度仅由 ReplayTimeline 的离散步骤推进，无连续进度条；
 * 不发起任何请求，也不写入任何运行数据（Visitor 的 Gate 选择/草稿不在本组件）。
 */
import type { ReplayBundle } from "@/lib/v4/replay/schema";
import { formatDateTime } from "./labels";
import {
  ReplayTimeline,
  formatStepTime,
  type ReplayEvidence,
  type ReplayTimelineStep,
} from "./ReplayTimeline";

export type ReplayGateRecord = {
  gate: string;
  decision: string;
  reason?: string;
  actor?: string;
  decidedAt?: string;
};

export type ReplayContentCheck = {
  title: string;
  status: string;
  findings?: string[];
};

export type ReplayMeta = {
  bundleId: string;
  sourceRunId: string;
  exportedAt: string;
  capturedAt: string;
  mode: string;
  allowlistVersion: string;
  bundleSha256: string;
  filesCount: number;
  scanOk: boolean;
  redactionEntries: number;
};

/** 判定回放数据是否超时效（默认 30 天）。 */
export const REPLAY_STALE_DAYS = 30;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** 时间线步骤：优先 data.timeline，回退到 data.events（ResearchRunEvent 形状）。 */
export function resolveTimelineSteps(bundle: ReplayBundle): ReplayTimelineStep[] {
  const data = asRecord(bundle.data) ?? {};
  const steps: ReplayTimelineStep[] = [];

  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  for (const raw of timeline) {
    if (typeof raw === "string") {
      steps.push({ id: raw, at: "", title: raw });
      continue;
    }
    const r = asRecord(raw);
    if (!r) continue;
    const id = asString(r.id ?? r.stepId ?? r.seq, "s" + steps.length);
    const at = asString(r.at ?? r.ts ?? r.createdAt);
    const title = asString(r.title ?? r.label ?? r.name ?? r.kind, "步骤");
    steps.push({
      id,
      at,
      title,
      detail: asString(r.detail ?? r.summary),
      kind: asString(r.kind),
      evidenceRefs: resolveEvidenceRefs(r.evidenceRefs),
    });
  }
  if (steps.length > 0) return steps;

  // 回退：从结构化事件派生（仅用公开字段，不含思维链）。
  const events = Array.isArray(data.events) ? data.events : [];
  for (const raw of events) {
    const r = asRecord(raw);
    if (!r) continue;
    const seq = asString(r.seq, "");
    const title = asString(r.type ?? "事件");
    const node = asString(r.node);
    steps.push({
      id: seq ? "ev-" + seq : "ev-" + steps.length,
      at: asString(r.createdAt),
      title: node && node !== title ? title + " · " + node : title,
      kind: node,
      detail: summarizeEventPayload(asString(r.payloadJson)),
    });
  }
  return steps;
}

function summarizeEventPayload(payloadJson: string): string {
  if (!payloadJson) return "";
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    for (const key of ["reason", "message", "decision", "summary", "note", "label"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  } catch {
    return "";
  }
}

function resolveEvidenceRefs(value: unknown): ReplayEvidence[] {
  if (!Array.isArray(value)) return [];
  const out: ReplayEvidence[] = [];
  for (const raw of value) {
    if (typeof raw === "string") {
      out.push({ id: raw });
      continue;
    }
    const r = asRecord(raw);
    if (!r) continue;
    const id = asString(r.id ?? r.evidenceId ?? r.ref);
    if (!id) continue;
    out.push({
      id,
      label: asString(r.label ?? r.title ?? r.kind),
      sourceUrl: asString(r.sourceUrl ?? r.url),
      capturedAt: asString(r.capturedAt),
      summary: asString(r.summary ?? r.snippet),
    });
  }
  return out;
}

/** 顶层证据索引（供步骤只带 id 时展开引用）。 */
export function resolveEvidenceIndex(bundle: ReplayBundle): ReplayEvidence[] {
  const data = asRecord(bundle.data) ?? {};
  return resolveEvidenceRefs(data.evidenceRefs);
}

/** Gate 决策历史记录（只读）。 */
export function resolveGates(bundle: ReplayBundle): ReplayGateRecord[] {
  const data = asRecord(bundle.data) ?? {};
  const gates = Array.isArray(data.gates) ? data.gates : [];
  const out: ReplayGateRecord[] = [];
  for (const raw of gates) {
    const r = asRecord(raw);
    if (!r) continue;
    out.push({
      gate: asString(r.gate ?? r.name ?? "gate"),
      decision: asString(r.decision ?? r.option),
      reason: asString(r.reason ?? r.note),
      actor: asString(r.actor),
      decidedAt: asString(r.decidedAt ?? r.at ?? r.createdAt),
    });
  }
  return out;
}

/** Content Guard 结果（只读）。 */
export function resolveContentChecks(bundle: ReplayBundle): ReplayContentCheck[] {
  const data = asRecord(bundle.data) ?? {};
  const content = asRecord(data.content);
  if (!content) return [];

  const candidates = Array.isArray(content.guards)
    ? content.guards
    : Array.isArray(content.checks)
      ? content.checks
      : Array.isArray(content.results)
        ? content.results
        : [];
  const out: ReplayContentCheck[] = [];
  for (const raw of candidates) {
    if (typeof raw === "string") {
      out.push({ title: raw, status: "记录" });
      continue;
    }
    const r = asRecord(raw);
    if (!r) continue;
    out.push({
      title: asString(r.title ?? r.name ?? r.check ?? "检查项"),
      status: asString(r.status ?? r.result ?? "记录"),
      findings: asStringArray(r.findings ?? r.messages ?? r.reasons),
    });
  }
  return out;
}

/** 展示标题（母 case 名），回退到 bundleId。 */
export function resolveDisplayTitle(bundle: ReplayBundle): string {
  const data = asRecord(bundle.data) ?? {};
  const candidate = asRecord(data.candidate);
  if (candidate) {
    const name = asString(candidate.name ?? candidate.productName ?? candidate.title ?? candidate.id);
    if (name) return name;
  }
  return bundle.bundleId;
}

/** 回放时效判定：capturedAt 距今超过 REPLAY_STALE_DAYS 天。 */
export function isReplayStale(
  capturedAt: string,
  now: Date = new Date(),
  staleDays = REPLAY_STALE_DAYS,
): boolean {
  if (!capturedAt) return false;
  const t = new Date(capturedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > staleDays * 24 * 60 * 60 * 1000;
}

export function resolveMeta(bundle: ReplayBundle): ReplayMeta {
  return {
    bundleId: bundle.bundleId,
    sourceRunId: bundle.sourceRunId,
    exportedAt: bundle.exportedAt,
    capturedAt: bundle.capturedAt,
    mode: bundle.mode,
    allowlistVersion: bundle.allowlistVersion,
    bundleSha256: bundle.manifest.bundleSha256,
    filesCount: bundle.manifest.files.length,
    scanOk: bundle.redactionReport.scanOk,
    redactionEntries: bundle.redactionReport.entries.length,
  };
}

export type ReplayViewProps = {
  bundle: ReplayBundle;
  now?: Date;
};

/**
 * ReplayView：组合时间线 / Gate 决策 / Content Guard / 标识与时效。
 * 纯展示：props 注入 bundle；播放为本地控制；不发起网络，不写入任何数据。
 */
export function ReplayView({ bundle, now }: ReplayViewProps) {
  const meta = resolveMeta(bundle);
  const title = resolveDisplayTitle(bundle);
  const steps = resolveTimelineSteps(bundle);
  const evidenceIndex = resolveEvidenceIndex(bundle);
  const gates = resolveGates(bundle);
  const checks = resolveContentChecks(bundle);
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
                      {g.gate} · {g.decision}
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
