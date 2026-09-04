import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { KeywordStrategyCard } from "./KeywordStrategyCard";
import { CompetitorStrategyCard } from "./CompetitorStrategyCard";
import { KeywordPendingSubmitCard } from "./KeywordPendingSubmitCard";
import { buildSaveSummaryWithTone } from "./BrowserUseCollectButton";
import {
  storeBrowserUsePreview,
  claimBrowserUsePreview,
  restoreBrowserUsePreviewClaim,
  takeBrowserUsePreview,
  _clearBrowserUsePreviewCacheForTests,
  type BrowserUseResearchPreviewV1,
} from "@/lib/server/browserUseResearch";

/* ── Lightweight FakeDOM for Node Vitest Environment ── */

type Listener = (event: FakeEvent) => void;

class FakeEvent {
  type: string;
  target: FakeNode;
  currentTarget: FakeNode | null = null;
  bubbles: boolean;
  defaultPrevented = false;
  constructor(type: string, target: FakeNode, bubbles = true) {
    this.type = type;
    this.target = target;
    this.bubbles = bubbles;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() {}
}

class FakeNode {
  nodeType = 0;
  nodeName = "";
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  ownerDocument: FakeDocument = null as unknown as FakeDocument;
  listeners = new Map<string, Listener[]>();
  addEventListener(name: string, fn: Listener) {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
  }
  removeEventListener(name: string, fn: Listener) {
    const list = this.listeners.get(name) ?? [];
    this.listeners.set(name, list.filter((item) => item !== fn));
  }
  dispatchEvent(event: FakeEvent): boolean {
    const chain: FakeNode[] = [];
    let cursor: FakeNode | null = this;
    while (cursor) { chain.push(cursor); cursor = cursor.parentNode; }
    for (const node of chain) {
      for (const fn of node.listeners.get(event.type) ?? []) {
        event.currentTarget = node;
        fn(event);
      }
    }
    return !event.defaultPrevented;
  }
  getRootNode(): FakeNode { return this.ownerDocument; }
  contains(node: FakeNode | null): boolean {
    let cursor: FakeNode | null = node;
    while (cursor) { if (cursor === this) return true; cursor = cursor.parentNode; }
    return false;
  }
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): FakeNode | null { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get parentElement(): FakeNode | null { return this.parentNode; }
  get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[idx + 1] ?? null;
  }
  appendChild(child: FakeNode): FakeNode {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore(child: FakeNode, before: FakeNode | null): FakeNode {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const idx = before ? this.childNodes.indexOf(before) : -1;
    if (idx >= 0) this.childNodes.splice(idx, 0, child);
    else this.childNodes.push(child);
    return child;
  }
  removeChild(child: FakeNode): FakeNode {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) this.childNodes.splice(idx, 1);
    child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get textContent(): string {
    if (this.nodeType === 3) return (this as unknown as FakeText).text;
    return this.childNodes.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    this.childNodes = [];
    if (value) this.appendChild(this.ownerDocument.createTextNode(value));
  }
}

class FakeText extends FakeNode {
  text: string;
  get nodeValue(): string { return this.text; }
  set nodeValue(value: string) { this.text = value; }
  get data(): string { return this.text; }
  set data(value: string) { this.text = value; }
  constructor(doc: FakeDocument, text: string) {
    super();
    this.nodeType = 3;
    this.nodeName = "#text";
    this.ownerDocument = doc;
    this.text = text;
  }
}

const SIMPLE_TAG = /^[a-z][a-z0-9]*$/i;
class FakeElement extends FakeNode {
  tagName: string;
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = "";
  get disabled(): boolean { return this.attributes.has("disabled"); }
  set disabled(value: boolean) {
    if (value) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }
  get title(): string { return this.attributes.get("title") ?? ""; }
  set title(value: string) { this.setAttribute("title", value); }
  get type(): string { return this.attributes.get("type") ?? ""; }
  set type(value: string) { this.setAttribute("type", value); }
  constructor(doc: FakeDocument, tagName: string) {
    super();
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = doc;
  }
  setAttribute(name: string, value: string) {
    if (name.startsWith("data-")) this.dataset[name.slice(5)] = String(value);
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
    if (name === "id") this.ownerDocument.registerElement(this);
  }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  focus() { this.ownerDocument.activeElement = this; }
  querySelector(selector: string): FakeElement | null {
    const parts = selector.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return null;
    const walk = (node: FakeNode): FakeElement | null => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType !== 1) continue;
        const el = child as FakeElement;
        const m = parts[0].match(/^\[data-testid="?([^"\]]+)"?\]$/);
        const match = m ? el.getAttribute("data-testid") === m[1] : el.tagName === parts[0].toUpperCase();
        if (match) {
          if (parts.length === 1) return el;
          const rest = selector.replace(parts[0], "").trim();
          if (rest) {
            const deep = el.querySelector(rest);
            if (deep) return deep;
          }
        }
        const deep = walk(el);
        if (deep) return deep;
      }
      return null;
    };
    return walk(this);
  }
}

