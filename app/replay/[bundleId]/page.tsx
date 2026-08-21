import type { Metadata } from "next";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseBundle, verifyBundleHash, type ReplayBundle } from "@/lib/v4/replay/schema";
import { ReplayView } from "@/components/v4/ReplayView";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "案例回放 - 轻选工作台",
  description: "查看单个脱敏历史案例回放：时间线、证据引用、Gate 决策与 Content Guard 结果。",
};

type ReplayDetailPageProps = {
  params: Promise<{ bundleId: string }>;
};

/**
 * 读单个母 case bundle（只读，D4 落盘 data/replay-bundles/）。缺失/损坏/hash 不通过 → null。
 */
async function loadReplayBundle(bundleId: string): Promise<ReplayBundle | null> {
  const safe = bundleId.trim().slice(0, 128);
  const filePath = path.join(process.cwd(), "data", "replay-bundles", safe + ".json");
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const parsed = parseBundle(raw);
  if (!parsed.ok) return null;
  const sha256 = (s: string) => { const { createHash } = require("node:crypto"); return createHash("sha256").update(s).digest("hex"); };
  if (!verifyBundleHash(parsed.bundle, sha256)) return null;
  return parsed.bundle;
}

export default async function ReplayDetailPage({ params }: ReplayDetailPageProps) {
  const { bundleId } = await params;
  const bundle = await loadReplayBundle(bundleId);

  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0 max-w-4xl">
          <WorkspaceMobileNav />
          <div className="mt-4">
            {bundle ? (
              <ReplayView bundle={bundle} />
            ) : (
              <section
                data-testid="replay-unavailable"
                className="rounded-2xl border border-slate-200 bg-white p-6"
              >
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                  真实脱敏历史案例回放
                </span>
                <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-950">
                  该回放不可用
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  未找到可用的脱敏案例 bundle（{bundleId.trim().slice(0, 128)}），或该 bundle 未通过
                  完整性 / 脱敏校验。请从演示案例列表重新进入。
                </p>
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
