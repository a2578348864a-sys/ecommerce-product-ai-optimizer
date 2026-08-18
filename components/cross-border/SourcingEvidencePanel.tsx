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
import { buildAccessHeaders, getAccessMode } from "@/lib/client/accessToken";
import { sourcingCapabilities } from "@/lib/client/sourcingCapabilities";
import {
  parseSourcingCapabilities,
  type SourcingCapabilitiesView,
} from "@/lib/client/acquisitionCapability";
import { CapabilityNotice } from "@/components/evidence/CapabilityNotice";
import type {
  AcquisitionCandidate,
  HumanConfirmedEntry,
  SourcingEvidenceV1,
  SourcingOperation,
} from "@/lib/upstream/1688/contracts";

/**
 * V3 Final R13（§201/§202）：UI 业务语义（关键词找货/图片找货/已有链接）→ 唯一 canonical operation。
 * 关键词找货 = search（route 只接受 search/image/url/detail/save；禁止漂移为 keyword 等裸字符串）。
 */
export const UI_METHOD_TO_OPERATION: Record<"keyword" | "image" | "url", SourcingOperation> = {
  keyword: "search",
  image: "image",
  url: "url",
};

/**
 * V3 Final R14：候选商品缩略图（唯一展示入口）。
 * - 1688 CDN（alicdn）防盗链：页面 Referer 触发 403 → referrerPolicy="no-referrer"（实证 200）；
 * - 单张加载失败 → 降级「暂无商品图」占位（不显示 broken icon、不无限重试）；
 * - 无图 → 占位；lazy 加载。
 */
