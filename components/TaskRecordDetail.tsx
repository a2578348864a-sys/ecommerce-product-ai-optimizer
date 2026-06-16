"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
  updatedAt: string;
  type: string;
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

type DetailResponse =
  | { ok: true; data: ViralTaskItem }
  | { ok: false; error: { code: string; message: string } };

type DeleteResponse =
  | { ok: true; data: { id: string } }
  | { ok: false; error: { code: string; message: string } };

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sourceLabel(source: string) {
  return source === "ai" ? "AI 深度拆解" : "mock 模拟拆解";
}

function getTitle(item: ViralTaskItem) {
  return item.title?.trim() || item.materialText.trim().slice(0, 20) || "未命名记录";
}

function getStringArray(result: unknown, key: string) {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return [];
  const value = Reflect.get(result, key);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 8)
    : [];
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;

  return (
    <section className="rounded-2xl border border-white/80 bg-white p-4">
      <h3 className="text-sm font-black text-slate-950">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </section>
  );
}

export function TaskRecordDetail({ id }: { id: string }) {
  const router = useRouter();
  const [record, setRecord] = useState<ViralTaskItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadRecord() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, { cache: "no-store" });
        const data = await response.json() as DetailResponse;
        if (!response.ok || !data.ok) {
          if (!cancelled) setError(data.ok ? "任务详情读取失败。" : data.error.message);
          return;
        }
        if (!cancelled) setRecord(data.data);
      } catch {
        if (!cancelled) setError("任务详情暂时无法读取，请稍后刷新。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadRecord();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const resultJson = useMemo(() => {
    if (!record) return "";
    try {
      return JSON.stringify(record.result, null, 2);
    } catch {
      return "结果内容暂时无法格式化。";
    }
  }, [record]);

  async function deleteRecord() {
    if (!record || deleting) return;
    const confirmed = window.confirm("确定删除这条任务记录吗？删除后无法恢复。");
    if (!confirmed) return;

    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(record.id)}`, {
        method: "DELETE",
      });
      const data = await response.json() as DeleteResponse;
      if (!response.ok || !data.ok) {
        setDeleteError(data.ok ? "删除失败，请稍后再试。" : data.error.message);
        return;
      }
      router.push("/tasks");
      router.refresh();
    } catch {
      setDeleteError("删除失败，请检查本地服务后重试。");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="app-surface px-4 py-8 sm:px-6 lg:px-8">
      <div className="relative mx-auto grid max-w-[1540px] gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="surface-card rounded-[34px] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Task Detail</p>
                <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-950">任务详情</h1>
                <p className="mt-1 text-sm text-slate-500">查看单条爆款拆解记录的输入、摘要和完整 JSON。</p>
              </div>
              <Link
                href="/tasks"
                className="glass-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-bold"
              >
                返回任务中心
              </Link>
            </div>
            <WorkspaceMobileNav />
          </header>

          {loading ? (
            <section className="surface-card rounded-[38px] p-8 text-sm text-teal-800">
              正在读取任务详情...
            </section>
          ) : error ? (
            <section className="surface-card rounded-[38px] p-8">
              <p className="text-sm font-bold text-rose-700">{error}</p>
              <Link href="/tasks" className="mt-5 inline-flex text-sm font-bold text-teal-700">
                返回任务列表
              </Link>
            </section>
          ) : record ? (
            <section className="surface-card rounded-[38px] p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-teal-700">Viral Record</p>
                  <h2 className="mt-2 break-words text-3xl font-black tracking-tight text-slate-950">
                    {getTitle(record)}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{record.oneLineSummary}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-bold text-teal-800">
                    {record.score}/100
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-bold text-slate-700">
                    {record.level}
                  </span>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-bold text-slate-400">记录 ID</p>
                  <p className="mt-1 break-all text-xs font-bold text-slate-800">{record.id}</p>
                </div>
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-bold text-slate-400">创建时间</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{formatDate(record.createdAt)}</p>
                </div>
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-bold text-slate-400">平台</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">
                    {extendedPlatformLabels[record.platform] || record.platform}
                  </p>
                </div>
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-bold text-slate-400">来源</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{sourceLabel(record.source)}</p>
                </div>
                <div className="surface-card-soft rounded-[22px] p-4">
                  <p className="text-xs font-bold text-slate-400">类型</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{record.type}</p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/80 bg-slate-50 p-4">
                <h3 className="text-sm font-black text-slate-950">输入素材</h3>
                {record.productUrl ? (
                  <p className="mt-3 break-all text-xs text-slate-500">链接：{record.productUrl}</p>
                ) : null}
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">
                  {record.materialText}
                </p>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <ResultList title="核心卖点" items={getStringArray(record.result, "sellingPoints")} />
                <ResultList title="用户痛点" items={getStringArray(record.result, "painPoints")} />
                <ResultList title="开头钩子" items={getStringArray(record.result, "hooks")} />
                <ResultList title="标题建议" items={getStringArray(record.result, "titleSuggestions")} />
                <ResultList title="短视频开头" items={getStringArray(record.result, "videoOpenings")} />
                <ResultList title="评论区话题" items={getStringArray(record.result, "commentTriggers")} />
                <ResultList title="转化优化" items={getStringArray(record.result, "conversionSuggestions")} />
                <ResultList title="风险提醒" items={getStringArray(record.result, "risks")} />
              </div>

              <div className="mt-5 rounded-2xl border border-white/80 bg-white p-4">
                <h3 className="text-sm font-black text-slate-950">完整结果 JSON</h3>
                <p className="mt-1 text-xs text-slate-500">用于复核 AI/mock 返回结构，长内容可以滚动查看。</p>
                <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                  {resultJson}
                </pre>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={deleteRecord}
                  disabled={deleting}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-5 text-sm font-bold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deleting ? "删除中..." : "删除这条记录"}
                </button>
                <Link href="/tasks" className="inline-flex h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-bold text-slate-700">
                  返回任务中心
                </Link>
                {deleteError ? <p className="text-sm font-bold text-rose-700">{deleteError}</p> : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
