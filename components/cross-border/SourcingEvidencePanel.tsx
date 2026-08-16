"use client";

/**
 * V3.5 — 供应线索面板（Sourcing Evidence Workbench，最小集成）
 *
 * 流程：关键词找货 / 图片找货 / 粘贴 1688 URL
 * → Search Results（Preview）→ Human Confirm → Sourcing Evidence。
 *
 * 文案与语义纪律（Contract §45/§46/§47/§48/§51）：
 * - 允许：供应线索 / 查看来源 / 加入供应线索 / 下一步询盘问题 / 相似与差异 / 未知项。
 * - 禁止：最佳供应商 / 推荐供应商 / 最优货源 / 靠谱指数 / 采购指数 / 成功率 / 建议购买。
 * - 价格只显示"页面显示价"；MOQ 只显示"展示值"；卖家自报 ≠ 事实。
 * - 询盘问题为确定性模板生成（基于 Unknowns/Claims），不自动发送、不调用 AI 猜规格。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccessPassword } from "@/lib/client/accessPassword";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { sourcingCapabilities } from "@/lib/client/sourcingCapabilities";
import type {
  AcquisitionCandidate,
  HumanConfirmedEntry,
  SourcingEvidenceV1,
} from "@/lib/upstream/1688/contracts";

type PanelStatus =
  | "idle"
  | "searching"
  | "preview"
  | "need_login"
  | "need_user_verification"
  | "no_results"
  | "partial"
  | "error"
  | "saving"
  | "confirmed";

type PreviewPayload = {
  previewId: string;
  method: "keyword" | "image" | "url";
  query: string;
  candidates: AcquisitionCandidate[];
  expiresAt: number;
};

type ToolStatus = { loggedIn: boolean; toolAvailable: boolean; cli?: { loggedIn: boolean; toolAvailable: boolean }; image?: { extensionAvailable: boolean; reasonCode?: string } };

const MATCH_STATE_LABEL: Record<string, string> = {
  exact_match: "与候选高度一致（需人工复核）",
  likely_similar: "相似（大概率同品类）",
  partial_match: "部分相似",
  different: "不同",
  unknown: "相似度未知（需人工查看）",
};

function formatPrice(candidate: AcquisitionCandidate): string {
  if (candidate.displayedPrice) return candidate.displayedPrice.text;
  if (candidate.priceRange) return `${candidate.priceRange.min ?? "?"} ~ ${candidate.priceRange.max ?? "?"}`;
  return "页面未显示";
}

function formatMoq(candidate: AcquisitionCandidate): string {
  return candidate.displayedMoq?.text ?? "页面未显示";
}

/** 确定性询盘问题生成（§51）：基于缺失字段与卖家自报，不猜事实（导出供测试） */
export function buildInquiryQuestions(candidate: AcquisitionCandidate): string[] {
  const questions: string[] = [];
  if (!candidate.displayedMoq) questions.push("该商品的真实起批量（MOQ）是多少？");
  if (candidate.priceTiers.length === 0) questions.push("当前报价对应哪个数量阶梯？各数量价格分别是多少？");
  if (candidate.skuSpecs.length === 0) questions.push("有哪些规格/SKU？当前报价对应哪个 SKU？");
  const claims = candidate.sellerClaims.map((claim) => `${claim.name}:${claim.value}`);
  if (!claims.some((text) => /定制|LOGO|logo/i.test(text))) questions.push("是否支持定制（LOGO / 包装 / 颜色）？");
  if (!claims.some((text) => /材质|材料/i.test(text))) questions.push("具体材质是什么？能否提供规格表？");
  if (!claims.some((text) => /检测|认证/i.test(text))) questions.push("是否有第三方检测报告或相关认证？");
  questions.push("包装数量与方式是什么？是否提供样品？样品价格如何？");
  return questions.slice(0, 6);
}

