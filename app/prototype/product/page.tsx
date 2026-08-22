/** 本地 Owner 视觉样板（原型）：商品研究结果。真实数据同上（Listing 草稿/图片检查来自真实 run）。 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import Link from "next/link";
import "../prototype.css";

const THUMB_BIG = (
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

/** 缺口 → 用户语言（无内部码/枚举）。 */
function gapText(): string {
  return "市场与评论数据还没有拿到（暂未获得数据），先补充再下结论。";
}

type Module = { no: string; title: string; ai: string; basis: string[]; missing: string; action: string };

function modulesFor(item: Record<string, unknown>): Module[] {
  const evidence = (Array.isArray(item.evidence) ? item.evidence : []) as Array<Record<string, unknown>>;
  const first = evidence[0] as Record<string, unknown> | undefined;
  return [
    {
      no: "01",
      title: "市场机会",
      ai: first ? "已有一条市场依据：" + String(first.entity ?? "") + "（" + String(item.marketplace ?? "US") + "）。" : "市场数据还没有拿到。",
      basis: first ? [String(first.type ?? "") + " 来源 · " + String(first.entity ?? ""), "市场：美国站"] : [],
      missing: "销量与价格数据还没拿到。",
      action: "查看依据",
    },
    { no: "02", title: "买家需求与差评", ai: "暂无结论——需要先拿到评论数据。", basis: [], missing: "评论与差评数据尚未拿到。", action: "去补充" },
    { no: "03", title: "货源与商品匹配", ai: "暂无结论——尚未核对供应商与商品匹配。", basis: [], missing: "供应商与货源信息尚未补充。", action: "去补充" },
    { no: "04", title: "成本与风险", ai: "暂无结论——需要采购与物流成本才能判断。", basis: [], missing: "采购成本、物流费用尚未填写。", action: "填写采购成本" },
  ];
}

export default async function PrototypeProduct() {
  const data = await loadData();
  const item = (data[0] ?? {}) as Record<string, unknown>;
  const name = String(item.productName ?? "商品名称待补充");
  const listingTitle = String(item.listingTitle ?? "");
  const listingPoints = (Array.isArray(item.listingPoints) ? item.listingPoints : []).map(String).filter(Boolean);
  const imgReasons = (Array.isArray(item.imgReasons) ? item.imgReasons : []).map(String).filter(Boolean);
  const modules = modulesFor(item);

  return (
    <div className="proto">
      <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pt-10 proto-bottom-pad">
        <p className="text-xs font-semibold tracking-[0.18em] text-[var(--slate)]">我的研究台 / 商品研究</p>

        <section className="proto-card mt-4 p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="proto-thumb h-40 w-40 shrink-0 sm:h-44 sm:w-44">
              {THUMB_BIG}
              <span className="thumb-cap">商品图待补充</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="proto-display text-2xl text-[var(--ink)] sm:text-3xl">{name}</h1>
                <span className="sticker sticker-amber">先补资料</span>
              </div>
              <p className="mt-1 text-sm text-[var(--slate)]">美国站 · 关键词待补充</p>
              <p className="mt-4 max-w-xl text-base leading-7 text-[var(--ink)]">{gapText()}</p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link href="/prototype/product" className="proto-btn">补充市场资料</Link>
                <span className="text-xs text-[var(--slate)]">补充后再读结论，先不用现在决定。</span>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {modules.map((m) => (
            <section key={m.no} className="proto-card p-5">
              <div className="proto-module-head">
                <span className="proto-module-no">{m.no}</span>
                <h2 className="text-base font-bold">{m.title}</h2>
              </div>
              <p className="mt-3 text-sm font-semibold leading-6 text-[var(--ink)]">{m.ai}</p>
              {m.basis.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {m.basis.map((b, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-5 text-[var(--slate)]">
                      <span aria-hidden="true" className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--green)]" />
                      {b}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs leading-5 text-[var(--slate)]">还没有可展示的依据。</p>
              )}
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-dashed border-[var(--line)] pt-3">
                <p className="text-xs text-[var(--amber)]">{m.missing}</p>
                <span className="proto-btn-sub text-xs">{m.action}</span>
              </div>
            </section>
          ))}
        </div>

        <section className="proto-card mt-6 p-5 sm:p-6" data-testid="proto-listing">
          <div className="proto-module-head">
            <span className="proto-module-no">05</span>
            <h2 className="text-base font-bold">Listing 与图片</h2>
            <span className="ml-auto text-xs text-[var(--slate)]">内部草稿 · 未发布</span>
          </div>
          {listingTitle ? (
            <div className="mt-4">
              <p className="proto-display text-lg text-[var(--ink)]">{listingTitle}</p>
              {listingPoints.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {listingPoints.slice(0, 3).map((p, i) => (
                    <li key={i} className="text-xs leading-5 text-[var(--slate)]">· {p.replace(/\n/g, "；")}</li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-3 text-xs text-[var(--amber)]">请人工核对后使用，发布前需要你确认。</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--slate)]">Listing 还没有草稿，先补充商品信息再生成。</p>
          )}
          <div className="mt-5 grid gap-4 sm:grid-cols-[10rem_1fr]">
            <div className="proto-thumb h-32 w-full sm:h-36">
              {THUMB_BIG}
              <span className="thumb-cap">商品图待补充</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--rose)]">这张图片暂时不能使用</p>
              <ul className="mt-2 space-y-1">
                {imgReasons.map((r, i) => (
                  <li key={i} className="text-xs leading-5 text-[var(--slate)]">· {r}</li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="proto-btn-sub text-xs">补充清晰产品参考图后重新检查</span>
              </div>
            </div>
          </div>
        </section>

        <nav className="proto-tabbar" aria-label="移动导航">
          <Link href="/prototype">研究台</Link>
          <Link href="/prototype/product" className="active">商品研究</Link>
        </nav>
      </div>
    </div>
  );
}
