"use client";

import React, { useState, useEffect, useId, useRef } from "react";
import type {
  ReferenceDraftReadiness,
  ReferenceListingDraft,
  ReferenceMaterialItem,
  ExcludedMaterialItem,
  StoredReferenceDraftState,
  DraftGenerationSnapshot,
} from "@/lib/referenceListingDraft/referenceDraftContract";

function safeLocalStorageGet(key: string): string | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, val: string): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    window.localStorage.setItem(key, val);
    return true;
  } catch {
    return false;
  }
}

function safeLocalStorageRemove(key: string): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export function ReferenceListingDraftPanel({
  taskId,
  onDraftGenerated,
}: {
  taskId: string;
  onDraftGenerated?: () => void;
}) {
  const panelId = useId();
  const reqSeqRef = useRef(0);

  const [loadingReadiness, setLoadingReadiness] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [readiness, setReadiness] = useState<ReferenceDraftReadiness | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [accessSubject, setAccessSubject] = useState<string | null>(null);

  // 初稿展示与编辑状态
  const [title, setTitle] = useState("");
  const [bullets, setBullets] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [isEdited, setIsEdited] = useState(false);
  const [generationSnapshot, setGenerationSnapshot] = useState<DraftGenerationSnapshot | null>(null);

  // 交互反馈
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);

  // 1. 每次 taskId 切换或初始化时：重置状态并等待服务端鉴权
  useEffect(() => {
    const currentSeq = ++reqSeqRef.current;

    // 立即清空展示与状态，杜绝不同任务间串稿，重置 generating
    setLoadingReadiness(true);
    setGenerating(false);
    setErrorMsg(null);
    setReadiness(null);
    setAccessSubject(null);
    setTitle("");
    setBullets([]);
    setDescription("");
    setIsEdited(false);
    setGenerationSnapshot(null);

    fetch(`/api/tasks/${encodeURIComponent(taskId)}/reference-listing-draft`, {
      signal: AbortSignal.timeout(15_000),
    })
      .then(async (res) => {
        const json = await res.json();
        return { status: res.status, ok: res.ok, json };
      })
      .then(({ status, ok, json }) => {
        // 如果请求已过期（任务已切换），直接丢弃，防止晚到响应覆盖
        if (currentSeq !== reqSeqRef.current) return;

        if (!ok || !json.ok) {
          // 401 / 403 / 404 等未通过鉴权或未找到情况：清空受保护文稿，禁止编辑、复制、下载与恢复缓存
          setErrorMsg(json.error?.message || `读取参考资料准备度失败 (${status})。`);
          setTitle("");
          setBullets([]);
          setDescription("");
          setIsEdited(false);
          setGenerationSnapshot(null);
          setAccessSubject(null);
          setReadiness(null);
          return;
        }

        const data: ReferenceDraftReadiness = json.data;
        setReadiness(data);
        if (!data.accessSubject || typeof data.accessSubject !== "string" || !data.accessSubject.trim()) {
          setErrorMsg("服务端未返回有效主体授权标识，已停止缓存与展示。");
          setAccessSubject(null);
          return;
        }
        const subject = data.accessSubject.trim();
        setAccessSubject(subject);

        // 仅在服务端 200 确认有效主体授权后，才允许读取该主体和任务的本地缓存
        const storageKey = `qingxuan:ref_draft:v2:${subject}:${taskId}`;
        const cachedStr = safeLocalStorageGet(storageKey);
        if (cachedStr) {
          try {
            const cached = JSON.parse(cachedStr) as StoredReferenceDraftState;
            if (
              cached &&
              cached.schemaVersion === 2 &&
              cached.subject === subject &&
              cached.taskId === taskId
            ) {
              setTitle(cached.title || "");
              setBullets(Array.isArray(cached.bullets) ? cached.bullets : []);
              setDescription(cached.description || "");
              setIsEdited(Boolean(cached.isManuallyEdited));
              // 缓存缺少有效 generationSnapshot 时视为不完整历史稿，明确提示无法验证依据
              if (cached.generationSnapshot && Array.isArray(cached.generationSnapshot.adoptedMaterials)) {
                setGenerationSnapshot(cached.generationSnapshot);
              } else {
                setGenerationSnapshot(null);
              }
            }
          } catch (err) {
            console.warn("[reference-draft] Failed to parse cached draft v2", err);
          }
        }
      })
      .catch((err) => {
        if (currentSeq !== reqSeqRef.current) return;
        console.error("[reference-draft] fetch readiness error", err);
        setErrorMsg("网络异常或服务不可用，请稍后刷新重试。");
      })
      .finally(() => {
        if (currentSeq === reqSeqRef.current) {
          setLoadingReadiness(false);
        }
      });
  }, [taskId]);

  // 2. 用户手动编辑时更新本地暂存
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    setIsEdited(true);
    persistState({ title: newTitle, isEdited: true });
  };

  const handleBulletChange = (index: number, newBullet: string) => {
    const updated = [...bullets];
    updated[index] = newBullet;
    setBullets(updated);
    setIsEdited(true);
    persistState({ bullets: updated, isEdited: true });
  };

  const handleDescriptionChange = (newDesc: string) => {
    setDescription(newDesc);
    setIsEdited(true);
    persistState({ description: newDesc, isEdited: true });
  };

  const persistState = (overrides?: {
    title?: string;
    bullets?: string[];
    description?: string;
    isEdited?: boolean;
  }) => {
    // 严禁假定权限：无有效服务端主体停止本地持久化
    if (!accessSubject) return;
    const subject = accessSubject;
    const storageKey = `qingxuan:ref_draft:v2:${subject}:${taskId}`;

    const payload: StoredReferenceDraftState = {
      schemaVersion: 2,
      subject,
      taskId,
      asin: readiness?.asin || null,
      productName: readiness?.productName || "",
      title: overrides?.title !== undefined ? overrides.title : title,
      bullets: overrides?.bullets !== undefined ? overrides.bullets : bullets,
      description: overrides?.description !== undefined ? overrides.description : description,
      isManuallyEdited: overrides?.isEdited !== undefined ? overrides.isEdited : isEdited,
      generationSnapshot: generationSnapshot || null,
      savedAt: new Date().toISOString(),
    };

    const success = safeLocalStorageSet(storageKey, JSON.stringify(payload));
    if (!success) {
      setStorageUnavailable(true);
    }
  };

  // 3. 点击生成参考初稿
  const handleGenerate = async () => {
    setGenerating(true);
    setErrorMsg(null);
    const generateSeq = ++reqSeqRef.current;

    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/reference-listing-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      const json = await res.json();

      // 如果任务已切换，丢弃生成响应，防止覆盖新任务状态
      if (generateSeq !== reqSeqRef.current) return;

      if (res.ok && json.ok && json.data) {
        const draft: ReferenceListingDraft = json.data;
        setTitle(draft.title);
        setBullets(draft.bullets);
        setDescription(draft.description);
        setIsEdited(false);
        setGenerationSnapshot(draft.generationSnapshot);

        const subject = draft.accessSubject;
        if (!subject) {
          setErrorMsg("服务端初稿响应未包含有效主体授权，已停止持久化。");
          return;
        }
        setAccessSubject(subject);

        // 使用响应数据直接构建缓存，避免异步 state 延迟
        const payload: StoredReferenceDraftState = {
          schemaVersion: 2,
          subject,
          taskId,
          asin: draft.asin,
          productName: draft.productName,
          title: draft.title,
          bullets: draft.bullets,
          description: draft.description,
          isManuallyEdited: false,
          generationSnapshot: draft.generationSnapshot,
          savedAt: new Date().toISOString(),
        };

        const storageKey = `qingxuan:ref_draft:v2:${subject}:${taskId}`;
        const success = safeLocalStorageSet(storageKey, JSON.stringify(payload));
        if (!success) {
          setStorageUnavailable(true);
        }

        onDraftGenerated?.();
      } else {
        setErrorMsg(json.error?.message || "生成参考初稿失败。");
      }
    } catch (err) {
      if (generateSeq !== reqSeqRef.current) return;
      console.error("[reference-draft] generation error", err);
      setErrorMsg("请求超时或网络异常，请重试。");
    } finally {
      if (generateSeq === reqSeqRef.current) {
        setGenerating(false);
      }
    }
  };

  // 4. 复制整套文案到剪贴板
  const handleCopy = async () => {
    const formattedBullets = bullets.map((b, i) => `Bullet ${i + 1}: ${b}`).join("\n");
    const fullText = `Title:\n${title}\n\nKey Features:\n${formattedBullets}\n\nDescription:\n${description}`;

    try {
      await navigator.clipboard.writeText(fullText);
      setCopyFeedback("已复制整套文案到剪贴板！");
      setTimeout(() => setCopyFeedback(null), 3000);
    } catch {
      setCopyFeedback("复制失败，请手动选取复制。");
      setTimeout(() => setCopyFeedback(null), 3000);
    }
  };

  // 5. 下载 Markdown 文件（禁止用最新资料拼造依据导出）
  const handleDownloadMarkdown = () => {
    const hasValidSnapshot = Boolean(
      generationSnapshot && Array.isArray(generationSnapshot.adoptedMaterials)
    );
    const activeSnapshot: DraftGenerationSnapshot = hasValidSnapshot
      ? generationSnapshot!
      : {
          productName: readiness?.productName || "Product Listing",
          market: readiness?.market || "Amazon US",
          asin: readiness?.asin || null,
          sourceFingerprint: "missing_snapshot",
          adoptedMaterials: [],
          excludedMaterials: [],
          generatedBy: "local_rules",
          generatedAt: "历史生成（快照数据丢失）",
        };

    const bulletsMd = bullets.map((b, i) => `${i + 1}. ${b}`).join("\n");
    const adoptedMd = hasValidSnapshot
      ? (activeSnapshot.adoptedMaterials.length > 0
          ? activeSnapshot.adoptedMaterials
              .map((m) => `- **[${m.label}]** ${m.value} *(来源: ${m.sourceLabel})*`)
              .join("\n")
          : "- 暂无已采纳规格事实")
      : "- ⚠️ **依据无法验证**：该文稿缺少初稿生成时的依据快照记录，禁止使用当前最新资料拼凑依据。请重新在工作台生成。";

    const excludedMd = hasValidSnapshot
      ? (activeSnapshot.excludedMaterials.length > 0
          ? activeSnapshot.excludedMaterials
              .map((e) => `- **${e.label || e.field}** (${e.value}): ${e.reason}`)
              .join("\n")
          : "- 无排除项目")
      : "- ⚠️ **无生成时快照记录**";

    const content = `# ${activeSnapshot.productName || "Product Listing"}

> **研究对象参考初稿 · 基于采集资料，待人工复核**

- **任务 ID**: \`${taskId}\`
- **ASIN / 站点**: ${activeSnapshot.asin || "未知"} (${activeSnapshot.market || "Amazon US"})
- **生成机制**: ${activeSnapshot.generatedBy === "local_rules" ? "本地确定性规则生成 (Zero Cost)" : "AI 模型辅助生成"}
- **生成时间**: ${activeSnapshot.generatedAt}
- **手动编辑状态**: ${isEdited ? "已手动编辑，需复核" : "未修改（原始初稿）"}
- **依据快照状态**: ${hasValidSnapshot ? "完整快照" : "⚠️ 缺失依据快照 (不完整历史稿，依据无法验证)"}
- **生成依据指纹**: \`${hasValidSnapshot ? activeSnapshot.sourceFingerprint : "未记录指纹"}\`
${
  hasValidSnapshot &&
  readiness?.sourceFingerprint &&
  readiness.sourceFingerprint !== activeSnapshot.sourceFingerprint
    ? `\n> *⚠️ 提示：最新采集资料指纹为 \`${readiness.sourceFingerprint}\`，与初稿生成时依据存在变动，建议重新生成。*\n`
    : ""
}
---

