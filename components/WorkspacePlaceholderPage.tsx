import Link from "next/link";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

type WorkspacePlaceholderPageProps = {
  title: string;
  description: string;
};

export function WorkspacePlaceholderPage({ title, description }: WorkspacePlaceholderPageProps) {
  return (
    <main className="app-surface px-4 py-8 sm:px-6 lg:px-8">
      <div className="relative mx-auto grid max-w-[1540px] gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="premium-card rounded-[34px] px-5 py-4">
            <div>
              <p className="eyebrow">Qingxuan Workspace</p>
              <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-950">{title}</h1>
              <p className="mt-1 text-sm text-slate-500">这个模块已经可以点击进入，不会再原地无反应。</p>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="premium-card rounded-[38px] p-6 shadow-[0_24px_68px_rgba(13,148,136,0.10)] ring-1 ring-emerald-200/35 sm:p-8">
            <div className="max-w-2xl">
              <span className="status-pill px-3 py-1 text-sm">
                开发中
              </span>
              <h2 className="mt-5 text-4xl font-black tracking-tight text-slate-950">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                当前页面只是占位说明，不调用 AI、不保存数据、不连接后端接口。
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/"
                  className="glass-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-bold"
                >
                  返回首页
                </Link>
                <Link
                  href="/products/new"
                  className="glass-button-soft inline-flex h-11 items-center justify-center px-5 text-sm font-bold"
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
