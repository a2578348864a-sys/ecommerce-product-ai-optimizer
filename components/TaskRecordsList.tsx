"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { platformLabels } from "@/lib/types";

const extendedPlatformLabels: Record<string, string> = {
  ...platformLabels,
  tiktok: "TikTok",
  "1688": "1688",
  alibaba: "阿里国际站",
};

type ViralTaskItem = {
  id: string;
  createdAt: string;
  title: string | null;
  platform: string;
  productUrl: string | null;
  materialText: string;
  source: string;
  score: number;
  level: string;
  oneLineSummary: string;
  result: unknown;
};

type ApiResponse =
  | { ok: true; data: { items: ViralTaskItem[] } }
  | { ok: false; error: { code: string; message: string } };

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getTitle(item: ViralTaskItem) {
  return item.title?.trim() || item.materialText.trim().slice(0, 20) || "未命名记录";
}

function sourceLabel(source: string) {
  return source === "ai" ? "AI" : "mock";
}

function getStringArray(result: unknown, key: string) {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return [];
  const value = Reflect.get(result, key);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 5)
    : [];
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;

  return (
    <div className="rounded-2xl border border-white/80 bg-white p-4">
      <p className="text-sm font-bold text-slate-950">{title}</p>
      <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-600">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}

export function TaskRecordsList() {
  const [items, setItems] = useState<ViralTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadTasks() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/tasks?type=viral", { cache: "no-store" });
        const data = await response.json() as ApiResponse;
        if (!response.ok || !data.ok) {
          setError(data.ok ? "任务记录读取失败。" : data.error.message);
          return;
        }
        if (!cancelled) setItems(data.data.items);
      } catch {
        if (!cancelled) setError("任务记录暂时无法读取，请稍后刷新。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTasks();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="app-surface px-4 py-8 sm:px-6 lg:px-8">
      <div className="relative mx-auto grid max-w-[1540px] gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="premium-card rounded-[34px] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Qingxuan Workspace</p>
                <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-950">任务记录</h1>
                <p className="mt-1 text-sm text-slate-500">查看已经保存的爆款拆解记录，默认展示 viral 记录。</p>
              </div>
              <Link
                href="/viral"
                className="glass-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-bold"
              >
                去爆款拆解
              </Link>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="premium-card rounded-[38px] p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-teal-700">Viral Records</p>
                <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950">爆款拆解历史</h2>
              </div>
              <span className="status-pill px-3 py-1 text-sm">{items.length} 条记录</span>
            </div>

            {loading ? (
              <div className="mt-6 rounded-3xl border border-dashed border-teal-200 bg-teal-50/50 p-8 text-sm text-teal-800">
                正在读取本地任务记录...
              </div>
            ) : error ? (
              <div className="mt-6 rounded-3xl border border-rose-100 bg-rose-50 p-8 text-sm text-rose-700">
                {error}
              </div>
            ) : items.length === 0 ? (
              <div className="mt-6 rounded-3xl border border-dashed border-teal-200 bg-teal-50/50 p-8">
                <p className="text-lg font-black text-slate-950">还没有保存的爆款拆解记录</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  去 /viral 生成 mock 或 AI 拆解结果后，点击“保存到任务记录”，这里就会出现历史记录。
                </p>
                <Link
                  href="/viral"
                  className="mt-5 inline-flex h-11 items-center justify-center rounded-full bg-teal-600 px-5 text-sm font-bold text-white"
                >
                  去生成第一条记录
                </Link>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {items.map((item) => {
                  const open = openId === item.id;
                  return (
                    <article key={item.id} className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                            <span>{formatDate(item.createdAt)}</span>
                            <span>{extendedPlatformLabels[item.platform] || item.platform}</span>
                            <span>{sourceLabel(item.source)}</span>
                          </div>
                          <h3 className="mt-2 truncate text-xl font-black tracking-tight text-slate-950">
                            {getTitle(item)}
                          </h3>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{item.oneLineSummary}</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-bold text-teal-800">
                            {item.score}/100
                          </span>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-bold text-slate-700">
                            {item.level}
                          </span>
                          <button
                            type="button"
                            onClick={() => setOpenId(open ? "" : item.id)}
                            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-teal-200 hover:text-teal-700"
                          >
                            {open ? "收起" : "展开详情"}
                          </button>
                        </div>
                      </div>

                      {open ? (
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <DetailList title="核心卖点" items={getStringArray(item.result, "sellingPoints")} />
                          <DetailList title="用户痛点" items={getStringArray(item.result, "painPoints")} />
                          <DetailList title="开头钩子" items={getStringArray(item.result, "hooks")} />
                          <DetailList title="风险提醒" items={getStringArray(item.result, "risks")} />
                          <div className="rounded-2xl border border-white/80 bg-slate-50 p-4 md:col-span-2">
                            <p className="text-sm font-bold text-slate-950">素材摘要</p>
                            <p className="mt-2 line-clamp-4 text-sm leading-6 text-slate-600">{item.materialText}</p>
                            {item.productUrl ? (
                              <p className="mt-2 break-all text-xs text-slate-500">链接：{item.productUrl}</p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