## 标题 (Title)

\`\`\`text
${title}
\`\`\`

## 核心卖点 (Bullet Points)

${bulletsMd}

## 商品描述 (Product Description)

${description}

---

## 采用依据 (Adopted Facts - 生成时快照)

${adoptedMd}

## 未采用说明 (Excluded Materials - 生成时快照)

${excludedMd}

---
*注：本初稿仅供产品调研与选品参考，未经逐项人工核验，不得直接作为最终正式发布文案或法律承诺。*
`;

    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Reference-Listing-Draft-${activeSnapshot.asin || taskId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const hasDraft = Boolean(title || bullets.length > 0);
  const isLegacyWithoutSnapshot = Boolean(hasDraft && !generationSnapshot);
  const isStale = Boolean(
    hasDraft &&
    generationSnapshot &&
    readiness?.sourceFingerprint &&
    generationSnapshot.sourceFingerprint !== readiness.sourceFingerprint
  );

  // 展示用的事实清单：有生成快照时展示生成时依据，缺少快照时严禁拿最新资料假冒依据
  const displayAdopted = generationSnapshot
    ? generationSnapshot.adoptedMaterials
    : isLegacyWithoutSnapshot
      ? []
      : readiness?.adoptedMaterials || [];
  const displayExcluded = generationSnapshot
    ? generationSnapshot.excludedMaterials
    : isLegacyWithoutSnapshot
      ? []
      : readiness?.excludedMaterials || [];

  return (
    <section
      id="reference-listing-draft-panel"
      data-testid="reference-listing-draft-panel"
      className="mt-6 rounded-2xl border border-indigo-200 bg-gradient-to-b from-indigo-50/60 via-white to-white p-5 shadow-sm"
    >
      {/* 标题栏与核心身份标记 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">按现有资料生成参考初稿</h3>
            <span
              data-testid="draft-identity-badge"
              className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700"
            >
              研究对象参考初稿 · 基于采集资料，待人工复核
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            根据当前商品已保存的资料生成参考文案，无需预先逐项人工确认或正式创作交接。
          </p>
        </div>

        {/* 状态徽章 */}
        <div className="flex items-center gap-2 text-xs">
          {hasDraft && (
            <>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                {generationSnapshot?.generatedBy === "ai" ? "AI 生成" : "本地规则生成"}
              </span>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                待人工复核
              </span>
              {isEdited && (
                <span
                  data-testid="badge-manually-edited"
                  className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700"
                >
                  已手动编辑，需复核
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* 资料准备状态概览 */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">资料准备状态：</span>
            {loadingReadiness ? (
              <span className="text-slate-400">正在检查现有资料...</span>
            ) : readiness ? (
              <span>
                可用规格资料 <strong className="text-emerald-700">{readiness.adoptedCount}</strong> 项，
                暂不采用/排除 <strong className="text-slate-600">{readiness.excludedCount}</strong> 项
              </span>
            ) : (
              <span className="text-slate-400">暂无资料状态</span>
            )}
          </div>

          {/* 主动作按钮 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="generate-reference-draft-btn"
              onClick={handleGenerate}
              disabled={generating || loadingReadiness || readiness?.status === "insufficient"}
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {generating ? (
                <span>正在生成参考初稿...</span>
              ) : hasDraft ? (
                <span>重新生成参考初稿</span>
              ) : (
                <span>按现有资料生成参考初稿</span>
              )}
            </button>
          </div>
        </div>

        {/* 资料不足提示 */}
        {!loadingReadiness && readiness?.status === "insufficient" && (
          <p className="mt-2 text-amber-700">
            ⚠️ {readiness.reason || "当前未提取到足够的基础规格资料，请先在上方补充或采集商品页面。"}
          </p>
        )}

        {/* 资料更新提示 */}
        {isStale && (
          <p className="mt-2 text-amber-700 font-medium">
            ⚠️ 当前商品的采集资料已发生变动，当前展示为历史生成时依据，建议点击上方按钮重新生成。
          </p>
        )}

        {/* 缺少生成快照的不完整历史稿提示 */}
        {isLegacyWithoutSnapshot && (
          <p data-testid="warning-missing-snapshot" className="mt-2 text-amber-700 font-medium">
            ⚠️ 该文稿缺少初稿生成时的依据快照（属于不完整历史稿），依据无法验证，禁止作为正式依据导出。建议点击上方按钮重新生成。
          </p>
        )}

        {/* localStorage 不可用提示 */}
        {storageUnavailable && (
          <p className="mt-1 text-slate-500">
            * 提示：当前环境本地存储暂存受限，刷新后可能无法保留手动编辑，但复制与下载功能仍然可用。
          </p>
        )}

        {/* 错误提示 */}
        {errorMsg && (
          <p className="mt-2 text-rose-600 font-medium">
            ❌ {errorMsg}
          </p>
        )}

        {/* 展开可折叠的采用与排除详情 */}
        <details className="mt-2.5 border-t border-slate-200/60 pt-2 text-slate-600">
          <summary className="cursor-pointer text-xs font-semibold text-indigo-700 hover:text-indigo-800">
            查看采用依据与未采用原因 ({displayAdopted.length + displayExcluded.length} 项)
            {generationSnapshot && isStale ? " [生成时依据]" : ""}
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {/* 采用依据 */}
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5">
              <h4 className="font-bold text-emerald-800">
                采用依据 ({displayAdopted.length} 项){generationSnapshot ? " (初稿生成时)" : ""}
              </h4>
              {displayAdopted.length > 0 ? (
                <ul className="mt-1.5 space-y-1">
                  {displayAdopted.map((item, idx) => (
                    <li key={item.id || idx} className="text-xs text-emerald-900">
                      <span className="font-semibold">[{item.label}]:</span> {item.value}{" "}
                      <span className="text-[10px] text-emerald-600">({item.sourceLabel})</span>
                    </li>
                  ))}
                </ul>
              ) : isLegacyWithoutSnapshot ? (
                <p className="mt-1 text-xs text-amber-700 font-medium">⚠️ 历史快照丢失，依据无法验证。禁止使用当前最新资料拼凑依据。</p>
              ) : (
                <p className="mt-1 text-xs text-emerald-600">暂无可采用的基础规格。</p>
              )}
            </div>

            {/* 未采用原因 */}
            <div className="rounded-lg border border-slate-200 bg-slate-100/60 p-2.5">
              <h4 className="font-bold text-slate-700">
                暂不采用说明 ({displayExcluded.length} 项){generationSnapshot ? " (初稿生成时)" : ""}
              </h4>
              {displayExcluded.length > 0 ? (
                <ul className="mt-1.5 space-y-1">
                  {displayExcluded.map((item, idx) => (
                    <li key={idx} className="text-xs text-slate-600">
                      <span className="font-semibold">{item.label || item.field}:</span> {item.reason}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-slate-500">无排除项。</p>
              )}
            </div>
          </div>
        </details>
      </div>

      {/* 结果编辑区 */}
      {hasDraft && (
        <div
          id="reference-listing-draft-content"
          data-testid="reference-listing-draft-content"
          className="mt-5 space-y-4 rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
            <h4 className="text-sm font-bold text-slate-800">
              英文参考初稿内容 (可直接编辑)
            </h4>
            <div className="flex items-center gap-2">
              {copyFeedback && (
                <span className="text-xs font-medium text-indigo-700 animate-pulse">
                  {copyFeedback}
                </span>
              )}
              <button
                type="button"
                data-testid="copy-reference-draft-btn"
                onClick={handleCopy}
                className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                复制全部文案
              </button>
              <button
                type="button"
                data-testid="download-reference-draft-btn"
                onClick={handleDownloadMarkdown}
                className="inline-flex items-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                下载 Markdown
              </button>
            </div>
          </div>

          {/* 标题 */}
          <div>
            <label
              htmlFor={`${panelId}-title`}
              className="block text-xs font-bold text-slate-700"
            >
              商品标题 (Title)
            </label>
            <input
              id={`${panelId}-title`}
              data-testid="reference-draft-title-input"
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* 五点卖点 (1~5 条) */}
          <div>
            <label className="block text-xs font-bold text-slate-700">
              核心卖点 (Bullet Points - 共 {bullets.length} 条)
            </label>
            <div className="mt-1.5 space-y-2">
              {bullets.map((bullet, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="mt-2 text-xs font-semibold text-slate-400">
                    {idx + 1}.
                  </span>
                  <textarea
                    data-testid={`reference-draft-bullet-${idx}`}
                    value={bullet}
                    rows={2}
                    onChange={(e) => handleBulletChange(idx, e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 商品描述 */}
          <div>
            <label
              htmlFor={`${panelId}-desc`}
              className="block text-xs font-bold text-slate-700"
            >
              商品描述 (Product Description)
            </label>
            <textarea
              id={`${panelId}-desc`}
              data-testid="reference-draft-desc-input"
              value={description}
              rows={3}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
      )}
    </section>
  );
}
