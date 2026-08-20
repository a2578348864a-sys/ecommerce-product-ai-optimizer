"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Check,
  Copy,
  FileCheck2,
  FileJson,
  FileText,
  MoreHorizontal,
  PencilLine,
  Trash2,
  WandSparkles,
} from "lucide-react";
import {
  buildAccessHeaders,
  isAuthenticated,
  updateDemoAccessSnapshot,
  type DemoAccessInfo,
} from "@/lib/client/accessToken";
import {
  getOrCreateStudioAttempt,
  shouldRetainStudioAttempt,
  type StudioAttempt,
} from "@/lib/client/studioIdempotency";
import {
  buildStudioListingRequestCore,
  EMPTY_LISTING_INTENT,
  type ListingFormIntent,
} from "@/lib/client/studioListingRequest";
import type { StudioListingPreferences } from "@/lib/studioListingInput";
import {
  buildListingGenerationReadiness,
  buildListingJsonExport,
  buildListingTxtExport,
} from "@/lib/listingStudioReview";
import {
  ListingResultWorkspace,
  type CopySection,
  type CopyStyle,
  type ListingPack,
  type StudioMode,
} from "@/components/listing-studio/ListingResultWorkspace";
import styles from "@/components/listing-studio/ListingStudioPolish.module.css";
import { createBrowserUuid } from "@/lib/browserUuid";
import { useSessionDraft } from "@/lib/client/useSessionDraft";
import { TaskStudioPreparation } from "@/components/studio/TaskStudioPreparation";
import { ListingHandoffSection } from "@/components/listing-handoff/ListingHandoffSection";
import { studioApiErrorCode, studioErrorMessage } from "@/lib/client/studioErrorMessage";
import { StudioProgressRail } from "@/components/studio/StudioProgressRail";
import { deriveListingStudioProgress } from "@/lib/client/studioProgress";
import { readJsonApiResponse } from "@/lib/client/safeApiResponse";
import { copyPlainText } from "@/lib/client/copyPlainText";

type StudioData = {
  listingPack: ListingPack;
  meta: {
    mode: StudioMode;
    saved: boolean;
    duplicate: boolean;
    input: StudioListingPreferences;
  };
};

const COPY_STYLES: Array<{ value: CopyStyle; label: string }> = [
  { value: "professional", label: "专业型" },
  { value: "conversion", label: "高转化型" },
  { value: "concise", label: "简洁型" },
  { value: "brand", label: "品牌型" },
];

const LISTING_OBJECTIVES: Array<{
  value: ListingFormIntent["listingObjective"];
  label: string;
}> = [
  { value: "balanced", label: "均衡" },
  { value: "seo", label: "SEO 优先" },
  { value: "conversion", label: "转化表达" },
  { value: "brand", label: "品牌一致" },
];

function apiErrorCode(json: unknown): string | null {
  return studioApiErrorCode(json);
}

function errorMessage(json: unknown, fallback: string): string {
  return studioErrorMessage(json, fallback);
}

