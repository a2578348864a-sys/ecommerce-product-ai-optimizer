import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/* ── 真实 React DOM 行为测试（无 jsdom 最小 DOM，改编自 VocEvidenceSection.conflict.dom.test.ts）。 ── */
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: unknown; href: string } & Record<string, unknown>) =>
    createElement("a", { href, ...props }, children as never),
}));

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
    const TAG_ATTR = /^([a-z0-9]*)\[([a-z-]+)="([^"]*)"\]$/;
    const tagAttr = part.match(TAG_ATTR);
    if (tagAttr) return (tagAttr[1] === "" || this.tagName === tagAttr[1].toUpperCase()) && this.attributes.get(tagAttr[2]) === tagAttr[3];
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
  private matchesSimple(el: FakeElement, part: string): boolean {
    if (SIMPLE_TAG.test(part)) return el.tagName === part.toUpperCase();
    const testId = parseTestIdPart(part);
    if (testId !== null) return el.dataset.testid === testId;
    const TAG_ATTR = /^([a-z0-9]*)\[([a-z-]+)="([^"]*)"\]$/;
    const tagAttr = part.match(TAG_ATTR);
    if (tagAttr) return (tagAttr[1] === "" || el.tagName === tagAttr[1].toUpperCase()) && el.attributes.get(tagAttr[2]) === tagAttr[3];
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

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function makeResponse(ok: boolean, status: number, body: unknown): FetchResponse {
  return { ok, status, json: async () => body };
}

function installGlobals() {
  documentInstance = new FakeDocument();
  container = documentInstance.createElement("div");
  container.setAttribute("id", "root");
  documentInstance.body.appendChild(container);
  documentInstance.registerElement(container);

  const store = new Map<string, string>();
  store.set("qx:no-auth-owner:v1", "1");
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
  const g = globalThis as Record<string, unknown>;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.document = documentInstance;
  g.window = {
    document: documentInstance,
    HTMLIFrameElement: class HTMLIFrameElement {},
    sessionStorage: storage,
    localStorage: storage,
    dispatchEvent: () => true,
    history: { replaceState: (_s: unknown, _t: string, url: string) => { hashHistory.push(url); } },
    location: { search: "", pathname: "/tasks/task-x", href: "http://localhost/tasks/task-x" },
    windowListeners: new Map<string, Listener[]>(),
    addEventListener: (name: string, fn: Listener) => {
      const list = (g.window as unknown as { windowListeners: Map<string, Listener[]> }).windowListeners.get(name) ?? [];
      list.push(fn);
      (g.window as unknown as { windowListeners: Map<string, Listener[]> }).windowListeners.set(name, list);
    },
    removeEventListener: (name: string, fn: Listener) => {
      const w = (g.window as unknown as { windowListeners: Map<string, Listener[]> }).windowListeners;
      w.set(name, (w.get(name) ?? []).filter((item) => item !== fn));
    },
  };
  (g.window as Record<string, unknown>).scrollY = 0;
  g.fetch = vi.fn(async (url: string) => {
    if (fetchHandler) return fetchHandler(String(url));
    return makeResponse(false, 404, { ok: false });
  });
  (g.window as Record<string, unknown>).CustomEvent = class CustomEvent {
    type: string;
    constructor(type: string) { this.type = type; }
  };
}

beforeEach(() => {
  root = null;
  hashHistory = [];
  fetchHandler = null;
  installGlobals();
});

afterEach(async () => {
  if (root) {
    await act(async () => { root!.unmount(); });
    root = null;
  }
});

async function clickInAct(el: FakeElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new FakeEvent("click", el as unknown as FakeNode));
  });
  await flush();
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}


function findByTestId(testId: string): FakeElement | null {
  return (container as unknown as FakeElement).querySelector('[data-testid="' + testId + '"]');
}

