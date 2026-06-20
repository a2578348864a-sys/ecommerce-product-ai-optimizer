import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "V2 工作流沙盒 - 轻选 Agent",
  description: "V2 工作流原型，仅为内部规划和截图讨论，不是已上线功能。",
};

const MOCK_CANDIDATES = [
  { id: "a", name: "桌面手机支架", score: 90, level: "A" },
  { id: "b", name: "宠物慢食碗", score: 55, level: "B" },
  { id: "c", name: "硅胶折叠水杯", score: 45, level: "C" },
];

const MOCK_STEPS = [
  {
    id: "sourcing",
    label: "货源确认",
    status: "done" as const,
    summary: "1688 货源充足，MOQ 10-50 个，价格带 ¥3-15，供应商 200+ 家。",
  },
  {
    id: "risk",
    label: "风险确认",
    status: "done" as const,
    summary: "桌面手机支架为通用品类，无侵权/禁售风险。注意确认无磁铁/电池夹带。",
  },
  {
    id: "profit",
    label: "利润粗算",
    status: "active" as const,
    summary: "预估售价 $8-15，采购成本 ¥5-12，头程运费约 $1-2/件，FBA 费约 $3-5，毛利率预估 35-50%。",
  },
  {
    id: "compliance",
    label: "合规确认",
    status: "pending" as const,
    summary: "无需特殊认证。目标市场（美国）无额外合规门槛。确认包装标签合规即可。",
  },
  {
    id: "beginner",
    label: "新手适合度",
    status: "pending" as const,
    summary: "货源易找、风险低、无合规门槛、物流简单 — 适合新手小单测试。",
  },
  {
    id: "nextAction",
    label: "下一步动作",
    status: "pending" as const,
    summary: "建议找 3-5 家 1688 供应商对比样品，先采购 10-20 个 FBA 测品。",
  },
];

const MOCK_CHECKLIST = [
  { id: "c1", label: "货源已确认", done: true },
  { id: "c2", label: "风险已确认", done: true },
  { id: "c3", label: "利润已粗算", done: false },
  { id: "c4", label: "合规已确认", done: false },
  { id: "c5", label: "适合度已判断", done: false },
  { id: "c6", label: "动作已确认", done: false },
];

function StepIcon({ status }: { status: "done" | "active" | "pending" }) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-700 text-xs font-bold">
        ✓
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-bold animate-pulse">
        →
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 text-gray-400 text-xs">
      ○
    </span>
  );
}

export default function V2LabPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      {/* ⚠️ 沙盒警告横幅 */}
      <div className="mb-6 rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-amber-800">
          ⚠️ V2 工作流沙盒 — 仅为原型，不是已上线功能
        </p>
        <p className="mt-1 text-xs text-amber-700">
          此页面仅供内部规划和截图讨论。所有数据为演示 mock，未调用真实 AI，未连接数据库。
        </p>
      </div>

      {/* 三栏布局 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 左栏：候选商品 */}
        <aside className="lg:col-span-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">
              候选商品
            </h2>
            <ul className="space-y-2">
              {MOCK_CANDIDATES.map((c, i) => (
                <li
                  key={c.id}
                  className={`rounded-md border px-3 py-2 text-sm transition ${
                    i === 0
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
                  <div className="mt-0.5 text-xs text-gray-500">
                    等级 {c.level} · {i === 0 ? "当前选中" : "点击切换"}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-gray-400">
              以上为演示数据，实际接入 /api/opportunities 排行榜。
            </p>
          </div>
        </aside>

        {/* 中栏：工作流步骤 */}
        <main className="lg:col-span-6">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-4 text-sm font-semibold text-gray-700">
              工作流步骤 · 桌面手机支架
            </h2>
            <ol className="space-y-0">
              {MOCK_STEPS.map((step, i) => (
                <li key={step.id} className="relative">
                  {i < MOCK_STEPS.length - 1 && (
                    <div
                      className={`absolute left-[9px] top-5 h-full w-0.5 ${
                        step.status === "done" ? "bg-green-300" : "bg-gray-200"
                      }`}
                    />
                  )}
                  <div className="flex items-start gap-3 pb-4">
                    <div className="mt-0.5 shrink-0">
                      <StepIcon status={step.status} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-medium ${
                            step.status === "pending"
                              ? "text-gray-400"
                              : "text-gray-800"
                          }`}
                        >
                          {step.label}
                        </span>
                        {step.status === "done" && (
                          <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-700">
                            已完成
                          </span>
                        )}
                        {step.status === "active" && (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                            进行中
                          </span>
                        )}
                        {step.status === "pending" && (
                          <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400">
                            待执行
                          </span>
                        )}
                      </div>
                      <p
                        className={`mt-1 text-xs leading-relaxed ${
                          step.status === "pending"
                            ? "text-gray-300"
                            : "text-gray-600"
                        }`}
                      >
                        {step.summary}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </main>

        {/* 右栏：人工确认清单 */}
        <aside className="lg:col-span-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">
              人工确认清单
            </h2>
            <ul className="space-y-2">
              {MOCK_CHECKLIST.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={item.done}
                    readOnly
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span
                    className={
                      item.done ? "text-gray-500 line-through" : "text-gray-700"
                    }
                  >
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-500">
                已确认{" "}
                <span className="font-bold text-gray-700">
                  {MOCK_CHECKLIST.filter((c) => c.done).length}
                </span>
                {" "}/ {MOCK_CHECKLIST.length} 项
              </p>
              <button
                disabled
                className="mt-2 w-full rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 cursor-not-allowed"
              >
                全部确认后保存（mock）
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* 底部：下一步建议 */}
      <footer className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">
          💡 下一步建议
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          桌面手机支架是成熟品类，建议先从该商品开始验证完整工作流。优先确认货源和利润粗算，再进入合规和新手适合度判断。
        </p>
        <p className="mt-2 text-xs text-gray-400">
          所有关键动作均需人工确认。系统不会自动采购、不会自动上架、不会自动投广告。
        </p>
      </footer>
    </div>
  );
}
