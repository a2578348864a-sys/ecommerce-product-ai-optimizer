/** 开发调试详情（研究后台）——默认隐藏，不进导航；从详情页“调试详情”链进入。 */
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getRun, type RunDetailResponse } from "@/components/v4/api";
import { DebugView } from "@/components/v4/DebugView";

export default function DebugPage() {
  const params = useParams<{ runId: string }>();
  const runId = params?.runId ?? "";
  const [data, setData] = useState<RunDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await getRun(runId);
        if (alive) setData(d);
      } catch {
        if (alive) setError("无法加载调试数据。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [runId]);

  return (
    <main className="app-shell px-4 py-6 sm:px-6">
      <h1 className="text-lg font-bold text-slate-900">开发调试详情（研究后台）</h1>
      <p className="mt-1 text-xs text-slate-400">此页面仅供排查问题，普通用户无需访问。</p>
      <div className="mt-4">
        <DebugView run={data?.run ?? null} events={data?.events ?? []} loading={loading} error={error} />
      </div>
    </main>
  );
}