import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/* ── BrowserUseCollectButton 真实行为测试（轮 9 收口） ── */
/* FakeDOM 基础设施与 CompetitorStrategyCard.dom.test.ts 同构。 */

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
  disabled = false;
  get open(): boolean { return this.attributes.has("open"); }
  set open(value: boolean) {
    if (value) this.setAttribute("open", "");
    else this.removeAttribute("open");
  }
  constructor(doc: FakeDocument, tagName: string) {
    super();
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = doc;
  }
  setAttribute(name: string, value: string) {
    if (name.startsWith("data-")) {
      this.dataset[name.slice(5)] = String(value);
    }
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
    if (name === "id") this.ownerDocument.registerElement(this);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  focus(_options?: { preventScroll?: boolean }) { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  querySelector(selector: string): FakeElement | null {
    const parts = selector.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return null;
    const walk = (node: FakeNode): FakeElement | null => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType !== 1) continue;
        const el = child as FakeElement;
        if (this.matchesSimple(el, parts[0])) {
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
  private matchesSimple(el: FakeElement, part: string): boolean {
    if (SIMPLE_TAG.test(part)) return el.tagName === part.toUpperCase();
    const m = part.match(/^\[data-testid="?([^"\]]+)"?\]$/);
    if (m) return el.getAttribute("data-testid") === m[1];
    return false;
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
  }
  createElement(tagName: string): FakeElement { return new FakeElement(this, tagName); }
  createElementNS(_ns: string, tagName: string): FakeElement { return new FakeElement(this, tagName); }
  createTextNode(text: string): FakeText { return new FakeText(this, text); }
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

beforeEach(() => {
  root = null;
  installGlobals();
});

afterEach(async () => {
  if (root) {
    await act(async () => { root!.unmount(); });
    root = null;
  }
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const STORAGE_VERSION = { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-14T02:00:00.000Z" };

describe("BrowserUseCollectButton 真实行为", () => {
  async function render(props: Partial<Parameters<typeof import("@/components/evidence/BrowserUseCollectButton").BrowserUseCollectButton>[0]> = {}) {
    const { BrowserUseCollectButton } = await import("@/components/evidence/BrowserUseCollectButton");
    const ref = { current: null as (() => void) | null };
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(BrowserUseCollectButton, {
        taskId: "task-a",
        kind: "competitor",
        storageVersion: STORAGE_VERSION,
        ...props,
        collectRef: ref,
      } as never));
    });
    await flush();
    return ref;
  }

  it("命令句柄 collectRef 触发 → 采集 fetch 恰调用 1 次（真行为，非源码字符串）", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          kind: "competitor",
          previewId: "bup_preview_h1",
          preview: { schema: "browser-use-research-preview.v1", kind: "competitor", seedAsin: "B0SAMPLE12", marketplace: "Amazon US", sourceUrl: "https://www.amazon.com/s?k=lunch", capturedAt: "2026-08-14T02:00:00.000Z", results: [{ asin: "B0C1", title: "T" }], missing: [], failureReason: null },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock as never);
    const ref = await render();
    expect(ref.current).not.toBeNull();
    await act(async () => { ref.current!(); });
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/competitor-evidence");
    vi.unstubAllGlobals();
  });

  it("空竞品预览（results=[] 且 failureReason=null）→ 确认保存前被前端拒绝：不出现绿色已保存状态", async () => {
    // 服务端空结果拒绝的红测在 route.test.ts（9c）；此处验证前端状态机双保险：
    // 即使被注入空预览，确认保存按钮必须禁用或保存被拒（不进入 idle+已保存 0 条）。
    const { browserUseCollectStateReducer, INITIAL_BROWSER_USE_COLLECT_STATE, browserUseSaveAllowed } = await import("@/components/evidence/BrowserUseCollectButton");
    // 前端门禁是"空预览不得确认保存"；当前实现必须暴露此判定（若渲染层无此判断则红）。
    const allowed = browserUseSaveAllowed({ results: [], failureReason: null } as never);
    expect(allowed).toBe(false);
    const withEmpty = browserUseCollectStateReducer(
      browserUseCollectStateReducer(INITIAL_BROWSER_USE_COLLECT_STATE, { type: "START" }),
      { type: "COLLECT_SUCCEEDED", preview: { kind: "competitor", results: [], failureReason: null } as never, previewId: "bup_preview_empty" },
    );
    // 不允许出现绿色 SAVED 且"已保存 0 条"
    const saved = browserUseCollectStateReducer(withEmpty, { type: "SAVED", count: 0, skipped: [] });
    expect(saved.message).not.toContain("已保存 0 条自动采集证据");
  });

  it("busy 期间（采集中）重复触发 collectRef → 采集入口调用 0 次（busy guard）", async () => {
    const gate: { open: (() => void) | null } = { open: null };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      await new Promise<void>((resolve) => { gate.open = resolve; });
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            kind: "competitor",
            previewId: "bup_preview_busy",
            preview: { schema: "browser-use-research-preview.v1", kind: "competitor", seedAsin: "B0SAMPLE12", marketplace: "Amazon US", sourceUrl: "https://www.amazon.com/s?k=lunch", capturedAt: "2026-08-14T02:00:00.000Z", results: [{ asin: "B0C1", title: "T" }], missing: [], failureReason: null },
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock as never);
    const ref = await render();
    // 第一次触发 → 进入 collecting（fetch 挂起中）
    await act(async () => { ref.current!(); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // busy 期间第二次触发 → guard 拦截，不产生第二次请求
    await act(async () => { ref.current!(); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    gate.open?.();
    await flush();
    await flush();
    vi.unstubAllGlobals();
  });

  it("skipped 按真实 code 分类：未保存原因必须如实呈现（不得统一称已在列表中）", async () => {
    const { buildSaveSummary } = await import("@/components/evidence/BrowserUseCollectButton");
    const summary = buildSaveSummary(1, [
      { asin: "B0D1", code: "duplicate_asin" },
      { asin: "B0D2", code: "task_result_conflict" },
      { asin: "B0D3", code: "competitor_evidence_limit_exceeded" },
      { asin: "B0D4", code: "save_failed" },
    ]);
    expect(summary).toContain("已在列表中");
    expect(summary).toContain("版本冲突");
    expect(summary).toContain("达到竞品上限");
    expect(summary).toContain("保存失败");
  });
});
