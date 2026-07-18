"use client";

import Image from "next/image";
import { useState } from "react";
import type {
  Stage15ScreeningPreviewItem,
  Stage15ScreeningPreviewView,
  Stage15ScreeningStatus,
} from "@/lib/stage15ScreeningPreview";
import { buildStage15NoviceGuidance } from "@/lib/stage15ScreeningPreviewGuidance";

export type Stage15Filter = "all" | Stage15ScreeningStatus;

const STATUS_COPY: Record<Stage15ScreeningStatus, { label: string; tone: string; explanation: string }> = {
  advance: {
    label: "进入调查短名单",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    explanation: "本批 Top-K 调查名额，仍需后续验证",
  },
  watch: {
    label: "保留观察",
    tone: "border-amber-200 bg-amber-50 text-amber-800",
    explanation: "暂不占用优先调查名额",
  },
  reject: {
    label: "本批不继续",
    tone: "border-rose-200 bg-rose-50 text-rose-800",
    explanation: "存在明确阻断或 Stage 1 已淘汰",
  },
  insufficient: {
    label: "市场证据不足",
    tone: "border-slate-200 bg-slate-100 text-slate-700",
    explanation: "证据不足，不能正常比较",
  },
};

const FILTERS: Array<{ key: Stage15Filter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "advance", label: "调查短名单" },
  { key: "watch", label: "观察" },
  { key: "reject", label: "不继续" },
  { key: "insufficient", label: "证据不足" },
];

const HUMAN_ANSWER_COPY = {
  yes: "是",
  no: "否",
  uncertain: "不确定",
  missing: "未回答",
} as const;

export function filterStage15PreviewItems(
  items: readonly Stage15ScreeningPreviewItem[],
  filter: Stage15Filter,
): Stage15ScreeningPreviewItem[] {
  return filter === "all" ? [...items] : items.filter((item) => item.status === filter);
}

function formatMetric(value: number | null, suffix = "") {
  return value === null ? "未获得" : `${value}${suffix}`;
}

function EvidenceList({
  title,
  values,
  emptyCopy,
}: {
  title: string;
  values: readonly string[];
  emptyCopy: string;
}) {
  return (
    <section>
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      {values.length > 0 ? (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {values.map((value) => <li key={value}>{value}</li>)}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-slate-500">{emptyCopy}</p>
      )}
    </section>
  );
}