export function SourcingEvidencePanel({
  taskId,
  amazonContext,
}: {
  taskId: string;
  amazonContext?: { title?: string | null; image?: string | null; asin?: string | null };
}) {
  const [accessPassword] = useAccessPassword();
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null);
  const [keyword, setKeyword] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [offerUrl, setOfferUrl] = useState("");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [evidence, setEvidence] = useState<SourcingEvidenceV1 | null>(null);
  const [storageVersion, setStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);
  const [detailByOfferId, setDetailByOfferId] = useState<Partial<Record<string, AcquisitionCandidate | null>>>({});
  const [noteByOfferId, setNoteByOfferId] = useState<Record<string, string>>({});
  const reqIdRef = useRef(0);
  const panelOpen = useRef(false);

  const api = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/sourcing`, {
      method: "POST",
      cache: "no-store",
      headers: { ...buildAccessHeaders(), "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    return { response, data: await response.json() as { ok: boolean; error?: { code: string; message: string }; data?: unknown } };
  }, [taskId]);

  const loadInitial = useCallback(async () => {
    const currentId = ++reqIdRef.current;
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/sourcing`, {
        cache: "no-store",
        headers: { ...buildAccessHeaders() },
        signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json() as {
        ok: boolean;
        data?: { evidence: SourcingEvidenceV1 | null; storageVersion: { resultJsonHash: string; updatedAt: string }; toolStatus: ToolStatus };
      };
      if (currentId !== reqIdRef.current) return;
      if (!response.ok || !data.ok || !data.data) return;
      setEvidence(data.data.evidence);
      setStorageVersion(data.data.storageVersion);
      setToolStatus(data.data.toolStatus);
      // F3：分能力 gate——CLI 未登录只影响关键词/URL（need_login 横幅），图片能力独立
      const caps = sourcingCapabilities(data.data.toolStatus);
      if (!caps.cliReady) setStatus("need_login");
    } catch {
      // 初始读取失败保持 idle
    }
  }, [taskId]);

  useEffect(() => {
    if (!panelOpen.current) {
      panelOpen.current = true;
      void loadInitial();
    }
  }, [loadInitial]);

  async function runSearch(method: "keyword" | "image" | "url", payload: Record<string, unknown>) {
    setStatus("searching");
    setErrorMessage("");
    setSelected(new Set());
    setDetailByOfferId({});
    try {
      const { response, data } = await api({ action: method, ...payload });
      if (!response.ok || !data.ok || !data.data) {
        const code = data.error?.code ?? "";
        if (method === "image") {
          // F3：图片找货错误按扩展/浏览器语义分流，绝不进入 CLI 登录横幅
          if (code === "auth_required") {
            setStatus("error");
            setErrorMessage("图片找货需要在普通 Chrome 中登录 1688（与 1688-cli 登录无关）。请在 Chrome 完成 1688 登录后重试。");
            return;
          }
          if (code === "extension_not_installed" || code === "extension_disconnected" || code === "extension_bridge_not_available") {
            setStatus("error");
            setErrorMessage("图片找货依赖 Qingxuan 1688 Helper 扩展。请在 chrome://extensions 加载扩展（普通 Chrome，无需 1688-cli）后重试。");
            return;
          }
          if (code === "risk_control_required") {
            setStatus("need_user_verification");
            setErrorMessage(data.error?.message ?? "");
            return;
          }
          setStatus("error");
          setErrorMessage(data.error?.message ?? "图片找货失败，请重试。");
          return;
        }
        if (code === "auth_required" || code === "acquisition_tool_not_available") {
          setStatus("need_login");
          setErrorMessage(data.error?.message ?? "");
          return;
        }
        if (code === "risk_control_required") {
          setStatus("need_user_verification");
          setErrorMessage(data.error?.message ?? "");
          return;
        }
        setStatus("error");
        setErrorMessage(data.error?.message ?? "获取失败，请重试。");
        return;
      }
      const payloadData = data.data as { preview: PreviewPayload; trace?: unknown };
      const candidates = payloadData.preview.candidates;
      if (candidates.length === 0) {
        setStatus("no_results");
        return;
      }
      setPreview(payloadData.preview);
      setStatus("preview");
    } catch {
      setStatus("error");
      setErrorMessage("网络异常，请重试。");
    }
  }

  async function loadDetail(offerId: string) {
    if (detailByOfferId[offerId] !== undefined) return;
    setDetailByOfferId((prev) => ({ ...prev, [offerId]: null }));
    try {
      const { response, data } = await api({ action: "detail", offerId });
      if (response.ok && data.ok && data.data) {
        const detail = (data.data as { detail: AcquisitionCandidate }).detail;
        setDetailByOfferId((prev) => ({ ...prev, [offerId]: detail }));
      } else {
        setDetailByOfferId((prev) => ({ ...prev, [offerId]: undefined }));
      }
    } catch {
      setDetailByOfferId((prev) => ({ ...prev, [offerId]: undefined }));
    }
  }

  async function confirmSelection() {
    if (!preview || selected.size === 0) return;
    setStatus("saving");
    setErrorMessage("");
    try {
      const { response, data } = await api({
        action: "save",
        previewId: preview.previewId,
        selectedOfferIds: [...selected],
        noteByOfferId,
        expectedStorageVersion: storageVersion,
      });
      if (!response.ok || !data.ok || !data.data) {
        const code = data.error?.code ?? "";
        if (code === "preview_expired") {
          setStatus("error");
          setErrorMessage("预览已过期，请重新搜索后再确认。");
          return;
        }
        if (code === "auth_required") {
          setStatus("need_login");
          setErrorMessage(data.error?.message ?? "");
          return;
        }
        setStatus("error");
        setErrorMessage(data.error?.message ?? "保存失败，请重试。");
        return;
      }
      const saved = data.data as { evidence: SourcingEvidenceV1; storageVersion: { resultJsonHash: string; updatedAt: string } };
      setEvidence(saved.evidence);
      setStorageVersion(saved.storageVersion);
      setPreview(null);
      setStatus("confirmed");
    } catch {
      setStatus("error");
      setErrorMessage("网络异常，保存未完成，请重试。");
    }
  }

  const toggleSelect = (offerId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(offerId)) next.delete(offerId);
      else next.add(offerId);
      return next;
    });
  };

  const accessReady = accessPassword.trim().length > 0;
  // F3：分能力 readiness（CLI 只 gate 关键词/URL；图片找货独立于 CLI）
  const caps = sourcingCapabilities(toolStatus);

  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4" data-testid="sourcing-evidence-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-900">供应线索（1688）</p>
        {status === "need_login" ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            需要完成 1688 登录
          </span>
        ) : null}
        {status === "need_user_verification" ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            需要在 1688 页面完成验证
          </span>
        ) : null}
      </div>

      {!accessReady ? (
        <p className="mt-3 text-sm text-slate-500">输入访问密码后可使用供应线索功能。</p>
      ) : (
        <>
          {status === "need_login" ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-sm font-semibold text-amber-800">{errorMessage || "1688-cli 会话未登录或已过期。"}</p>
              <p className="mt-1 text-sm text-amber-700">
                关键词找货与 1688 链接读取需要完成 1688-cli 扫码登录；图片找货不依赖 1688-cli（普通 Chrome + 扩展即可使用）。
              </p>
            </div>
          ) : null}

          {status === "need_user_verification" ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-sm font-semibold text-amber-800">{errorMessage || "1688 触发了验证。"}</p>
              <p className="mt-1 text-sm text-amber-700">请在 1688 页面完成滑块/验证后重试（系统不会绕过验证）。</p>
            </div>
          ) : null}

          {status === "error" ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
              <p className="text-sm font-semibold text-rose-700">{errorMessage}</p>
            </div>
          ) : null}

          {status === "confirmed" ? (
            <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50/60 p-3">
              <p className="text-sm font-semibold text-teal-700">已加入供应线索（{evidence?.humanConfirmed.length ?? 0} 条）。</p>
            </div>
          ) : null}

          {/* ── 获取入口 ── */}
          {!preview && status !== "saving" && (
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-bold text-slate-500">关键词找货</p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter" && keyword.trim() && caps.cliReady) void runSearch("keyword", { keyword: keyword.trim() }); }}
                    placeholder="例如：不锈钢保温杯"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    data-testid="sourcing-keyword-input"
                  />
                  <button
                    type="button"
                    disabled={!keyword.trim() || status === "searching" || !caps.cliReady}
                    onClick={() => void runSearch("keyword", { keyword: keyword.trim() })}
                    className="linear-button inline-flex h-9 items-center justify-center px-3 text-sm font-semibold disabled:opacity-50"
                    data-testid="sourcing-keyword-submit"
                  >
                    搜索
                  </button>
                </div>
                {!caps.cliReady ? (
                  <p className="mt-1.5 text-xs text-amber-600">需要完成 1688-cli 扫码登录后使用。</p>
                ) : null}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-bold text-slate-500">图片找货</p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={imageUrl}
                    onChange={(event) => setImageUrl(event.target.value)}
                    placeholder="候选主图 https:// 链接"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    data-testid="sourcing-image-input"
                  />
                  <button
                    type="button"
                    disabled={!imageUrl.trim() || status === "searching" || !caps.imageReady}
                    onClick={() => void runSearch("image", { imageUrl: imageUrl.trim() })}
                    className="linear-button inline-flex h-9 items-center justify-center px-3 text-sm font-semibold disabled:opacity-50"
                    data-testid="sourcing-image-submit"
                  >
                    图搜
                  </button>
                </div>
                {!caps.imageReady ? (
                  <p className="mt-1.5 text-xs text-amber-600">
                    图片找货依赖普通 Chrome + Qingxuan 1688 Helper 扩展（不依赖 1688-cli）。请在 chrome://extensions 加载扩展后刷新。
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-slate-400">1688 图搜会打开本地浏览器窗口（需前台运行）。</p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-bold text-slate-500">已有 1688 链接</p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={offerUrl}
                    onChange={(event) => setOfferUrl(event.target.value)}
                    placeholder="detail.1688.com/offer/…"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    data-testid="sourcing-url-input"
                  />
                  <button
                    type="button"
                    disabled={!offerUrl.trim() || status === "searching" || !caps.cliReady}
                    onClick={() => void runSearch("url", { url: offerUrl.trim() })}
                    className="linear-button inline-flex h-9 items-center justify-center px-3 text-sm font-semibold disabled:opacity-50"
                    data-testid="sourcing-url-submit"
                  >
                    读取
                  </button>
                </div>
                {!caps.cliReady ? (
                  <p className="mt-1.5 text-xs text-amber-600">需要完成 1688-cli 扫码登录后使用。</p>
                ) : null}
              </div>
            </div>
          )}

          {/* ── Preview（Search Results ≠ Evidence） ── */}
          {preview && (
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-700">
                  搜索结果（{preview.candidates.length} 条）— 需人工确认后才成为供应线索
                </p>
                <button type="button" onClick={() => { setPreview(null); setStatus("idle"); }} className="text-sm font-semibold text-slate-400 hover:text-slate-600">
                  取消
                </button>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {preview.candidates.map((candidate) => {
                  const detail = detailByOfferId[candidate.offerId];
                  const showDetail = detail !== undefined && detail !== null;
                  return (
                    <div key={candidate.offerId} className="rounded-xl border border-slate-200 bg-white p-3" data-testid="sourcing-preview-card">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selected.has(candidate.offerId)}
                          onChange={() => toggleSelect(candidate.offerId)}
                          className="mt-1 h-4 w-4"
                          aria-label={`选择 ${candidate.title}`}
                          data-testid={`select-${candidate.offerId}`}
                        />
                        {candidate.images[0] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={candidate.images[0]} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-slate-200 object-cover" />
                        ) : (
                          <div className="h-16 w-16 shrink-0 rounded-lg border border-dashed border-slate-300" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-semibold text-slate-800">{candidate.title}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            页面显示价：<span className="font-bold text-slate-700">{formatPrice(candidate)}</span>
                            {" · "}起批：{formatMoq(candidate)}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-400">
                            供应商：{candidate.supplierDisplayName || "未显示"}
                          </p>
                          {candidate.matchState ? (
                            <p className="mt-0.5 text-xs font-semibold text-teal-700">{MATCH_STATE_LABEL[candidate.matchState] ?? "相似度未知"}</p>
                          ) : null}
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <a
                              href={candidate.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-semibold text-teal-700 hover:text-teal-900"
                            >
                              查看来源
                            </a>
                            {detailByOfferId[candidate.offerId] === undefined ? (
                              <button type="button" onClick={() => void loadDetail(candidate.offerId)} className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                                {detailByOfferId[candidate.offerId] === null ? "读取中…" : "查看详情"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      {showDetail ? (
                        <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs text-slate-600">
                          <p>价格阶梯：{detail?.priceTiers.map((tier) => `${tier.minQty} 件 ¥${tier.price}`).join(" / ") || "未显示"}</p>
                          <p className="mt-0.5">SKU/规格：{detail?.skuSpecs.slice(0, 3).map((sku) => sku.specs).join("；") || "未显示"}</p>
                          <p className="mt-0.5">
                            卖家自报：{detail?.sellerClaims.slice(0, 3).map((claim) => `${claim.name}:${claim.value}`).join("；") || "未显示"}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  disabled={selected.size === 0 || status === "saving"}
                  onClick={() => void confirmSelection()}
                  className="linear-button inline-flex h-10 items-center justify-center px-5 text-sm font-semibold disabled:opacity-50"
                  data-testid="sourcing-confirm-button"
                >
                  {status === "saving" ? "保存中…" : `加入供应线索（${selected.size}）`}
                </button>
                <span className="text-xs text-slate-400">未确认的搜索结果不会保存为证据。</span>
              </div>
            </div>
          )}

          {status === "searching" ? (
            <p className="mt-3 text-sm text-slate-500" data-testid="sourcing-searching">正在获取 1688 供应候选…</p>
          ) : null}

          {status === "no_results" ? (
            <p className="mt-3 text-sm text-slate-500">没有找到结果，换个关键词试试。</p>
          ) : null}

          {/* ── 已保存证据 ── */}
          {evidence && evidence.candidates.length > 0 && status !== "preview" && status !== "searching" && status !== "saving" ? (
            <div className="mt-5 rounded-xl border border-slate-200 bg-white p-3" data-testid="sourcing-evidence-list">
              <p className="text-sm font-bold text-slate-700">已确认的供应线索（{evidence.humanConfirmed.length}）</p>
              <div className="mt-2 grid gap-2">
                {evidence.candidates.map((candidate) => {
                  const confirmed = evidence.humanConfirmed.some((entry: HumanConfirmedEntry) => entry.offerId === candidate.offerId);
                  if (!confirmed) return null;
                  const unknownItems: string[] = [];
                  if (!candidate.displayedMoq) unknownItems.push("真实起批量未知");
                  if (candidate.priceTiers.length === 0) unknownItems.push("数量阶梯价未知");
                  if (candidate.skuSpecs.length === 0) unknownItems.push("SKU/规格未知");
                  const questions = buildInquiryQuestions(candidate);
                  return (
                    <div key={candidate.offerId} className="rounded-lg border border-teal-100 bg-teal-50/40 p-3" data-testid="sourcing-evidence-item">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="line-clamp-1 text-sm font-semibold text-slate-800">{candidate.title}</p>
                        <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-teal-700 hover:text-teal-900">
                          查看来源
                        </a>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span>页面显示价：{formatPrice(candidate)}</span>
                        <span>展示起批：{formatMoq(candidate)}</span>
                        <span>供应商：{candidate.supplierDisplayName || "未显示"}</span>
                      </div>
                      {candidate.sellerClaims.length > 0 ? (
                        <p className="mt-1.5 text-xs text-slate-500">
                          卖家自报（≠ 事实）：{candidate.sellerClaims.slice(0, 4).map((claim) => `${claim.name}:${claim.value}`).join("；")}
                        </p>
                      ) : null}
                      {unknownItems.length > 0 ? (
                        <p className="mt-1.5 text-xs font-semibold text-amber-700">未知项：{unknownItems.join("；")}</p>
                      ) : null}
                      <div className="mt-2 rounded-lg bg-white p-2">
                        <p className="text-xs font-bold text-slate-500">下一步询盘问题（建议向供应商确认）</p>
                        <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
                          {questions.map((question) => <li key={question}>{question}</li>)}
                        </ul>
                      </div>
                    </div>
                  );
                })}
              </div>
              {amazonContext?.title ? (
                <p className="mt-2 text-xs text-slate-400">
                  对比对象：{amazonContext.title}（{amazonContext.asin ?? "亚马逊候选"}）——相似与差异需人工结合商品图片与规格判断，系统不自动评分。
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
