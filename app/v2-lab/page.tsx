import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "V2 工作流沙盒 - 轻选 Agent",
  description: "V2 工作流原型，仅为内部规划和截图讨论，不是已上线功能。",
};

/* ── Mock data ─────────────────────────────────────── */

const MOCK_CANDIDATES = [
  {
    id: "a",
    name: "桌面手机支架",
    score: 90,
    level: "优先小单测试",
    riskHint: "低风险 · 新手友好",
    selected: true,
  },
  {
    id: "b",
    name: "宠物慢食碗",
    score: 55,
    level: "可以观察",
    riskHint: "食品接触 · 需确认材质认证",
    selected: false,
  },
  {
    id: "c",
    name: "硅胶折叠水杯",
    score: 45,
    level: "有经验再做",
    riskHint: "食品接触 · 专利风险 · 认证多",
    selected: false,
  },
];

/* 4-step workflow (Phase 1A mock) */
interface WorkflowStep {
  id: string;
  label: string;
  status: "done" | "active" | "pending";
  summary: string;
  riskNote: string;
  confirmed: boolean;
}

const MOCK_STEPS: WorkflowStep[] = [
  {
    id: "sourcing",
    label: "货源确认",
    status: "done",
    summary:
      "1688 货源充足，MOQ 10-50 个，价格带 ¥3-15，供应商 200+ 家。成熟品类，采购难度低。",
    riskNote: "",
    confirmed: true,
  },
  {
    id: "risk",
    label: "风险排查",
    status: "done",
    summary:
      "通用品类，无侵权/禁售风险。物流售后简单。注意确认产品无磁铁或电池夹带。",
    riskNote: "高风险提示：如果变体含磁铁/电池，风险升级为橙色。",
    confirmed: true,
  },
  {
    id: "profitCompliance",
    label: "利润与合规粗判",
    status: "active",
    summary:
      "预估售价 $8-15，采购 ¥5-12，头程运费约 $1-2/件，FBA 约 $3-5，毛利率约 35-50%。目标市场（美国）无需特殊认证。",
    riskNote:
      "利润为 mock 估算，真实选品需要人工复核采购成本、运费和平台费率。合规结论基于品类通用判断，正式上线前需逐一核验目标市场要求。",
    confirmed: false,
  },
  {
    id: "conclusion",
    label: "小白结论与下一步",
    status: "pending",
    summary:
      "货源易找、风险低、利润空间合理、无特殊合规门槛 — 建议小单测试。找 3-5 家 1688 供应商对比样品，先采购 10-20 个 FBA 测品，验证转化率和售后率后再决定是否加大投入。",
    riskNote:
      "本结论基于 AI 分析 + mock 数据，不是最终采购建议。所有关键动作必须人工确认。系统不会自动采购、自动上架或自动投广告。",
    confirmed: false,
  },
];

/* ── Sub-components ───────────────────────────────── */

