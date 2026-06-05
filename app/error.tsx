"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <h1 className="text-2xl font-bold text-slate-900 mb-4">页面渲染出错</h1>
      <p className="text-slate-600 mb-6">请刷新或检查生成结果结构。</p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-6 text-sm font-semibold text-white hover:bg-slate-800"
        >
          刷新页面
        </button>
      </div>
    </div>
  );
}
