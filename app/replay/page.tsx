import type { Metadata } from "next";
import Link from "next/link";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseBundle, type ReplayBundle } from "@/lib/v4/replay/schema";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Replay 演示案例 - 轻选工作台",
  description: "查看真实脱敏历史案例回放（Guided Demo），回放只读、不触发真实数据源。",
};

type ReplayPreview = {
  bundleId: string;
  capturedAt: string;
  title: string;
  scanOk: boolean;
  redactionEntries: number;
};

function displayTitle(bundle: ReplayBundle): string {
  const data =
    bundle.data && typeof bundle.data === "object" && !Array.isArray(bundle.data)
      ? (bundle.data as Record<string, unknown>)
      : {};
  const candidate =
    data.candidate && typeof data.candidate === "object" && !Array.isArray(data.candidate)
      ? (data.candidate as Record<string, unknown>)
      : null;
  if (candidate) {
    const name = candidate.name ?? candidate.productName ?? candidate.title ?? candidate.id;
    if (typeof name === "string" && name.trim()) return name;
  }
  return bundle.bundleId;
}

/**
 * 读母案例 bundle（只读，D4 落盘 data/replay-bundles/）。目录缺失/损坏 → 空列表，绝不伪造。
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
    previews.push({
      bundleId: bundle.bundleId,
      capturedAt: bundle.capturedAt,
      title: displayTitle(bundle),
      scanOk: bundle.redactionReport.scanOk,
      redactionEntries: bundle.redactionReport.entries.length,
    });
  }

  previews.sort((a, b) => (b.capturedAt || "").localeCompare(a.capturedAt || ""));
  return previews;
}

export default async function ReplayListPage() {
  const bundles = await loadReplayBundleList();

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

          <div className="mt-4">
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
                        <h3 className="text-base font-semibold text-slate-800">{b.title}</h3>
                        <p className="mt-1 text-xs text-slate-500">
                          回放时点：{b.capturedAt ? new Date(b.capturedAt).toLocaleString("zh-CN") : "—"}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          脱敏 {b.redactionEntries} 项 · {b.scanOk ? "扫描通过" : "扫描未通过"} · b#{b.bundleId}
                        </p>
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
