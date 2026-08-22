/** 本地 Owner 视觉样板（原型）：工作台。真实数据来自 docs/v4.1/proto-data.json（由 dev.db 只读聚合）。 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import Link from "next/link";
import "./prototype.css";

const PRODUCT_THUMB = (
  <svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <path d="M38 30 C38 26 42 24 50 24 C58 24 62 26 62 30 L64 70 C64 76 58 80 50 80 C42 80 36 76 36 70 Z" stroke="#6F6C63" strokeWidth="2.4" strokeLinejoin="round" />
    <path d="M40 32 L60 32" stroke="#6F6C63" strokeWidth="2" />
    <path d="M43 36 L57 36" stroke="#B9B5AA" strokeWidth="2" strokeDasharray="3 3" />
    <path d="M44 44 L56 44 M45 52 L55 52 M46 60 L54 60" stroke="#B9B5AA" strokeWidth="2" />
    <path d="M50 24 L50 16" stroke="#6F6C63" strokeWidth="2" />
  </svg>
);

async function loadData() {
  const raw = await fsp.readFile(path.join(process.cwd(), "docs", "v4.1", "proto-data.json"), "utf8");
  return JSON.parse(raw) as Array<Record<string, unknown>>;
}

const GROUP_META: Record<string, { title: string; note: string; sticker: string; stickerClass: string }> = {
  needs: { title: "需要我处理", note: "等你的决定或补充，才能继续。", sticker: "先补资料", stickerClass: "sticker-amber" },
  doing: { title: "AI 研究中", note: "正在整理市场数据，稍后回来。", sticker: "研究中", stickerClass: "sticker-blue" },
  done: { title: "已完成", note: "结论已经好了。", sticker: "已完成", stickerClass: "sticker-green" },
  failed: { title: "需要我处理", note: "上一次研究中断，可以重新开始。", sticker: "重新开始", stickerClass: "sticker-rose" },
};

function oneLiner(item: Record<string, unknown>): string {
  const evidenceCount = Array.isArray(item.evidence) ? (item.evidence as unknown[]).length : 0;
  const gap = String(item.gap ?? "");
  const hasGap = Boolean(gap);
  if (hasGap) return "已拿到 " + evidenceCount + " 条市场依据；评论与数据还没拿到，先补充再判断。";
  return "已拿到 " + evidenceCount + " 条市场依据，可以给出初步结论。";
}

function nextFor(item: Record<string, unknown>): string {
  const g = String(item.group ?? "needs");
  if (g === "done") return "查看结果";
  if (g === "doing") return "查看进展";
  if (g === "failed") return "重新开始";
  return "补充市场资料";
}

export default async function PrototypeWorkbench() {
  const data = await loadData();
  const byGroup: Record<string, Array<Record<string, unknown>>> = { needs: [], doing: [], done: [], failed: [] };
  for (const raw of data) {
    const item = raw as Record<string, unknown>;
    const g = String(item.group ?? "needs");
    (byGroup[g] ?? (byGroup[g] = [])).push(item);
  }
  const groups = ["needs", "doing", "done"] as const;

  return (
    <div className="proto">
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6 sm:pt-10 proto-bottom-pad">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-[var(--slate)]">我的研究台</p>
            <h1 className="proto-display mt-1 text-3xl text-[var(--ink)] sm:text-4xl">研究台</h1>
            <p className="mt-2 text-sm text-[var(--slate)]">每个商品走到哪一步，下一步该做什么，一眼看清。</p>
          </div>
          <Link href="/prototype/product" className="proto-btn" data-testid="proto-start">开始研究一个商品</Link>
        </header>

        <div className="mt-8 grid gap-8 md:grid-cols-3">
          {groups.map((g) => {
            const meta = GROUP_META[g];
            const items = byGroup[g] ?? [];
            return (
              <section key={g} aria-label={meta.title}>
                <div className="proto-group-head">
                  <h2 className="text-base font-bold">{meta.title}</h2>
                  <span className="text-xs text-[var(--slate)]">{items.length} 件</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--slate)]">{meta.note}</p>
                <div className="mt-4 space-y-4">
                  {items.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--line)] px-4 py-6 text-center text-xs text-[var(--slate)]">
                      还没有商品到这里。
                    </div>
                  ) : null}
                  {items.map((item) => {
                    const name = String(item.productName ?? "商品名称待补充");
                    const market = String(item.marketplace ?? "待定");
                    return (
                      <article key={String(item.candidateId)} className="proto-card p-4">
                        <div className="flex gap-3">
                          <div className="proto-thumb h-24 w-24 shrink-0 sm:h-28 sm:w-28">
                            {PRODUCT_THUMB}
                            <span className="thumb-cap">商品图待补充</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="proto-display truncate text-lg text-[var(--ink)]">{name}</h3>
                              <span className={"sticker shrink-0 " + meta.stickerClass}>{meta.sticker}</span>
                            </div>
                            <p className="mt-0.5 text-xs text-[var(--slate)]">美国站 · 关键词待补充</p>
                            <p className="mt-2 text-sm leading-6 text-[var(--ink)]">{market ? oneLiner(item) : "资料还需补充。"}</p>
                            <Link
                              href={g === "needs" ? "/prototype/product" : "/prototype/product"}
                              className="proto-btn-sub mt-3 text-sm"
                              data-testid={"proto-next-" + g}
                            >
                              {nextFor(item)}
                              <span aria-hidden="true">→</span>
                            </Link>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <nav className="proto-tabbar" aria-label="移动导航">
          <Link href="/prototype" className="active">研究台</Link>
          <Link href="/prototype/product">商品研究</Link>
        </nav>
      </div>
    </div>
  );
}
