/**
 * ManualReviewChecklist — 上线 / 采购前人工确认清单
 *
 * 统一的人工复核清单，适用于所有任务类型。
 * 纯前端静态展示，不调用 AI，不改 DB。
 */

import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";

type ChecklistItem = {
  id: string;
  label: string;
  category: "risk" | "compliance" | "cost" | "general";
};

const checklistItems: ChecklistItem[] = [
  {
    id: "ip",
    label: "是否涉及品牌、外观、图片、专利侵权风险",
    category: "risk",
  },
  {
    id: "high_risk_category",
    label: "是否涉及儿童、食品接触、带电、带磁、液体、化妆品、医疗功效等高风险品类",
    category: "risk",
  },
  {
    id: "platform_policy",
    label: "目标平台规则是否允许销售该类商品",
    category: "compliance",
  },
  {
    id: "certification",
    label: "是否需要 CPC/ASTM/FDA/FCC/CE 等认证，能否从供应商获取合规文件",
    category: "compliance",
  },
  {
    id: "cost_control",
    label: "成本、运费、平台佣金、退货和售后费用是否可控",
    category: "cost",
  },
  {
    id: "supplier_verified",
    label: "供应商资质、MOQ、样品质量和交期是否已核实",
    category: "general",
  },
  {
    id: "logistics",
    label: "物流方案是否确认（普货/特货渠道、时效、禁运限制）",
    category: "general",
  },
  {
    id: "ai_disclaimer",
    label: "AI 结论仅作辅助参考，不作为最终采购或经营决策依据",
    category: "general",
  },
];

const categoryLabels: Record<ChecklistItem["category"], { label: string; className: string }> = {
  risk: { label: "风险", className: "border-rose-200 bg-rose-50 text-rose-700" },
  compliance: { label: "合规", className: "border-amber-200 bg-amber-50 text-amber-700" },
  cost: { label: "成本", className: "border-sky-200 bg-sky-50 text-sky-700" },
  general: { label: "通用", className: "border-slate-200 bg-slate-50 text-slate-600" },
};

export function ManualReviewChecklist({ className }: { className?: string }) {
  return (
    <section className={`rounded-2xl border border-amber-200 bg-amber-50/70 p-4${className ? ` ${className}` : ""}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <ShieldAlert className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-950">上线 / 采购前人工确认清单</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            以下事项必须在推进前由人工逐项确认。AI 不会替代你的判断，也不会自动执行任何操作。
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {checklistItems.map((item) => (
          <li key={item.id} className="flex items-start gap-3 rounded-xl bg-white/85 px-4 py-3">
            <span className="mt-0.5 shrink-0 text-amber-500">
              <AlertTriangle className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="text-sm leading-6 text-slate-700">{item.label}</span>
            </div>
            <span className={"shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold " + categoryLabels[item.category].className}>
              {categoryLabels[item.category].label}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-start gap-2 rounded-xl bg-white/85 p-3">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        <p className="text-xs leading-5 text-slate-600">
          建议逐项确认后，在任务详情中更新「人工决策状态」为「可继续」或「已淘汰」，方便后续复盘。
        </p>
      </div>
    </section>
  );
}