export function SourcingCandidateThumb({
  imageUrl,
  offerId,
  className = "h-16 w-16 shrink-0 rounded-lg border border-slate-200 object-cover",
}: {
  imageUrl: string | null | undefined;
  offerId: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!imageUrl || failed) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50" data-testid={`no-image-${offerId}`}>
        <span className="px-1 text-center text-[10px] leading-tight text-slate-400">暂无商品图</span>
      </div>
    );
  }
   
  return (
    <img
      src={imageUrl}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

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

type ToolStatus = {
  loggedIn: boolean;
  toolAvailable: boolean;
  cli?: { loggedIn: boolean; toolAvailable: boolean };
  image?: { extensionAvailable: boolean; versionCompatible?: boolean; extensionSwVersion?: string | null; reasonCode?: string };
  /** D1：工具可用但未登录时，服务端构造的固定登录命令（仅展示，业务层不执行 login） */
  loginHint?: { command: string } | null;
  /** R1：最近一次检测时间（ISO；UI 显示"刚刚检测：HH:MM"） */
  checkedAt?: string | null;
};

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
  onConfirmed,
  onEvidenceChange,
}: {
  taskId: string;
  amazonContext?: { title?: string | null; image?: string | null; asin?: string | null };
  /** R7：供应线索人工确认保存成功后冒泡（顶部"当前研究资料"据此重新计算） */
  onConfirmed?: () => void;
  /** R7：供应线索 evidence 状态变化上报（供 Workbench 顶部清单实时派生） */
  onEvidenceChange?: (hasConfirmed: boolean) => void;
}) {
  const [accessPassword] = useAccessPassword();
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null);
  const [capabilities, setCapabilities] = useState<SourcingCapabilitiesView | null>(null);
  const [keyword, setKeyword] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [offerUrl, setOfferUrl] = useState("");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [evidence, setEvidence] = useState<SourcingEvidenceV1 | null>(null);
  const [storageVersion, setStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);
  const [detailByOfferId, setDetailByOfferId] = useState<Partial<Record<string, AcquisitionCandidate | null>>>({});
  const [noteByOfferId, setNoteByOfferId] = useState<Record<string, string>>({});
  const [checkingTools, setCheckingTools] = useState(false);
  const [lastCheckAt, setLastCheckAt] = useState<Date | null>(null);
  const [checkResult, setCheckResult] = useState<string>("");
  const [loginNotice, setLoginNotice] = useState("");
  const [openingLogin, setOpeningLogin] = useState(false);
  const [previewDemo, setPreviewDemo] = useState(false);
  const reqIdRef = useRef(0);
  const panelOpen = useRef(false);

  // 演示模式（Visitor）：本地采集能力不可用（local_env_required）时，搜索入口仍可
  // 体验“演示找货”——服务端回放预置真实 1688 供应线索样本（demo 分支），结果标注“演示数据”。
  const demoMode = getAccessMode() === "demo";

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

  const loadInitial = useCallback(async (): Promise<ToolStatus | null> => {
    const currentId = ++reqIdRef.current;
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/sourcing`, {
        cache: "no-store",
        headers: { ...buildAccessHeaders() },
        signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json() as {
        ok: boolean;
        data?: { evidence: SourcingEvidenceV1 | null; storageVersion: { resultJsonHash: string; updatedAt: string }; toolStatus: ToolStatus; capabilities?: unknown };
      };
      if (currentId !== reqIdRef.current) return null;
      if (!response.ok || !data.ok || !data.data) return null;
      setEvidence(data.data.evidence);
      setStorageVersion(data.data.storageVersion);
      setToolStatus(data.data.toolStatus);
      setCapabilities(parseSourcingCapabilities(data.data.capabilities));
      onEvidenceChange?.((data.data.evidence?.humanConfirmed.length ?? 0) > 0);
      // F3：分能力 gate——CLI 未登录只影响关键词/URL（need_login 横幅），图片能力独立
      const caps = sourcingCapabilities(data.data.toolStatus);
      // §16：公网（capabilities=local_env_required）不进入 need_login 诊断态——由 CapabilityNotice 统一提示
      const publicRuntime = parseSourcingCapabilities(data.data.capabilities)?.keyword.state === "local_env_required";
      setStatus((prev) => (
        publicRuntime ? "idle" : (caps.cliReady ? (prev === "need_login" ? "idle" : prev) : "need_login")
      ));
      return data.data.toolStatus;
    } catch {
      // 初始读取失败保持 idle
      return null;
    }
  }, [taskId, onEvidenceChange]);

  useEffect(() => {
    if (!panelOpen.current) {
      panelOpen.current = true;
      void loadInitial();
    }
  }, [loadInitial]);

  // V3 Final R9（§151）：Task 已确认的主图自动预填图片找货输入框（用户可替换）。
  // 只在用户尚未手动编辑时预填；用户一旦输入，不再覆盖。
  const imageEditedRef = useRef(false);
  useEffect(() => {
    if (imageEditedRef.current) return;
    const sourceImage = amazonContext?.image;
    if (sourceImage && sourceImage.trim()) {
      setImageUrl(sourceImage.trim());
    }
  }, [amazonContext?.image]);

  /** D1：用户完成登录/加载扩展后手动重新检测（按钮触发，含检测中状态 + 时间戳反馈） */
  async function refreshTools() {
    setCheckingTools(true);
    setErrorMessage("");
    setCheckResult("");
    try {
      const fresh = await loadInitial();
      setLastCheckAt(new Date());
      if (fresh) {
        const capsNow = sourcingCapabilities(fresh);
        const parts: string[] = [];
        parts.push(capsNow.cliReady ? "关键词登录：已完成" : (capsNow.cliToolAvailable ? "关键词登录：未完成" : "关键词工具：未安装"));
        parts.push(capsNow.imageReady ? "浏览器助手：已连接" : "浏览器助手：未连接");
        setCheckResult(parts.join(" · "));
      }
    } finally {
      setCheckingTools(false);
    }
  }

  /** R1：打开 1688 登录窗口（固定安全 capability，用户扫码由 CLI 打开的真实浏览器完成） */
  async function openLoginWindow() {
    setOpeningLogin(true);
    setErrorMessage("");
    setLoginNotice("");
    try {
      const { response, data } = await api({ action: "begin-keyword-login" });
      if (!response.ok || !data.ok) {
        setErrorMessage(data.error?.message ?? "无法打开 1688 登录窗口，请稍后重试。");
        return;
      }
      setLoginNotice((data.data as { hint?: string }).hint ?? "已在电脑上打开 1688 登录窗口，请完成扫码。");
    } catch {
      setErrorMessage("无法打开 1688 登录窗口，请稍后重试。");
    } finally {
      setOpeningLogin(false);
    }
  }

  async function runSearch(method: "keyword" | "image" | "url", payload: Record<string, unknown>) {
    setStatus("searching");
    setErrorMessage("");
    setSelected(new Set());
    setDetailByOfferId({});
    try {
      // V3 Final R13：action 必须用 canonical SourcingOperation（keyword → search）
      const { response, data } = await api({ action: UI_METHOD_TO_OPERATION[method], ...payload });
      if (!response.ok || !data.ok || !data.data) {
        const code = data.error?.code ?? "";
        if (method === "image") {
          // F3：图片找货错误按扩展/浏览器语义分流，绝不进入 CLI 登录横幅
          if (code === "auth_required") {
            setStatus("error");
            setErrorMessage("图片找货需要在普通 Chrome 中登录 1688（与关键词找货的登录相互独立）。请在 Chrome 完成 1688 登录后重试。");
            return;
          }
          if (code === "extension_not_installed" || code === "extension_disconnected" || code === "extension_bridge_not_available") {
            setStatus("error");
            setErrorMessage("图片找货需要浏览器助手扩展。请按「图片找货」入口下的加载步骤安装后，点击「已加载，重新检测」重试。");
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
      const payloadData = data.data as { preview: PreviewPayload; trace?: unknown; demo?: boolean };
      const candidates = payloadData.preview.candidates;
      if (candidates.length === 0) {
        setStatus("no_results");
        return;
      }
      setPreview(payloadData.preview);
      setPreviewDemo(payloadData.demo === true);
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
      onConfirmed?.();
      onEvidenceChange?.(true);
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
  // §16/§17：公网 runtime（capabilities=local_env_required）→ 统一"实时找货需要本地研究环境"，
  // 不展示"组件未安装/登录失败/CLI 缺失"等本地诊断文案；已保存供应证据仍正常展示。
  // 演示模式（Visitor）：改为"演示找货"引导——demo 分支回放预置样本，搜索按钮可点。
  const localEnvRequired = capabilities !== null && capabilities.keyword.state === "local_env_required";
  const canDemoReplay = localEnvRequired && demoMode;

  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4" data-testid="sourcing-evidence-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-900">供应线索（1688）</p>
        {!localEnvRequired && status === "need_login" ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            需要完成 1688 登录
          </span>
        ) : null}
        {!localEnvRequired && status === "need_user_verification" ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            需要在 1688 页面完成验证
          </span>
        ) : null}
      </div>

      {!accessReady ? (
        <p className="mt-3 text-sm text-slate-500">输入访问密码后可使用供应线索功能。</p>
      ) : (
        <>
          {/* §16/§17：公网实时找货能力提示（本地研究环境）；演示模式改为"演示找货"引导 */}
          <CapabilityNotice
            capability={localEnvRequired
              ? { state: "local_env_required", reasonCategory: "local_environment_required" }
              : null}
            localEnvMessage={demoMode
              ? "演示模式：当前环境不执行实时 1688 找货，可点击下方「演示找货」回放示例供应线索（演示数据，非实时采集）。"
              : "实时找货需要在本地研究环境使用。已保存并确认的供应证据仍可正常查看。"}
          />

          {/* R1：两套独立登录说明（常驻，任何状态下可见；公网不展示本地工具概念） */}
          {!localEnvRequired && (
            <p className="mt-3 text-xs leading-5 text-slate-500" data-testid="sourcing-dual-login-note">
            1688 有两套相互独立的登录：<span className="font-semibold">关键词找货 / 链接读取</span>需要完成「关键词登录」；
            <span className="font-semibold">图片找货</span>只需要浏览器助手 + 普通 Chrome 登录 1688，互不影响。
            图片找货需确认已在普通 Chrome 中登录 1688（系统无法代替确认登录态）。
            </p>
          )}

          {!localEnvRequired && status === "need_login" ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3" role="alert">
              <p className="text-sm font-semibold text-amber-800">
                {caps.cliToolAvailable ? "关键词找货与链接读取：登录未完成" : "关键词找货组件尚未准备完成"}
              </p>
              <p className="mt-1 text-sm text-amber-700">
                {caps.cliToolAvailable
                  ? "图片找货不受影响（浏览器助手已独立就绪时可正常使用）。"
                  : "未检测到本机 1688 采集工具，关键词找货与链接读取暂不可用；图片找货不受影响。"}
              </p>
              {caps.cliToolAvailable ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={openingLogin}
                    onClick={() => void openLoginWindow()}
                    className="linear-button inline-flex h-8 items-center justify-center px-3 text-xs font-semibold disabled:opacity-50"
                    data-testid="sourcing-open-login-window"
                  >
                    {openingLogin ? "正在打开…" : "打开 1688 登录窗口"}
                  </button>
                  <button
                    type="button"
                    disabled={checkingTools}
                    onClick={() => void refreshTools()}
                    className="linear-button inline-flex h-8 items-center justify-center px-3 text-xs font-semibold disabled:opacity-50"
                    data-testid="sourcing-relogin-check"
                  >
                    {checkingTools ? "正在检测…" : "重新检测"}
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <p className="text-sm text-amber-700">未检测到本机 1688 采集工具。</p>
                  <button
                    type="button"
                    disabled={checkingTools}
                    onClick={() => void refreshTools()}
                    className="rounded border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                    data-testid="sourcing-relogin-check"
                  >
                    {checkingTools ? "正在检测…" : "重新检测"}
                  </button>
                </div>
              )}
              {loginNotice ? <p className="mt-2 text-sm font-semibold text-teal-700">{loginNotice}</p> : null}
              {caps.cliToolAvailable ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-amber-700">登录步骤（2 步）</summary>
                  <ol className="mt-2 list-inside list-decimal space-y-1.5 text-sm text-amber-700">
                    <li>点击「打开 1688 登录窗口」——会在电脑上打开真实浏览器登录页，用手机 1688 App 扫码。</li>
                    <li>扫码完成后回到本页，点击「重新检测」确认登录生效。</li>
                  </ol>
                </details>
              ) : null}
            </div>
          ) : null}

          {!localEnvRequired && status === "need_user_verification" ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-sm font-semibold text-amber-800">{errorMessage || "1688 触发了验证。"}</p>
              <p className="mt-1 text-sm text-amber-700">请在 1688 页面完成滑块/验证后重试（系统不会绕过验证）。</p>
            </div>
          ) : null}

          {!localEnvRequired && status === "error" ? (
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
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-500">关键词找货</p>
                  {localEnvRequired ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">需要本地研究环境</span>
                  ) : caps.cliReady ? (
                    <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">1688 登录 ✓</span>
                  ) : caps.cliToolAvailable ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">需登录 1688</span>
                  ) : (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500">组件未安装</span>
                  )}
                </div>
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
                    disabled={!keyword.trim() || status === "searching" || !caps.cliReady || (localEnvRequired && !demoMode)}
                    onClick={() => void runSearch("keyword", { keyword: keyword.trim() })}
                    className="linear-button inline-flex h-9 items-center justify-center px-3 text-sm font-semibold disabled:opacity-50"
                    data-testid="sourcing-keyword-submit"
                  >
                    搜索
                  </button>
                </div>
                {!localEnvRequired ? (
                  !caps.cliToolAvailable ? (
                    <p className="mt-1.5 text-xs text-amber-600">关键词找货组件尚未安装，安装完成后即可使用（见顶部提示）。</p>
                  ) : !caps.cliReady ? (
                    <p className="mt-1.5 text-xs text-amber-600">需要先登录 1688 后使用（见顶部登录提示）。</p>
                  ) : null
                ) : null}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-500">图片找货</p>
                  {localEnvRequired ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">需要本地研究环境</span>
                  ) : caps.imageReady ? (
                    <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">浏览器助手 ✓</span>
                  ) : caps.imageReasonCode === "extension_version_mismatch" || (caps.imageExtensionSwVersion !== null && !caps.imageVersionCompatible) ? (
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">浏览器助手需要更新</span>
                  ) : (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">需加载扩展</span>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    value={imageUrl}
                    onChange={(event) => { imageEditedRef.current = true; setImageUrl(event.target.value); }}
                    placeholder="候选主图 https:// 链接"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    data-testid="sourcing-image-input"
                  />
                  <button
                    type="button"
                    disabled={!imageUrl.trim() || status === "searching" || !caps.imageReady || (localEnvRequired && !demoMode)}
                    onClick={() => void runSearch("image", { imageUrl: imageUrl.trim() })}
                    className="linear-button inline-flex h-9 items-center justify-center px-3 text-sm font-semibold disabled:opacity-50"
                    data-testid="sourcing-image-submit"
                  >
                    图搜
                  </button>
                </div>
                {/* V3 Final R9（§151）：Task 主图自动预填 + 一键使用 */}
                {amazonContext?.image && amazonContext.image.trim() ? (
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="max-w-full truncate">当前商品主图：{amazonContext.image.trim()}</span>
                    <button
                      type="button"
                      onClick={() => { imageEditedRef.current = false; setImageUrl(amazonContext.image?.trim() ?? ""); }}
                      className="rounded border border-teal-300 bg-white px-2 py-0.5 font-semibold text-teal-700 hover:bg-teal-50"
                      data-testid="sourcing-use-source-image"
                    >
                      使用此图片找货
                    </button>
                  </p>
                ) : null}
                {!localEnvRequired && !caps.imageReady ? (
                  caps.imageReasonCode === "extension_version_mismatch" || (caps.imageExtensionSwVersion !== null && !caps.imageVersionCompatible) ? (
                    <div className="mt-1.5">
                      <p className="text-xs font-semibold text-rose-700" data-testid="sourcing-helper-outdated">
                        浏览器助手版本过旧（已连接：{caps.imageExtensionSwVersion ?? "未知"}），需要重新加载。
                      </p>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-semibold text-rose-700">查看更新步骤（约 1 分钟）</summary>
                        <ol className="mt-1.5 list-inside list-decimal space-y-1 text-xs text-rose-700">
                          <li>打开 Chrome，地址栏输入 <code className="rounded bg-white px-1 font-mono">chrome://extensions</code> 并回车。</li>
                          <li>找到「轻选 1688 浏览器助手」，点击「重新加载」。</li>
                          <li>回到轻选工作台，点击下方「重新检测」确认版本生效。</li>
                        </ol>
                      </details>
                      <button
                        type="button"
                        disabled={checkingTools}
                        onClick={() => void refreshTools()}
                        className="mt-2 rounded border border-rose-300 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        data-testid="sourcing-extension-recheck"
                      >
                        {checkingTools ? "正在检测…" : "重新检测"}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1.5">
                      <p className="text-xs text-amber-600">需要先在 Chrome 中加载浏览器助手扩展。</p>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-semibold text-amber-700">如何加载（一次性，约 1 分钟）</summary>
                        <ol className="mt-1.5 list-inside list-decimal space-y-1 text-xs text-amber-700">
                          <li>打开 Chrome，地址栏输入 <code className="rounded bg-white px-1 font-mono">chrome://extensions</code> 并回车。</li>
                          <li>打开右上角「开发者模式」开关。</li>
                          <li>点击「加载已解压的扩展程序」，选择扩展文件夹：<code className="rounded bg-white px-1 font-mono">qingxuan-1688-helper</code>。</li>
                        </ol>
                        <button
                          type="button"
                          disabled={checkingTools}
                          onClick={() => void refreshTools()}
                          className="mt-2 rounded border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                          data-testid="sourcing-extension-recheck"
                        >
                          {checkingTools ? "正在检测…" : "已加载，重新检测"}
                        </button>
                      </details>
                    </div>
                  )
                ) : !localEnvRequired ? (
                  <p className="mt-1.5 text-xs text-slate-400">
                    浏览器助手已连接。请确认已在普通 Chrome 中登录 1688（系统无法代替确认登录态）；1688 图搜会打开本地浏览器窗口（需前台运行）。
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-500">已有 1688 链接</p>
                  {localEnvRequired ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">需要本地研究环境</span>
                  ) : caps.cliReady ? (
                    <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">1688 登录 ✓</span>
                  ) : caps.cliToolAvailable ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">需登录 1688</span>
                  ) : (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500">组件未安装</span>
                  )}
                </div>
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
                    disabled={!offerUrl.trim() || status === "searching" || !caps.cliReady || (localEnvRequired && !demoMode)}
                    onClick={() => void runSearch("url", { url: offerUrl.trim() })}
                    className="linear-button inline-flex h-9 items-center justify-center px-3 text-sm font-semibold disabled:opacity-50"
                    data-testid="sourcing-url-submit"
                  >
                    读取
                  </button>
                </div>
                {!localEnvRequired ? (
                  !caps.cliToolAvailable ? (
                    <p className="mt-1.5 text-xs text-amber-600">链接读取组件尚未安装，安装完成后即可使用（见顶部提示）。</p>
                  ) : !caps.cliReady ? (
                    <p className="mt-1.5 text-xs text-amber-600">需要先登录 1688 后使用（见顶部登录提示）。</p>
                  ) : null
                ) : null}
              </div>
            </div>
          )}

          {/* R1：重新检测反馈（时间戳 + 结果摘要） */}
          {lastCheckAt ? (
            <p className="mt-2 text-xs text-slate-500" data-testid="sourcing-check-feedback">
              刚刚检测：{lastCheckAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
              {checkResult ? ` · ${checkResult}` : ""}
            </p>
          ) : null}

          {/* ── Preview（Search Results ≠ Evidence） ── */}
          {preview && (
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-700">
                  搜索结果（{preview.candidates.length} 条）— 需人工确认后才成为供应线索
                </p>
                {previewDemo && (
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800" data-testid="demo-sample-badge">
                    演示数据（示例供应线索，非实时采集）
                  </span>
                )}
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
                        <SourcingCandidateThumb imageUrl={candidate.images[0]} offerId={candidate.offerId} />
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