class FakeDocument extends FakeNode {
  body: FakeElement;
  activeElement: FakeElement | null = null;
  private elementById = new Map<string, FakeElement>();
  constructor() {
    super();
    this.nodeType = 9;
    this.nodeName = "#document";
    this.ownerDocument = this;
    this.body = new FakeElement(this, "body");
    this.appendChild(this.body);
  }
  get defaultView() { return (globalThis as unknown as { window: unknown }).window; }
  createElement(tagName: string): FakeElement { return new FakeElement(this, tagName); }
  createElementNS(_ns: string, tagName: string): FakeElement { return new FakeElement(this, tagName); }
  createTextNode(text: string): FakeText { return new FakeText(this, text); }
  createEvent() { return new FakeEvent("event", this); }
  registerElement(el: FakeElement) {
    const id = el.getAttribute("id");
    if (id) this.elementById.set(id, el);
  }
  getElementById(id: string): FakeElement | null { return this.elementById.get(id) ?? null; }
}

let documentInstance: FakeDocument;
let container: FakeElement;
let root: Root | null = null;

function installGlobals() {
  documentInstance = new FakeDocument();
  container = documentInstance.createElement("div");
  container.setAttribute("id", "root");
  documentInstance.body.appendChild(container);
  documentInstance.registerElement(container);
  const g = globalThis as Record<string, unknown>;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.document = documentInstance;
  g.window = {
    document: documentInstance,
    HTMLIFrameElement: class HTMLIFrameElement {},
  };
}

function samplePreview(): BrowserUseResearchPreviewV1 {
  return {
    schema: "browser-use-research-preview.v1",
    version: 1,
    kind: "keyword",
    seedAsin: "B0SAMPLE12",
    marketplace: "US",
    seedProductUrl: null,
    sourceUrl: "https://www.amazon.com/dp/B0SAMPLE12",
    capturedAt: "2026-08-14T02:00:00.000Z",
    results: [
      { keyword: "kitchen organizer", keywordTranslation: "厨房整理架", searchVolume: 12000, relevance: 85, competition: null, abaWeeklyRank: null, purchaseVolume: null, capturedAt: "2026-08-14T02:00:00.000Z" },
      { keyword: "drawer divider", keywordTranslation: "抽屉分隔板", searchVolume: 9500, relevance: 80, competition: null, abaWeeklyRank: null, purchaseVolume: null, capturedAt: "2026-08-14T02:00:00.000Z" },
    ],
    missing: [],
    failureReason: null,
    collector: { tool: "browser-use", version: "0.1.9" },
  };
}

