// page.tsx - to be written via multiple steps
"use client";

import { AlertCircle, ChevronDown, ChevronUp, ClipboardList, Download, FileText, Lock, RefreshCcw, ShieldCheck, Wand2 } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import {
  AssessmentCard,
  ConfidenceBadge,
  getConfidenceLabel,
  InquiryTemplatesSection,
  MissingDataSection,
  ScoreCard,
  ScoreDimensionCard,
  SectionGroupTitle,
  SimpleListSection,
  TextBlockSection,
  ValidationChecklistSection,
} from "@/components/ResultSection";
import {
  AlibabaResult,
  basicRequiredFields,
  categories,
  GenerateErrorResponse,
  inputLimits,
  ProductFormInput,
  scoreDimensionLabels,
  yesNo,
  yesNoUnsure,
} from "@/lib/types";

const emptyForm: ProductFormInput = {
  productName: "",
  category: "电子",
  material: "",
  sellingPoints: "",
  productCost: "",
  estimatedPrice: "",
  moq: "",
  targetCountries: "",
  englishName: "",
  specifications: "",
  productUsage: "",
  applicableScenarios: "",
  productWeight: "",
  productVolume: "",
  supportsOemOdm: "",
  hasStock: "",
  leadTime: "",
  packagingMethod: "",
  targetBuyerTypes: "",
  customerPainPoints: "",
  competitorInfo: "",
  keywordTrendData: "",
  rfqData: "",
  amazonCompetitorInfo: "",
  isFragile: "",
  isLiquid: "",
  isBatteryPowered: "",
  isMagnetic: "",
  isFoodContact: "",
  isChildrenProduct: "",
  needsCertification: "",
  existingCertificates: "",
  supplyChainAdvantages: "",
  factoryAdvantages: "",
  additionalNotes: "",
};
const sampleForm: ProductFormInput = {
  productName: "便携式蓝牙无线音箱",
  category: "电子",
  material: "ABS塑料+金属网罩",
  sellingPoints: "IPX7防水、20小时续航、蓝牙5.3、TWS串联、免提通话、便携挂扣设计",
  productCost: "35-50",
  estimatedPrice: "12-25",
  moq: "500",
  targetCountries: "美国、欧洲、东南亚",
  englishName: "Portable Bluetooth Wireless Speaker",
  specifications: "直径8cm*高10cm，重量320g",
  productUsage: "户外露营、泳池派对、骑行、浴室、桌面使用",
  applicableScenarios: "户外活动、家庭娱乐、商务礼品、促销赠品",
  productWeight: "320",
  productVolume: "0.5",
  supportsOemOdm: "是",
  hasStock: "是",
  leadTime: "15-25天",
  packagingMethod: "彩盒包装，每箱50个",
  targetBuyerTypes: "批发商、品牌商、促销品采购商、电商卖家",
  customerPainPoints: "音质差、续航短、不防水、连接不稳定",
  competitorInfo: "JBL Go4售价49美元，Anker Soundcore售价35美元，主打IPX7和长续航",
  keywordTrendData: "",
  rfqData: "",
  amazonCompetitorInfo: "",
  isFragile: "否",
  isLiquid: "否",
  isBatteryPowered: "是",
  isMagnetic: "否",
  isFoodContact: "否",
  isChildrenProduct: "否",
  needsCertification: "是",
  existingCertificates: "CE、FCC、ROHS",
  supplyChainAdvantages: "价格优势，月产能5万台",
  factoryAdvantages: "自有注塑车间，QC团队20人",
  additionalNotes: "",
};

type FieldErrors = Partial<Record<keyof ProductFormInput | "accessPassword", string>>;

function getTextLength(value: string | undefined) {
  return (value || "").trim().length;
}

function validateForm(form: ProductFormInput, accessPassword: string) {
  const errors: FieldErrors = {};
  if (!accessPassword.trim()) {
    errors.accessPassword = "请输入访问密码。";
  }
  for (const field of basicRequiredFields) {
    if (!form[field]?.trim()) {
      errors[field] = "该项不能为空。";
    }
  }
  for (const [field, limit] of Object.entries(inputLimits)) {
    const val = form[field as keyof ProductFormInput];
    if (getTextLength(val) > (limit || 999)) {
      errors[field as keyof ProductFormInput] = "最多输入 " + (limit || 999) + " 个字符。";
    }
  }
  return errors;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sanitizeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 48) || "选品分析结果";
}

function downloadTextFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function getInputSummary(form: ProductFormInput) {
  return [
    ["产品中文名称", form.productName],
    ["产品英文名称", form.englishName || "未填写"],
    ["产品类别", form.category],
    ["材质", form.material],
    ["核心卖点", form.sellingPoints],
    ["产品成本", form.productCost],
    ["预估售价", form.estimatedPrice],
    ["MOQ", form.moq],
    ["目标国家/地区", form.targetCountries],
  ];
}
function resultToText(form: ProductFormInput, result: AlibabaResult) {
  const scoreLabels: Record<string, string> = {
    marketDemand: "市场需求", competitionRisk: "竞争强度", profitMargin: "利润空间",
    logisticsDifficulty: "物流难度", complianceRisk: "认证/合规风险", b2bFit: "B2B适配度",
    differentiation: "差异化空间", beginnerDifficulty: "新手操作难度",
  };
  const lines: string[] = [];
  lines.push("== 产品机会总评分: " + result.productOpportunityScore + "/100 (置信度: " + getConfidenceLabel(result.confidenceLevel) + ") ==");
  lines.push("");
  lines.push("建议: " + (result.recommendation || {}).suggestion || "");
  if ((result.recommendation || {}).dataWarning || "") lines.push("数据提示: " + (result.recommendation || {}).dataWarning || "");
  lines.push("");
  lines.push("== 评分明细 ==");
  for (const [key, dim] of Object.entries(result.scoreBreakdown || {})) {
    const label = scoreLabels[key] || key;
    lines.push(label + ": " + dim.score + "分 - " + dim.basis);
  }
  lines.push("");
  const assessments: Array<[string, any]> = [
    ["市场需求", (result.demandAnalysis )],
    ["竞争强度", result.competitionRiskAssessment],
    ["利润空间", result.profitRiskAssessment],
    ["物流难度", result.logisticsRiskAssessment],
    ["认证/合规风险", result.complianceRiskAssessment],
    ["B2B适配度", result.b2bFitAssessment],
    ["差异化机会", result.differentiationAssessment],
    ["新手操作难度", result.beginnerDifficultyAssessment],
  ];
  for (const [label, a] of assessments) {
    lines.push("== " + label + " ==");
    lines.push("结论: " + a.conclusion);
    lines.push("依据: " + a.basis);
    lines.push("风险: " + a.risk);
    lines.push("置信度: " + a.confidence);
    lines.push("验证: " + a.verificationStep);
    lines.push("");
  }
  lines.push("== 缺失数据提醒 ==");
  if (result.missingData.length) result.missingData.forEach(i => lines.push("- " + i));
  else lines.push("无");
  lines.push("");
  lines.push("== 验证清单 ==");
  result.validationChecklist.forEach((i, idx) => lines.push((idx + 1) + ". " + i));
  lines.push("");
  lines.push("== 目标国家/地区 ==");
  lines.push(result.targetMarkets.join(", "));
  lines.push("");
  lines.push("== 买家类型 ==");
  lines.push(result.buyerTypes.join(", "));
  lines.push("");
  lines.push("== 标题 ==");
  lines.push(result.alibabaTitle);
  lines.push("");
  lines.push("== 核心关键词 ==");
  lines.push(result.coreKeywords.join(", "));
  lines.push("");
  lines.push("== 长尾关键词 ==");
  lines.push(result.longTailKeywords.join(", "));
  lines.push("");
  lines.push("== 详情页文案 ==");
  lines.push(result.productDescription);
  lines.push("");
  lines.push("== 询盘模板 ==");
  lines.push("首次询价: " + (result.inquiryReplyTemplates || {}).firstInquiry);
  lines.push("MOQ: " + (result.inquiryReplyTemplates || {}).moqReply);
  lines.push("样品费: " + (result.inquiryReplyTemplates || {}).sampleFeeReply);
  lines.push("OEM/ODM: " + (result.inquiryReplyTemplates || {}).oemOdmReply);
  lines.push("价格: " + (result.inquiryReplyTemplates || {}).priceTooHighReply);
  lines.push("交期: " + (result.inquiryReplyTemplates || {}).leadTimeReply);
  lines.push("运费: " + (result.inquiryReplyTemplates || {}).shippingReply);
  lines.push("跟进: " + (result.inquiryReplyTemplates || {}).followUpReply);
  lines.push("");
  lines.push("== 主图建议 ==");
  result.imageSuggestions.forEach((i, idx) => lines.push((idx + 1) + ". " + i));
  lines.push("");
  lines.push("== Amazon Listing 补充版 ==");
  lines.push(result.amazonListing || "");
  lines.push("");
  lines.push("== 行动计划 ==");
  result.actionPlan.forEach((i, idx) => lines.push((idx + 1) + ". " + i));
  return lines.join("\n");
}

