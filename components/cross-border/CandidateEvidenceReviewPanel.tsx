import { ExternalLink } from "lucide-react";
import {
  getEvidenceQueueSuggestionLabel,
  getEvidenceSourceRelationLabel,
  getEvidenceSourceTypeLabel,
  type CandidateEvidenceReviewV1,
} from "@/lib/candidateEvidenceReview";
import { getRiskFlagLabel } from "@/lib/candidateEvidence";

type CandidateEvidenceReviewPanelProps = {
  review: CandidateEvidenceReviewV1;
};

function displayTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "时间不可用";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function displayImageSignal(value: boolean | null): string {
  if (value === true) return "页面中观察到图片";
  if (value === false) return "页面中未观察到图片";
  return "未获得图片信号";
}

function displayRobotsStatus(value: "allowed" | "not_present" | "manual"): string {
  if (value === "allowed") return "robots.txt 允许";
  if (value === "not_present") return "未发现 robots.txt";
  return "人工来源";
}

function SourceLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-teal-700 transition hover:bg-teal-50"
    >
      打开来源
      <ExternalLink className="size-3" />
    </a>
  );
}

export function CandidateEvidenceReviewPanel({ review }: CandidateEvidenceReviewPanelProps) {
  if (review.integrity === "unverified") {
    return (
      <details
        className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5"
        data-testid="candidate-evidence-review"
      >
        <summary className="cursor-pointer select-none text-xs font-semibold text-amber-800">
          复核来源与判断
        </summary>
        <div className="mt-3 space-y-2 text-xs leading-5 text-amber-900">
          <p>当前 Candidate 没有可验证的公开来源证据链。现有分数、摘要和风险标记只能作为待人工核对的线索。</p>
          {review.openUrl ? <SourceLink href={review.openUrl} /> : null}
        </div>
      </details>
    );
  }

  const { facts, assessment } = review;
  const scoreItems = [
    ["需求信号", assessment.scores.demandSignal],
    ["供货便利", assessment.scores.supplyEase],
    ["风险", assessment.scores.risk],
    ["新手适配", assessment.scores.beginnerFit],
    ["综合", assessment.scores.final],
  ] as const;

  return (
    <details
      className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/40 px-3 py-2.5"
      data-testid="candidate-evidence-review"
    >
      <summary className="cursor-pointer select-none text-xs font-semibold text-emerald-800">
        复核来源与判断
      </summary>
      <div className="mt-3 space-y-3">
        <section className="rounded-lg border border-emerald-100 bg-white/80 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-slate-800">来源事实</p>
              <p className="mt-0.5 text-[11px] text-slate-500">服务端保存的公开页面抓取记录</p>
            </div>
            <SourceLink href={facts.openUrl} />
          </div>
          <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
            <div><dt className="text-slate-400">抓取时间</dt><dd className="font-medium text-slate-700">{displayTime(facts.capturedAt)}</dd></div>
            <div><dt className="text-slate-400">来源域名</dt><dd className="break-all font-medium text-slate-700">{facts.sourceHost ?? "未记录"}</dd></div>
            <div><dt className="text-slate-400">页面类型</dt><dd className="font-medium text-slate-700">{getEvidenceSourceTypeLabel(facts.sourceType)}</dd></div>
            <div><dt className="text-slate-400">来源关系</dt><dd className="font-medium text-slate-700">{getEvidenceSourceRelationLabel(facts.sourceRelation)}</dd></div>
            <div><dt className="text-slate-400">HTTP 状态</dt><dd className="font-medium text-slate-700">{facts.httpStatus ?? "未记录"}</dd></div>
            <div><dt className="text-slate-400">重定向</dt><dd className="font-medium text-slate-700">{facts.redirectCount ?? "未记录"} 次</dd></div>
            <div><dt className="text-slate-400">Content-Type</dt><dd className="break-all font-medium text-slate-700">{facts.contentType ?? "未记录"}</dd></div>
            <div><dt className="text-slate-400">抓取许可</dt><dd className="font-medium text-slate-700">{displayRobotsStatus(facts.robots)}</dd></div>
            <div><dt className="text-slate-400">页面价格文本</dt><dd className="font-medium text-slate-700">{facts.priceText ?? "未观察到"}</dd></div>
            <div><dt className="text-slate-400">图片信号</dt><dd className="font-medium text-slate-700">{displayImageSignal(facts.hasImage)}</dd></div>
            <div className="sm:col-span-2"><dt className="text-slate-400">来源文档 URL</dt><dd className="break-all font-medium text-slate-700">{facts.documentUrl}</dd></div>
            <div className="sm:col-span-2"><dt className="text-slate-400">商品 URL</dt><dd className="break-all font-medium text-slate-700">{facts.candidateUrl ?? "来源文档未提供独立商品 URL"}</dd></div>
          </dl>
          {facts.signalText ? (
            <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs leading-5 text-slate-600">
              页面信号：{facts.signalText}
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-amber-100 bg-white/80 p-3">
          <p className="text-xs font-bold text-slate-800">规则判断</p>
          <p className="mt-0.5 text-[11px] text-amber-700">以下是代码规则计算，不是市场事实。</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {scoreItems.map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 px-2 py-2 text-center">
                <p className="text-[10px] text-slate-400">{label}</p>
                <p className="mt-0.5 text-sm font-bold text-slate-800">{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs font-semibold text-slate-700">
            队列建议：{getEvidenceQueueSuggestionLabel(assessment.queueSuggestion)}
          </p>
          {assessment.reasons.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-600">
              {assessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          ) : null}
          {assessment.riskFlags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {assessment.riskFlags.map((flag) => (
                <span key={flag} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                  {getRiskFlagLabel(flag)}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        <p className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] leading-5 text-slate-600">
          来源证据链已验证仅表示保存时证据与规则结果的关联完整，不代表商品真实性、市场需求或页面当前状态。
        </p>
      </div>
    </details>
  );
}
