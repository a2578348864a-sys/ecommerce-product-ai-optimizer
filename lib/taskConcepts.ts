/* ── Phase 2-A.3: Centralized task type registry ── */

export type TaskTypeEntry = {
  type: string;
  label: string;
  agentLabel: string;
  filterLabel: string;
  searchable: boolean;
};

/** Single source of truth for all task types. Add new types here only. */
export const TASK_TYPE_REGISTRY: readonly TaskTypeEntry[] = [
  { type: "workflow",      label: "一键分析",         agentLabel: "一键选品工作流",   filterLabel: "一键分析",                  searchable: true },
  { type: "opportunities", label: "机会雷达",         agentLabel: "机会雷达 Agent",   filterLabel: "机会雷达",                  searchable: true },
  { type: "viral",         label: "海外爆款趋势分析", agentLabel: "海外爆款趋势 Agent", filterLabel: "海外爆款趋势分析",        searchable: true },
  { type: "radar",         label: "爆款雷达分析",     agentLabel: "爆款雷达 Agent",   filterLabel: "爆款雷达分析",              searchable: true },
  { type: "product",       label: "选品利润分析",     agentLabel: "选品分析 Agent",   filterLabel: "选品利润分析",              searchable: true },
  { type: "risk",          label: "风险排查",         agentLabel: "风险检查 Agent",   filterLabel: "风险排查",                  searchable: true },
  { type: "sourcing",      label: "货源判断",         agentLabel: "货源判断 Agent",   filterLabel: "货源判断",                  searchable: true },
  { type: "material",      label: "素材接收",         agentLabel: "素材接收 Agent",   filterLabel: "素材接收",                  searchable: true },
  { type: "summary",       label: "小白结论",         agentLabel: "小白结论 Agent",   filterLabel: "小白结论",                  searchable: true },
] as const;

/** Derive task type labels map for detail display */
export const TASK_TYPE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  TASK_TYPE_REGISTRY.map((e) => [e.type, e.label]),
);

/** Derive agent label map for detail display */
export const TASK_AGENT_LABEL_MAP: Record<string, string> = Object.fromEntries(
  TASK_TYPE_REGISTRY.map((e) => [e.type, e.agentLabel]),
);

/** Searchable types — used by /api/tasks to validate the type param */
export const SEARCHABLE_TASK_TYPES: ReadonlySet<string> = new Set(
  TASK_TYPE_REGISTRY.filter((e) => e.searchable).map((e) => e.type),
);

/** Filter dropdown options for /tasks list */
export const TASK_TYPE_FILTER_OPTIONS = [
  { value: "", label: "全部类型" },
  ...TASK_TYPE_REGISTRY.map((e) => ({ value: e.type, label: e.filterLabel })),
] as const;

/* ── Original task status / agent options (preserved) ── */

export const taskStatusOptions = [
  { value: "draft", label: "草稿", tone: "slate" },
  { value: "queued", label: "排队中", tone: "sky" },
  { value: "running", label: "执行中", tone: "amber" },
  { value: "waiting", label: "等待人工确认", tone: "violet" },
  { value: "completed", label: "已完成", tone: "emerald" },
  { value: "failed", label: "失败", tone: "rose" },
  { value: "cancelled", label: "已取消", tone: "slate" },
] as const;

export const taskTypeOptions = [
  { value: "opportunities", label: "机会雷达" },
  { value: "viral", label: "海外爆款趋势分析" },
  { value: "product", label: "选品分析" },
  { value: "competitor", label: "竞品拆解" },
  { value: "keyword", label: "关键词分析" },
  { value: "copywriting", label: "文案生成" },
  { value: "profit", label: "利润测算" },
  { value: "risk", label: "风险检查" },
  { value: "image", label: "AI 生图预案" },
  { value: "video", label: "AI 生视频预案" },
  { value: "workflow", label: "多 Agent 工作流" },
] as const;

export const agentTypeOptions = [
  { value: "viral", label: "海外爆款趋势 Agent" },
  { value: "product", label: "选品分析 Agent" },
  { value: "competitor", label: "竞品拆解 Agent" },
  { value: "keyword", label: "关键词 Agent" },
  { value: "copy", label: "文案生成 Agent" },
  { value: "profit", label: "利润测算 Agent" },
  { value: "risk", label: "风险检查 Agent" },
  { value: "image_prompt", label: "AI 生图提示词 Agent" },
  { value: "image_generate", label: "AI 生图 Agent" },
  { value: "video_script", label: "AI 视频脚本 Agent" },
  { value: "video_generate", label: "AI 生视频 Agent" },
  { value: "summary", label: "复盘优化 Agent" },
] as const;

export const mediaProviderOptions = [
  { value: "openai", label: "OpenAI" },
  { value: "seedance", label: "Seedance" },
  { value: "kling", label: "Kling" },
  { value: "runway", label: "Runway" },
  { value: "mock", label: "Mock / 本地草稿" },
] as const;

export const agentCapabilityMatrix = [
  {
    name: "海外爆款趋势 Agent",
    status: "已上线",
    href: "/viral",
    description: "拆解海外平台素材标题、卖点、评论需求和跨境商品机会。",
    cta: "进入分析",
  },
  { name: "选品分析 Agent", status: "规划中", description: "根据产品、价格、平台证据判断是否值得继续做。" },
  { name: "竞品拆解 Agent", status: "规划中", description: "整理竞品卖点、价格带、差评和内容角度。" },
  { name: "关键词 Agent", status: "规划中", description: "沉淀找货关键词、搜索词、标题词和长尾词。" },
  { name: "文案生成 Agent", status: "规划中", description: "生成标题、卖点、详情页结构和广告文案草稿。" },
  { name: "利润测算 Agent", status: "规划中", description: "结合售价、成本、物流和平台扣点做利润判断。" },
  { name: "风险检查 Agent", status: "规划中", description: "提示侵权、功效宣称、资质、售后和物流风险。" },
  {
    name: "AI 生图 Agent",
    status: "高成本 / 后期接入",
    description: "生成图片提示词、广告图方案、产品主图/场景图创意方案。",
    flags: ["调用前需人工确认", "当前默认关闭"],
  },
  {
    name: "AI 生视频 Agent",
    status: "高成本 / 后期接入",
    description: "生成视频脚本、分镜、镜头语言、旁白字幕和视频生成 Prompt。",
    flags: ["调用前需人工确认", "当前默认关闭"],
  },
  { name: "复盘优化 Agent", status: "后期", description: "汇总历史任务表现，沉淀下一轮优化建议。" },
] as const;

export const workflowPreviewSteps = [
  "输入素材/产品",
  "智能分流",
  "多 Agent 分析",
  "汇总报告",
  "保存任务",
  "人工确认执行",
] as const;

export type TaskStatusValue = (typeof taskStatusOptions)[number]["value"];
