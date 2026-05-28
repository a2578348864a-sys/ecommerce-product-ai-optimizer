"use client";

import { AlertCircle, ClipboardList, Lock, RefreshCcw, Wand2 } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
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

export default function HomePage() {
  const [form, setForm] = useState<ProductInput>(emptyForm);
  const [accessPassword, setAccessPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [result, setResult] = useState<GeneratedContent | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const savedPassword = window.sessionStorage.getItem("app_access_password");
    if (savedPassword) {
      setAccessPassword(savedPassword);
    }
  }, []);

  const allResultText = useMemo(() => (result ? resultToText(result) : ""), [result]);

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

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white/90 px-5 py-5 shadow-soft backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-teal-700">Ecommerce AI Workspace</p>
            <h1 className="mt-2 text-3xl font-bold tracking-normal text-slate-950 sm:text-4xl">
              电商商品页 AI 优化器
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
              输入商品信息，一键生成标题、详情页、短视频脚本、客服话术和差评回复。
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-800">
            <ClipboardList className="h-5 w-5 flex-none" />
            <span>适合商品上新、页面改版和投放测试前使用</span>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div className="mb-5 flex items-center justify-between gap-3">
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

            <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
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

            <div className="mt-4 grid gap-4">
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
          </form>

          <section className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-soft backdrop-blur">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">生成结果</h2>
                <p className="mt-1 text-sm text-slate-500">每个模块都可以单独复制，也可以一次复制全部。</p>
              </div>
              <CopyButton text={allResultText} label="复制全部" className={!result ? "pointer-events-none opacity-45" : ""} />
            </div>

            {!result ? (
              <div className="flex min-h-[520px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
                <Wand2 className="h-10 w-10 text-teal-600" />
                <h3 className="mt-4 text-lg font-semibold text-slate-950">等待生成运营内容</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  先填写左侧商品信息。为了控制成本，建议卖点和竞品描述写重点，不需要粘贴整页商品详情。
                </p>
              </div>
            ) : (
              <div className="grid gap-4">
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