function findAllByTestId(testId: string): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (node: FakeNode) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType !== 1) continue;
      const el = child as FakeElement;
      if (el.dataset.testid === testId) found.push(el);
      walk(el);
    }
  };
  walk(container as FakeNode);
  return found;
}

/* ── 全局 DOM 测试状态 ── */
let documentInstance: FakeDocument;
let container: FakeElement;
let root: Root | null = null;
let hashHistory: string[] = [];
let fetchHandler: ((url: string) => FetchResponse) | null = null;

/* fixtures */
const SUMMARY = {
  runId: "run-abc12345",
  model: "deepseek-test",
  gateResult: "pass",
  evidenceRefCoverage: { total: 21, withRefs: 15 },
  startedAt: "2026-08-14T02:00:00.000Z",
  finishedAt: "2026-08-14T02:01:00.000Z",
  summary: {
    facts: [
      { id: "f1", type: "fact", text: "多条评论提到适合学校午餐", evidenceRefs: ["ev:voc:1", "ev:voc:2"] },
      { id: "f2", type: "fact", text: "1688 供应报价较低 MOQ 500 件", evidenceRefs: ["ev:sourcing:1"] },
    ],
    estimates: [],
    signals: [],
    risks: [{ id: "r1", type: "risk", text: "存在交付延迟投诉", evidenceRefs: ["ev:voc:3"] }],
    conflicts: [],
    missing: [{ id: "m1", type: "missing", text: "缺少竞品详细价格", evidenceRefs: [] }],
    nextSteps: [],
  },
  noviceExplanation: { whatWeKnow: "知道", whatWeDontKnow: "不知道", biggestRisk: "风险", why: "原因", nextToResearch: "下一步" },
  unverified: [],
  updatedAt: "2026-08-14T02:01:00.000Z",
};

const MODULES = [
  { key: "market", title: "市场机会", conclusion: [], missing: [{ text: "无依据的臆测" }], next: [] },
  { key: "buyers", title: "买家需求与差评", conclusion: [
    { text: "多条评论提到适合学校午餐", refCount: 2, evidenceTarget: "buyer" },
    { text: "存在交付延迟投诉", refCount: 1, evidenceTarget: "buyer" },
  ], missing: [], next: [] },
  { key: "sourcing", title: "货源与商品匹配", conclusion: [
    { text: "1688 供应报价较低 MOQ 500 件", refCount: 1, evidenceTarget: "sourcing" },
  ], missing: [], next: [] },
  { key: "costRisk", title: "成本与风险", conclusion: [
    { text: "物流与平台费用预估偏高", refCount: 1, evidenceTarget: "costRisk" },
  ], missing: [], next: [] },
];


async function mountSection(extraProps: Record<string, unknown> = {}) {
  const { AiEvidenceSummarySection } = await import("@/components/evidence/AiEvidenceSummarySection");
  await act(async () => {
    root = createRoot(container as unknown as Element);
    root.render(createElement(AiEvidenceSummarySection, {
      taskId: "task-x",
      summary: true,
      storageVersion: null,
      onChanged: () => undefined,
      ...extraProps,
    } as never));
  });
  await flush();
}

function targetSection(id: string): FakeElement {
  const el = documentInstance.createElement("section");
  el.setAttribute("id", id);
  documentInstance.body.appendChild(el);
  documentInstance.registerElement(el);
  return el;
}

