import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { FactCandidateReview } from "@/components/evidence/FactCandidateReview";

/* ── 真实 React DOM 行为测试：FactCandidateReview 折叠入口与事实确认 ── */

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
    list.push(fn);
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
function parseTestIdPart(part: string): string | null {
  if (!part.startsWith("[data-testid=") || !part.endsWith("]")) return null;
  const inner = part.slice("[data-testid=".length, -1);
  return inner.replace(/^["']/, "").replace(/["']$/, "");
}

class FakeElement extends FakeNode {
  tagName: string;
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = "";
  tabIndex = -1;
  scrollIntoViewCalls = 0;
  options: FakeElement[] = [];
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
  scrollIntoView() { this.scrollIntoViewCalls += 1; }
  matches(selector: string): boolean {
    return selector.split(",").map((part) => part.trim()).some((part) => {
      if (SIMPLE_TAG.test(part)) return this.tagName === part.toUpperCase();
      if (part === "[tabindex]" && this.attributes.has("tabindex")) return true;
      const testId = parseTestIdPart(part);
      if (testId !== null) return this.dataset.testid === testId;
      return false;
    });
  }
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
  querySelectorAll(selector: string): FakeElement[] {
    const results: FakeElement[] = [];
    const walk = (node: FakeNode) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType !== 1) continue;
        const el = child as FakeElement;
        if (el.matches(selector)) results.push(el);
        walk(el);
      }
    };
    walk(this);
    return results;
  }
  private matchesSimple(el: FakeElement, part: string): boolean {
    if (SIMPLE_TAG.test(part)) return el.tagName === part.toUpperCase();
    const testId = parseTestIdPart(part);
    if (testId !== null) return el.dataset.testid === testId;
    return false;
  }
}

class FakeDocument extends FakeNode {
  body: FakeElement;
  activeElement: FakeElement | null = null;
  defaultView: unknown = null;
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

class HTMLIFrameElement {}
class HTMLInputElement {}

function installGlobals() {
  documentInstance = new FakeDocument();
  container = documentInstance.createElement("div");
  container.setAttribute("id", "root");
  documentInstance.body.appendChild(container);
  documentInstance.registerElement(container);
  const g = globalThis as Record<string, unknown>;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.document = documentInstance;
  g.HTMLIFrameElement = HTMLIFrameElement;
  g.HTMLInputElement = HTMLInputElement;
  const win = {
    document: documentInstance,
    HTMLIFrameElement,
    HTMLInputElement,
    location: { hash: "" },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  g.window = win;
  documentInstance.defaultView = win;
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
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const mockCandidates = [
  { candidateId: "c-brand", field: "brand", label: "品牌", value: "Thermos", sourceKind: "seller_sprite_product_facts", sourceRef: "ref-1" },
  { candidateId: "c-cap", field: "capacity", label: "容量", value: "10oz", sourceKind: "product_title", sourceRef: "ref-2" },
  { candidateId: "c-ins", field: "insulation", label: "保温性能", value: "12小时保冷", sourceKind: "amazon_browser_evidence", sourceRef: "ref-3" },
];

const mockConfirmed = [
  { candidateId: "c-mat", field: "material", label: "材质", value: "304 不锈钢", sourceKind: "human_manual", sourceRef: "ref-manual", confirmedAt: "2026-08-15", confirmedBy: "owner" },
];

describe("FactCandidateReview 紧凑折叠入口 DOM 挂载测试", () => {
  function installFetchHandler() {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tasks/task-1/fact-candidates")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              candidates: mockCandidates,
              confirmed: mockConfirmed,
            },
          }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({ ok: true, data: {} }) } as unknown as Response;
    }));
  }

  async function mountReview() {
    installFetchHandler();
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(FactCandidateReview, {
          taskId: "task-1",
          storageVersion: { resultJsonHash: "hash-1", updatedAt: "2026-08-20" },
          onChanged: vi.fn(),
        }),
      );
    });
    await flush();
  }

  it("1. 外层根节点为 details 且拥有 id=fact-candidate-review 与 testid", async () => {
    await mountReview();
    const details = documentInstance.getElementById("fact-candidate-review") as FakeElement | null;
    expect(details).not.toBeNull();
    expect(details!.tagName).toBe("DETAILS");
    expect(details!.getAttribute("data-testid")).toBe("fact-candidate-review");
  });

  it("2. 默认收起（open 属性为 false）", async () => {
    await mountReview();
    const details = documentInstance.getElementById("fact-candidate-review") as FakeElement | null;
    expect(details!.open).toBe(false);
  });

  it("3. summary 作为紧凑概览行，显示待确认和已确认项数及引导提示", async () => {
    await mountReview();
    const details = documentInstance.getElementById("fact-candidate-review") as FakeElement | null;
    const summary = details!.querySelector("summary");
    expect(summary).not.toBeNull();
    const text = summary!.textContent;
    expect(text).toContain("商品事实确认");
    expect(text).toContain("待确认 3 项");
    expect(text).toContain("已确认 1 项");
    expect(text).toContain("点击展开");
  });

  it("4. 展开后可查看智能补齐按钮、全选和候选列表，保留全部 testid", async () => {
    await mountReview();
    const details = documentInstance.getElementById("fact-candidate-review") as FakeElement | null;
    await act(async () => { details!.open = true; });
    await flush();

    const smartRecovery = details!.querySelector('[data-testid="smart-recovery-trigger"]');
    expect(smartRecovery).not.toBeNull();
    expect(smartRecovery!.textContent).toContain("智能补齐");

    const selectAll = details!.querySelector('[data-testid="fact-candidate-select-all"]');
    expect(selectAll).not.toBeNull();

    const confirmedCounts = details!.querySelector('[data-testid="fact-confirmed-counts"]');
    expect(confirmedCounts).not.toBeNull();
    expect(confirmedCounts!.textContent).toContain("已确认（1）");

    const manualEntry = details!.querySelector('[data-testid="manual-fact-entry"]');
    expect(manualEntry).not.toBeNull();
  });
});