function resultToMarkdown(form: ProductFormInput, result: AlibabaResult, generatedAt: string) {
  const lines: string[] = [];
  lines.push("# 阿里国际站选品分析报告: " + (form.productName || ""));
  lines.push("");
  lines.push("**生成时间：** " + generatedAt);
  lines.push("");
  lines.push("**产品机会评分：** " + result.productOpportunityScore + "/100（" + getConfidenceLabel(result.confidenceLevel) + "置信度）");
  lines.push("");
  lines.push("**建议：** " + (result.recommendation || {}).suggestion || "");
  if ((result.recommendation || {}).dataWarning || "") lines.push("**" + (result.recommendation || {}).dataWarning || "" + "**");
  lines.push("");
  lines.push("## 产品信息");
  lines.push("");
  for (const [k, v] of getInputSummary(form)) {
    lines.push("- **" + k + "：** " + v);
  }
  lines.push("");
  lines.push("## 评分明细");
  lines.push("");
  const scoreLabels: Record<string, string> = {
    marketDemand: "市场需求", competitionRisk: "竞争强度", profitMargin: "利润空间",
    logisticsDifficulty: "物流难度", complianceRisk: "认证/合规风险", b2bFit: "B2B适配度",
    differentiation: "差异化空间", beginnerDifficulty: "新手操作难度",
  };
  for (const [key, dim] of Object.entries(result.scoreBreakdown || {})) {
    const label = scoreLabels[key] || key;
    lines.push("### " + label + "（" + dim.score + "分）");
    lines.push("");
    lines.push("- 依据：" + dim.basis);
    lines.push("- 主要风险：" + (dim.mainRisk || "无"));
    lines.push("- 缺失数据：" + (dim.missingData || "无"));
    lines.push("");
  }
  lines.push("## 选品分析");
  lines.push("");
  const assessments: Array<[string, any]> = [
    ["市场需求", (result.demandAnalysis )],
    ["竞争强度", result.competitionRiskAssessment],
    ["利润空间", result.profitRiskAssessment],
    ["物流难度", result.logisticsRiskAssessment],
    ["认证/合规风险", result.complianceRiskAssessment],
    ["B2B适配度", result.b2bFitAssessment],
    ["差异化机会", result.differentiationAssessment],
    ["新手操作难度", result.beginnerDifficultyAssessment],
  ];
  for (const [label, a] of assessments) {
    lines.push("### " + label);
    lines.push("");
    lines.push("- 结论：" + a.conclusion);
    lines.push("- 依据：" + a.basis);
    lines.push("- 风险：" + a.risk);
    lines.push("- 置信度：" + a.confidence);
    lines.push("- 下一步验证：" + a.verificationStep);
    lines.push("");
  }
  lines.push("## 缺失数据");
  lines.push("");
  if (result.missingData.length) result.missingData.forEach(i => lines.push("- " + i));
  else lines.push("无缺失数据");
  lines.push("");
  lines.push("## 验证清单");
  lines.push("");
  result.validationChecklist.forEach((i, idx) => lines.push((idx + 1) + ". " + i));
  lines.push("");
  lines.push("## 发布优化");
  lines.push("");
  lines.push("**目标国家/地区：** " + result.targetMarkets.join("、"));
  lines.push("");
  lines.push("**买家类型：** " + result.buyerTypes.join("、"));
  lines.push("");
  lines.push("**Alibaba 标题：** " + result.alibabaTitle);
  lines.push("");
  lines.push("**核心关键词：** " + result.coreKeywords.join("、"));
  lines.push("");
  lines.push("**长尾关键词：** " + result.longTailKeywords.join("、"));
  lines.push("");
  lines.push("**产品描述：** " + result.productDescription);
  lines.push("");
  lines.push("**Amazon Listing 补充版：** " + result.amazonListing);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("*生成内容仅供选品初筛参考，不构成销售承诺。*");
  return lines.join("\n");
}
function resultToWordHtml(form: ProductFormInput, result: AlibabaResult, generatedAt: string) {
  const esc = (s: string) => escapeHtml(s);
  const dimRows = Object.entries(result.scoreBreakdown || {}).map(([key, dim]) => {
    const labels: Record<string, string> = {
      marketDemand: "市场需求", competitionRisk: "竞争强度", profitMargin: "利润空间",
      logisticsDifficulty: "物流难度", complianceRisk: "认证/合规风险", b2bFit: "B2B适配度",
      differentiation: "差异化空间", beginnerDifficulty: "新手操作难度",
    };
    const label = labels[key] || key;
    return "<tr><td>" + label + "</td><td>" + dim.score + "分</td><td>" + esc(dim.basis) + "</td></tr>";
  }).join("");
  const inputRows = getInputSummary(form).map(([k, v]) => "<li><strong>" + esc(k) + "：</strong>" + esc(v || "") + "</li>").join("");
  const assessments: Array<[string, any]> = [
    ["市场需求", (result.demandAnalysis )],
    ["竞争强度", result.competitionRiskAssessment],
    ["利润空间", result.profitRiskAssessment],
    ["物流难度", result.logisticsRiskAssessment],
    ["认证/合规风险", result.complianceRiskAssessment],
    ["B2B适配度", result.b2bFitAssessment],
    ["差异化机会", result.differentiationAssessment],
    ["新手操作难度", result.beginnerDifficultyAssessment],
  ];
  const assessHtml = assessments.map(([label, a]) => {
    const isRisk = a.risk.includes("⚠️") || a.risk.includes("高风险");
    const bgColor = isRisk ? "#fef2f2" : "#f8fafc";
    return "<div style='background:" + bgColor + ";border:1px solid #e2e8f0;border-radius:6px;padding:12px;margin:8px 0'>"
      + "<h3 style='margin:0 0 8px'>" + label + "</h3>"
      + "<p><strong>结论：</strong>" + esc(a.conclusion) + "</p>"
      + "<p><strong>依据：</strong>" + esc(a.basis) + "</p>"
      + "<p><strong>风险：</strong>" + esc(a.risk) + "</p>"
      + "<p><strong>置信度：</strong>" + esc(a.confidence) + "</p>"
      + "<p><strong>验证：</strong>" + esc(a.verificationStep) + "</p></div>";
  }).join("");
  return "<!doctype html><html><head><meta charset='utf-8'/>"
    + "<title>阿里国际站选品分析报告</title>"
    + "<style>body{font-family:'Microsoft YaHei',Arial,sans-serif;color:#0f172a;line-height:1.7;max-width:800px;margin:40px auto;padding:0 20px}"
    + "h1{font-size:24px;margin-bottom:8px}h2{margin-top:28px;font-size:18px;border-bottom:1px solid #cbd5e1;padding-bottom:6px}"
    + "h3{margin-top:16px;font-size:15px}"
    + "table{width:100%;border-collapse:collapse;margin:16px 0}"
    + "th,td{border:1px solid #e2e8f0;padding:8px 12px;text-align:left;font-size:14px}"
    + "th{background:#f8fafc;font-weight:600}"
    + ".score{font-size:32px;font-weight:700;color:#0f766e}"
    + ".meta{color:#475569;font-size:13px}.notice{margin-top:28px;color:#64748b;font-size:13px}"
    + "</style></head><body>"
    + "<h1>阿里国际站选品分析报告</h1>"
    + "<p class='meta'>生成时间：" + esc(generatedAt) + "</p>"
    + "<p><span class='score'>" + result.productOpportunityScore + "</span>/100分</p>"
    + "<p><strong>建议：</strong>" + esc((result.recommendation || {}).suggestion || "") + "</p>"
    + ((result.recommendation || {}).dataWarning || "" ? "<div style='background:#fffbeb;border:1px solid #fde68a;padding:12px;border-radius:6px;margin:16px 0'>" + esc((result.recommendation || {}).dataWarning || "") + "</div>" : "")
    + "<h2>产品信息</h2><ul>" + inputRows + "</ul>"
    + "<h2>评分明细</h2><table><thead><tr><th>维度</th><th>得分</th><th>依据</th></tr></thead><tbody>" + dimRows + "</tbody></table>"
    + "<h2>选品分析</h2>" + assessHtml
    + ((result.amazonListing || "") ? "<h2>Amazon Listing 补充版</h2><p>" + esc(result.amazonListing || "") + "</p>" : "")
    + "<p class='notice'>生成内容仅供选品初筛参考，不构成销售承诺。</p>"
    + "</body></html>";
}