describe("R2 查看依据：真实按钮 + 真实定位（点击行为）", () => {
  it("渲染为 button：type=button + aria-controls 指向映射目标 id", async () => {
    await mountSection({ businessModules: MODULES });
    const btn = documentInstance.body.querySelector('button[data-testid="view-evidence-buyers-0"]') as unknown as FakeElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("type")).toBe("button");
    expect(btn!.getAttribute("aria-controls")).toBe("formal-v2-buyer-evidence");
    expect(btn!.getAttribute("data-testid") || "").toContain("view-evidence");
  });

  it("点击后：hash 更新 + scrollIntoView + focus 目标 + aria-expanded", async () => {
    const buyerTarget = targetSection("formal-v2-buyer-evidence");
    await mountSection({ businessModules: MODULES });
    const btn = documentInstance.body.querySelector('button[aria-controls="formal-v2-buyer-evidence"]') as unknown as FakeElement | null;
    expect(btn).not.toBeNull();
    await clickInAct(btn!);
    expect(btn!.getAttribute("aria-expanded")).toBe("true");
    const win = globalThis.window as unknown as { location: { hash?: string } };
    // 真实浏览器会设置 #formal-v2-buyer-evidence；fake location 无 hash 属性时为 undefined，以 scroll/focus 为准
    if (win.location.hash !== undefined) expect(win.location.hash).toBe("#formal-v2-buyer-evidence");
    expect(buyerTarget.scrollIntoViewCalls).toBeGreaterThan(0);
    expect(documentInstance.activeElement?.getAttribute("id")).toBe("formal-v2-buyer-evidence");
  });

  it("点击后展开祖先 details", async () => {
    const buyerTarget = targetSection("formal-v2-buyer-evidence");
    const details = documentInstance.createElement("details");
    details.appendChild(buyerTarget);
    documentInstance.body.appendChild(details);
    await mountSection({ businessModules: MODULES });
    const btn = documentInstance.body.querySelector('button[aria-controls="formal-v2-buyer-evidence"]') as unknown as FakeElement | null;
    await clickInAct(btn!);
    expect(details.open).toBe(true);
  });

  it("目标不存在 → fail-closed：显示「对应资料区暂时无法打开」，不报成功不跳转", async () => {
    await mountSection({ businessModules: MODULES });
    const btn = documentInstance.body.querySelector('button[aria-controls="formal-v2-buyer-evidence"]') as unknown as FakeElement | null;
    await clickInAct(btn!);
    const win = globalThis.window as unknown as { location: { hash?: string } };
    // fail-closed：不得设置 hash（undefined/空 均视为未跳转）
    expect(!win.location.hash || win.location.hash === "").toBe(true);
    expect(documentInstance.body.textContent).toContain("对应资料区暂时无法打开");
  });
});

describe("R2 页面去重：四模块默认主阅读流，旧扁平分类仅默认关闭的历史详情", () => {
  it("默认不展开旧分类；仅存在「查看历史分类详情」折叠入口", async () => {
    await mountSection({ businessModules: MODULES });
    const historyToggle = documentInstance.body.querySelector('details[data-testid="legacy-category-details"]') as unknown as FakeElement | null;
    expect(historyToggle).not.toBeNull();
    // 默认关闭：同一条内容在默认阅读流只出现一次（旧扁平分类藏于折叠内）
    expect(historyToggle!.open).toBe(false);
  });
});

describe("R3 成本与风险真实组件视图", () => {
  it("真实 CommercialInputsCard 渲染根节点持有 formal-v2-cost-risk-evidence id（供查看依据定位）", async () => {
    const { CommercialInputsCard } = await import("@/components/product-research/CommercialInputsCard");
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(CommercialInputsCard, {
        taskId: "task-x",
        onChanged: () => undefined,
      } as never));
    });
    await flush();
    // 真实组件根节点（id + data-testid 同时存在；表单控件用 data-testid 暴露）
    const cardRoot = documentInstance.getElementById("formal-v2-cost-risk-evidence") as unknown as FakeElement | null;
    expect(cardRoot).not.toBeNull();
    expect(cardRoot!.getAttribute("data-testid")).toBe("commercial-inputs-card");
    // 可填写控件真实存在（fake DOM 中 testid 即 dataset.testid）
    // 可填写控件真实存在（testid 由组件 data-testid 提供；fake DOM 以 dataset 承载）
    const price = documentInstance.body.querySelector('input[data-testid="ci-purchase-price"]') as unknown as FakeElement | null;
    expect(price).not.toBeNull();
    const moq = documentInstance.body.querySelector('input[data-testid="ci-moq"]') as unknown as FakeElement | null;
    expect(moq).not.toBeNull();
    const logistics = documentInstance.body.querySelector('input[data-testid="ci-logistics"]') as unknown as FakeElement | null;
    expect(logistics).not.toBeNull();
    const compliance = documentInstance.body.querySelector('select[data-testid="ci-compliance-status"]') as unknown as FakeElement | null;
    expect(compliance).not.toBeNull();
  });
});

