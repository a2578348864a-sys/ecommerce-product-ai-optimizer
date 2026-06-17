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
  { value: "viral", label: "爆款素材分析" },
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
  { value: "viral", label: "爆款素材 Agent" },
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
    name: "爆款素材 Agent",
    status: "已上线",
    href: "/viral",
    description: "拆解素材标题、卖点、评论需求和爆款潜力。",
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
