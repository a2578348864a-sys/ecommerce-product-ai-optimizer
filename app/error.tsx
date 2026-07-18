"use client";

import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4 py-10">
      <section className="surface-card-strong w-full max-w-lg p-6 text-center sm:p-8">
        <p className="eyebrow">轻选工作台</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">这个页面暂时打不开</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">可以重新加载，或先返回工作台继续其他操作。</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          onClick={reset}
          className="linear-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
        >
          重新尝试
        </button>
          <Link href="/" className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold">返回工作台</Link>
        </div>
      </section>
    </main>
  );
}
