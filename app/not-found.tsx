import Link from "next/link";

export default function NotFound() {
  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4 py-10">
      <section className="surface-card-strong w-full max-w-lg p-6 text-center sm:p-8">
        <p className="eyebrow">404 · 轻选工作台</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">页面没有找到</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">链接可能已失效。返回工作台，或去任务中心查看已有记录。</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/" className="linear-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-semibold">返回工作台</Link>
          <Link href="/tasks" className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold">查看任务</Link>
        </div>
      </section>
    </main>
  );
}