function normalizeResult(data: any): AlibabaResult {
  const source = data && typeof data === "object" ? data : {};
  const asString = (value: unknown) => typeof value === "string" ? value : "";
  const asStringArray = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  const normalizeDim = (value: any) => ({
    score: typeof value?.score === "number" && Number.isFinite(value.score) ? value.score : 0,
    basis: asString(value?.basis) || "暂无依据",
    mainRisk: asString(value?.mainRisk),
    missingData: asString(value?.missingData),
  });
  const normalizeAssess = (value: any) => ({
    conclusion: asString(value?.conclusion),
    basis: asString(value?.basis),
    risk: asString(value?.risk),
    confidence: (["low", "medium", "high"].includes(value?.confidence) ? value.confidence : "low") as "low" | "medium" | "high",
    verificationStep: asString(value?.verificationStep),
  });
  const templates = source.inquiryReplyTemplates && typeof source.inquiryReplyTemplates === "object"
    ? source.inquiryReplyTemplates
    : {};

  return {
    productOpportunityScore: typeof source.productOpportunityScore === "number" && Number.isFinite(source.productOpportunityScore)
      ? Math.min(Math.max(source.productOpportunityScore, 0), 100)
      : 0,
    confidenceLevel: (["low", "medium", "high"].includes(source.confidenceLevel) ? source.confidenceLevel : "low") as "low" | "medium" | "high",
    recommendation: {
      suggestion: asString(source.recommendation?.suggestion),
      dataWarning: asString(source.recommendation?.dataWarning),
    },
    scoreBreakdown: {
      marketDemand: normalizeDim(source.scoreBreakdown?.marketDemand),
      competitionRisk: normalizeDim(source.scoreBreakdown?.competitionRisk),
      profitMargin: normalizeDim(source.scoreBreakdown?.profitMargin),
      logisticsDifficulty: normalizeDim(source.scoreBreakdown?.logisticsDifficulty),
      complianceRisk: normalizeDim(source.scoreBreakdown?.complianceRisk),
      b2bFit: normalizeDim(source.scoreBreakdown?.b2bFit),
      differentiation: normalizeDim(source.scoreBreakdown?.differentiation),
      beginnerDifficulty: normalizeDim(source.scoreBreakdown?.beginnerDifficulty),
    },
    demandAnalysis: normalizeAssess(source.demandAnalysis),
    competitionRiskAssessment: normalizeAssess(source.competitionRiskAssessment),
    profitRiskAssessment: normalizeAssess(source.profitRiskAssessment),
    logisticsRiskAssessment: normalizeAssess(source.logisticsRiskAssessment),
    complianceRiskAssessment: normalizeAssess(source.complianceRiskAssessment),
    b2bFitAssessment: normalizeAssess(source.b2bFitAssessment),
    differentiationAssessment: normalizeAssess(source.differentiationAssessment),
    beginnerDifficultyAssessment: normalizeAssess(source.beginnerDifficultyAssessment),
    missingData: asStringArray(source.missingData),
    validationChecklist: asStringArray(source.validationChecklist),
    targetMarkets: asStringArray(source.targetMarkets),
    buyerTypes: asStringArray(source.buyerTypes),
    alibabaTitle: asString(source.alibabaTitle),
    coreKeywords: asStringArray(source.coreKeywords),
    longTailKeywords: asStringArray(source.longTailKeywords),
    productDescription: asString(source.productDescription),
    inquiryReplyTemplates: {
      firstInquiry: asString(templates.firstInquiry),
      moqReply: asString(templates.moqReply),
      sampleFeeReply: asString(templates.sampleFeeReply),
      oemOdmReply: asString(templates.oemOdmReply),
      priceTooHighReply: asString(templates.priceTooHighReply),
      leadTimeReply: asString(templates.leadTimeReply),
      shippingReply: asString(templates.shippingReply),
      followUpReply: asString(templates.followUpReply),
    },
    imageSuggestions: asStringArray(source.imageSuggestions),
    amazonListing: asString(source.amazonListing),
    actionPlan: asStringArray(source.actionPlan),
  };
}