function GuidanceList({ values }: { values: readonly string[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
      {values.map((value) => <li key={value}>{value}</li>)}
    </ul>
  );
}

function ProductCard({ item }: { item: Stage15ScreeningPreviewItem }) {
  const status = STATUS_COPY[item.status];
  const guidance = buildStage15NoviceGuidance(item);
  return (
    <article
      data-testid="screening-item"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="grid gap-0 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="flex min-h-44 items-center justify-center bg-slate-100 p-4">
          {item.image.status === "available" && item.image.dataUrl ? (
            <Image
              alt={`${item.productTypeZh}参考图`}
              className="h-40 w-full rounded-xl object-contain"
              height={160}
              src={item.image.dataUrl}
              unoptimized
              width={180}
            />
          ) : (
            <div className="flex h-40 w-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-3 text-center text-sm text-slate-500">
              <span aria-hidden="true" className="text-2xl">▧</span>
              <span className="mt-2">
                {item.image.status === "image_not_cached" ? "图片未缓存" : "图片完整性校验失败"}
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {item.blindItemId} · Stage 1 排名 {item.stage1Rank ?? "无"}
              </p>
              <h3 className="mt-1 text-lg font-semibold text-slate-950">{item.productTypeZh}</h3>
              <p className="mt-1 text-sm text-slate-600">用途：{item.primaryUseZh}</p>
            </div>
            <div className={`rounded-full border px-3 py-1 text-sm font-semibold ${status.tone}`}>
              {status.label}
            </div>
          </div>

          <p className="mt-3 text-sm text-slate-500">{status.explanation}</p>
          <div className="mt-4 grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-3">
            <div><span className="block text-slate-500">公开价格</span>{formatMetric(item.evidence.price, " USD")}</div>
            <div><span className="block text-slate-500">页面评分（仅供参考）</span>{formatMetric(item.evidence.rating)}</div>
            <div><span className="block text-slate-500">评论数量（不是销量）</span>{formatMetric(item.evidence.reviewCount)}</div>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            这些是页面观察数据，不是入选原因，也不能证明销量、质量或利润。
          </p>

          <details className="mt-4 rounded-xl border border-slate-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-teal-800">
              为什么这样分？下一步查什么？
            </summary>
            <div className="space-y-4 border-t border-slate-200 px-4 py-4">
              <section className="space-y-4 rounded-xl border border-teal-100 bg-teal-50/60 p-4">
                <div>
                  <h4 className="font-semibold text-slate-950">为什么{status.label}</h4>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{guidance.whyThisStatus}</p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <h4 className="font-semibold text-slate-950">已经确认</h4>
                    <GuidanceList values={guidance.confirmedFacts} />
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-950">还没有确认</h4>
                    <GuidanceList values={guidance.unknownFacts} />
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-sky-200 bg-white p-3">
                    <h4 className="font-semibold text-slate-950">下一步只查这一件事</h4>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{guidance.nextAction}</p>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-white p-3">
                    <h4 className="font-semibold text-slate-950">Stage 1.5 什么时候停止</h4>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{guidance.stopCondition}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h4 className="font-semibold text-slate-950">Stage 2 以后再判断</h4>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    供应商、平台费用、运费、利润和合规属于专业商业验证；本页没有判断这些内容。
                  </p>
                </div>
                <p className="text-xs leading-5 text-slate-500">
                  以上是展示层派生说明，只帮助阅读，不改变商品状态、排名或商业结论。
                </p>
              </section>

              <details className="rounded-xl border border-slate-200 bg-white">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">
                  原始证据（供复核）
                </summary>
                <div className="space-y-4 border-t border-slate-200 px-4 py-4">
                  <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
                    <p>市场证据门禁：{item.gates.screeningEvidenceSufficient ? "通过" : "未通过"}</p>
                    <p>理解商品：{item.gates.userUnderstandsProduct ? "是" : "否"}</p>
                    <p>愿意继续调查：{item.gates.willingToContinueResearch ? "是" : "否"}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                    原始回答：理解商品 {HUMAN_ANSWER_COPY[item.rawHumanAnswer.productUnderstood]}；
                    证据充分 {HUMAN_ANSWER_COPY[item.rawHumanAnswer.evidenceSufficient]}；
                    存在明显担忧 {HUMAN_ANSWER_COPY[item.rawHumanAnswer.obviousConcern]}；
                    愿意再调查 10 分钟 {HUMAN_ANSWER_COPY[item.rawHumanAnswer.investigateNext10Minutes]}。
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <EvidenceList
                      emptyCopy="当前证据包未记录支持证据。"
                      title="支持证据"
                      values={item.reasons.supportingEvidence}
                    />
                    <EvidenceList
                      emptyCopy="当前证据包未记录反向证据；不等于没有风险。"
                      title="反向证据"
                      values={item.reasons.counterEvidence}
                    />
                    <EvidenceList
                      emptyCopy="当前证据包未列出缺失项；不等于所有事实都已验证。"
                      title="缺失证据"
                      values={item.reasons.missingEvidence}
                    />
                    <EvidenceList
                      emptyCopy="当前证据包未记录人工门禁原因。"
                      title="人工门禁原因"
                      values={item.reasons.humanGate}
                    />
                    <EvidenceList
                      emptyCopy="当前证据包未记录下一步。"
                      title="下一步验证"
                      values={item.nextValidationPlan}
                    />
                    <EvidenceList
                      emptyCopy="当前证据包未记录停止条件。"
                      title="停止条件"
                      values={item.killCriteria}
                    />
                  </div>
                </div>
              </details>
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}

export function Stage15ScreeningPreview({ preview }: { preview: Stage15ScreeningPreviewView }) {
  const [filter, setFilter] = useState<Stage15Filter>("all");
  const visibleItems = filterStage15PreviewItems(preview.items, filter);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="rounded-full bg-teal-50 px-3 py-1 text-teal-800">本地只读</span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">工程收敛已验证</span>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">筛选有效性未验证</span>
          </div>
          <h1 className="mt-4 text-3xl font-bold text-slate-950">调查短名单预览</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            把 20 个真实商品的离线 Stage 1＋Stage 1.5 结果投影为可阅读的调查列表，不产生正式业务候选记录，也不写数据库。
          </p>
          <p className="mt-2 text-sm text-slate-500">
            中文商品类型和用途仅用于理解辅助，不是来源页面事实；公开价格、页面评分和评论数量仍按来源证据单独展示，评论数量不是销量。
          </p>
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <strong>边界：</strong>advance 只是本批调查名额，不代表质量通过、值得采购或能够赚钱。
            商业验证未开始，不能判断利润或可采购性。
          </div>
        </header>

        <section aria-label="批次统计" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">总商品</p><p className="text-2xl font-bold">{preview.items.length}</p></div>
          {(["advance", "watch", "reject", "insufficient"] as const).map((status) => (
            <div key={status} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">{STATUS_COPY[status].label}</p>
              <p className="text-2xl font-bold">{preview.summary[status]}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((option) => {
              const count = option.key === "all" ? preview.items.length : preview.summary[option.key];
              const selected = option.key === filter;
              return (
                <button
                  aria-pressed={selected}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold ${selected ? "border-teal-700 bg-teal-700 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                  key={option.key}
                  onClick={() => setFilter(option.key)}
                  type="button"
                >
                  {option.label} {count}
                </button>
              );
            })}
          </div>
        </section>

        <section aria-live="polite" className="space-y-4">
          {visibleItems.map((item) => <ProductCard item={item} key={item.productKey} />)}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold">A：对照复验边界</h2>
            <p className="mt-2 text-sm text-slate-600">
              对照复验尚未执行。未来需要使用独立证据比较 advance 与相近 watch；本预览不会自动联网或改写筛选结论。
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold">B：新手理解检查</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
              <li>能找到 5 个优先调查商品。</li>
              <li>能说清主要原因与下一步要查什么。</li>
              <li>知道 advance 不是商业通过或赚钱结论。</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
