"use client";

import {
  AlertCircle,
  ClipboardList,
  Download,
  FileText,
  Layers3,
  Lock,
  RefreshCcw,
  ShieldCheck,
  Wand2,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { formatResultValue, ResultSection } from "@/components/ResultSection";
import {
  categories,
  GeneratedContent,
  GenerateErrorResponse,
  inputLimits,
  languages,
  platforms,
  ProductInput,
  requiredFields,
  resultLabels,
  tones,
} from "@/lib/types";

const emptyForm: ProductInput = {
  productName: "",
  category: "服装",
  platform: "淘宝/天猫",
  sellingPointsInput: "",
  targetAudience: "",
  priceRange: "",
  competitorInfo: "",
  painPoints: "",
  tone: "专业可信",
  language: "中文",
};

const sampleForm: ProductInput = {
  productName: "轻量防晒透气运动外套",
  category: "服装",
  platform: "小红书",
  sellingPointsInput: "UPF50+ 防晒，轻薄透气，通勤和户外都能穿，版型显瘦，不闷汗，易收纳。",
  targetAudience: "经常通勤、周末徒步或露营的年轻上班族和大学生",
  priceRange: "199-299 元",
  competitorInfo: "竞品多强调防晒指数，但款式偏户外，日常穿搭感不足。",
  painPoints: "怕晒黑、怕闷热、普通防晒衣不好搭配、出门携带不方便。",
  tone: "小红书种草风",
  language: "中文",
};

type FieldErrors = Partial<Record<keyof ProductInput | "accessPassword", string>>;

function getTextLength(value: string | undefined) {
  return (value || "").trim().length;
}

function validateForm(form: ProductInput, accessPassword: string) {
  const errors: FieldErrors = {};

  if (!accessPassword.trim()) {
    errors.accessPassword = "请输入访问密码。";
  }

  for (const field of requiredFields) {
    if (!form[field]?.trim()) {
      errors[field] = "该项不能为空。";
    }
  }

  for (const [field, limit] of Object.entries(inputLimits) as Array<[keyof ProductInput, number]>) {
    if (getTextLength(form[field]) > limit) {
      errors[field] = `最多输入 ${limit} 个字符。`;
    }
  }

  return errors;
}

function resultToText(result: GeneratedContent) {
  return resultLabels
    .map((section) => {
      const value = result[section.key];
      return `【${section.title}】\n${formatResultValue(value)}`;
    })
    .join("\n\n");
}

function getResultItemCount(result: GeneratedContent) {
  return resultLabels.reduce((count, section) => {
    const value = result[section.key];
    return count + (Array.isArray(value) ? value.length : 1);
  }, 0);
}

function sanitizeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 48) || "商品页优化结果";
}

function getInputSummaryMarkdown(form: ProductInput) {
  return [
    `- 商品名称：${form.productName}`,
    `- 商品类目：${form.category}`,
    `- 目标平台：${form.platform}`,
    `- 目标人群：${form.targetAudience}`,
    `- 商品价格区间：${form.priceRange || "未填写"}`,
    `- 风格选择：${form.tone}`,
    `- 输出语言：${form.language}`,
    `- 商品核心卖点：${form.sellingPointsInput}`,
    `- 竞品链接或竞品描述：${form.competitorInfo || "未填写"}`,
    `- 用户痛点：${form.painPoints || "未填写"}`,
  ].join("\n");
}

