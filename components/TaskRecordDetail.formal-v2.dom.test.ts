import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { TaskRecordDetail } from "@/components/TaskRecordDetail";

/* ── 真实 React DOM 行为测试：无 jsdom 的最小 DOM（支撑 React 19 渲染/事件 + 真实组件挂载）。 ── */

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: unknown; href: string } & Record<string, unknown>) =>
    createElement("a", { href, ...props }, children as never),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tasks/task-x",
  useSearchParams: () => ({ get: () => null }),
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

let documentInstance: FakeDocument | null = null;
let root: Root | null = null;
let container: FakeElement | null = null;
let hashHistory: string[] = [];
type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
let fetchHandler: ((url: string) => FetchResponse) | null = null;

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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mountDetail() {
  await act(async () => {
    root = createRoot(container as unknown as Element);
    root.render(createElement(TaskRecordDetail, { id: "task-x" }));
  });
  await flush();
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

/* ── fixtures + fetch mock ── */
function recordFixture(overrides: Record<string, unknown> & { result?: Record<string, unknown>; type?: string; decisionStatus?: string; researchStale?: boolean } = {}) {
  return {
    id: "task-x",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    type: "workflow",
    decisionStatus: "pending",
    title: "测试商品 商品研究",
    platform: "manual",
    productUrl: null,
    materialText: "测试商品",
    source: "agent_run",
    score: 0,
    level: "",
    oneLineSummary: "",
    productImage: null,
    result: { productName: "测试商品" },
    researchStale: false,
    ...overrides,
  };
}

const versionedDecision = {
  schema: "product-research-record.v1",
  revision: 1,
  researchHash: "a".repeat(64),
  candidateId: "cand-x",
  runId: "run-x",
  contextHash: "b".repeat(64),
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  latestDecision: {
    decisionId: "11111111-1111-4111-8111-111111111111",
    revision: 1,
    status: "creative_ready",
    reason: "已保存人工决定",
    nextAction: null,
    researchHash: "a".repeat(64),
    decidedAt: "2026-08-20T00:00:00.000Z",
    actor: { mode: "owner", actorRef: "owner:v1" },
  },
  decisionEvents: [],
};

const staleResult = {
  productName: "已过期商品",
  productResearchSummary: { schema: "product-research-record.v1", status: "creative_ready", label: "进入创作准备" },
  researchRecord: versionedDecision,
  browserEvidence: { schema: "browser-evidence.v1", snapshots: [{ fields: { asin: { value: "B0STALE12" } } }] },
  researchCompletion: {
    schema: "research-completion.v1",
    status: "completed",
    completedAt: "2026-08-20T01:00:00.000Z",
    decisionId: "11111111-1111-4111-8111-111111111111",
    revision: 1,
    finalStatus: "creative_ready",
    evidenceHash: "c".repeat(64),
  },
};

function installRecordHandler(record: ReturnType<typeof recordFixture>) {
  fetchHandler = (url: string) => {
    if (url.includes("/api/runtime-mode")) {
      return makeResponse(true, 200, { ok: true, mode: "local_owner", noAuthOwner: true, v4GraphEnabled: true });
    }
    if (url.includes("/api/tasks/task-x")) {
      return makeResponse(true, 200, { ok: true, data: record });
    }
    return makeResponse(false, 404, { ok: false });
  };
}

describe("TaskRecordDetail 正式组件挂载（真实 DOM）", () => {
  it("workflow 活动记录：显示 Formal v2，不出现 legacy；主按钮实点展开/定位/焦点/aria 正确", async () => {
    installRecordHandler(recordFixture());
    await mountDetail();

    expect(findByTestId("formal-v2-product-result")).not.toBeNull();
    expect(findByTestId("legacy-record-content")).toBeNull();
    expect(findAllByTestId("formal-v2-module-market").length).toBe(1);

    const button = findByTestId("formal-v2-primary-action")!;
    expect(button.getAttribute("aria-controls")).toBe("formal-v2-materials");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await act(async () => { button.dispatchEvent(new FakeEvent("click", button)); });
    await flush();

    const details = documentInstance!.getElementById("formal-v2-materials") as FakeElement | null;
    expect(details).not.toBeNull();
    expect(details!.getAttribute("open") !== null).toBe(true);
    expect(hashHistory.at(-1)).toBe("#formal-v2-materials");
    expect(documentInstance!.activeElement?.nodeName).toBe("SUMMARY");
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("workflow 已完成（历史视图）：完成动作指向真实目标 listing-and-images；模块按钮 aria-controls 一致", async () => {
    installRecordHandler(recordFixture({
      decisionStatus: "continue",
      result: {
        productName: "已完成商品",
        productResearchSummary: { schema: "product-research-record.v1", status: "creative_ready", label: "进入创作准备" },
        researchRecord: versionedDecision,
        researchCompletion: { schema: "research-completion.v1", status: "completed", completedAt: "2026-08-20T02:00:00.000Z", decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, finalStatus: "creative_ready", evidenceHash: "a".repeat(64) },
      },
    }));
    await mountDetail();

    const button = findByTestId("formal-v2-primary-action")!;
    expect(button.textContent).toContain("查看 Listing 与图片");
    expect(button.getAttribute("aria-controls")).toBe("listing-and-images");
    await act(async () => { button.dispatchEvent(new FakeEvent("click", button)); });
    await flush();
    expect(hashHistory.at(-1)).toBe("#listing-and-images");
    expect(documentInstance!.getElementById("listing-and-images")).not.toBeNull();
    expect(documentInstance!.activeElement?.nodeName).toBe("H2");

    // 四模块按钮指向各自的证据目标
    const firstModule = (container as unknown as FakeElement).querySelector('[data-testid="formal-v2-module-market"] button') as FakeElement | null;
    expect(firstModule).not.toBeNull();
    expect(firstModule!.getAttribute("aria-controls")).toBe("formal-v2-market-evidence");
    await act(async () => { firstModule!.dispatchEvent(new FakeEvent("click", firstModule!)); });
    await flush();
    expect(hashHistory.at(-1)).toBe("#formal-v2-market-evidence");
    expect(documentInstance!.getElementById("formal-v2-market-evidence")).not.toBeNull();
  });

  it("stale workflow：正式组件真实渲染重新确认目标，点击后展开/hash/焦点/aria 正确", async () => {
    installRecordHandler(recordFixture({ decisionStatus: "continue", researchStale: true, result: staleResult }));
    await mountDetail();

    const button = findByTestId("formal-v2-primary-action")!;
    expect(button.textContent).toContain("重新确认研究资料");
    expect(button.getAttribute("aria-controls")).toBe("product-research-decision");

    // 正式组件真实渲染的 stale 目标（research-stale-notice 按钮）
    const staleNoticeButton = (documentInstance!.getElementById("product-research-decision") as unknown as FakeElement)?.querySelector('[data-testid="research-stale-notice"] button') ?? null;
    expect(staleNoticeButton).not.toBeNull();

    await act(async () => { button.dispatchEvent(new FakeEvent("click", button)); });
    await flush();
    expect(hashHistory.at(-1)).toBe("#product-research-decision");
    const focused = documentInstance!.activeElement;
    expect(focused?.nodeName).toBe("BUTTON");
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("非 workflow（viral/risk/product）：不显示 Formal v2 四模块，保留既有详情内容", async () => {
    for (const type of ["viral", "risk", "product"]) {
      installGlobals();
      installRecordHandler(recordFixture({ type, title: type + " 记录", result: { score: 80, level: "low", oneLineSummary: "既有结论" } }));
      await mountDetail();

      expect(findByTestId("legacy-record-content"), type + " legacy content").not.toBeNull();
      expect(findByTestId("formal-v2-product-result"), type + " no formal view").toBeNull();
      expect(findAllByTestId("formal-v2-module-market"), type + " no formal modules").toHaveLength(0);
      expect(findByTestId("formal-v2-primary-action"), type + " no formal primary").toBeNull();

      // 既有详情内容：身份标题存在
      const text = (documentInstance!.getElementById("root") as unknown as FakeElement).textContent;
      expect(text, type + " legacy title").toContain("来源：");

    }
  });
});


const MODULE_EXPECT: Array<{ key: string; targetId: string }> = [
  { key: "market", targetId: "formal-v2-market-evidence" },
  { key: "buyers", targetId: "formal-v2-buyer-evidence" },
  { key: "sourcing", targetId: "formal-v2-sourcing-evidence" },
  { key: "cost-risk", targetId: "formal-v2-cost-risk-evidence" },
];

describe("四模块按钮目标路由（真实 TaskRecordDetail 挂载）", () => {
  async function mountWorkflow() {
    installRecordHandler(recordFixture());
    await mountDetail();
  }
  function moduleButton(key: string): FakeElement {
    const btn = (container as unknown as FakeElement).querySelector('[data-testid="formal-v2-module-' + key + '"] button') as FakeElement | null;
    expect(btn, "module button " + key).not.toBeNull();
    return btn!;
  }
  function focusedInside(target: FakeElement): boolean {
    let cur: FakeNode | null = documentInstance!.activeElement;
    while (cur) { if (cur === target) return true; cur = cur.parentNode; }
    return false;
  }

  it("1. 四个按钮 aria-controls 分别等于四个目标且互不重复；目标在挂载 DOM 中真实存在", async () => {
    await mountWorkflow();
    const seen = new Set<string>();
    for (const { key, targetId } of MODULE_EXPECT) {
      const btn = moduleButton(key);
      expect(btn.getAttribute("aria-controls")).toBe(targetId);
      seen.add(targetId);
      expect(documentInstance!.getElementById(targetId), targetId + " exists").not.toBeNull();
    }
    expect(seen.size).toBe(4);
  });

  it("2. 分别点击四个按钮：外层 details 自动展开；hash/滚动目标/焦点均在对应资料区内", async () => {
    await mountWorkflow();
    const details = documentInstance!.getElementById("formal-v2-materials") as FakeElement | null;
    for (const { key, targetId } of MODULE_EXPECT) {
      if (details?.open) {
        await act(async () => { details.open = false; });
        await flush();
      }
      const btn = moduleButton(key);
      await act(async () => { btn.dispatchEvent(new FakeEvent("click", btn)); });
      await flush();
      expect(details!.open, key + " ancestors open").toBe(true);
      expect(hashHistory.at(-1), key + " hash").toBe("#" + targetId);
      const section = documentInstance!.getElementById(targetId)!;
      expect(section.scrollIntoViewCalls, key + " scroll").toBeGreaterThan(0);
      expect(focusedInside(section), key + " focus inside").toBe(true);
    }
  });

  it("3. 关闭总资料区后点击模块按钮会重新展开祖先 details", async () => {
    await mountWorkflow();
    const details = documentInstance!.getElementById("formal-v2-materials") as FakeElement | null;
    expect(details).not.toBeNull();
    await act(async () => { details!.open = false; });
    await flush();
    expect(details!.open).toBe(false);
    const btn = moduleButton("sourcing");
    await act(async () => { btn.dispatchEvent(new FakeEvent("click", btn)); });
    await flush();
    expect(details!.open).toBe(true);
    expect(hashHistory.at(-1)).toBe("#formal-v2-sourcing-evidence");
  });

  it("4. 顶部总入口不变：活动视图主按钮仍指向 formal-v2-materials", async () => {
    await mountWorkflow();
    const top = findByTestId("formal-v2-primary-action")!;
    expect(top.getAttribute("aria-controls")).toBe("formal-v2-materials");
    await act(async () => { top.dispatchEvent(new FakeEvent("click", top)); });
    await flush();
    expect(hashHistory.at(-1)).toBe("#formal-v2-materials");
  });

  it("5. 焦点落在目标区内的标题或首个可操作元素（H3 或 section 本身）", async () => {
    await mountWorkflow();
    for (const { key, targetId } of MODULE_EXPECT) {
      const btn = moduleButton(key);
      await act(async () => { btn.dispatchEvent(new FakeEvent("click", btn)); });
      await flush();
      const section = documentInstance!.getElementById(targetId)!;
      const focused = documentInstance!.activeElement!;
      const ok = focused.nodeName === "H3" || focused === section || focusedInside(section);
      expect(ok, key + " focus semantics").toBe(true);
    }
  });
});
