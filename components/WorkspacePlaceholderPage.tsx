import Link from "next/link";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

type WorkspacePlaceholderPageProps = {
  title: string;
  description: string;
};

const statusCards = [
  { title: "当前状态", text: "页面入口已保留，当前仅展示规划说明。" },
  { title: "可用能力", text: "可从首页和爆款拆解页继续使用全自动电商 Agent Alpha MVP 的受控自动化流程。" },
  { title: "下一步", text: "后续按业务优先级接入真实表单、记录和结果区。" },
  { title: "规划能力", text: "多 Agent 协同和自动流程仍为规划中，不触发真实任务。" },
];

export function WorkspacePlaceholderPage({ title, description }: WorkspacePlaceholderPageProps) {
  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-4">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">Qingxuan Workspace</p>
              <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{title}</h1>
              <p className="muted-text mt-1 text-sm">工作台子页面已预留，当前以规划说明为主。</p>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="surface-card-strong p-5 sm:p-6">
            <div className="max-w-3xl">
              <span className="status-badge px-3 py-1 text-sm">规划中</span>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{title}</h2>
              <p className="muted-text mt-3 text-sm leading-6">{description}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                当前页面只是占位说明，不调用 AI、不保存数据、不连接后端接口。
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/" className="linear-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-semibold">
                  返回首页
                </Link>
                <Link href="/products/new" className="linear-button-soft inline-flex h-11 items-center justify-center px-5 text-sm font-semibold">
                  去选品体检
                </Link>
              </div>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {statusCards.map((card) => (
              <article key={card.title} className="surface-card-soft p-4">
                <p className="text-sm font-semibold text-slate-900">{card.title}</p>
                <p className="muted-text mt-2 text-sm leading-6">{card.text}</p>
              </article>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
