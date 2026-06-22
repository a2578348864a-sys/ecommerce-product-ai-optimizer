"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  FileUp,
  Loader2,
  Play,
  RotateCcw,
  Save,
  XCircle,
} from "lucide-react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";

type QueueStatus = "queued" | "running" | "analyzed" | "saved" | "failed" | "save_failed";

type ApiFinalReport = {
  finalVerdict: string;
  riskLevel: "green" | "yellow" | "red";
  beginnerFit: string;
  canTestSmallBatch: boolean;
  mustCheckBeforeListing: string[];
  nextSteps: string[];
  manualReviewChecklist: string[];
};

type ApiWorkflowResult = {
  ok: boolean;
  workflowId: string;
  productName: string;
  status: "completed" | "partial_failed" | "failed";
  steps: Array<Record<string, unknown>>;
  sourcing: Record<string, unknown> | null;
  risk: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
  listing: Record<string, unknown> | null;
  finalReport: ApiFinalReport | null;
  costGuard: {
    aiStepsRequested: number;
    aiStepsCompleted: number;
    fallbackSteps: number;
  };
  warnings: string[];
};

type ApiErrorResponse = {
  ok: false;
  error: { code: string; message: string };
};

type BatchMeta = {
  batchId: string;
  batchName: string;
  batchIndex: number;
  batchTotal: number;
  source: "workflow_batch_mvp";
};

type QueueItem = {
  id: string;
  productName: string;
  status: QueueStatus;
  result: ApiWorkflowResult | null;
  taskId: string | null;
  error: string;
  batchMeta: BatchMeta | null;
};

const MAX_BATCH_PRODUCTS = 3;

