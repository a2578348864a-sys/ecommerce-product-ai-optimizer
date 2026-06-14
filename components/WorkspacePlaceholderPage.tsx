import Link from "next/link";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

type WorkspacePlaceholderPageProps = {
  title: string;
  description: string;
};

export function WorkspacePlaceholderPage({ title, description }: WorkspacePlaceholderPageProps) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.14),transparent_32rem),linear-gradient(180deg,#f8fcfb_0%,#f4f8fb_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1540px] gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
        <WorkspaceSidebar />

        <div className="min-w-0 space-y-5">
          <header className="rounded-[28px] border border-white/80 bg-white/90 px-5 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-600">Qingxuan Workspace</p>
              <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950">{title}</h1>
              <p className="mt-1 text-sm text-slate-500">这个模块已经可以点击进入，不会再原地无反应。</p>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="rounded-[32px] border border-white/80 bg-white/95 p-8 shadow-[0_24px_70px_rgba(15,23,42,0.07)]">
            <div className="max-w-2xl">
              <span className="inline-flex rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700">
                开发中
              </span>
              <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-950">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                当前页面只是占位说明，不调用 AI、不保存数据、不连接后端接口。
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/"
                  className="inline-flex h-11 items-center justify-center rounded-full bg-teal-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-teal-700"
                >
                  返回首页
                </Link>
                <Link
                  href="/products/new"
                  className="inline-flex h-11 items-center justify-center rounded-full border border-teal-200 bg-white px-5 text-sm font-semibold text-teal-700 transition hover:border-teal-300 hover:bg-teal-50"
                >
                  去选品体检
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