function StepStatusBadge({ status }: { status: WorkflowStep["status"] }) {
  const map = {
    done: "bg-green-50 text-green-700 border-green-200",
    active: "bg-blue-50 text-blue-700 border-blue-200",
    pending: "bg-gray-50 text-gray-400 border-gray-200",
  };
  const label = { done: "已完成", active: "进行中", pending: "待执行" };
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${map[status]}`}
    >
      {label[status]}
    </span>
  );
}

function StepIcon({ status }: { status: WorkflowStep["status"] }) {
  if (status === "done") {
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-700">
        ✓
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">
        →
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 text-xs text-gray-400">
      ○
    </span>
  );
}

function StepCard({ step, isLast }: { step: WorkflowStep; isLast: boolean }) {
  return (
    <li className="relative flex gap-3">
      {/* vertical connector */}
      {!isLast && (
        <div
          className={`absolute left-[9px] top-5 h-full w-0.5 ${
            step.status === "done" ? "bg-green-200" : "bg-gray-200"
          }`}
        />
      )}
      {/* icon */}
      <div className="mt-1 shrink-0">
        <StepIcon status={step.status} />
      </div>
      {/* card body */}
      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-3 pb-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span
            className={`text-sm font-semibold ${
              step.status === "pending" ? "text-gray-400" : "text-gray-800"
            }`}
          >
            {step.label}
          </span>
          <StepStatusBadge status={step.status} />
        </div>

        <p
          className={`mb-2 text-xs leading-relaxed ${
            step.status === "pending" ? "text-gray-300" : "text-gray-600"
          }`}
        >
          {step.summary}
        </p>

        {/* risk note */}
        {step.riskNote && (
          <p
            className={`mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] leading-relaxed ${
              step.status === "pending" ? "text-amber-300" : "text-amber-700"
            }`}
          >
            ⚠ {step.riskNote}
          </p>
        )}

        {/* inline confirm checkbox */}
        <label
          className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition ${
            step.confirmed
              ? "border-green-200 bg-green-50 text-green-700"
              : step.status === "pending"
                ? "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                : "border-gray-200 bg-white text-gray-600 cursor-pointer hover:border-blue-300"
          }`}
        >
          <input
            type="checkbox"
            checked={step.confirmed}
            readOnly
            className="h-3.5 w-3.5 rounded"
          />
          {step.confirmed ? "已确认" : "人工确认"}
        </label>
      </div>
    </li>
  );
}

/* ── Page ──────────────────────────────────────────── */

export default function V2LabPage() {
  const confirmedCount = MOCK_STEPS.filter((s) => s.confirmed).length;
  const totalCount = MOCK_STEPS.length;

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      {/* ⚠️ Sandbox banner */}
      <div className="mb-6 rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-amber-800">
          ⚠️ V2 工作流沙盒 — Phase 1A 交互原型，不是已上线功能
        </p>
        <p className="mt-1 text-xs text-amber-700">
          当前不调用真实 AI，不保存任务，不接 API。
          所有数据为 mock 演示。不会自动采购、自动发布、自动投广告。
          <strong> 所有关键动作必须人工确认。</strong>
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left column: candidates */}
        <aside className="lg:col-span-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-1 text-sm font-semibold text-gray-700">
              候选商品
            </h2>
            <p className="mb-3 text-[11px] text-gray-400">
              来自机会雷达排行榜 · 当前为 mock 示例
            </p>
            <ul className="space-y-2">
              {MOCK_CANDIDATES.map((c) => (
                <li
                  key={c.id}
                  className={`rounded-md border px-3 py-2.5 text-sm transition ${
                    c.selected
                      ? "border-blue-300 bg-blue-50 ring-1 ring-blue-200"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">{c.name}</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-bold text-gray-600">
                      {c.score}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {c.level}
                  </div>
                  <div
                    className={`mt-0.5 text-[11px] ${
                      c.riskHint.includes("低风险")
                        ? "text-green-600"
                        : "text-amber-600"
                    }`}
                  >
                    {c.riskHint}
                  </div>
                  {c.selected && (
                    <div className="mt-1.5 text-[11px] font-medium text-blue-600">
                      ← 当前选中
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Right column: workflow steps + inline confirm */}
        <section className="lg:col-span-8">
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">
                工作流 · 桌面手机支架
              </h2>
              <span className="text-xs text-gray-500">
                已确认 {confirmedCount}/{totalCount} 步
              </span>
            </div>

            <ol className="space-y-0">
              {MOCK_STEPS.map((step, i) => (
                <StepCard
                  key={step.id}
                  step={step}
                  isLast={i === MOCK_STEPS.length - 1}
                />
              ))}
            </ol>

            {/* Bottom action */}
            <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-700">
                  💡 下一步建议
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {confirmedCount === totalCount
                    ? "全部确认完成，可保存到任务中心。"
                    : `请先完成剩余 ${totalCount - confirmedCount} 步的人工确认。`}
                </p>
              </div>
              <button
                disabled
                className="shrink-0 rounded-md bg-gray-200 px-4 py-1.5 text-xs font-medium text-gray-500 cursor-not-allowed"
              >
                {confirmedCount === totalCount
                  ? "保存到任务中心（mock）"
                  : "全部确认后可保存"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
