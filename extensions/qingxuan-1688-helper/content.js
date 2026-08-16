/**
 * Qingxuan 1688 Sourcing Helper — content script（V3.5 正式版）
 *
 * 固定能力（非通用浏览器 Agent；§8 capability allowlist）：
 *   getState  — 页面状态（分类 / 上传入口 proof / 预览 proof / 结果页分类）
 *   upload    — 候选图注入（DataTransfer + files 原型 setter；§13-§15 Identity Proof）
 *   submit    — “搜索图片”触发（resolver v2 + composed 事件；§17-§19 Trigger Proof）
 *   collect   — 结果卡片提取（data-renderkey offerId；§20；§38 守卫拒绝推荐流）
 *
 * 消息协议（§29）：typed message {type, version, jobId, payload}；action allowlist；
 * 未知 action reject；不执行任意 payload。
 *
 * 版本化 resolver（§17）：
 *   native-1688-upload-resolver.v2
 *   native-1688-image-submit-resolver.v2（定位+事件执行分离）
 *   native-1688-result-extractor.v2
 *
 * 禁止：任意 eval / 任意 selector 注入 / Cookie 读取 / Token 读取 / 任意 URL。
 */

(() => {
  "use strict";

  const MESSAGE_VERSION = "1.0";
  const UPLOAD_RESOLVER_VERSION = "native-1688-upload-resolver.v2";
  const SUBMIT_RESOLVER_VERSION = "native-1688-image-submit-resolver.v2";
  const EXTRACTOR_VERSION = "native-1688-result-extractor.v2";
  const MAX_CARDS = 60;

  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function fail(code, message) {
    return { ok: false, code, message };
  }

  // ── 页面分类 ─────────────────────────────

  function classifyPage() {
    const href = location.href;
    let pageKind = "unknown";
    if (/^https:\/\/s\.1688\.com\//.test(href)) pageKind = "upload_page";
    else if (/^https:\/\/air\.1688\.com\//.test(href) && new URL(href).searchParams.get("tab") === "imageSearch") {
      pageKind = "result_page";
    } else if (/login|signin/i.test(href)) pageKind = "login_wall";
    else if (/captcha|verify/i.test(href)) pageKind = "risk_control";
    return pageKind;
  }

  // ── getState：上传入口 proof（§16：证明属于 1688 图搜组件，非任意 file input） ──

  function uploadTargetReport() {
    const fileInputs = Array.from(document.querySelectorAll("input[type=file]"));
    const target = document.querySelector('input[type=file]#img-search-upload');
    const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : null;
    const found = target instanceof HTMLInputElement;
    return {
      found,
      unique: fileInputs.length === 1 && fileInputs[0] === target,
      visible: found && rect !== null && rect.width > 0 && rect.height > 0,
      enabled: found && !target.disabled,
      y: found && rect ? Math.round(rect.y + rect.height / 2) : null,
      reasonCodes: found ? [] : ["upload_target_not_found"],
    };
  }

  function previewReport() {
    const previewImages = Array.from(document.querySelectorAll("img")).filter((img) => {
      const src = img.currentSrc || img.src || "";
      return src.startsWith("data:image/");
    });
    const first = previewImages[0];
    return {
      confirmed: previewImages.length > 0,
      count: previewImages.length,
      srcLength: first ? (first.currentSrc || first.src).length : 0,
    };
  }

  function resultPageReport() {
    const url = new URL(location.href);
    const tabImageSearch = url.searchParams.get("tab") === "imageSearch";
    const imageIdInUrl = /imageId=\d{10,}/.test(location.href);
    const bodyText = (document.body && document.body.innerText || "").replace(/\s+/g, " ").slice(0, 4000);
    const fallbackMarkers = ["热门推荐", "大家都在搜", "猜你喜欢"];
    const hasFallbackMarker = fallbackMarkers.some((marker) => bodyText.includes(marker));
    return {
      resultsReady: tabImageSearch && imageIdInUrl && !hasFallbackMarker,
      isFallbackRecommendation: !tabImageSearch || !imageIdInUrl || hasFallbackMarker,
      imageIdInUrl,
      pageUrl: location.href,
      reasonCodes: [
        ...(!tabImageSearch ? ["result_tab_missing"] : []),
        ...(!imageIdInUrl ? ["image_id_missing"] : []),
        ...(hasFallbackMarker ? ["fallback_marker_present"] : []),
      ],
    };
  }

  // ── upload：DataTransfer 注入（R1 实证路径；§14） ──

  async function uploadCandidateImage(payload) {
    const imageBase64 = payload && typeof payload.imageBase64 === "string" ? payload.imageBase64 : "";
    if (!imageBase64) return fail("invalid_image_payload", "缺少图片字节（base64）。");
    let array;
    try {
      const binary = atob(imageBase64);
      array = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
    } catch {
      return fail("invalid_image_payload", "图片 base64 解码失败。");
    }
    const target = document.querySelector('input[type=file]#img-search-upload');
    if (!(target instanceof HTMLInputElement)) {
      return fail("upload_target_not_found", "未找到 1688 图搜上传入口（input#img-search-upload）。");
    }
    try {
      const file = new File([array], "candidate-image.jpg", { type: "image/jpeg" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set;
      if (!setter) return fail("no_files_setter", "浏览器不支持 files setter。");
      setter.call(target, dt.files);
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, files: target.files.length, resolverVersion: UPLOAD_RESOLVER_VERSION };
    } catch (error) {
      return fail("inject_failed", String(error).slice(0, 200));
    }
  }

  // ── submit resolver v2（§17：定位与事件执行分离；R1 实证 + chrome.dom 评估） ──

  function findSubmitCandidates() {
    const candidates = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll("*")) {
        const text = (el.innerText || "").replace(/\s+/g, " ").trim();
        const hasSearchBtnClass = typeof el.className === "string" && el.className.split(/\s+/).includes("search-btn");
        if (hasSearchBtnClass || text === "搜索图片") {
          candidates.push(el);
        }
        let shadow = null;
        if (el.shadowRoot) {
          shadow = el.shadowRoot;
        } else if (typeof chrome !== "undefined" && chrome.dom && chrome.dom.openOrClosedShadowRoot) {
          try {
            shadow = chrome.dom.openOrClosedShadowRoot(el);
          } catch {
            shadow = null;
          }
        }
        if (shadow) walk(shadow);
      }
    };
    walk(document);
    return candidates;
  }

  function submitProof(candidate) {
    if (!(candidate instanceof HTMLElement)) return { found: false, reasonCodes: ["not_element"] };
    const rect = candidate.getBoundingClientRect();
    const text = (candidate.innerText || "").replace(/\s+/g, " ").trim();
    const visible = rect.width > 0 && rect.height > 0;
    const inViewport = visible && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    const enabled = !(candidate.disabled === true);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    let atPoint = null;
    try {
      atPoint = document.elementFromPoint(cx, cy);
    } catch {
      atPoint = null;
    }
    const hit = atPoint === candidate || (atPoint !== null && candidate.contains(atPoint));
    return {
      found: visible && enabled && text === "搜索图片",
      unique: true,
      visible,
      inViewport,
      enabled,
      text,
      x: Math.round(cx),
      y: Math.round(cy),
      hit,
      reasonCodes: [
        ...(!visible ? ["not_visible"] : []),
        ...(!enabled ? ["disabled"] : []),
        ...(text !== "搜索图片" ? ["wrong_text"] : []),
        ...(!hit ? ["element_from_point_mismatch"] : []),
      ],
    };
  }

  async function submitImageSearch() {
    let candidates = findSubmitCandidates();
    if (candidates.length === 0) {
      return fail("search_trigger_not_confirmed", `未找到“搜索图片”按钮（candidates=0）。`);
    }
    let best = null;
    let bestProof = null;
    for (const candidate of candidates) {
      const proof = submitProof(candidate);
      if (proof.found && proof.inViewport) {
        best = candidate;
        bestProof = proof;
        break;
      }
    }
    if (!best) {
      const first = candidates.find((candidate) => submitProof(candidate).found);
      if (!first) return fail("search_trigger_not_confirmed", `按钮文本/状态不匹配（candidates=${candidates.length}）。`);
      first.scrollIntoView({ block: "center", behavior: "instant" });
      await new Promise((resolveWait) => setTimeout(resolveWait, 800));
      candidates = findSubmitCandidates();
      for (const candidate of candidates) {
        const proof = submitProof(candidate);
        if (proof.found && proof.inViewport) {
          best = candidate;
          bestProof = proof;
          break;
        }
      }
    }
    if (!best || !bestProof) return fail("search_trigger_not_confirmed", "滚动后仍未找到视口内按钮。");

    // 点击前实时重证明（Wrong Click 门禁；stale 防护）
    const recheck = submitProof(best);
    if (!recheck.found || recheck.x === null || recheck.y === null) {
      return fail("search_trigger_not_confirmed", "按钮已变化（stale），已停止（Wrong Click 门禁）。");
    }
    // 事件执行器（resolver v2 分离）：dispatch 到 elementFromPoint 命中元素；composed:true 穿透 closed shadow（R1 实证）
    let target = null;
    try {
      target = document.elementFromPoint(recheck.x, recheck.y);
    } catch {
      target = null;
    }
    if (!(target instanceof Element)) target = best;
    let clickable = target;
    while (clickable && clickable !== document.body) {
      const tag = clickable.tagName.toLowerCase();
      if (tag === "button" || tag === "a" || (typeof clickable.className === "string" && clickable.className.split(/\s+/).includes("search-btn"))) {
        break;
      }
      clickable = clickable.parentElement;
    }
    const dispatchTarget = clickable instanceof Element ? clickable : best;
    const rect = dispatchTarget.getBoundingClientRect();
    const cx = rect.width > 0 ? rect.x + rect.width / 2 : recheck.x;
    const cy = rect.height > 0 ? rect.y + rect.height / 2 : recheck.y;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      dispatchTarget.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: cx,
        clientY: cy,
      }));
    }
    if (dispatchTarget instanceof HTMLElement) dispatchTarget.click();
    return {
      ok: true,
      method: "dom_dispatch",
      resolverVersion: SUBMIT_RESOLVER_VERSION,
      text: recheck.text,
      targetTag: dispatchTarget.tagName,
      cx,
      cy,
    };
  }

  // ── collect：结果卡片提取（§20：data-renderkey offerId；同卡片绑定；bounded；dedupe） ──

  function offerIdFromElement(el) {
    const renderKey = el.getAttribute("data-renderkey") || "";
    const m = renderKey.match(/_(\d{5,20})$/);
    if (m) return m[1];
    for (const attr of ["data-offerid", "data-offer-id", "data-id", "data-itemid"]) {
      const value = el.getAttribute(attr);
      if (value && /^\d{5,20}$/.test(value)) return value;
    }
    for (const a of el.querySelectorAll("a[href]")) {
      const href = a.href || "";
      const m1 = href.match(/\/offer\/(\d{5,20})/);
      if (m1) return m1[1];
      const m2 = href.match(/[?&]offerId=(\d{5,20})/);
      if (m2) return m2[1];
    }
    return null;
  }

  function collectImageResults() {
    const cards = [];
    const seen = new Set();
    const visit = (root) => {
      const containers = Array.from(root.querySelectorAll(
        '[class*="searchOfferItem"], [class*="offerItem"], [data-renderkey], [data-offerid], [data-offer-id]',
      ));
      for (const container of containers) {
        const offerId = offerIdFromElement(container);
        if (!offerId || seen.has(offerId)) continue;
        seen.add(offerId);
        const text = (container.innerText || "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        const img = container.querySelector("img");
        const priceRaw = text.match(/(?:¥|￥)\s*(\d+(?:\s*\.\s*\d+)?)/);
        const priceText = priceRaw ? `¥${priceRaw[1].replace(/\s+/g, "")}` : null;
        const moqRaw = text.match(/(\d+)\s*件起批/);
        const moqText = moqRaw ? `${moqRaw[1]}件起批` : null;
        cards.push({
          offerId,
          title: text.slice(0, 200),
          priceText,
          moqText,
          supplierName: null,
          imageUrl: img ? (img.currentSrc || img.src || "").slice(0, 300) : null,
          detailUrl: `https://detail.1688.com/offer/${offerId}.html`,
          entityBound: true,
        });
        if (cards.length >= MAX_CARDS) return;
      }
      for (const el of root.querySelectorAll("*")) {
        let shadow = null;
        if (el.shadowRoot) shadow = el.shadowRoot;
        else if (typeof chrome !== "undefined" && chrome.dom && chrome.dom.openOrClosedShadowRoot) {
          try { shadow = chrome.dom.openOrClosedShadowRoot(el); } catch { shadow = null; }
        }
        if (shadow && cards.length < MAX_CARDS) visit(shadow);
      }
    };
    visit(document);
    return { cards: cards.slice(0, MAX_CARDS), extractorVersion: EXTRACTOR_VERSION };
  }

  // ── 消息分发（typed + version + action allowlist；§29） ──

  const ACTIONS = new Set(["getState", "upload", "submit", "collect"]);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isRecord(message) || message.version !== MESSAGE_VERSION || !ACTIONS.has(message.type)) {
      sendResponse({ ok: false, code: "unknown_action", version: MESSAGE_VERSION });
      return false;
    }
    const handler = (async () => {
      switch (message.type) {
        case "getState":
          return {
            ok: true,
            pageKind: classifyPage(),
            pageUrl: location.href,
            uploadTarget: uploadTargetReport(),
            preview: previewReport(),
            resultPage: resultPageReport(),
          };
        case "upload":
          return await uploadCandidateImage(message.payload);
        case "submit":
          return await submitImageSearch();
        case "collect":
          // §38 守卫：只有 Native 结果页才提取；上传页推荐流 ≠ 图搜结果
          if (classifyPage() !== "result_page" || !resultPageReport().resultsReady) {
            return { ok: false, code: "not_result_page", pageKind: classifyPage(), pageUrl: location.href.slice(0, 160) };
          }
          return { ok: true, ...collectImageResults() };
        default:
          return fail("unknown_action", String(message.type));
      }
    })();
    handler.then((result) => sendResponse(result)).catch((error) => sendResponse(fail("internal_error", String(error).slice(0, 200))));
    return true; // async sendResponse
  });

  // MV3 SW 心跳（§30）：SW 空闲 30s 终止；定时消息保活 + 驱动 bridge 轮询。
  // 后台 tab 的 setInterval 会被节流 → 页面回前台/聚焦时补发。
  const heartbeat = () => {
    try {
      chrome.runtime.sendMessage({ type: "heartbeat" }).catch(() => undefined);
    } catch {
      // SW 未就绪时忽略
    }
  };
  setInterval(heartbeat, 2000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") heartbeat();
  });
  window.addEventListener("focus", heartbeat);
})();
