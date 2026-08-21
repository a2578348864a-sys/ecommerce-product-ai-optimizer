import type { Metadata } from "next";
import Link from "next/link";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseBundle, type ReplayBundle } from "@/lib/v4/replay/schema";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { formatDateTime } from "@/components/v4/labels";
import {
  resolveBusinessFields,
  resolveDisplayTitle,
  resolveReplayMetrics,
} from "@/components/v4/replay-resolvers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Replay 演示案例 - 轻选工作台",
  description: "查看真实脱敏历史案例回放（Guided Demo），回放只读、不触发真实数据源。",
};

type ReplayPreview = {
  bundleId: string;
  capturedAt: string;
  title: string;
  /** 业务字段（无 → 诚实空态）。 */
  productName: string;
  keyword: string;
  market: string;
  conclusion: string;
  risk: string;
  thumbnail: string;
  /** 以下统计全部由真实 bundle 动态派生（禁止硬编码 74/5/11）。 */
  events: number;
  gates: number;
  checks: number;
  scanOk: boolean;
  redactionEntries: number;
  hashPrefix: string;
};

/**
 * 读母案例 bundle（只读，D4 落盘 data/replay-bundles/）。目录缺失/损坏 → 空列表，绝不伪造。
 * 业务字段 + 统计均通过 resolveBusinessFields / resolveReplayMetrics 动态派生。
 */
async function loadReplayBundleList(): Promise<ReplayPreview[]> {
  const dir = path.join(process.cwd(), "data", "replay-bundles");
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const previews: ReplayPreview[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    let raw: string;
    try {
      raw = await fs.readFile(path.join(dir, entry.name), "utf8");
    } catch {
      continue;
    }
    const parsed = parseBundle(raw);
    if (!parsed.ok) continue;
    const bundle = parsed.bundle;
    const metrics = resolveReplayMetrics(bundle);
    const business = resolveBusinessFields(bundle);
    previews.push({
      bundleId: bundle.bundleId,
      capturedAt: bundle.capturedAt,
      title: resolveDisplayTitle(bundle),
      productName: business.productName,
      keyword: business.keyword,
      market: business.market,
      conclusion: business.conclusion,
      risk: business.risk,
      thumbnail: business.thumbnail,
      events: metrics.events,
      gates: metrics.gates,
      checks: metrics.checks,
      scanOk: metrics.scanOk,
      redactionEntries: metrics.redactionEntries,
      hashPrefix: metrics.bundleSha256.slice(0, 12),
    });
  }

  previews.sort((a, b) => (b.capturedAt || "").localeCompare(a.capturedAt || ""));
  return previews;
}