function resultToMarkdown(form: ProductInput, result: GeneratedContent, generatedAt: string) {
  const sections = resultLabels
    .map((section) => {
      const value = result[section.key];
      return `## ${section.title}\n\n${formatResultValue(value)}`;
    })
    .join("\n\n");

  return [
    `# ${form.productName || "电商商品页 AI 优化结果"}`,
    "",
    `生成时间：${generatedAt}`,
    "",
    "## 商品信息",
    "",
    getInputSummaryMarkdown(form),
    "",
    sections,
    "",
    "---",
    "",
    "生成内容仅供运营参考，请根据平台规则、商品真实情况和广告法要求修改后使用。",
  ].join("\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatResultValueAsHtml(value: string | string[]) {
  if (Array.isArray(value)) {
    return `<ol>${value.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
  }

  return `<p>${escapeHtml(value).replace(/\n/g, "<br />")}</p>`;
}

function resultToWordHtml(form: ProductInput, result: GeneratedContent, generatedAt: string) {
  const sections = resultLabels
    .map((section) => {
      const value = result[section.key];
      return `<h2>${escapeHtml(section.title)}</h2>${formatResultValueAsHtml(value)}`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(form.productName || "电商商品页 AI 优化结果")}</title>
  <style>
    body { font-family: "Microsoft YaHei", Arial, sans-serif; color: #0f172a; line-height: 1.7; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    h2 { margin-top: 28px; font-size: 18px; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; }
    li { margin: 6px 0; }
    .meta { color: #475569; font-size: 13px; }
    .notice { margin-top: 28px; color: #64748b; font-size: 13px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(form.productName || "电商商品页 AI 优化结果")}</h1>
  <p class="meta">生成时间：${escapeHtml(generatedAt)}</p>
  <h2>商品信息</h2>
  <ul>
    <li>商品类目：${escapeHtml(form.category)}</li>
    <li>目标平台：${escapeHtml(form.platform)}</li>
    <li>目标人群：${escapeHtml(form.targetAudience)}</li>
    <li>商品价格区间：${escapeHtml(form.priceRange || "未填写")}</li>
    <li>风格选择：${escapeHtml(form.tone)}</li>
    <li>输出语言：${escapeHtml(form.language)}</li>
    <li>商品核心卖点：${escapeHtml(form.sellingPointsInput)}</li>
    <li>竞品链接或竞品描述：${escapeHtml(form.competitorInfo || "未填写")}</li>
    <li>用户痛点：${escapeHtml(form.painPoints || "未填写")}</li>
  </ul>
  ${sections}
  <p class="notice">生成内容仅供运营参考，请根据平台规则、商品真实情况和广告法要求修改后使用。</p>
</body>
</html>`;
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

export default function HomePage() {
  const [form, setForm] = useState<ProductInput>(emptyForm);
  const [accessPassword, setAccessPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [result, setResult] = useState<GeneratedContent | null>(null);
  const [generatedAt, setGeneratedAt] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const savedPassword = window.sessionStorage.getItem("app_access_password");
    if (savedPassword) {
      setAccessPassword(savedPassword);
    }
  }, []);

  const allResultText = useMemo(() => (result ? resultToText(result) : ""), [result]);
  const resultItemCount = useMemo(() => (result ? getResultItemCount(result) : 0), [result]);

  function updateField<K extends keyof ProductInput>(field: K, value: ProductInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

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

      const data = (await response.json()) as GeneratedContent | GenerateErrorResponse;
      if (!response.ok) {
        const failure = data as GenerateErrorResponse;
        setFieldErrors((failure.fieldErrors || {}) as FieldErrors);
        setError(failure.error || "生成失败，请稍后再试。");
        return;
      }

      setResult(data as GeneratedContent);
      setGeneratedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
    } catch {
      setError("请求失败，请检查网络连接或稍后再试。");
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
    if (!result) {
      return;
    }

    const fileName = `${sanitizeFileName(form.productName)}-运营优化.md`;
    downloadTextFile(fileName, resultToMarkdown(form, result, generatedAt), "text/markdown;charset=utf-8");
  }

  function downloadWord() {
    if (!result) {
      return;
    }

    const fileName = `${sanitizeFileName(form.productName)}-运营优化.doc`;
    downloadTextFile(fileName, resultToWordHtml(form, result, generatedAt), "application/msword;charset=utf-8");
  }

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
          <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-teal-700">Ecommerce AI Workspace</p>
              <h1 className="mt-2 text-3xl font-bold tracking-normal text-slate-950 sm:text-4xl">
              电商商品页 AI 优化器
              </h1>
              <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
              输入商品信息，一键生成标题、详情页、短视频脚本、客服话术和差评回复。
              </p>
            </div>
            <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-3 lg:w-[420px]">
              <StatusPill icon={<ClipboardList className="h-4 w-4" />} label="17 个输出模块" />
              <StatusPill icon={<ShieldCheck className="h-4 w-4" />} label="服务端密钥保护" />
              <StatusPill icon={<Download className="h-4 w-4" />} label="支持导出交付" />
            </div>
          </div>
          <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs leading-5 text-slate-500 sm:px-6">
            当前版本适合商品上新、详情页改版、内容种草、投放测试和客服 SOP 准备。
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
          <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white shadow-soft">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">商品信息</h2>
                <p className="mt-1 text-sm text-slate-500">字段越具体，生成结果越接近真实运营场景。</p>
              </div>
              <button
                type="button"
                onClick={fillSample}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-teal-300 hover:text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
              >
                <RefreshCcw className="h-4 w-4" />
                填入示例
              </button>
            </div>

            <div className="space-y-5 p-5">
            <FormBlock title="访问保护" description="防止公开页面被随意调用 API。">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800" htmlFor="accessPassword">
                <Lock className="h-4 w-4" />
                访问密码
              </label>
              <input
                id="accessPassword"
                type="password"
                value={accessPassword}
                onChange={(event) => {
                  setAccessPassword(event.target.value);
                  setFieldErrors((current) => ({ ...current, accessPassword: undefined }));
                }}
                className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                placeholder="请输入 APP_ACCESS_PASSWORD"
                autoComplete="current-password"
              />
              {fieldErrors.accessPassword ? (
                <p className="mt-2 text-sm text-red-600">{fieldErrors.accessPassword}</p>
              ) : (
                <p className="mt-2 text-xs leading-5 text-slate-500">密码只用于当前浏览器会话，服务端每次生成都会重新校验。</p>
              )}
            </div>
            </FormBlock>

            <FormBlock title="基础信息" description="决定平台规则、标题方向和转化语气。">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                label="商品名称"
                required
                value={form.productName}
                limit={inputLimits.productName}
                error={fieldErrors.productName}
                onChange={(value) => updateField("productName", value)}
                placeholder="例如：轻量防晒透气运动外套"
              />
              <SelectInput
                label="商品类目"
                required
                value={form.category}
                options={categories}
                error={fieldErrors.category}
                onChange={(value) => updateField("category", value)}
              />
              <SelectInput
                label="目标平台"
                required
                value={form.platform}
                options={platforms}
                error={fieldErrors.platform}
                onChange={(value) => updateField("platform", value)}
              />
              <TextInput
                label="目标人群"
                required
                value={form.targetAudience}
                limit={inputLimits.targetAudience}
                error={fieldErrors.targetAudience}
                onChange={(value) => updateField("targetAudience", value)}
                placeholder="例如：大学生、宝妈、上班族"
              />
              <TextInput
                label="商品价格区间"
                value={form.priceRange || ""}
                limit={inputLimits.priceRange}
                error={fieldErrors.priceRange}
                onChange={(value) => updateField("priceRange", value)}
                placeholder="例如：99-199 元"
              />
              <SegmentedInput
                label="输出语言"
                required
                value={form.language}
                options={languages}
                error={fieldErrors.language}
                onChange={(value) => updateField("language", value)}
              />
            </div>
            </FormBlock>

            <FormBlock title="运营素材" description="补充越具体，差异化建议越能落到页面细节。">
            <div className="grid gap-4">
              <TextareaInput
                label="商品核心卖点"
                required
                value={form.sellingPointsInput}
                limit={inputLimits.sellingPointsInput}
                error={fieldErrors.sellingPointsInput}
                onChange={(value) => updateField("sellingPointsInput", value)}
                placeholder="写清楚材质、功能、场景、优势、用户为什么要买。"
              />
              <TextareaInput
                label="竞品链接或竞品描述"
                value={form.competitorInfo || ""}
                limit={inputLimits.competitorInfo}
                error={fieldErrors.competitorInfo}
                onChange={(value) => updateField("competitorInfo", value)}
                placeholder="可以填写竞品链接、价格、主打卖点或你观察到的问题。"
              />
              <TextareaInput
                label="用户痛点"
                value={form.painPoints || ""}
                limit={inputLimits.painPoints}
                error={fieldErrors.painPoints}
                onChange={(value) => updateField("painPoints", value)}
                placeholder="例如：怕踩雷、怕质量差、怕不适合自己、怕售后麻烦。"
              />
              <SegmentedInput
                label="风格选择"
                required
                value={form.tone}
                options={tones}
                error={fieldErrors.tone}
                onChange={(value) => updateField("tone", value)}
              />
            </div>
            </FormBlock>

            {error ? (
              <div className="mt-5 flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                <span>{error}</span>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isLoading}
              className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-5 text-base font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              <Wand2 className="h-5 w-5" />
              {isLoading ? "正在生成，请稍候..." : "开始生成"}
            </button>
            </div>
          </form>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">生成结果</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {result
                      ? `已生成 ${resultLabels.length} 个模块、${resultItemCount} 条可用内容。`
                      : "生成后可复制全部、单模块复制，也可导出 Markdown 或 Word。"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton text={allResultText} label="复制全部" className={!result ? "pointer-events-none opacity-45" : ""} />
                  <button
                    type="button"
                    onClick={downloadMarkdown}
                    disabled={!result}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-teal-300 hover:text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-45"
                  >
                    <FileText className="h-4 w-4" />
                    下载 Markdown
                  </button>
                  <button
                    type="button"
                    onClick={downloadWord}
                    disabled={!result}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-teal-300 hover:text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-45"
                  >
                    <Download className="h-4 w-4" />
                    下载 Word
                  </button>
                </div>
              </div>
              {result ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <ResultMetric label="平台模板" value={form.platform} />
                  <ResultMetric label="内容风格" value={form.tone} />
                  <ResultMetric label="生成时间" value={generatedAt} />
                </div>
              ) : null}
            </div>

            {!result ? (
              <div className="m-5 flex min-h-[520px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                  <Wand2 className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">等待生成运营内容</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  先填写左侧商品信息。为了控制成本，建议卖点和竞品描述写重点，不需要粘贴整页商品详情。
                </p>
                <div className="mt-5 grid w-full max-w-lg gap-2 sm:grid-cols-3">
                  <EmptyHint title="平台化" text="按目标平台调整表达" />
                  <EmptyHint title="可交付" text="复制和导出都可用" />
                  <EmptyHint title="可检查" text="含合规与行动计划" />
                </div>
              </div>
            ) : (
              <div className="grid gap-4 p-5">
                {resultLabels.map((section) => (
                  <ResultSection
                    key={section.key}
                    title={section.title}
                    description={section.description}
                    value={result[section.key]}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-center text-sm leading-6 text-slate-500">
          生成内容仅供运营参考，请根据平台规则、商品真实情况和广告法要求修改后使用。
        </footer>
      </div>
    </main>
  );
}

function StatusPill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-teal-700">{icon}</span>
      <span className="font-medium">{label}</span>
    </div>
  );
}

function FormBlock({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-md bg-teal-50 text-teal-700">
          <Layers3 className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function EmptyHint({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-left">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{text}</p>
    </div>
  );
}

type TextInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  limit: number;
  required?: boolean;
  error?: string;
  placeholder?: string;
};

function TextInput({ label, value, onChange, limit, required, error, placeholder }: TextInputProps) {
  const length = getTextLength(value);

  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold text-slate-800">
        <span>{label}{required ? <span className="text-red-500"> *</span> : null}</span>
        <span className={length > limit ? "text-red-600" : "text-slate-400"}>{length}/{limit}</span>
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
      />
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </label>
  );
}

type TextareaInputProps = TextInputProps;

function TextareaInput({ label, value, onChange, limit, required, error, placeholder }: TextareaInputProps) {
  const length = getTextLength(value);

  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold text-slate-800">
        <span>{label}{required ? <span className="text-red-500"> *</span> : null}</span>
        <span className={length > limit ? "text-red-600" : "text-slate-400"}>{length}/{limit}</span>
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
      />
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </label>
  );
}

type SelectInputProps<T extends readonly string[]> = {
  label: string;
  value: string;
  options: T;
  onChange: (value: T[number]) => void;
  required?: boolean;
  error?: string;
};

function SelectInput<T extends readonly string[]>({ label, value, options, onChange, required, error }: SelectInputProps<T>) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-800">
        {label}{required ? <span className="text-red-500"> *</span> : null}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T[number])}
        className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </label>
  );
}

type SegmentedInputProps<T extends readonly string[]> = {
  label: string;
  value: string;
  options: T;
  onChange: (value: T[number]) => void;
  required?: boolean;
  error?: string;
};

function SegmentedInput<T extends readonly string[]>({ label, value, options, onChange, required, error }: SegmentedInputProps<T>) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-slate-800">
        {label}{required ? <span className="text-red-500"> *</span> : null}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = value === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={`h-10 rounded-md border px-3 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 ${
                isSelected
                  ? "border-teal-600 bg-teal-600 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:text-teal-700"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </fieldset>
  );
}
