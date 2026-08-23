import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

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
  // React 19 commitTextUpdate 写 nodeValue；必须同步 text，否则 textContent 读到陈旧文本。
  get nodeValue(): string { return this.text; }
  set nodeValue(value: string) { this.text = String(value); }
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
  g.fetch = vi.fn(async (url: string, init?: { body?: string }) => {
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



import { resolveSourcingSaveError, SourcingEvidencePanel } from "@/components/cross-border/SourcingEvidencePanel";

const GET_OK = {
  ok: true,
  data: {
    evidence: null,
    storageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-14T02:00:00.000Z" },
    toolStatus: { loggedIn: true, toolAvailable: true, cli: { loggedIn: true, toolAvailable: true }, image: { extensionAvailable: false, reasonCode: "no_extension" } },
    capabilities: { keyword: { state: "available", reasonCategory: null }, image: { state: "available", reasonCategory: null }, detail: { state: "available", reasonCategory: null } },
  },
};

describe("SourcingEvidencePanel 同页版本恢复（轮 14，真实组件挂载）", () => {
  it("挂载后初始 GET：面板渲染、能力可用（不出现组件未安装）", async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).includes("/api/tasks/task-x/sourcing") && !init?.body) {
        return makeResponse(true, 200, GET_OK);
      }
      return makeResponse(false, 404, { ok: false });
    });
    const onEvt = vi.fn();
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(SourcingEvidencePanel, {
        taskId: "task-x",
        amazonContext: { title: "亚马逊候选保温杯", image: null, asin: null },
        onEvidenceChange: onEvt,
      } as never));
    });
    await flush();
    const text = (container as unknown as FakeElement).textContent;
    expect(text).toContain("供应线索（1688）");
    expect(text).not.toContain("组件未安装");
  });
});

describe("resolveSourcingSaveError（轮 14 前端恢复决策单测）", () => {
  it("409 首冲突 → conflict_retry（不展示错误、保留预览）", () => {
    const r = resolveSourcingSaveError(409, "task_result_conflict", "content changed", false);
    expect(r.kind).toBe("conflict_retry");
    expect(r.message).toBe("");
  });
  it("409 二次冲突 → conflict_stop + 「资料又发生变化，请再试一次」", () => {
    const r = resolveSourcingSaveError(409, "task_result_conflict", "content changed", true);
    expect(r.kind).toBe("conflict_stop");
    expect(r.message).toBe("资料又发生变化，请再试一次");
  });
  it("preview_expired → 明确过期（唯一过期来源）", () => {
    const r = resolveSourcingSaveError(410, "preview_expired", "预览已过期或不属于当前任务，请重新搜索。", false);
    expect(r.kind).toBe("preview_expired");
    expect(r.message).toContain("预览已过期");
  });
  it("auth_required → 跳转登录态", () => {
    const r = resolveSourcingSaveError(401, "auth_required", "需要登录", false);
    expect(r.kind).toBe("auth_required");
  });
  it("其它错误 → generic（保留原文案）", () => {
    const r = resolveSourcingSaveError(500, "server_error", "服务器错误", false);
    expect(r.kind).toBe("generic");
    expect(r.message).toBe("服务器错误");
  });
});
