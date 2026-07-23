import Link from "next/link";

export function OpportunitiesFlowGuidance() {
  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3 text-sm">
      <p className="font-semibold text-teal-800">📍 主路径：机会雷达 → Agent 主链路 → 人工复核 → 任务中心</p>
      <p className="mt-1 text-xs text-teal-700">
        本页用于发现候选商品并标记状态。筛选出感兴趣的商品后，去
        <Link href="/agent/run" className="mx-0.5 font-semibold underline">Agent 主链路</Link>
        做 8 步深度分析，保存后进入
        <Link href="/tasks" className="mx-0.5 font-semibold underline">任务中心</Link>
        跟进。
      </p>
    </div>
  );
}
