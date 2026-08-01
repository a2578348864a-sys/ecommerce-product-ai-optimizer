import Link from "next/link";
import type { ReactNode } from "react";

export function OpportunitiesConvergenceView({
  legacyContent,
}: {
  legacyContent: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section
        data-testid="sellersprite-primary-entry"
        className="surface-card mx-auto flex w-full max-w-7xl flex-col gap-5 border-teal-200 bg-teal-50/40 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
      >
        <div className="max-w-3xl space-y-2">
          <p className="eyebrow">当前商品研究主链</p>
          <div>
            <h1 className="section-title text-xl sm:text-2xl">上传卖家精灵报表</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              上传 SellerSprite 美国站搜索结果，先安全校验数据，再人工选择商品加入研究池。
            </p>
          </div>
          <p className="text-xs leading-5 text-slate-500">
            新流程无需填写查询词、类目或价格，也不需要重复上传文件。
          </p>
        </div>
        <Link
          href="/opportunities/sellersprite-preview"
          className="linear-button-primary inline-flex min-h-11 shrink-0 items-center justify-center px-5 py-2 text-sm font-semibold"
        >
          上传并预览报表
        </Link>
      </section>

      <details className="surface-card mx-auto w-full max-w-7xl overflow-hidden">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-800 outline-none marker:text-teal-600 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500">
          旧版批次与历史
        </summary>
        <div className="border-t border-slate-200 bg-slate-50/40 p-4 sm:p-5">
          <p className="mb-4 rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600">
            旧版 ProductBatch 流程仅用于历史兼容，不属于当前 SellerSprite 商品研究主链。
          </p>
          {legacyContent}
        </div>
      </details>
    </div>
  );
}