export default async function ReplayListPage() {
  const bundles = await loadReplayBundleList();

  const totalBundles = bundles.length;
  const totalEvents = bundles.reduce((sum, b) => sum + b.events, 0);
  const totalGates = bundles.reduce((sum, b) => sum + b.gates, 0);
  const totalChecks = bundles.reduce((sum, b) => sum + b.checks, 0);
  const totalRedactions = bundles.reduce((sum, b) => sum + b.redactionEntries, 0);
  const allScanOk = bundles.length > 0 && bundles.every((b) => b.scanOk);

  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0">
          <div className="workspace-header page-header space-y-4">
            <header className="space-y-3">
              <p className="eyebrow">Guided Demo · Replay</p>
              <div>
                <h1 className="section-title text-2xl sm:text-3xl">Replay 演示案例</h1>
                <p className="mt-2 text-sm text-slate-600">
                  浏览真实脱敏历史案例回放，查看时间线、证据引用与 Gate 决策历史。回放只读，不触发真实数据源。
                </p>
              </div>
            </header>
            <WorkspaceMobileNav />
          </div>

          <div className="mt-4 space-y-4">
            {totalBundles > 0 ? (
              <section
                data-testid="replay-collection-summary"
                aria-label="真实脱敏案例库概览"
                className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
              >
                <p className="eyebrow">Replay 案例库</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                  真实脱敏案例库概览
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  以下数字由已导出落盘的真实案例 bundle 动态推导，全部只读；不构成对当前市场或经营现况的承诺。
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <dt className="text-[11px] font-medium text-slate-500">可用案例</dt>
                    <dd className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">{totalBundles}</dd>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <dt className="text-[11px] font-medium text-slate-500">时间线步骤合计</dt>
                    <dd className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">{totalEvents}</dd>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <dt className="text-[11px] font-medium text-slate-500">人工决策合计</dt>
                    <dd className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">{totalGates}</dd>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <dt className="text-[11px] font-medium text-slate-500">Content Guard 合计</dt>
                    <dd className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">{totalChecks}</dd>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <dt className="text-[11px] font-medium text-slate-500">脱敏字段合计 / 扫描</dt>
                    <dd className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">
                      {totalRedactions}
                      <span className="ml-1.5 align-middle text-xs font-semibold text-slate-500">
                        · {allScanOk ? "全部通过" : "部分未通过"}
                      </span>
                    </dd>
                  </div>
                </dl>
              </section>
            ) : null}

            <section
              data-testid="replay-list"
              className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">
                  真实脱敏历史案例回放
                </span>
                <span className="text-xs text-slate-400">仅保留脱敏后的公开信息，供学习参考。</span>
              </div>

              {bundles.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  暂无可回放的演示案例。案例由导出流程生成并落盘后在此展示（当前为空）。
                </p>
              ) : (
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {bundles.map((b) => (
                    <li key={b.bundleId}>
                      <Link
                        href={"/replay/" + encodeURIComponent(b.bundleId)}
                        data-testid={"replay-preview-" + b.bundleId}
                        className="block rounded-xl border border-slate-200 bg-slate-50/60 p-4 transition hover:border-teal-300 hover:bg-teal-50/40"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-base font-semibold text-slate-800">{b.title}</h3>
                            <p className="mt-1 text-xs text-slate-500">
                              回放时点：{formatDateTime(b.capturedAt)}
                            </p>
                          </div>
                          {b.thumbnail ? (
                            <div
                              role="img"
                              aria-label={b.productName || "案例缩略图"}
                              className="h-14 w-14 shrink-0 rounded-lg border border-slate-200 bg-slate-100 bg-cover bg-center"
                              style={{ backgroundImage: 'url("' + b.thumbnail + '")' }}
                            />
                          ) : (
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-[10px] text-slate-300">
                              无图
                            </div>
                          )}
                        </div>
                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-slate-500 sm:grid-cols-3">
                          <div>
                            <dt>关键词</dt>
                            <dd className="break-words font-semibold text-slate-700">{b.keyword || "未提供"}</dd>
                          </div>
                          <div>
                            <dt>市场</dt>
                            <dd className="font-semibold text-slate-700">{b.market || "未提供"}</dd>
                          </div>
                          <div>
                            <dt>风险</dt>
                            <dd className="break-words font-semibold text-slate-700">{b.risk || "未提供"}</dd>
                          </div>
                        </dl>
                        <p className="mt-1.5 break-words text-[11px] leading-5 text-slate-500">
                          <span className="font-medium text-slate-600">结论：</span>
                          {b.conclusion || "未提供"}
                        </p>
                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500 sm:grid-cols-3">
                          <div>
                            <dt>时间线步骤</dt>
                            <dd className="font-semibold tabular-nums text-slate-700">{b.events}</dd>
                          </div>
                          <div>
                            <dt>人工决策</dt>
                            <dd className="font-semibold tabular-nums text-slate-700">{b.gates}</dd>
                          </div>
                          <div>
                            <dt>Content Guard</dt>
                            <dd className="font-semibold tabular-nums text-slate-700">{b.checks}</dd>
                          </div>
                          <div>
                            <dt>脱敏字段</dt>
                            <dd className="font-semibold tabular-nums text-slate-700">{b.redactionEntries}</dd>
                          </div>
                          <div>
                            <dt>脱敏扫描</dt>
                            <dd className="font-semibold text-slate-700">{b.scanOk ? "通过" : "未通过"}</dd>
                          </div>
                          <div>
                            <dt>bundle</dt>
                            <dd className="break-all font-semibold text-slate-700">{b.hashPrefix}…</dd>
                          </div>
                        </dl>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-4 text-xs leading-5 text-slate-400">
                本演示页只读展示已导出的脱敏母案例（bundle）。回放不进入任何真实浏览器 / 数据源，也不代表当前市场或经营现况。
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
