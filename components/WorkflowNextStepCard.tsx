/**
 * WorkflowNextStepCard — 根据任务类型展示下一步建议
 *
 * 纯前端静态提示，不调用 AI，不改 DB。
 * 兼容旧数据：type 缺失时显示通用建议。
 */

import { AlertCircle, CheckCircle2, ClipboardList, Lightbulb, Search, ShieldAlert } from "lucide-react";

type NextStepItem = {
  label: string;
  icon: React.ReactNode;
};

type TaskNextSteps = {
  title: string;
  description: string;
  steps: NextStepItem[];
};

const fallbackNextSteps: TaskNextSteps = {
  title: "通用复查建议",
  description: "无法识别任务类型时的通用建议。请结合实际情况判断下一步。",
  steps: [
    { label: "人工复核利润、成本和售价是否合理", icon: <CheckCircle2 className="size-4" /> },
    { label: "确认供应商、MOQ、样品和物流方案", icon: <Search className="size-4" /> },
    { label: "检查平台规则和认证要求", icon: <ShieldAlert className="size-4" /> },
    { label: "结合自身经验决定是否小单测试", icon: <Lightbulb className="size-4" /> },
  ],
};

const nextStepsByType: Record<string, TaskNextSteps> = {
  sourcing: {
    title: "货源判断 — 下一步建议",
    description: "AI 已给出货源可行性判断和搜索建议，以下是人工需要确认的关键事项：",
    steps: [
      { label: "核实供应商资质、价格、MOQ 和最小起订量", icon: <Search className="size-4" /> },
      { label: "确认物流方案、运费和时效是否可控", icon: <ClipboardList className="size-4" /> },
      { label: "索取样品并检查质量、包装和实际重量", icon: <CheckCircle2 className="size-4" /> },
      { label: "对比至少 2-3 家供应商的报价和服务", icon: <Lightbulb className="size-4" /> },
    ],
  },
  risk: {
    title: "风险排查 — 下一步建议",
    description: "AI 已标记潜在风险点，以下是人工必须复核的关键事项：",
    steps: [
      { label: "人工复核侵权风险：品牌、外观、图片、专利", icon: <AlertCircle className="size-4" /> },
      { label: "确认是否需要 CPC/ASTM/FDA/FCC 等认证", icon: <ShieldAlert className="size-4" /> },
      { label: "检查目标平台规则：是否允许销售该类商品", icon: <ClipboardList className="size-4" /> },
      { label: "评估物流限制：带电、带磁、液体、大件等特殊要求", icon: <Search className="size-4" /> },
    ],
  },
  summary: {
    title: "小白结论 — 下一步建议",
    description: "AI 已给出综合判断，以下是人工决策前需要确认的事项：",
    steps: [
      { label: "结合成本、售价、运费和平台佣金复核利润", icon: <CheckCircle2 className="size-4" /> },
      { label: "根据风险等级判断是否适合自身资源和经验", icon: <ShieldAlert className="size-4" /> },
      { label: "决定是否进行小单测试还是直接放弃", icon: <Lightbulb className="size-4" /> },
      { label: "如果继续：准备拍摄素材、撰写 listing、联系供应商", icon: <ClipboardList className="size-4" /> },
    ],
  },
  product: {
    title: "选品分析 — 下一步建议",
    description: "AI 已给出利润测算和关键词建议，以下是人工需要复核的事项：",
    steps: [
      { label: "复核售价、成本、佣金和利润是否准确", icon: <CheckCircle2 className="size-4" /> },
      { label: "检查 listing 草稿中的合规表达（不写死认证承诺）", icon: <ShieldAlert className="size-4" /> },
      { label: "验证关键词在目标平台的搜索量和竞争度", icon: <Search className="size-4" /> },
      { label: "确认图片、A+、视频素材是否已准备", icon: <ClipboardList className="size-4" /> },
    ],
  },
  viral: {
    title: "爆款拆解 — 下一步建议",
    description: "AI 已分析内容爆款潜力，以下是人工需要判断的事项：",
    steps: [
      { label: "判断卖点和内容角度是否适合你的目标平台", icon: <Lightbulb className="size-4" /> },
      { label: "不要直接照搬原内容，需做差异化改编", icon: <AlertCircle className="size-4" /> },
      { label: "核查原内容是否存在版权或肖像权问题", icon: <ShieldAlert className="size-4" /> },
      { label: "评估内容制作成本和团队能力", icon: <ClipboardList className="size-4" /> },
    ],
  },
  material: {
    title: "素材接收 — 下一步建议",
    description: "AI 已提取商品信息，以下是人工需要确认的事项：",
    steps: [
      { label: "确认提取的商品名、卖点、价格是否准确", icon: <CheckCircle2 className="size-4" /> },
      { label: "确认素材来源的可靠性和使用授权", icon: <ShieldAlert className="size-4" /> },
      { label: "补充缺失的关键信息（价格、热度、平台等）", icon: <ClipboardList className="size-4" /> },
      { label: "如果素材不足，去对应平台搜索更多信息", icon: <Search className="size-4" /> },
    ],
  },
  radar: {
    title: "爆款雷达 — 下一步建议",
    description: "AI 已分析多个候选商品，以下是人工需要确认的事项：",
    steps: [
      { label: "对比候选品之间的分数、风险和机会差异", icon: <Lightbulb className="size-4" /> },
      { label: "选出 1-2 个最有潜力的候选品深入分析", icon: <Search className="size-4" /> },
      { label: "高风险类目必须人工复核合规和资质要求", icon: <ShieldAlert className="size-4" /> },
      { label: "进入货源判断或风险排查页面做下一步确认", icon: <ClipboardList className="size-4" /> },
    ],
  },
  opportunities: {
    title: "机会雷达 — 下一步建议",
    description: "AI 已完成批量候选品分析和评分排序，以下是人工需要确认的事项：",
    steps: [
      { label: "检查评分靠前的候选品是否符合自身资源和经验", icon: <CheckCircle2 className="size-4" /> },
      { label: "高风险/高合规门槛品类必须人工复核后再推进", icon: <ShieldAlert className="size-4" /> },
      { label: "选定 1-3 个候选品进入货源判断或风险排查", icon: <Search className="size-4" /> },
      { label: "参考证据链和评分理由，不要只看分数", icon: <Lightbulb className="size-4" /> },
    ],
  },
};

function getNextSteps(taskType: string | undefined): TaskNextSteps {
  if (taskType && nextStepsByType[taskType]) {
    return nextStepsByType[taskType];
  }
  return fallbackNextSteps;
}

export function WorkflowNextStepCard({ taskType, className }: { taskType?: string; className?: string }) {
  const nextSteps = getNextSteps(taskType);

  return (
    <section className={`rounded-2xl border border-teal-200 bg-teal-50/70 p-4${className ? ` ${className}` : ""}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
          <Lightbulb className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-950">{nextSteps.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">{nextSteps.description}</p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {nextSteps.steps.map((step) => (
          <li key={step.label} className="flex items-start gap-3 rounded-xl bg-white/85 px-4 py-3">
            <span className="mt-0.5 shrink-0 text-teal-600">{step.icon}</span>
            <span className="text-sm leading-6 text-slate-700">{step.label}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs leading-5 text-slate-500">
        💡 以上为前端静态提示，不调用 AI。实际决策请结合你的经验、资源和平台最新规则。
      </p>
    </section>
  );
}