export default function HomePage() {
  const [form, setForm] = useState<ProductFormInput>(emptyForm);
  const [accessPassword, setAccessPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [result, setResult] = useState<AlibabaResult | null>(null);
  const [generatedAt, setGeneratedAt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showProfessional, setShowProfessional] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const savedPassword = window.sessionStorage.getItem("app_access_password");
    if (savedPassword) setAccessPassword(savedPassword);
  }, []);

  const allResultText = useMemo(() => (result ? resultToText(form, result) : ""), [form, result]);

  const updateField = useCallback(<K extends keyof ProductFormInput>(field: K, value: ProductFormInput[K]) => {
    setForm((cur) => ({ ...cur, [field]: value }));
    setFieldErrors((cur) => ({ ...cur, [field]: undefined }));
  }, []);

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const errors = validateForm(form, accessPassword);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError("请先检查表单中的必填项和字数限制。");
      return;
    }
    setIsLoading(true);
    try {
      window.sessionStorage.setItem("app_access_password", accessPassword);
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, accessPassword }),
      });
      const data = await response.json() as AlibabaResult | GenerateErrorResponse;
      if (!response.ok) {
        const failure = data as GenerateErrorResponse;
        if (failure.fieldErrors) setFieldErrors(failure.fieldErrors as FieldErrors);
        setError(failure.error || "生成失败，请稍后重试。");
        return;
      }
      setResult(normalizeResult(data));
      setGeneratedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
    } catch {
      setError("请求失败，请检查网络连接或稍后重试。");
    } finally {
      setIsLoading(false);
    }
  }

  function fillSample() {
    setForm(sampleForm);
    setFieldErrors({});
    setError("");
  }

  function downloadMarkdown() {
    if (!result) return;
    const fileName = sanitizeFileName(form.productName) + "-选品分析.md";
    downloadTextFile(fileName, resultToMarkdown(form, result, generatedAt), "text/markdown;charset=utf-8");
  }

  function downloadWord() {
    if (!result) return;
    const fileName = sanitizeFileName(form.productName) + "-选品分析.doc";
    downloadTextFile(fileName, resultToWordHtml(form, result, generatedAt), "application/msword;charset=utf-8");
  }
  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
          <div className="flex flex-col gap-3 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-teal-700">Alibaba.com AI Workspace</p>
              <h1 className="mt-2 text-3xl font-bold tracking-normal text-slate-950 sm:text-4xl">阿里国际站选品发布 AI 助手 Pro</h1>
              <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">输入产品信息，AI 帮你初步判断产品机会、利润风险、物流风险、认证风险、B2B 适配度，并生成阿里国际站标题、关键词、详情页和询盘回复。</p>
            </div>
            <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-3 lg:w-[420px]">
              <StatusPill icon={<ClipboardList className="h-4 w-4" />} label="选品初筛" />
              <StatusPill icon={<ShieldCheck className="h-4 w-4" />} label="发布优化" />
              <StatusPill icon={<Download className="h-4 w-4" />} label="询盘转化" />
            </div>
          </div>
          <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs leading-5 text-slate-500 sm:px-6">工具定位为「选品初筛与发布辅助」，不是「保证选品成功」。</div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(400px,1fr)_minmax(0,1.1fr)]">
          {/* FORM */}
          <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white shadow-soft">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">产品信息</h2>
                <p className="mt-1 text-sm text-slate-500">基础模式展示核心字段</p>
              </div>
              <button type="button" onClick={fillSample} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-teal-300 hover:text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2">
                <RefreshCcw className="h-4 w-4" />填入示例
              </button>
            </div>

            <div className="space-y-4 p-5">
              {/* Access Password */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800" htmlFor="pw">
                  <Lock className="h-4 w-4" />访问密码
                </label>
                <input id="pw" type="password" value={accessPassword} onChange={(e) => { setAccessPassword(e.target.value); setFieldErrors((c) => ({ ...c, accessPassword: undefined })); }}
                  className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  placeholder="请输入 APP_ACCESS_PASSWORD" autoComplete="current-password" />
                {fieldErrors.accessPassword ? <p className="mt-2 text-sm text-red-600">{fieldErrors.accessPassword}</p> : <p className="mt-2 text-xs text-slate-500">密码仅用于当前浏览器会话</p>}
              </div>

              {/* Basic Fields */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Wand2 className="h-3.5 w-3.5" /></div>
                  <h3 className="text-sm font-semibold text-slate-800">基础信息（必填）</h3>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextInput label="产品中文名称" required value={form.productName} limit={inputLimits.productName || 80} error={fieldErrors.productName} onChange={(v) => updateField("productName", v)} placeholder="便携式蓝牙无线音箱" />
                  <SelectInput label="产品类别" required value={form.category} options={categories} error={fieldErrors.category} onChange={(v) => updateField("category", v)} />
                  <TextInput label="材质" required value={form.material} limit={inputLimits.material || 100} error={fieldErrors.material} onChange={(v) => updateField("material", v)} placeholder="ABS塑料+金属网罩" />
                  <TextInput label="产品成本" required value={form.productCost} limit={inputLimits.productCost || 40} error={fieldErrors.productCost} onChange={(v) => updateField("productCost", v)} placeholder="35-50 元或美元" />
                  <TextInput label="预估售价" required value={form.estimatedPrice} limit={inputLimits.estimatedPrice || 40} error={fieldErrors.estimatedPrice} onChange={(v) => updateField("estimatedPrice", v)} placeholder="12-25 美元" />
                  <TextInput label="MOQ" required value={form.moq} limit={inputLimits.moq || 40} error={fieldErrors.moq} onChange={(v) => updateField("moq", v)} placeholder="500" />
                  <div className="sm:col-span-2"><TextInput label="目标国家/地区" required value={form.targetCountries} limit={inputLimits.targetCountries || 100} error={fieldErrors.targetCountries} onChange={(v) => updateField("targetCountries", v)} placeholder="美国、欧洲、东南亚" /></div>
                  <div className="sm:col-span-2"><TextareaInput label="核心卖点" required value={form.sellingPoints} limit={inputLimits.sellingPoints || 800} error={fieldErrors.sellingPoints} onChange={(v) => updateField("sellingPoints", v)} placeholder="写清楚材质、功能、场景、优势" /></div>
                </div>
              </div>

              {/* Professional Toggle */}
              <button type="button" onClick={() => setShowProfessional(!showProfessional)}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-teal-300 hover:text-teal-700">
                {showProfessional ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {showProfessional ? "收起专业信息" : "展开更多专业信息（可选填）"}
              </button>

              {/* Professional Groups */}
              {showProfessional && (
                <div className="space-y-3">
                  <ProfGroup title="产品基础信息补充" group="g1" expanded={expandedGroups} onToggle={toggleGroup}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextInput label="产品英文名称" value={form.englishName || ""} limit={inputLimits.englishName || 200} onChange={(v) => updateField("englishName", v)} placeholder="Portable Bluetooth Speaker" />
                      <TextInput label="规格尺寸" value={form.specifications || ""} limit={inputLimits.specifications || 200} onChange={(v) => updateField("specifications", v)} placeholder="8cm*10cm" />
                      <TextInput label="产品用途" value={form.productUsage || ""} limit={inputLimits.productUsage || 200} onChange={(v) => updateField("productUsage", v)} placeholder="客户用这个产品做什么" />
                      <TextInput label="适用场景" value={form.applicableScenarios || ""} limit={inputLimits.applicableScenarios || 200} onChange={(v) => updateField("applicableScenarios", v)} placeholder="户外、家庭、礼品" />
                    </div>
                  </ProfGroup>

                  <ProfGroup title="选品判断信息补充" group="g2" expanded={expandedGroups} onToggle={toggleGroup}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextInput label="产品重量(g)" value={form.productWeight || ""} limit={inputLimits.productWeight || 40} onChange={(v) => updateField("productWeight", v)} placeholder="320" />
                      <TextInput label="产品体积(m³)" value={form.productVolume || ""} limit={inputLimits.productVolume || 40} onChange={(v) => updateField("productVolume", v)} placeholder="0.5" />
                      <SelectInput label="OEM/ODM" value={form.supportsOemOdm || ""} options={["", ...yesNo]} onChange={(v) => updateField("supportsOemOdm", v)} />
                      <SelectInput label="是否现货" value={form.hasStock || ""} options={["", ...yesNo]} onChange={(v) => updateField("hasStock", v)} />
                      <TextInput label="交货周期" value={form.leadTime || ""} limit={inputLimits.leadTime || 100} onChange={(v) => updateField("leadTime", v)} placeholder="15-25天" />
                      <TextInput label="包装方式" value={form.packagingMethod || ""} limit={inputLimits.packagingMethod || 200} onChange={(v) => updateField("packagingMethod", v)} placeholder="彩盒包装，每箱50个" />
                    </div>
                  </ProfGroup>

                  <ProfGroup title="市场与买家信息" group="g3" expanded={expandedGroups} onToggle={toggleGroup}>
                    <div className="grid gap-4">
                      <TextInput label="目标买家类型" value={form.targetBuyerTypes || ""} limit={inputLimits.targetBuyerTypes || 200} onChange={(v) => updateField("targetBuyerTypes", v)} placeholder="批发商、品牌商、电商卖家" />
                      <TextareaInput label="目标客户痛点" value={form.customerPainPoints || ""} limit={inputLimits.customerPainPoints || 500} onChange={(v) => updateField("customerPainPoints", v)} placeholder="客户对同类产品的不满或期望" />
                      <TextareaInput label="竞品信息" value={form.competitorInfo || ""} limit={inputLimits.competitorInfo || 600} onChange={(v) => updateField("competitorInfo", v)} placeholder="竞品链接、价格、主打卖点" />
                      <TextareaInput label="阿里关键词趋势" value={form.keywordTrendData || ""} limit={inputLimits.keywordTrendData || 600} onChange={(v) => updateField("keywordTrendData", v)} placeholder="可选，来自阿里后台" />
                      <TextareaInput label="RFQ 需求信息" value={form.rfqData || ""} limit={inputLimits.rfqData || 600} onChange={(v) => updateField("rfqData", v)} placeholder="可选，来自 RFQ 市场" />
                      <TextareaInput label="Amazon 竞品" value={form.amazonCompetitorInfo || ""} limit={inputLimits.amazonCompetitorInfo || 600} onChange={(v) => updateField("amazonCompetitorInfo", v)} placeholder="可选，Amazon 数据" />
                    </div>
                  </ProfGroup>

                  <ProfGroup title="风险信息" group="g4" expanded={expandedGroups} onToggle={toggleGroup}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <SelectInput label="是否易碎" value={form.isFragile || ""} options={["", ...yesNoUnsure]} onChange={(v) => updateField("isFragile", v)} />
                      <SelectInput label="是否液体" value={form.isLiquid || ""} options={["", ...yesNoUnsure]} onChange={(v) => updateField("isLiquid", v)} />
                      <SelectInput label="是否带电" value={form.isBatteryPowered || ""} options={["", ...yesNoUnsure]} onChange={(v) => updateField("isBatteryPowered", v)} />
                      <SelectInput label="是否带磁" value={form.isMagnetic || ""} options={["", ...yesNoUnsure]} onChange={(v) => updateField("isMagnetic", v)} />
                      <SelectInput label="食品接触" value={form.isFoodContact || ""} options={["", ...yesNoUnsure]} onChange={(v) => updateField("isFoodContact", v)} />
                      <SelectInput label="儿童用品" value={form.isChildrenProduct || ""} options={["", ...yesNoUnsure]} onChange={(v) => updateField("isChildrenProduct", v)} />
                      <SelectInput label="需要认证" value={form.needsCertification || ""} options={["", ...yesNoUnsure]} onChange={(v) => updateField("needsCertification", v)} />
                      <TextareaInput label="已有认证证书" value={form.existingCertificates || ""} limit={inputLimits.existingCertificates || 400} onChange={(v) => updateField("existingCertificates", v)} placeholder="CE、FCC、ROHS" />
                    </div>
                  </ProfGroup>

                  <ProfGroup title="补充信息" group="g5" expanded={expandedGroups} onToggle={toggleGroup}>
                    <div className="grid gap-4">
                      <TextareaInput label="供应链优势" value={form.supplyChainAdvantages || ""} limit={inputLimits.supplyChainAdvantages || 400} onChange={(v) => updateField("supplyChainAdvantages", v)} placeholder="价格优势、月产能5万台" />
                      <TextareaInput label="工厂优势" value={form.factoryAdvantages || ""} limit={inputLimits.factoryAdvantages || 400} onChange={(v) => updateField("factoryAdvantages", v)} placeholder="自有车间、QC团队" />
                      <TextareaInput label="其他补充" value={form.additionalNotes || ""} limit={inputLimits.additionalNotes || 800} onChange={(v) => updateField("additionalNotes", v)} placeholder="其他你想 AI 知道的信息" />
                    </div>
                  </ProfGroup>
                </div>
              )}
            </div>
            {error ? (
              <div className="mx-5 mb-4 flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                <span>{error}</span>
              </div>
            ) : null}

            <div className="px-5 pb-5">
              <button type="submit" disabled={isLoading}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-5 text-base font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400">
                <Wand2 className="h-5 w-5" />
                {isLoading ? "正在分析，请稍候..." : "开始分析"}
              </button>
            </div>
          </form>
          {/* RESULTS */}
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">分析结果</h2>
                  <p className="mt-1 text-sm text-slate-500">{result ? "点击各模块展开查看" : "生成后可复制全部或导出 Markdown / Word"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton text={allResultText} label="复制全部" className={!result ? "pointer-events-none opacity-45" : ""} />
                  <button type="button" onClick={downloadMarkdown} disabled={!result}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-teal-300 hover:text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-45">
                    <FileText className="h-4 w-4" />Markdown
                  </button>
                  <button type="button" onClick={downloadWord} disabled={!result}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-teal-300 hover:text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-45">
                    <Download className="h-4 w-4" />Word
                  </button>
                </div>
              </div>
            </div>

            {!result ? (
              <div className="m-5 flex min-h-[600px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-50 text-teal-700"><Wand2 className="h-6 w-6" /></div>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">等待选品分析</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">先填写左侧产品信息，至少填写基础模式的 8 个必填字段。</p>
                <div className="mt-5 grid w-full max-w-lg gap-2 sm:grid-cols-3">
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-left">
                    <p className="text-sm font-semibold text-slate-900">选品初筛</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">机会评分+风险判断</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-left">
                    <p className="text-sm font-semibold text-slate-900">发布优化</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">标题+关键词+详情页</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-left">
                    <p className="text-sm font-semibold text-slate-900">询盘转化</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">8个沟通模板</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-5 p-5">
                <ScoreCard score={result.productOpportunityScore} confidenceLevel={result.confidenceLevel} recommendation={result.recommendation} />
                <MissingDataSection items={result.missingData} />
                <ValidationChecklistSection items={result.validationChecklist} />

                <div>
                  <SectionGroupTitle title="评分明细" count={8} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(result.scoreBreakdown ? Object.entries(result.scoreBreakdown) : []).map(([key, dim]) => {
                      const info = scoreDimensionLabels[key as keyof typeof scoreDimensionLabels]; if (!info) return null;
                      if (!info) return null;
                      return <ScoreDimensionCard key={key} label={info.label} maxScore={info.maxScore} dimension={dim} />;
                    })}
                  </div>
                </div>

                <div>
                  <SectionGroupTitle title="选品分析" count={8} />
                  <div className="grid gap-3">
                    <AssessmentCard title="市场需求判断" assessment={(result.demandAnalysis ) || { conclusion: "", basis: "", risk: "", confidence: "low", verificationStep: "" }} />
                    <AssessmentCard title="竞争强度判断" assessment={result.competitionRiskAssessment || { conclusion: "", basis: "", risk: "", confidence: "low", verificationStep: "" }} />
                    <AssessmentCard title="利润空间判断" assessment={result.profitRiskAssessment || { conclusion: "", basis: "", risk: "", confidence: "low", verificationStep: "" }} />
                    <AssessmentCard title="物流难度判断" assessment={result.logisticsRiskAssessment || { conclusion: "", basis: "", risk: "", confidence: "low", verificationStep: "" }} />
                    <AssessmentCard title="认证/合规风险判断" assessment={result.complianceRiskAssessment || { conclusion: "", basis: "", risk: "", confidence: "low", verificationStep: "" }} />
                    <AssessmentCard title="B2B 适配度判断" assessment={result.b2bFitAssessment || { conclusion: "", basis: "", risk: "", confidence: "low", verificationStep: "" }} />
                    <AssessmentCard title="差异化机会" assessment={result.differentiationAssessment || { conclusion: "", basis: "", risk: "", confidence: "low", verificationStep: "" }} />
                    <AssessmentCard title="新手操作难度" assessment={result.beginnerDifficultyAssessment || { conclusion: "", basis: "", risk: "", confidence: "low", verificationStep: "" }} />
                  </div>
                </div>

                <div>
                  <SectionGroupTitle title="发布优化" />
                  <div className="grid gap-3">
                    <SimpleListSection title="适合目标国家/地区" items={result.targetMarkets} />
                    <SimpleListSection title="适合买家类型" items={result.buyerTypes} />
                    <TextBlockSection title="阿里国际站英文标题" text={result.alibabaTitle} />
                    <SimpleListSection title="核心关键词" items={result.coreKeywords} />
                    <SimpleListSection title="长尾关键词" items={result.longTailKeywords} />
                    <TextBlockSection title="产品详情页英文文案" text={result.productDescription} />
                  </div>
                </div>

                <div>
                  <SectionGroupTitle title="询盘转化" />
                  <InquiryTemplatesSection templates={result.inquiryReplyTemplates} />
                </div>

                <div>
                  <SectionGroupTitle title="补充与行动" />
                  <div className="grid gap-3">
                    <SimpleListSection title="主图/详情图建议" items={result.imageSuggestions} />
                    <TextBlockSection title="Amazon Listing 补充版" text={result.amazonListing || ""} />
                    <SimpleListSection title="优先行动计划" items={result.actionPlan} />
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-center text-sm leading-6 text-slate-500">
          生成内容仅供选品初筛参考，不构成销售承诺。
        </footer>
      </div>
    </main>
  );
}
// ==================== Helper Components ====================

function StatusPill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-teal-700">{icon}</span>
      <span className="font-medium">{label}</span>
    </div>
  );
}

function ProfGroup({ title, group, expanded, onToggle, children }: {
  title: string;
  group: string;
  expanded: Record<string, boolean>;
  onToggle: (g: string) => void;
  children: ReactNode;
}) {
  const isOpen = !!expanded[group];
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button type="button" onClick={() => onToggle(group)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <span>{title}</span>
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {isOpen && <div className="border-t border-slate-100 p-4">{children}</div>}
    </div>
  );
}

function TextInput({ label, value, onChange, limit, required, error, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  limit: number; required?: boolean; error?: string; placeholder?: string;
}) {
  const len = getTextLength(value);
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold text-slate-800">
        <span>{label}{required ? <span className="text-red-500"> *</span> : null}</span>
        <span className={len > limit ? "text-red-600" : "text-slate-400"}>{len}/{limit}</span>
      </span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </label>
  );
}

function TextareaInput({ label, value, onChange, limit, required, error, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  limit: number; required?: boolean; error?: string; placeholder?: string;
}) {
  const len = getTextLength(value);
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold text-slate-800">
        <span>{label}{required ? <span className="text-red-500"> *</span> : null}</span>
        <span className={len > limit ? "text-red-600" : "text-slate-400"}>{len}/{limit}</span>
      </span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3}
        className="w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </label>
  );
}

function SelectInput({ label, value, options, onChange, required, error }: {
  label: string; value: string; options: readonly string[];
  onChange: (v: string) => void; required?: boolean; error?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-800">
        {label}{required ? <span className="text-red-500"> *</span> : null}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100">
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </label>
  );
}
