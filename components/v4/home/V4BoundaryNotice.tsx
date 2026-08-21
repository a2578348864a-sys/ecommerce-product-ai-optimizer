"use client";

/**
 * V4.1 — 产品边界区（文案按契约 §1.A / §1.B，诚实、无夸大）。
 */
import { ShieldCheck } from "lucide-react";
import type { HomeRuntime } from "./heroLogic";

export function V4BoundaryNotice({ runtime }: { runtime: HomeRuntime }) {
  return (
    <section
      data-testid="v4-boundary"
      className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-sm leading-6 text-slate-500"
    >
      <div className="flex gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
        <div>
          <p className="font-semibold text-slate-700">产品边界</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>不预测爆款，不保证销量或利润。</li>
            <li>Replay 为历史脱敏案例，不代表当前市场或经营现况。</li>
            {runtime.mode === "public_showcase" ? (
              <li>公网不会实时抓取 Amazon / 1688，也不消耗访客配额。</li>
            ) : null}
            <li>真实事实需供应商材料 + 人工确认。</li>
            <li>生成内容导出前须人工审核。</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