function SectionHeading({
  index,
  title,
  description,
}: {
  index: string;
  title: string;
  description: string;
}) {
  return (
    <div className={styles.sectionHeading}>
      <span className={styles.sectionIndex} aria-hidden="true">{index}</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

function FieldLabel({
  htmlFor,
  children,
  optional = false,
}: {
  htmlFor: string;
  children: string;
  optional?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="studio-label">
      <span>{children}</span>
      {optional ? <span className={styles.optional}>辅助</span> : null}
    </label>
  );
}

type ManualListingDraft = {
  productName: string;
  description: string;
  category: string;
  intent: ListingFormIntent;
  factsConfirmed: boolean;
};

const EMPTY_MANUAL_LISTING_DRAFT: ManualListingDraft = {
  productName: "",
  description: "",
  category: "",
  intent: EMPTY_LISTING_INTENT,
  factsConfirmed: false,
};

export function ListingStudioClient({ taskId = "" }: { taskId?: string }) {
  const [progressInput, setProgressInput] = useState({
    briefReady: false,
    isGenerating: false,
    hasResult: false,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const handleTaskReady = useCallback((briefReady: boolean) => {
    setProgressInput((current) => ({ ...current, briefReady }));
  }, []);
  const handleTaskCommitted = useCallback(() => {
    // 创作资料确认成功（含原地事实补充）→ 通知 ListingHandoffSection 重读服务端状态
    setRefreshKey((current) => current + 1);
  }, []);
  const handleTaskProgress = useCallback((state: { isGenerating: boolean; hasResult: boolean }) => {
    setProgressInput((current) => ({ ...current, ...state }));
  }, []);
  const handleManualProgress = useCallback((state: {
    briefReady: boolean;
    isGenerating: boolean;
    hasResult: boolean;
  }) => setProgressInput(state), []);
  const progressRail = (
    <StudioProgressRail
      label="Listing 制作进度"
      steps={deriveListingStudioProgress(progressInput)}
    />
  );

  if (taskId) {
    // P1-UI-01：与 ImageStudioClient 同构修复——单一 wrapper 作为 .main grid 唯一子项，
    // 内部正常文档流（rail → banner → content），防止 rail 布局盒被父 grid 压缩。
    return (
      <div data-testid="listing-studio-task-flow" className="studio-main-flow">
        {progressRail}
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700" data-testid="listing-mode-task-linked">
          来自研究记录（TASK-LINKED）· 事实来自商品研究确认
        </div>
        <TaskStudioPreparation taskId={taskId} kind="listing" onReadyChange={handleTaskReady} onCommitted={handleTaskCommitted}>
          <div className="surface-card p-4" data-testid="listing-studio-task-mode">
            <ListingHandoffSection taskId={taskId} onProgressChange={handleTaskProgress} refreshSignal={refreshKey} />
          </div>
        </TaskStudioPreparation>
      </div>
    );
  }
  return (
    <div data-testid="listing-studio-standalone-flow" className="studio-main-flow">
      {progressRail}
      <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600" data-testid="listing-mode-standalone">
        独立工具（STANDALONE）· 资料由你提供，未经商品研究验证
      </div>
      <ManualListingStudioClient onProgressChange={handleManualProgress} />
    </div>
  );
}

function ManualListingStudioClient({ onProgressChange }: {
  onProgressChange: (state: { briefReady: boolean; isGenerating: boolean; hasResult: boolean }) => void;
}) {
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [intent, setIntent] = useState<ListingFormIntent>(EMPTY_LISTING_INTENT);
  const [mode, setMode] = useState<StudioMode>("mock");
  const [realConfirmed, setRealConfirmed] = useState(false);
  const [factsConfirmed, setFactsConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StudioData | null>(null);
  const [error, setError] = useState("");
  const [copiedSection, setCopiedSection] = useState<CopySection | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [studioMounted, setStudioMounted] = useState(false);
  const productNameRef = useRef<HTMLInputElement>(null);
  const realAttemptRef = useRef<StudioAttempt | null>(null);
  const restoredDraftRef = useRef(false);
  const sessionDraft = useSessionDraft<ManualListingDraft>({
    pageKind: "listing-studio-manual",
    entityId: "manual",
    revision: "studio-creative-brief.v1",
    initial: EMPTY_MANUAL_LISTING_DRAFT,
  });

  useEffect(() => {
    setStudioMounted(true);
    setAuthenticated(isAuthenticated());
  }, []);
  useEffect(() => {
    if (!sessionDraft.draft || restoredDraftRef.current) return;
    restoredDraftRef.current = true;
    setProductName(sessionDraft.draft.productName);
    setDescription(sessionDraft.draft.description);
    setCategory(sessionDraft.draft.category);
    setIntent({ ...EMPTY_LISTING_INTENT, ...sessionDraft.draft.intent });
    setFactsConfirmed(sessionDraft.draft.factsConfirmed === true);
  }, [sessionDraft.draft]);

  useEffect(() => {
    sessionDraft.save({ productName, description, category, intent, factsConfirmed });
  }, [productName, description, category, intent, factsConfirmed, sessionDraft]);

  const updateIntent = useCallback((field: keyof ListingFormIntent, value: string) => {
    setIntent((current) => ({ ...current, [field]: value } as ListingFormIntent));
    setFactsConfirmed(false);
  }, []);

  const requestPreview = buildStudioListingRequestCore({
    productName,
    description,
    category,
    intent,
    mode,
  });
  const readinessPreferences: StudioListingPreferences = {
    targetMarket: requestPreview.targetMarket,
    outputLanguage: requestPreview.outputLanguage,
    tone: requestPreview.tone,
    listingObjective: requestPreview.listingObjective,
    coreFunction: requestPreview.coreFunction,
    targetAudience: requestPreview.targetAudience,
    problemSolved: requestPreview.problemSolved,
    differentiators: requestPreview.differentiators,
    primaryKeywords: requestPreview.primaryKeywords,
    secondaryKeywords: requestPreview.secondaryKeywords,
    competitorKeywords: requestPreview.competitorKeywords,
    confirmedFacts: requestPreview.confirmedFacts,
    unverifiedFacts: requestPreview.unverifiedFacts,
    prohibitedClaims: requestPreview.prohibitedClaims,
    additionalRequirements: requestPreview.additionalRequirements,
  };
  const readiness = buildListingGenerationReadiness({
    productName: requestPreview.productName,
    description: requestPreview.description,
    preferences: readinessPreferences,
  });
  const missingReadinessLabels = readiness.checks
    .filter((check) => !check.complete)
    .map((check) => check.label);

  const canGenerate = authenticated
    && productName.trim().length > 0
    && factsConfirmed
    && (mode === "mock" || realConfirmed);

  useEffect(() => {
    onProgressChange({
      briefReady: canGenerate,
      isGenerating: loading,
      hasResult: result !== null,
    });
  }, [canGenerate, loading, onProgressChange, result]);

  const handleGenerate = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!canGenerate || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    setCopiedSection(null);
    try {
      const requestCore = buildStudioListingRequestCore({
        productName,
        description,
        category,
        intent,
        mode,
      });
      const attempt = mode === "real"
        ? getOrCreateStudioAttempt(
            realAttemptRef.current,
            JSON.stringify(requestCore),
            () => createBrowserUuid(),
          )
        : null;
      if (attempt) realAttemptRef.current = attempt;
      const requestBody = {
        ...requestCore,
        ...(attempt ? { confirmRealAi: true, idempotencyKey: attempt.idempotencyKey } : {}),
      };
      const response = await fetch("/api/listing-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify(requestBody),
      });
      const parsedResponse = await readJsonApiResponse(response);
      const json: unknown = parsedResponse.ok
        ? parsedResponse.payload
        : { error: parsedResponse.error };
      if (
        !response.ok
        || !json
        || typeof json !== "object"
        || !("ok" in json)
        || json.ok !== true
        || !("data" in json)
      ) {
        if (mode === "real" && !shouldRetainStudioAttempt(apiErrorCode(json))) {
          realAttemptRef.current = null;
        }
        if (typeof json === "object" && json && "demoAccess" in json) {
          updateDemoAccessSnapshot((json as { demoAccess: DemoAccessInfo }).demoAccess);
        }
        setError(errorMessage(json, "生成失败，请稍后重试。"));
        return;
      }
      if (mode === "real") realAttemptRef.current = null;
      if ("demoAccess" in json && json.demoAccess) {
        updateDemoAccessSnapshot(json.demoAccess as DemoAccessInfo);
      }
      setResult((json as { data: StudioData }).data);
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [
    canGenerate,
    loading,
    productName,
    description,
    category,
    intent,
    mode,
  ]);

  const copyText = useCallback(async (text: string, section: CopySection) => {
    if (!text.trim()) return;
    try {
      const copied = await copyPlainText(text);
      if (!copied) throw new Error("copy_unavailable");
      setCopiedSection(section);
      window.setTimeout(() => {
        setCopiedSection((current) => current === section ? null : current);
      }, 2_000);
    } catch {
      setError("复制失败，请手动选择结果文本。");
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (!result?.listingPack) return;
    const listing = result.listingPack;
    const text = [
      listing.titles?.[0] ? `Title: ${listing.titles[0]}` : "",
      listing.bullets?.length
        ? `Bullet Points:\n${listing.bullets.map((bullet) => `  • ${bullet}`).join("\n")}`
        : "",
      listing.description ? `Description: ${listing.description}` : "",
      listing.keywords?.length ? `Search Terms: ${listing.keywords.join(", ")}` : "",
    ].filter(Boolean).join("\n\n");
    await copyText(text, "all");
  }, [copyText, result]);

  const handleExport = useCallback((format: "txt" | "json") => {
    if (!result?.listingPack) return;
    try {
      const content = format === "txt"
        ? buildListingTxtExport(result.listingPack)
        : buildListingJsonExport(result.listingPack);
      const safeBaseName = productName
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "listing";
      const blob = new Blob(
        [format === "txt" ? "\uFEFF" : "", content],
        { type: format === "txt" ? "text/plain;charset=utf-8" : "application/json;charset=utf-8" },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeBaseName}.${format}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("导出失败，请重试或使用复制功能。");
    }
  }, [productName, result]);

  const clearStudio = useCallback(() => {
    setProductName("");
    setDescription("");
    setCategory("");
    setIntent({ ...EMPTY_LISTING_INTENT });
    setMode("mock");
    setRealConfirmed(false);
    setFactsConfirmed(false);
    setResult(null);
    setError("");
    setCopiedSection(null);
    realAttemptRef.current = null;
    sessionDraft.clear();
  }, [sessionDraft]);

  const returnToEdit = useCallback(() => {
    productNameRef.current?.focus({ preventScroll: true });
    productNameRef.current?.scrollIntoView({ block: "center" });
  }, []);

  const hasStudioContent = Boolean(
    result
    || productName
    || description
    || category
    || intent.coreFunctions
    || intent.targetAudience
    || intent.problemsSolved
    || intent.differentiators
    || intent.primaryKeyword
    || intent.secondaryKeywords
    || intent.competitorKeywords
    || intent.confirmedFacts
    || intent.unverifiedFacts
    || intent.prohibitedClaims
    || intent.additionalRequirements,
  );

  return (
    <div className={`studio-layout listing-studio-workbench min-w-0 ${styles.workbench}`}>
      <form
        className={`studio-input-card studio-form listing-input-panel min-w-0 ${styles.inputPanel}`}
        onSubmit={handleGenerate}
      >
        <div className={styles.inputPanelHeader}>
          <div>
            <p className={styles.panelKicker}>Product facts</p>
            <h2 className="studio-panel-title">商品事实输入</h2>
            <p className="studio-helper">结构化输入用于工作台辅助；Mock 不调用真实 AI。</p>
          </div>
          <span className={styles.localOnlyBadge}>字段参与生成</span>
        </div>

        <div className={styles.formBody}>
          {studioMounted && sessionDraft.restored ? (
            <p className={`studio-login-notice ${styles.formNotice}`} data-testid="listing-session-restored">
              已恢复本次登录身份在此标签页中的未提交草稿。
            </p>
          ) : studioMounted && sessionDraft.invalidated ? (
            <p className={`studio-login-notice ${styles.formNotice}`}>
              旧版草稿已失效，请重新确认商品资料。
            </p>
          ) : null}

          <section className={styles.sectionGroup} aria-labelledby="listing-basic-heading">
            <div id="listing-basic-heading">
              <SectionHeading
                index="01"
                title="商品基础"
                description="先记录可以被人工核对的商品事实。"
              />
            </div>
            <div className={styles.fieldGrid}>
              <div className={`${styles.field} ${styles.fieldWide}`}>
                <FieldLabel htmlFor="listing-product-name">商品名称 *</FieldLabel>
                <input
                  ref={productNameRef}
                  id="listing-product-name"
                  name="productName"
                  autoComplete="off"
                  required
                  maxLength={200}
                  className={`studio-control ${styles.control}`}
                  placeholder="例如：Foldable Laptop Stand…"
                  value={productName}
                  onChange={(event) => { setProductName(event.target.value); setFactsConfirmed(false); }}
                />
              </div>
              <div className={styles.field}>
                <FieldLabel htmlFor="listing-category">商品类别</FieldLabel>
                <input
                  id="listing-category"
                  name="category"
                  autoComplete="off"
                  maxLength={200}
                  className={`studio-control ${styles.control}`}
                  placeholder="例如：Home Office…"
                  value={category}
                  onChange={(event) => { setCategory(event.target.value); setFactsConfirmed(false); }}
                />
              </div>
              <div className={styles.field}>
                <FieldLabel htmlFor="listing-target-market" optional>目标市场</FieldLabel>
                <select
                  id="listing-target-market"
                  name="targetMarket"
                  className={`studio-control ${styles.control}`}
                  value={intent.targetMarket}
                  onChange={(event) => updateIntent("targetMarket", event.target.value)}
                >
                  <option value="US">美国（US）</option>
                  <option value="UK">英国（UK）</option>
                  <option value="DE">德国（DE）</option>
                  <option value="CA">加拿大（CA）</option>
                </select>
              </div>
              <div className={`${styles.field} ${styles.fieldWide}`}>
                <FieldLabel htmlFor="listing-description">商品描述</FieldLabel>
                <textarea
                  id="listing-description"
                  name="description"
                  autoComplete="off"
                  maxLength={1000}
                  className={`studio-control ${styles.control} ${styles.compactTextarea}`}
                  rows={3}
                  placeholder="简要描述材质、规格、用途和需要确认的信息…"
                  value={description}
                  onChange={(event) => { setDescription(event.target.value); setFactsConfirmed(false); }}
                />
              </div>
              <div className={styles.field}>
                <FieldLabel htmlFor="listing-output-language" optional>输出语言</FieldLabel>
                <select
                  id="listing-output-language"
                  name="outputLanguage"
                  className={`studio-control ${styles.control}`}
                  value={intent.outputLanguage}
                  onChange={(event) => updateIntent("outputLanguage", event.target.value)}
                >
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                </select>
              </div>
            </div>
          </section>

          <section className={styles.sectionGroup} aria-labelledby="listing-facts-heading">
            <div id="listing-facts-heading">
              <SectionHeading
                index="02"
                title="事实可信度"
                description="把可用于文案的事实与待确认信息分开，禁止声明会被逐字拦截。"
              />
            </div>
            <div className={styles.fieldGrid}>
              <div className={`${styles.field} ${styles.fieldWide}`}>
                <FieldLabel htmlFor="listing-confirmed-facts">已确认事实</FieldLabel>
                <textarea
                  id="listing-confirmed-facts"
                  name="confirmedFacts"
                  autoComplete="off"
                  maxLength={3600}
                  rows={3}
                  className={`studio-control ${styles.control}`}
                  placeholder="每行一项，例如：铝合金框架、可折叠结构…"
                  value={intent.confirmedFacts}
                  onChange={(event) => updateIntent("confirmedFacts", event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <FieldLabel htmlFor="listing-unverified-facts" optional>待人工确认事实</FieldLabel>
                <textarea
                  id="listing-unverified-facts"
                  name="unverifiedFacts"
                  autoComplete="off"
                  maxLength={3600}
                  rows={3}
                  className={`studio-control ${styles.control}`}
                  placeholder="每行一项；只进入风险提示，不进入商业文案…"
                  value={intent.unverifiedFacts}
                  onChange={(event) => updateIntent("unverifiedFacts", event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <FieldLabel htmlFor="listing-prohibited-claims">禁止生成的声明</FieldLabel>
                <textarea
                  id="listing-prohibited-claims"
                  name="prohibitedClaims"
                  autoComplete="off"
                  maxLength={2400}
                  rows={3}
                  className={`studio-control ${styles.control}`}
                  placeholder="每行一项，例如：军用级、保证第一…"
                  value={intent.prohibitedClaims}
                  onChange={(event) => updateIntent("prohibitedClaims", event.target.value)}
                />
              </div>
            </div>
            <p className={`studio-login-notice ${styles.formNotice}`} data-testid="listing-readiness">
              <strong>
                信息完整度 {readiness.completedCount}/{readiness.totalCount} · {readiness.completionPercent}%
              </strong>
              {" "}
              <span>
                {readiness.ready
                  ? "关键输入已齐；生成结果仍须人工复核。"
                  : `建议补充：${missingReadinessLabels.join("、")}。不阻断 Mock 预览。`}
              </span>
            </p>
          </section>

          <section className={styles.sectionGroup} aria-labelledby="listing-selling-heading">
            <div id="listing-selling-heading">
              <SectionHeading
                index="03"
                title="商品卖点"
                description="区分功能、受众、问题和差异化，减少空泛表达。"
              />
            </div>
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <FieldLabel htmlFor="listing-core-functions" optional>核心功能</FieldLabel>
                <textarea
                  id="listing-core-functions"
                  name="coreFunctions"
                  autoComplete="off"
                  maxLength={600}
                  rows={2}
                  className={`studio-control ${styles.control}`}
                  placeholder="例如：六档高度调节…"
                  value={intent.coreFunctions}
                  onChange={(event) => updateIntent("coreFunctions", event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <FieldLabel htmlFor="listing-target-audience" optional>目标用户</FieldLabel>
                <textarea
                  id="listing-target-audience"
                  name="targetAudience"
                  autoComplete="off"
                  maxLength={400}
                  rows={2}
                  className={`studio-control ${styles.control}`}
                  placeholder="例如：居家办公用户…"
                  value={intent.targetAudience}
                  onChange={(event) => updateIntent("targetAudience", event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <FieldLabel htmlFor="listing-problems-solved" optional>解决问题</FieldLabel>
                <textarea
                  id="listing-problems-solved"
                  name="problemsSolved"
                  autoComplete="off"
                  maxLength={600}
                  rows={2}
                  className={`studio-control ${styles.control}`}
                  placeholder="例如：桌面拥挤、视线过低…"
                  value={intent.problemsSolved}
                  onChange={(event) => updateIntent("problemsSolved", event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <FieldLabel htmlFor="listing-selling-points">差异化卖点</FieldLabel>
                <textarea
                  id="listing-selling-points"
                  name="sellingPoints"
                  autoComplete="off"
                  maxLength={1000}
                  rows={2}
                  className={`studio-control ${styles.control}`}
                  placeholder="逗号分隔，如：轻便、可折叠…"
                  value={intent.differentiators}
                  onChange={(event) => updateIntent("differentiators", event.target.value)}
                />
              </div>
            </div>
          </section>

          <section className={styles.sectionGroup} aria-labelledby="listing-seo-heading">
            <div id="listing-seo-heading">
              <SectionHeading
                index="04"
                title="SEO 设置"
                description="主词和次词参与生成；竞品词只作研究参考，不进入文案。"
              />
            </div>
            <div className={styles.fieldGrid}>
              <div className={`${styles.field} ${styles.fieldWide}`}>
                <FieldLabel htmlFor="listing-primary-keyword" optional>主关键词</FieldLabel>
                <input
                  id="listing-primary-keyword"
                  name="primaryKeyword"
                  autoComplete="off"
                  maxLength={200}
                  className={`studio-control ${styles.control}`}
                  placeholder="例如：foldable laptop stand…"
                  value={intent.primaryKeyword}
                  onChange={(event) => updateIntent("primaryKeyword", event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <FieldLabel htmlFor="listing-secondary-keywords" optional>次关键词</FieldLabel>
                <textarea
                  id="listing-secondary-keywords"
                  name="secondaryKeywords"
                  autoComplete="off"
                  maxLength={600}
                  rows={2}
                  className={`studio-control ${styles.control}`}
                  placeholder="逗号分隔…"
                  value={intent.secondaryKeywords}
                  onChange={(event) => updateIntent("secondaryKeywords", event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <FieldLabel htmlFor="listing-competitor-keywords" optional>竞品关键词</FieldLabel>
                <textarea
                  id="listing-competitor-keywords"
                  name="competitorKeywords"
                  autoComplete="off"
                  maxLength={600}
                  rows={2}
                  className={`studio-control ${styles.control}`}
                  placeholder="仅作人工参考，逗号分隔…"
                  value={intent.competitorKeywords}
                  onChange={(event) => updateIntent("competitorKeywords", event.target.value)}
                />
              </div>
            </div>
          </section>

          <section className={styles.sectionGroup} aria-labelledby="listing-objective-heading">
            <div id="listing-objective-heading">
              <SectionHeading
                index="05"
                title="Listing 目标"
                description="目标只调整表达重点，不代表排名、曝光或转化承诺。"
              />
            </div>
            <div className={styles.styleGrid} role="radiogroup" aria-label="Listing 目标">
              {LISTING_OBJECTIVES.map((objective) => (
                <label
                  key={objective.value}
                  className={styles.styleOption}
                  data-selected={intent.listingObjective === objective.value}
                >
                  <input
                    type="radio"
                    name="listingObjective"
                    value={objective.value}
                    checked={intent.listingObjective === objective.value}
                    onChange={() => updateIntent("listingObjective", objective.value)}
                  />
                  <span>{objective.label}</span>
                </label>
              ))}
            </div>
            <p className="studio-helper">
              “SEO 优先”和“转化表达”仅控制 Mock 模板与受控 Real 上下文的写作侧重。
            </p>
          </section>

          <section className={styles.sectionGroup} aria-labelledby="listing-style-heading">
            <div id="listing-style-heading">
              <SectionHeading
                index="06"
                title="文案风格"
                description="所选风格会进入 Mock 模板和受控 Real AI 上下文。"
              />
            </div>
            <div className={styles.styleGrid} role="radiogroup" aria-label="文案风格">
              {COPY_STYLES.map((style) => (
                <label
                  key={style.value}
                  className={styles.styleOption}
                  data-selected={intent.copyStyle === style.value}
                >
                  <input
                    type="radio"
                    name="copyStyle"
                    value={style.value}
                    checked={intent.copyStyle === style.value}
                    onChange={() => updateIntent("copyStyle", style.value)}
                  />
                  <span>{style.label}</span>
                </label>
              ))}
            </div>
          </section>

          <section className={styles.sectionGroup} aria-labelledby="listing-extra-heading">
            <div id="listing-extra-heading">
              <SectionHeading
                index="07"
                title="额外创作要求"
                description="补充长度、结构或表达要求；不得用来覆盖事实与禁止声明。"
              />
            </div>
            <div className={styles.field}>
              <FieldLabel htmlFor="listing-additional-requirements" optional>额外要求</FieldLabel>
              <textarea
                id="listing-additional-requirements"
                name="additionalRequirements"
                maxLength={1000}
                rows={3}
                className={`studio-control ${styles.control}`}
                placeholder="例如：每条 Bullet 控制在 180 字符以内，避免夸张语气…"
                value={intent.additionalRequirements}
                onChange={(event) => updateIntent("additionalRequirements", event.target.value)}
              />
            </div>
          </section>

          <label className="studio-warning listing-real-warning" data-testid="listing-facts-confirmation">
            <input
              type="checkbox"
              checked={factsConfirmed}
              onChange={(event) => setFactsConfirmed(event.target.checked)}
            />
            <span>以上商品事实由我提供或确认，仅用于生成草稿，最终仍需人工复核。</span>
          </label>

          <section className={`${styles.sectionGroup} ${styles.modeSection}`}>
            <fieldset className={`listing-mode-fieldset ${styles.modeFieldset}`}>
              <legend className="sr-only">生成模式</legend>
              <SectionHeading
                index="08"
                title="生成模式"
                description="默认使用 Mock 验收，不调用 Provider。"
              />
              <div className="studio-mode-grid listing-mode-selector">
                {(["mock", "real"] as const).map((value) => (
                  <label key={value} className="studio-mode-option" data-selected={mode === value}>
                    <input
                      type="radio"
                      name="listingMode"
                      value={value}
                      checked={mode === value}
                      onChange={() => {
                        setMode(value);
                        realAttemptRef.current = null;
                        setRealConfirmed(false);
                        setError("");
                      }}
                    />
                    <span className="listing-mode-copy">
                      <span className="listing-mode-title">
                        {value === "mock" ? "Mock 预览" : "Real AI"}
                        {mode === value ? <Check aria-hidden="true" className="size-3.5" /> : null}
                      </span>
                      <span className="studio-mode-description">
                        {value === "mock" ? "免费，不调用 Provider" : "可能消耗 Visitor 额度"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {mode === "real" ? (
              <label className="studio-warning listing-real-warning">
                <input
                  type="checkbox"
                  checked={realConfirmed}
                  onChange={(event) => setRealConfirmed(event.target.checked)}
                />
                <span>我确认本次会调用真实 AI，可能消耗额度；结果仍须人工复核。</span>
              </label>
            ) : null}
          </section>

          <div className={styles.actions}>
            <button
              type="submit"
              disabled={!canGenerate || loading}
              className="linear-button-primary listing-primary-button w-full"
            >
              <span className="listing-primary-button-label">
                {loading
                  ? <span className="listing-button-spinner" aria-hidden="true" />
                  : <WandSparkles aria-hidden="true" className="size-4" />}
                {loading ? "生成中…" : mode === "mock" ? "生成 Mock 草稿" : "确认并调用真实 AI"}
              </span>
            </button>
            {!authenticated ? <p className="studio-login-notice">请先登录后再使用 Studio。</p> : null}
          </div>
        </div>
      </form>

      <section
        className={`studio-result-card listing-result-panel min-w-0 ${styles.resultPanel}`}
        aria-live="polite"
        aria-busy={loading}
      >
        <div className={`studio-result-header listing-result-header ${styles.resultHeader}`}>
          <div className="listing-result-heading">
            <div>
              <p className={styles.panelKicker}>Review & optimize</p>
              <h2 className="studio-panel-title">Listing 工作区</h2>
            </div>
            {result ? (
              <span className="studio-result-status">
                {result.meta.mode === "mock"
                  ? "Mock · 未调用 AI"
                  : result.meta.duplicate ? "Real AI · 幂等重放" : "Real AI · 已受控调用"}
              </span>
            ) : <span className="listing-result-subtitle">等待生成内容</span>}
          </div>
          <div
            className={`studio-result-toolbar listing-toolbar-desktop ${styles.toolbar}`}
            aria-label="结果工具栏"
          >
            <button
              type="button"
              className="studio-toolbar-button"
              onClick={handleCopy}
              disabled={!result}
              title={result ? "复制全部 Listing 结果" : "生成结果后可复制"}
            >
              {copiedSection === "all"
                ? <Check aria-hidden="true" className="size-3.5" />
                : <Copy aria-hidden="true" className="size-3.5" />}
              {copiedSection === "all" ? "已复制" : "复制全部"}
            </button>
            <button
              type="button"
              className="studio-toolbar-button"
              onClick={() => handleExport("txt")}
              disabled={!result}
              title={result ? "下载纯文本 Listing" : "生成结果后可导出"}
            >
              <FileText aria-hidden="true" className="size-3.5" />
              导出 TXT
            </button>
            <button
              type="button"
              className="studio-toolbar-button"
              onClick={() => handleExport("json")}
              disabled={!result}
              title={result ? "下载结构化 Listing JSON" : "生成结果后可导出"}
            >
              <FileJson aria-hidden="true" className="size-3.5" />
              导出 JSON
            </button>
            <button
              type="button"
              className={`studio-toolbar-button ${styles.editAction}`}
              onClick={returnToEdit}
              title="返回商品事实输入"
            >
              <PencilLine aria-hidden="true" className="size-3.5" />
              重新编辑
            </button>
            <button
              type="button"
              className="studio-toolbar-button studio-danger-action"
              onClick={clearStudio}
              disabled={!hasStudioContent}
              title={hasStudioContent ? "清空全部输入与当前结果" : "当前没有可清空的内容"}
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              清空
            </button>
          </div>
          <details className="listing-mobile-actions">
            <summary aria-label="打开结果操作">
              <MoreHorizontal aria-hidden="true" className="size-4" />
              操作
            </summary>
            <div className="listing-mobile-actions-menu">
              <button type="button" onClick={handleCopy} disabled={!result}>
                <Copy aria-hidden="true" className="size-4" />
                {copiedSection === "all" ? "已复制全部" : "复制全部"}
              </button>
              <button type="button" onClick={() => handleExport("txt")} disabled={!result}>
                <FileText aria-hidden="true" className="size-4" />
                导出 TXT
              </button>
              <button type="button" onClick={() => handleExport("json")} disabled={!result}>
                <FileJson aria-hidden="true" className="size-4" />
                导出 JSON
              </button>
              <button type="button" onClick={returnToEdit}>
                <PencilLine aria-hidden="true" className="size-4" />
                重新编辑
              </button>
              <button
                type="button"
                className="studio-danger-action"
                onClick={clearStudio}
                disabled={!hasStudioContent}
              >
                <Trash2 aria-hidden="true" className="size-4" />
                清空
              </button>
            </div>
          </details>
        </div>

        <div className="listing-result-viewport">
          {loading ? (
            <div className={styles.loadingState}>
              <div className={styles.loadingContent}>
                <span className="studio-empty-icon">
                  <span className="listing-button-spinner" aria-hidden="true" />
                </span>
                <h3>正在生成 Listing 草稿</h3>
                <p>Mock 模式只生成本地验收结果，请保持页面打开。</p>
              </div>
            </div>
          ) : error ? (
            <div className={styles.errorState} role="alert">
              <div className={styles.errorContent}>
                <h3>生成未完成</h3>
                <p>{error}</p>
                <button type="button" className="studio-toolbar-button" onClick={returnToEdit}>
                  返回输入检查
                </button>
              </div>
            </div>
          ) : result ? (
            <div className="listing-result-modules-frame">
              <ListingResultWorkspace
                listingPack={result.listingPack}
                preferences={result.meta.input}
                mode={result.meta.mode}
                copiedSection={copiedSection}
                onCopy={copyText}
              />
            </div>
          ) : (
            <div className={`listing-empty-state ${styles.emptyState}`}>
              <div className={styles.emptyContent}>
                <span className="studio-empty-icon">
                  <FileCheck2 aria-hidden="true" className="size-6" />
                </span>
                <h3>从商品事实开始</h3>
                <p>生成后，这里会按标题、Bullet Points、Description、Search Terms 和 AI Review 分区展示。</p>
                <div className={styles.emptySteps} aria-label="结果工作区模块">
                  <span>生成草稿</span>
                  <span>本地检查</span>
                  <span>人工复核</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
