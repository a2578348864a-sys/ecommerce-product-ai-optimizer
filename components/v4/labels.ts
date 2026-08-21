/**
 * V4 P1 — Run Console 展示标签与格式化助手（客户端安全）。
 *
 * 不导入 contracts 的值导出（其含 "server-only"），只通过 "import type" 引用类型，
 * 以免把服务端依赖带进客户端 bundle。
 */
import type { ResearchRunErrorCode, ResearchRunNode, ResearchRunStatus, ResearchRunWait } from "@/lib/v4/contracts";

export type StatusTone =
  | "teal"
  | "slate"
  | "blue"
  | "amber"
  | "rose"
  | "emerald"
  | "indigo";

export const STATUS_LABELS: Record<ResearchRunStatus, string> = {
  draft: "草稿",
  planning: "计划中",
  running: "运行中",
  waiting_human: "等待人工",
  waiting_auth: "等待登录",
  waiting_input: "等待输入",
  paused_budget: "预算暂停",
  revising: "修订中",
  failed_recoverable: "可恢复失败",
  failed_terminal: "终态失败",
  cancelled: "已取消",
  completed: "已完成",
};

const STATUS_TONES: Record<ResearchRunStatus, StatusTone> = {
  draft: "slate",
  planning: "blue",
  running: "blue",
  waiting_human: "amber",
  waiting_auth: "amber",
  waiting_input: "amber",
  paused_budget: "amber",
  revising: "indigo",
  failed_recoverable: "rose",
  failed_terminal: "rose",
  cancelled: "slate",
  completed: "emerald",
};

export function statusTone(status: ResearchRunStatus): StatusTone {
  return STATUS_TONES[status] ?? "slate";
}

export const NODE_LABELS: Record<ResearchRunNode, string> = {
  load_context: "加载上下文",
  validate_identity: "校验身份",
  assess_gaps: "评估缺口",
  build_plan: "制定计划",
  dispatch_tool: "调用工具",
  validate_output: "校验输出",
  merge_evidence: "合并证据",
  detect_conflicts: "检测冲突",
  revise_plan: "修订计划",
  synthesize_market: "市场综合分析",
  gate_a: "门禁 A",
  supplier_research: "供应商研究",
  product_fact_gate: "产品事实门禁",
  commercial_check: "商业可行性",
  gate_b: "门禁 B",
  content_handoff: "内容交接",
  content_skills: "内容技能",
  content_review: "内容审核",
  complete: "完成",
  fail: "失败",
  cancel: "取消",
};

/** 节点推进顺序（NodeFlow 展示用）。 */
export const NODE_FLOW_ORDER: ResearchRunNode[] = [
  "load_context",
  "validate_identity",
  "assess_gaps",
  "build_plan",
  "dispatch_tool",
  "validate_output",
  "merge_evidence",
  "detect_conflicts",
  "revise_plan",
  "synthesize_market",
  "gate_a",
  "supplier_research",
  "product_fact_gate",
  "commercial_check",
  "gate_b",
  "content_handoff",
  "content_skills",
  "content_review",
  "complete",
];

export const WAIT_KIND_LABELS: Record<ResearchRunWait["kind"], string> = {
  human_decision: "人工决策",
  authentication: "需要登录",
  input: "需要输入",
  budget: "预算限制",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  run_created: "运行创建",
  node_entered: "进入节点",
  node_completed: "节点完成",
  plan_created: "计划创建",
  plan_revised: "计划修订",
  tool_dispatched: "工具调用",
  tool_result_validated: "工具结果校验",
  evidence_merged: "证据合并",
  conflict_detected: "冲突检测",
  waiting_human: "等待人工",
  human_decision: "人工决策",
  resumed: "已恢复",
  cancelled: "已取消",
  budget_paused: "预算暂停",
  failed: "失败",
  completed: "完成",
};

export const ERROR_CODE_LABELS: Record<ResearchRunErrorCode, string> = {
  AUTH_REQUIRED: "需要登录",
  CAPTCHA_OR_BOT_CHECK: "验证码或人机校验",
  WRONG_ENTITY: "实体不匹配",
  DOM_CHANGED: "页面结构变化",
  RATE_LIMITED: "访问受限",
  TIMEOUT: "超时",
  BUDGET_EXCEEDED: "预算耗尽",
  SCHEMA_INVALID: "数据结构无效",
  SOURCE_STALE: "来源过期",
  PERMISSION_DENIED: "权限不足",
  USER_CANCELLED: "用户取消",
  UNKNOWN_RECOVERABLE: "未知可恢复错误",
  TERMINAL_UNSUPPORTED: "不支持的操作",
};

/** 终态：completed / cancelled / failed_terminal。 */
export function isTerminalStatus(status: ResearchRunStatus): boolean {
  return status === "completed" || status === "cancelled" || status === "failed_terminal";
}

const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  teal: "border-teal-200 bg-teal-50 text-teal-700",
  slate: "border-slate-200 bg-slate-50 text-slate-600",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
};

export function statusToneClass(status: ResearchRunStatus): string {
  return STATUS_TONE_CLASSES[statusTone(status)];
}

/** 格式化为本地日期时间（zh-CN）。 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** 货币格式化：保留 2 位小数，币种前缀（￥/$/€）。 */
export function formatMoney(value: number, currency = "CNY"): string {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "￥";
  const amount = Number.isFinite(value) ? value : 0;
  return symbol + amount.toFixed(2);
}

/** 百分比格式化（0–1 范围）。 */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value * 100) + "%";
}

/** 紧凑数字（token / steps）。 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN").format(value);
}
