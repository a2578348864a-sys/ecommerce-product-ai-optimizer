/**
 * V2 工作流沙盒 — 从 opportunities 任务记录中提取候选品数组。
 *
 * 纯函数，不访问网络，不调用 AI，不写数据库。
 */

export type V2Candidate = {
  name: string;
  score: number;
  level: string;
  levelLabel: string;
  displayRiskLevel: string;
  reasons: string[];
  risks: string[];
  nextAction: string;
  sourcingSummary: string;
  riskSummary: string;
  summaryVerdict: string;
  status: string;
};

export type V2RecordsInput = {
  items?: Array<{
    type?: string;
    result?: unknown;
  }>;
  records?: Array<{
    type?: string;
    result?: unknown;
  }>;
};

const FALLBACK = "暂无该项数据";

function safeString(v: unknown, fallback = FALLBACK): string {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return fallback;
}

function safeNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return 0;
}

function safeArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  }
  return [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 从 opportunities 任务 API 响应中提取最新一条记录的类型。
 * 如果不是 opportunities 类型，返回 null（前端应显示空状态）。
 */
function findLatestOpportunitiesResult(raw: V2RecordsInput): Record<string, unknown> | null {
  const items = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.records) ? raw.records : [];
  for (const item of items) {
    if (isRecord(item) && item.type === "opportunities" && isRecord(item.result)) {
      return item.result as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * V2 沙盒示例数据 — 用于本地评审，不来自真实 AI。
 * 包含 3 个候选品：桌面手机支架（高分）、硅胶折叠水杯（中低分）、儿童电动牙刷（低分高风险）。
 */
export const SAMPLE_CANDIDATES: V2Candidate[] = [
  {
    name: "桌面手机支架",
    score: 90,
    level: "A",
    levelLabel: "优先小单测试",
    displayRiskLevel: "yellow",
    reasons: ["货源易找", "新手友好", "风险低"],
    risks: ["确认无磁铁或电池夹带", "检查外观专利"],
    nextAction: "找 3-5 家 1688 供应商对比样品，先采购 10-20 个 FBA 测品",
    sourcingSummary: "1688 货源充足，MOQ 10-50 个，价格带 ¥3-15，供应商 200+ 家。成熟品类，采购难度低。",
    riskSummary: "通用品类，无侵权/禁售风险。物流售后简单。注意确认产品无磁铁或电池夹带。",
    summaryVerdict: "新手可小单测试",
    status: "completed",
  },
  {
    name: "硅胶折叠水杯",
    score: 45,
    level: "C",
    levelLabel: "有经验再做",
    displayRiskLevel: "yellow",
    reasons: ["轻小件", "差异化外观"],
    risks: ["食品接触材料", "FDA/LFGB/国标检测", "材质认证", "专利风险", "平台资质要求"],
    nextAction: "先确认供应商能否提供 FDA/LFGB 检测报告，再评估认证成本和周期",
    sourcingSummary: "1688 供应商适中，需筛选食品级硅胶材质供应商。MOQ 通常 100-500 个。",
    riskSummary: "食品接触类商品需要 FDA/LFGB/国标等材质检测。平台可能要求上传认证文件。存在外观专利风险。",
    summaryVerdict: "有经验可尝试，新手慎入",
    status: "completed",
  },
  {
    name: "儿童电动牙刷",
    score: 10,
    level: "E",
    levelLabel: "暂不建议",
    displayRiskLevel: "red",
    reasons: [],
    risks: ["儿童用品", "带电产品", "CPC/材料检测", "电池运输限制", "平台资质门槛高", "合规成本高"],
    nextAction: "不建议新手做。如果坚持要做，先确认 CPC 认证成本和周期，再评估供应链。",
    sourcingSummary: "供应商较少，MOQ 高（通常 500+），需要验厂。带电产品物流限制多。",
    riskSummary: "高风险：儿童用品 + 带电 + CPC 认证 + 电池运输限制。平台审核严格，合规成本高，售后风险大。",
    summaryVerdict: "新手不建议",
    status: "completed",
  },
];

/**
 * 从 result.candidates 提取候选品数组。
 * 缺失字段用安全默认值填充，不抛异常，不输出 undefined/null。
 */
export function extractCandidates(raw: V2RecordsInput): V2Candidate[] {
  const result = findLatestOpportunitiesResult(raw);
  if (!result) return [];

  const rawCandidates = result.candidates;
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) return [];

  return rawCandidates.map((c: unknown) => {
    const item = isRecord(c) ? c : {};

    return {
      name: safeString(item.name, "未命名商品"),
      score: safeNumber(item.score),
      level: safeString(item.level, ""),
      levelLabel: safeString(item.levelLabel, ""),
      displayRiskLevel: safeString(item.displayRiskLevel, ""),
      reasons: safeArray(item.reasons),
      risks: safeArray(item.risks),
      nextAction: safeString(item.nextAction, ""),
      sourcingSummary: safeString(item.sourcingSummary, FALLBACK),
      riskSummary: safeString(item.riskSummary, FALLBACK),
      summaryVerdict: safeString(item.summaryVerdict, FALLBACK),
      status: safeString(item.status, ""),
    };
  });
}
