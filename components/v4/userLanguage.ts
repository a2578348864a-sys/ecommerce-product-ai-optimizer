/**
 * V4.1 C 端用户语言映射（本地工作台用）。
 *
 * 原则：普通页面不得出现内部英文枚举/工程字段；后台概念（LangGraph/Gate/Checkpoint/
 * Hash/Revision/Event/Guard/Token/Fixture）只存在于调试区。
 * 纯函数模块：无 "use client" 限制、无 IO；由首页/列表/详情导入。
 */

/** 术语替换（用户可见文案）。 */
export const USER_TERMS: Record<string, string> = {
  Evidence: "数据依据",
  "Gate A": "是否继续找货",
  "Product Fact Gate": "确认我的商品信息",
  "Commercial/Gate B": "是否开始准备上架",
  "Content Guard": "内容检查",
  blocked: "暂时不能使用",
  unknown: "待补充",
  no_results: "暂未获得数据",
  approve_export: "确认使用",
  Replay: "演示案例",
};

/** 节点/事件 → 用户可理解事件语言。 */
export const USER_EVENT_LABELS: Record<string, string> = {
  run_created: "开始研究",
  node_entered: "正在处理",
  plan_created: "整理研究计划",
  tool_dispatched: "查找市场数据",
  evidence_merged: "找到市场数据",
  conflict_detected: "发现数据不一致",
  waiting_human: "等待确认",
  human_decision: "已记录你的决定",
  resumed: "继续研究",
  fact_confirmed: "已确认商品信息",
  completed: "已完成研究",
  failed: "研究遇到问题",
  cancelled: "已取消",
};

export type RunStatusUserView = 
  | "进行中"
  | "等待确认"
  | "资料不足（研究已结束）"
  | "已完成"
  | "失败待处理"
  | "已取消";

/** 状态 → 用户语言（终态权威由调用方保证）。 */
export function userStatus(status: string): RunStatusUserView {
  switch (status) {
    case "completed": return "已完成";
    case "cancelled": return "已取消";
    case "failed_terminal": return "失败待处理";
    case "failed_recoverable": return "失败待处理";
    case "waiting_human":
    case "waiting_auth":
    case "waiting_input": return "等待确认";
    case "draft": return "进行中";
    case "planning":
    case "running":
    case "revising":
    case "paused_budget": return "进行中";
    default: return "进行中";
  }
}

/** 图片检查内部字段 → 用户可读说明。unknown code → 原样（调试区）。 */
export const IMAGE_CHECK_USER_MESSAGES: Record<string, string> = {
  identity_not_detected: "无法确认是不是同一个商品",
  structure_not_verifiable: "无法确认产品结构",
  color_not_detected: "没有识别出颜色",
  quantity_not_detected: "没有识别出商品数量",
  dimension_text_not_detected: "没有识别出尺寸文字",
  text_not_detected: "没有识别出文字标识",
};

export const IMAGE_BLOCKED_USER_HINT = "这张图片暂时不能使用，请补充清晰产品参考图后重新检查。";

/** 下一步动作 → 用户按钮文案（推导优先级由调用方保证；此处仅文案）。 */
export const NEXT_ACTION_USER_LABELS: Record<string, string> = {
  finish_gate_a_decision: "决定是否继续找货",
  confirm_product_facts: "确认商品信息",
  fill_commercial_costs: "填写采购成本",
  content_generation: "补充内容资料",
  content_review: "查看内容检查结果",
  start_research: "开始商品研究",
  retry: "重试研究",
  check_listing: "继续生成 Listing",
  fix_images: "修改图片",
  review_report: "查看研究结论",
};

/** 待补充缺口说明（尽力而为，缺口字段缺失时调用方用通用文案）。 */
export function userGapText(gap?: string): string {
  if (!gap) return "尚有资料待补充";
  return gap;
}
