import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <main className="app-shell flex min-h-[60vh] items-center justify-center px-4 py-16">
      <div className="mx-auto max-w-md text-center">
        <div className="linear-icon mx-auto size-14 rounded-2xl bg-slate-100 text-slate-400">
          <span className="flex size-full items-center justify-center text-lg font-bold">404</span>
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">页面不存在</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          你访问的页面不存在或已迁移。研究始终从发现商品开始，由你确认每一步。
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            href="/"
            className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold"
          >
            返回工作台
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/opportunity-candidates"
            className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
          >
            商品研究池
          </Link>
        </div>
      </div>
    </main>
  );
}