const statusConfig: Record<QueueStatus, { label: string; className: string }> = {
  queued: { label: "等待中", className: "border-slate-200 bg-slate-50 text-slate-600" },
  running: { label: "分析中", className: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  analyzed: { label: "已分析", className: "border-teal-200 bg-teal-50 text-teal-700" },
  saved: { label: "已保存", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  failed: { label: "分析失败", className: "border-rose-200 bg-rose-50 text-rose-700" },
  save_failed: { label: "保存失败", className: "border-amber-200 bg-amber-50 text-amber-700" },
};

function parseProducts(input: string) {
  const seen = new Set<string>();
  const products: string[] = [];

  for (const line of input.split(/\r?\n/)) {
    const name = line.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    products.push(name);
  }

  return products;
}

function makeBatchId() {
  return `batch-${Date.now()}`;
}

function makeBatchMeta(batchId: string, batchIndex: number, batchTotal: number): BatchMeta {
  return {
    batchId,
    batchName: "批量一键分析",
    batchIndex,
    batchTotal,
    source: "workflow_batch_mvp",
  };
}

function makeReviewState() {
  return {
    sourcingReviewed: false,
    riskReviewed: false,
    summaryReviewed: false,
    listingReviewed: false,
  };
}

function StatusIcon({ status }: { status: QueueStatus }) {
  if (status === "running") return <Loader2 className="size-4 animate-spin text-indigo-500" />;
  if (status === "saved") return <CheckCircle2 className="size-4 text-emerald-500" />;
  if (status === "failed") return <XCircle className="size-4 text-rose-500" />;
  if (status === "save_failed") return <AlertCircle className="size-4 text-amber-500" />;
  if (status === "analyzed") return <Save className="size-4 text-teal-500" />;
  return <ClipboardList className="size-4 text-slate-400" />;
}

export function WorkflowBatchClient() {
  const [accessPassword, setAccessPassword, isAccessPasswordReady] = useAccessPassword();
  const [input, setInput] = useState("桌面手机支架\n宠物慢食碗\n硅胶折叠水杯");
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null);

  const parsedProducts = useMemo(() => parseProducts(input), [input]);
  const canRun = parsedProducts.length > 0 && !running;

  function updateItem(id: string, patch: Partial<QueueItem>) {
    setQueueItems((current) => current.map((item) => (
      item.id === id ? { ...item, ...patch } : item
    )));
  }

  async function saveAnalyzedItem(item: QueueItem) {
    if (!item.result || !item.batchMeta) {
      updateItem(item.id, { status: "save_failed", error: "缺少已分析结果，无法保存。" });
      return;
    }

    try {
      const response = await fetch("/api/workflows/product-analysis/save-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessPassword,
          workflowResult: item.result,
          reviewState: makeReviewState(),
          batchMeta: item.batchMeta,
        }),
      });
      const data = await response.json() as
        | { ok: true; data: { id: string; title: string; type: string; allReviewed: boolean } }
        | ApiErrorResponse;

      if (!response.ok || !data.ok) {
        const errorMessage = "error" in data ? data.error.message : "保存任务失败。";
        updateItem(item.id, {
          status: "save_failed",
          error: errorMessage,
        });
        return;
      }

      updateItem(item.id, { status: "saved", taskId: data.data.id, error: "" });
    } catch {
      updateItem(item.id, { status: "save_failed", error: "网络异常，保存失败。" });
    }
  }

  async function runItem(item: QueueItem) {
    updateItem(item.id, { status: "running", error: "" });

    try {
      const response = await fetch("/api/workflows/product-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: item.productName,
          source: "manual",
          accessPassword,
        }),
      });
      const data = await response.json() as ApiWorkflowResult | ApiErrorResponse;

      if (!response.ok || !data.ok) {
        const errorMessage = "error" in data ? data.error.message : "分析失败。";
        updateItem(item.id, {
          status: "failed",
          error: errorMessage,
        });
        return;
      }

      const analyzedItem = { ...item, status: "analyzed" as QueueStatus, result: data as ApiWorkflowResult, error: "" };
      updateItem(item.id, analyzedItem);
      await saveAnalyzedItem(analyzedItem);
    } catch {
      updateItem(item.id, { status: "failed", error: "网络异常，分析失败。" });
    }
  }

  async function startBatch() {
    if (running) return;
    setMessage("");

    const products = parseProducts(input);
    if (products.length === 0) {
      setQueueItems([]);
      setBatchId(null);
      setMessage("请至少输入 1 个商品。");
      return;
    }

    if (products.length > MAX_BATCH_PRODUCTS) {
      setQueueItems([]);
      setBatchId(null);
      setMessage("一次最多支持 3 个商品。请删减后再开始，系统不会发起任何 AI 调用。");
      return;
    }

    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setMessage("请先输入访问密码。");
      return;
    }

    const nextBatchId = makeBatchId();
    const initialItems: QueueItem[] = products.map((productName, index) => ({
      id: `${nextBatchId}-${index}`,
      productName,
      status: "queued",
      result: null,
      taskId: null,
      error: "",
      batchMeta: makeBatchMeta(nextBatchId, index + 1, products.length),
    }));

    setBatchId(nextBatchId);
    setQueueItems(initialItems);
    setRunning(true);

    for (const item of initialItems) {
      await runItem(item);
    }

    setRunning(false);
  }

  async function retrySave(id: string) {
    if (running) return;
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setMessage("请先输入访问密码。");
      return;
    }
    const item = queueItems.find((queueItem) => queueItem.id === id);
    if (!item || !item.result) {
      setMessage("缺少已分析结果，不能重试保存。");
      return;
    }

    updateItem(id, { status: "analyzed", error: "" });
    await saveAnalyzedItem(item);
  }

  function resetBatch() {
    if (running) return;
    setQueueItems([]);
    setBatchId(null);
    setMessage("");
  }

  function handleFileImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset file input so the same file can be re-imported
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".csv") && !fileName.endsWith(".txt")) {
      setImportMessage({ type: "error", text: "仅支持 .csv 和 .txt 文件格式。" });
      return;
    }

    const isCsv = fileName.endsWith(".csv");
    const reader = new FileReader();

    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text || text.trim().length === 0) {
        setImportMessage({ type: "error", text: "文件内容为空，请检查文件。" });
        return;
      }

      let productNames: string[];

      if (!isCsv) {
        // TXT: one product per line, reuse existing parser
        productNames = parseProducts(text);
      } else {
        // CSV: detect header, extract product names
        const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
        if (lines.length === 0) {
          setImportMessage({ type: "error", text: "CSV 文件无有效内容。" });
          return;
        }

        const headerCells = lines[0].split(",").map((h) => h.trim().toLowerCase());
        const productNameKeywords = ["productname", "商品名", "name", "title", "product", "product_name"];
        let targetColumn = -1;

        for (let i = 0; i < headerCells.length; i++) {
          if (productNameKeywords.includes(headerCells[i])) {
            targetColumn = i;
            break;
          }
        }

        const hasHeader = targetColumn >= 0;
        if (!hasHeader) targetColumn = 0;

        const dataStartIndex = hasHeader ? 1 : 0;
        const seen = new Set<string>();
        productNames = [];

        for (let i = dataStartIndex; i < lines.length; i++) {
          const cells = lines[i].split(",");
          const name = (cells[targetColumn] ?? "").trim();
          if (!name || seen.has(name)) continue;
          seen.add(name);
          productNames.push(name);
        }
      }

      if (productNames.length === 0) {
        setImportMessage({ type: "error", text: "未找到有效商品名，请检查文件内容。" });
        return;
      }

      if (productNames.length > MAX_BATCH_PRODUCTS) {
        const truncated = productNames.slice(0, MAX_BATCH_PRODUCTS);
        setInput(truncated.join("\n"));
        setImportMessage({
          type: "warning",
          text: `已导入前 ${MAX_BATCH_PRODUCTS} 个商品，超出部分未加入（共识别 ${productNames.length} 个）。`,
        });
      } else {
        setInput(productNames.join("\n"));
        setImportMessage({
          type: "success",
          text: `已导入 ${productNames.length} 个商品。`,
        });
      }

      if (message) setMessage("");
    };

    reader.onerror = () => {
      setImportMessage({ type: "error", text: "文件读取失败，请重试。" });
    };

    reader.readAsText(file, "UTF-8");
  }

  const savedCount = queueItems.filter((item) => item.status === "saved").length;
  const failedCount = queueItems.filter((item) => item.status === "failed" || item.status === "save_failed").length;

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="workspace-header">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Phase 2-C</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">批量一键分析队列</h1>
                <p className="mt-1 text-sm text-slate-500">
                  一次最多 3 个商品，系统按顺序自动分析并保存到任务中心。站外动作仍需人工确认。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/workflow" className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold">
                  单品分析
                </Link>
                <Link href="/tasks" className="linear-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-semibold">
                  任务中心
                </Link>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="surface-card p-5 sm:p-6">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleFileImport}
              className="hidden"
              data-testid="batch-file-input"
            />

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    批量商品名 <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={running}
                    data-testid="import-csv-button"
                    className="linear-button inline-flex h-8 items-center gap-1.5 px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FileUp className="size-3.5" />
                    导入 CSV/TXT
                  </button>
                </div>
                <textarea
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    if (message) setMessage("");
                  }}
                  disabled={running}
                  rows={8}
                  data-testid="batch-product-input"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-60"
                  placeholder={"每行一个商品，例如：\n桌面手机支架\n宠物慢食碗\n硅胶折叠水杯"}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>已识别 {parsedProducts.length} 个去重商品，最多 {MAX_BATCH_PRODUCTS} 个。</span>
                  {parsedProducts.length > MAX_BATCH_PRODUCTS ? (
                    <span className="font-semibold text-rose-600">超过上限，不会发起 AI 或保存请求。</span>
                  ) : null}
                </div>
                {importMessage ? (
                  <div
                    data-testid="import-message"
                    className={`mt-2 rounded-lg px-3 py-2 text-xs font-semibold ${
                      importMessage.type === "error"
                        ? "border border-rose-200 bg-rose-50 text-rose-700"
                        : importMessage.type === "warning"
                          ? "border border-amber-200 bg-amber-50 text-amber-700"
                          : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {importMessage.text}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                <p className="text-sm font-bold text-amber-800">执行边界</p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-700">
                  <li>- 前端串行执行，不并发。</li>
                  <li>- 成功后自动保存为待复核任务。</li>
                  <li>- 分析/保存失败不会阻塞后续商品。</li>
                  <li>- 不做站外上架、联系供应商、投广告或下单。</li>
                </ul>
              </div>
            </div>

            <div className="mt-5">
              <label className="mb-1 block text-sm font-semibold text-slate-700">
                访问密码 <span className="text-rose-500">*</span>
              </label>
              <input
                type="password"
                value={accessPassword}
                onChange={(event) => setAccessPassword(event.target.value)}
                disabled={running}
                className="w-full max-w-sm rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-60"
                placeholder="输入访问密码"
              />
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void startBatch()}
                disabled={!canRun}
                data-testid="start-batch-button"
                className="linear-button-primary inline-flex h-11 items-center gap-2 px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {running ? "队列执行中" : "开始批量执行"}
              </button>
              <button
                type="button"
                onClick={resetBatch}
                disabled={running}
                className="linear-button inline-flex h-11 items-center gap-2 px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="size-4" />
                清空队列
              </button>
            </div>

            {message ? (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" data-testid="batch-message">
                {message}
              </div>
            ) : null}
          </section>

          <section className="surface-card p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-teal-700">执行队列</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">站内自动执行进度</h2>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="linear-pill px-3 py-1 text-slate-600">总数 {queueItems.length}</span>
                <span className="linear-pill border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">已保存 {savedCount}</span>
                <span className="linear-pill border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">异常 {failedCount}</span>
              </div>
            </div>

            {batchId ? (
              <p className="mt-2 break-all text-xs text-slate-500">批次 ID：{batchId}</p>
            ) : null}

            {queueItems.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-sm leading-6 text-slate-500">
                队列还未开始。输入 1-3 个商品后点击“开始批量执行”。
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {queueItems.map((item) => {
                  const config = statusConfig[item.status];
                  return (
                    <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4" data-testid={`queue-item-${item.productName}`}>
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusIcon status={item.status} />
                            <h3 className="text-base font-semibold text-slate-950">{item.productName}</h3>
                            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${config.className}`}>
                              {config.label}
                            </span>
                            {item.batchMeta ? (
                              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                                批量任务 {item.batchMeta.batchIndex}/{item.batchMeta.batchTotal}
                              </span>
                            ) : null}
                          </div>
                          {item.error ? (
                            <p className="mt-2 text-sm text-rose-600">{item.error}</p>
                          ) : null}
                          {item.result?.finalReport ? (
                            <p className="mt-2 text-sm leading-6 text-slate-600">
                              {item.result.finalReport.finalVerdict} · {item.result.finalReport.riskLevel}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          {item.taskId ? (
                            <Link href={`/tasks/${item.taskId}`} className="linear-button-primary inline-flex h-10 items-center px-4 text-sm font-semibold">
                              查看任务
                            </Link>
                          ) : null}
                          {item.status === "save_failed" ? (
                            <button
                              type="button"
                              onClick={() => void retrySave(item.id)}
                              disabled={running}
                              data-testid={`retry-save-${item.productName}`}
                              className="linear-button inline-flex h-10 items-center px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              重试保存
                            </button>
                          ) : null}
                        </div>
                      </div>
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