describe("Evidence Card Flow 闭环回归测试（10大关键断言）", () => {
  beforeEach(() => {
    _clearBrowserUsePreviewCacheForTests();
    installGlobals();
    root = null;
  });

  afterEach(async () => {
    if (root) {
      await act(async () => { root?.unmount(); });
      root = null;
    }
    vi.restoreAllMocks();
  });

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  const render = async (element: React.ReactElement) => {
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(element);
    });
    await flush();
  };

  /* ── 8. briefEvidenceCount=0 + keywordPending -> 「确认并用于 Listing」 disabled ── */
  it("断言 8: briefEvidenceCount=0 且有 keywordPending 时，按钮禁用并显示「先保存关键词证据」", async () => {
    await render(
      createElement(KeywordStrategyCard, {
        rows: [],
        productName: "Drawer Organizer",
        briefPrimary: null,
        briefEvidenceCount: 0,
        inListing: false,
        needsReconfirm: false,
        hasPending: true,
        pendingKeywordCount: 5,
        onSave: async () => null,
        onSaved: () => {},
      })
    );

    const btn = container.querySelector("[data-testid=kw-adjust]");
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toBe("先保存关键词证据");
    expect(btn?.title).toBe("保存本次采集结果后，才能确认关键词方案。");

    const status = container.querySelector("[data-testid=kw-status]");
    expect(status?.textContent).toContain("状态：已采集 5 条关键词 · 待确认保存");
  });

  /* ── briefEvidenceCount=0 + no pending -> 「等待采集」 disabled ── */
  it("briefEvidenceCount=0 且无 pending 时，按钮禁用并显示「等待采集」", async () => {
    await render(
      createElement(KeywordStrategyCard, {
        rows: [],
        productName: "Drawer Organizer",
        briefPrimary: null,
        briefEvidenceCount: 0,
        inListing: false,
        needsReconfirm: false,
        hasPending: false,
        onSave: async () => null,
        onSaved: () => {},
      })
    );

    const btn = container.querySelector("[data-testid=kw-adjust]");
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toBe("等待采集");
    expect(btn?.title).toBe("请先通过下方「采集关键词+竞品」获取证据");

    const status = container.querySelector("[data-testid=kw-status]");
    expect(status?.textContent).toContain("状态：待确认");
  });

  /* ── 9. briefEvidenceCount>0 -> 「确认并用于 Listing」 enabled ── */
  it("断言 9: briefEvidenceCount>0 时，「确认并用于 Listing」 按钮启用", async () => {
    await render(
      createElement(KeywordStrategyCard, {
        rows: [{ keyword: "organizer", rowNumber: 1 }],
        productName: "Drawer Organizer",
        briefPrimary: null,
        briefEvidenceCount: 3,
        inListing: false,
        needsReconfirm: false,
        hasPending: false,
        onSave: async () => null,
        onSaved: () => {},
      })
    );

    const btn = container.querySelector("[data-testid=kw-adjust]");
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(false);
    expect(btn?.textContent).toBe("确认并用于 Listing");

    const status = container.querySelector("[data-testid=kw-status]");
    expect(status?.textContent).toContain("已采集3条关键词，尚未确认方案");
  });

  /* ── briefPrimary 已确认时 -> 「调整关键词方案」 enabled ── */
  it("briefPrimary 已有时，按钮显示「调整关键词方案」且启用", async () => {
    await render(
      createElement(KeywordStrategyCard, {
        rows: [{ keyword: "organizer", rowNumber: 1 }],
        productName: "Drawer Organizer",
        briefPrimary: "silver drawer organizer",
        briefEvidenceCount: 3,
        inListing: true,
        needsReconfirm: false,
        hasPending: false,
        onSave: async () => null,
        onSaved: () => {},
      })
    );

    const btn = container.querySelector("[data-testid=kw-adjust]");
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(false);
    expect(btn?.textContent).toBe("调整关键词方案");

    const status = container.querySelector("[data-testid=kw-status]");
    expect(status?.textContent).toContain("状态：已确认");
    expect(status?.textContent).toContain("Listing：已用于 Listing");
  });

  /* ── pendingPanel 内嵌在 KeywordStrategyCard 内部 ── */
  it("pendingPanel 内嵌在 KeywordStrategyCard 底部的 data-testid=kw-pending-slot 中", async () => {
    const dummyPanel = createElement("div", { "data-testid": "mock-pending-panel" }, "Pending Content");
    await render(
      createElement(KeywordStrategyCard, {
        rows: [],
        productName: "Drawer Organizer",
        briefPrimary: null,
        briefEvidenceCount: 0,
        inListing: false,
        needsReconfirm: false,
        hasPending: true,
        pendingPanel: dummyPanel,
        onSave: async () => null,
        onSaved: () => {},
      })
    );

    const slot = container.querySelector("[data-testid=kw-pending-slot]");
    expect(slot).not.toBeNull();
    expect(slot?.querySelector("[data-testid=mock-pending-panel]")).not.toBeNull();
  });

  /* ── 2. preview TTL expired -> save -> preview_not_found -> UI expired -> save button gone ── */
  it("断言 2: 预览过期调用保存返回 preview_not_found，卡片进入 expired 态且保存按钮消失", async () => {
    let expiredFired = false;
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, error: { code: "preview_not_found", message: "预览不存在或已过期，请重新采集。" } }),
    }));

    await render(
      createElement(KeywordPendingSubmitCard, {
        taskId: "task-1",
        preview: {
          previewId: "bup_preview_expired1",
          seedAsin: "B0SAMPLE12",
          sourceUrl: "https://www.amazon.com/dp/B0SAMPLE12",
          keywordCount: 10,
          capturedAt: null,
        },
        storageVersion: { resultJsonHash: "hash1", updatedAt: "time1" },
        onSaved: () => {},
        onCancel: () => {},
        onExpired: () => { expiredFired = true; },
      })
    );

    const saveBtn = container.querySelector("[data-testid=keyword-pending-save]");
    expect(saveBtn).not.toBeNull();

    // 点击保存，模拟触发过期响应
    await act(async () => {
      saveBtn?.dispatchEvent(new FakeEvent("click", saveBtn));
    });
    await flush();

    expect(expiredFired).toBe(true);
    // 保存按钮消失
    expect(container.querySelector("[data-testid=keyword-pending-save]")).toBeNull();
    // 呈现失效状态文案
    const title = container.querySelector("[data-testid=kw-expired-title]");
    expect(title?.textContent).toBe("本次关键词预览已失效，未保存任何关键词。");
    expect(container.textContent).toContain("请重新执行“采集关键词+竞品”获得新的预览。");
  });

  /* ── 3. expired state -> recollect / cancel buttons ── */
  it("断言 3: expired 态下点击重新采集触发 onRecollect，点击放弃触发 onCancel", async () => {
    let recollectFired = false;
    let cancelFired = false;
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, error: { code: "preview_not_found" } }),
    }));

    await render(
      createElement(KeywordPendingSubmitCard, {
        taskId: "task-1",
        preview: {
          previewId: "bup_preview_expired2",
          seedAsin: "B0SAMPLE12",
          sourceUrl: "https://www.amazon.com/dp/B0SAMPLE12",
          keywordCount: 10,
          capturedAt: null,
        },
        storageVersion: { resultJsonHash: "hash1", updatedAt: "time1" },
        onSaved: () => {},
        onCancel: () => { cancelFired = true; },
        onRecollect: () => { recollectFired = true; },
      })
    );

    const saveBtn = container.querySelector("[data-testid=keyword-pending-save]");
    await act(async () => { saveBtn?.dispatchEvent(new FakeEvent("click", saveBtn)); });
    await flush();

    const recollectBtn = container.querySelector("[data-testid=keyword-pending-recollect]");
    expect(recollectBtn).not.toBeNull();
    await act(async () => { recollectBtn?.dispatchEvent(new FakeEvent("click", recollectBtn)); });
    expect(recollectFired).toBe(true);

    const cancelBtn = container.querySelector("[data-testid=keyword-pending-cancel]");
    expect(cancelBtn).not.toBeNull();
    await act(async () => { cancelBtn?.dispatchEvent(new FakeEvent("click", cancelBtn)); });
    expect(cancelFired).toBe(true);
  });

  /* ── 1. fresh keyword preview -> save success -> onSaved called ── */
  it("断言 1: fresh preview 保存成功触发 onSaved 回调", async () => {
    let savedFired = false;
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { savedCount: 2 } }),
    }));

    await render(
      createElement(KeywordPendingSubmitCard, {
        taskId: "task-1",
        preview: {
          previewId: "bup_preview_fresh1",
          seedAsin: "B0SAMPLE12",
          sourceUrl: "https://www.amazon.com/dp/B0SAMPLE12",
          keywordCount: 2,
          capturedAt: null,
        },
        storageVersion: { resultJsonHash: "hash1", updatedAt: "time1" },
        onSaved: () => { savedFired = true; },
        onCancel: () => {},
      })
    );

    const saveBtn = container.querySelector("[data-testid=keyword-pending-save]");
    await act(async () => { saveBtn?.dispatchEvent(new FakeEvent("click", saveBtn)); });
    await flush();

    expect(savedFired).toBe(true);
  });

  /* ── 4 & 5 & 6. CAS conflict claim restoration and single-claim semantics ── */
  it("断言 4, 5, 6: 原子 claim、防二次消费、CAS冲突恢复后重试成功", async () => {
    const previewData = samplePreview();
    const previewId = storeBrowserUsePreview(previewData);

    // 断言 6: 并发 claim 只有 1 个成功
    const [c1, c2] = [claimBrowserUsePreview(previewId), claimBrowserUsePreview(previewId)];
    expect(c1).not.toBeNull();
    expect(c2).toBeNull();

    // 断言 5: 已消费 preview 不得再次 claim
    expect(takeBrowserUsePreview(previewId)).toBeNull();

    // 断言 4: CAS 冲突未落库时恢复 claim
    const restored = restoreBrowserUsePreviewClaim(previewId, c1!);
    expect(restored).toBe(true);

    // 恢复后可重新 claim 并重试成功
    const retryClaim = claimBrowserUsePreview(previewId);
    expect(retryClaim).not.toBeNull();
    expect(retryClaim?.preview.results).toEqual(previewData.results);

    // 再次 claim 变空
    expect(claimBrowserUsePreview(previewId)).toBeNull();
  });

  /* ── 7. EvidenceWorkbench only 1 「采集关键词+竞品」 button ── */
  it("断言 7: EvidenceWorkbench 源代码结构验证仅有 1 个「采集关键词+竞品」按钮（BrowserUseCollectButton showTrigger={false}）", () => {
    const wbSource = readFileSync(resolve(process.cwd(), "components/evidence/EvidenceWorkbench.tsx"), "utf8");
    const cardSource = readFileSync(resolve(process.cwd(), "components/evidence/CompetitorStrategyCard.tsx"), "utf8");
    const btnSource = readFileSync(resolve(process.cwd(), "components/evidence/BrowserUseCollectButton.tsx"), "utf8");

    // CompetitorStrategyCard 拥有主采集按钮
    expect(cardSource).toContain("采集关键词+竞品");

    // BrowserUseCollectButton 支持 showTrigger = true 默认值
    expect(btnSource).toContain("showTrigger = true");

    // EvidenceWorkbench 中传入 showTrigger={false}
    expect(wbSource).toContain("showTrigger={false}");

    // 确保 EvidenceWorkbench 不直接放置第二个采集按钮文案
    expect((wbSource.match(/采集关键词\+竞品/g) || []).length).toBe(0);
  });

  /* ── 10. saved=0 + duplicate only -> 「没有新增竞品」 ── */
  it("断言 10: saved=0 且全部为重复时，返回「没有新增竞品：4 条已在列表中，已跳过重复项。」且 tone 为 neutral", () => {
    const skipped = [
      { asin: "B001", code: "duplicate_asin" },
      { asin: "B002", code: "duplicate_asin" },
      { asin: "B003", code: "duplicate_asin" },
      { asin: "B004", code: "duplicate_asin" },
    ];
    const summary = buildSaveSummaryWithTone(0, skipped);
    expect(summary.tone).toBe("neutral");
    expect(summary.message).toBe("没有新增竞品：4 条已在列表中，已跳过重复项。");
  });

  it("buildSaveSummaryWithTone 覆盖各种保存场景", () => {
    // 场景 A: saved > 0 无跳过
    expect(buildSaveSummaryWithTone(3, [])).toEqual({
      message: "已保存 3 条自动采集证据。",
      tone: "success",
    });

    // 场景 B: saved > 0 有重复
    expect(buildSaveSummaryWithTone(2, [{ asin: "B001", code: "duplicate_asin" }])).toEqual({
      message: "新增保存 2 条竞品；1 条已在列表中，已跳过重复项。",
      tone: "success",
    });

    // 场景 C: saved = 0 且只有冲突
    expect(buildSaveSummaryWithTone(0, [{ asin: "B001", code: "task_result_conflict" }])).toEqual({
      message: "部分竞品未保存：内容版本已更新，请刷新后重试。",
      tone: "warning",
    });

    // 场景 D: saved = 0 且达到上限
    expect(buildSaveSummaryWithTone(0, [{ asin: "B001", code: "competitor_evidence_limit_exceeded" }])).toEqual({
      message: "竞品未保存：已达到竞品数量上限（1 条未添加）。",
      tone: "warning",
    });
  });
});