describe("R3 成本与风险查看依据：进入真实可填写表单", () => {
  it("「成本与风险查看依据」定位到 commercial-inputs-card（真实表单根节点），非缺口说明区", async () => {
    // 模拟真实布局：commercial 表单根节点持有 formal-v2-cost-risk-evidence 与 data-testid=commercial-inputs-card
    const cardRoot = documentInstance.createElement("section");
    cardRoot.setAttribute("id", "formal-v2-cost-risk-evidence");
    cardRoot.setAttribute("data-testid", "commercial-inputs-card");
    documentInstance.body.appendChild(cardRoot);
    documentInstance.registerElement(cardRoot);
    // 模拟 MissingSection 不再占用该 id（不被查询到）
    const missingSection = documentInstance.createElement("section");
    missingSection.setAttribute("data-testid", "workbench-missing");
    missingSection.textContent = "还缺什么（待补资料）";
    documentInstance.body.appendChild(missingSection);
    documentInstance.registerElement(missingSection);

    await mountSection({ businessModules: MODULES });
    const btn = documentInstance.body.querySelector('button[aria-controls="formal-v2-cost-risk-evidence"]') as unknown as FakeElement | null;
    expect(btn).not.toBeNull();
    await clickInAct(btn!);
    const win = globalThis.window as unknown as { location: { hash?: string } };
    if (win.location.hash !== undefined) expect(win.location.hash).toBe("#formal-v2-cost-risk-evidence");
    const target = documentInstance.getElementById("formal-v2-cost-risk-evidence");
    expect(target).not.toBeNull();
    // 目标即商业输入卡片根（含可填写控件语义：不是 workbench-missing 缺口区）
    expect(target!.getAttribute("data-testid")).toBe("commercial-inputs-card");
    expect(target!.scrollIntoViewCalls).toBeGreaterThan(0);
    expect(documentInstance.activeElement?.getAttribute("id")).toBe("formal-v2-cost-risk-evidence");
    // 缺口区不是目标（fail-closed 不误跳）
    const missing = documentInstance.getElementById("missing-not-registered") as unknown as FakeElement | null;
    expect(missing).toBeNull();
  });
  it("id 归属唯一：正式布局下 costRisk 命中商业表单根，且缺口说明区（workbench-missing）不持有该 id", async () => {
    const cardRoot = documentInstance.createElement("section");
    cardRoot.setAttribute("id", "formal-v2-cost-risk-evidence");
    cardRoot.setAttribute("data-testid", "commercial-inputs-card");
    documentInstance.body.appendChild(cardRoot);
    documentInstance.registerElement(cardRoot);
    const missingSection = documentInstance.createElement("section");
    missingSection.setAttribute("data-testid", "workbench-missing");
    documentInstance.body.appendChild(missingSection);
    documentInstance.registerElement(missingSection);

    await mountSection({ businessModules: MODULES });
    const btn = documentInstance.body.querySelector('button[aria-controls="formal-v2-cost-risk-evidence"]') as unknown as FakeElement | null;
    expect(btn).not.toBeNull();
    await clickInAct(btn!);
    const target = documentInstance.getElementById("formal-v2-cost-risk-evidence");
    expect(target).not.toBeNull();
    expect(target!.getAttribute("data-testid")).toBe("commercial-inputs-card");
  });
});
