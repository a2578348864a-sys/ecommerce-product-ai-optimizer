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


import { VocEvidenceSection } from "@/components/evidence/VocEvidenceSection";

const V1 = { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-14T02:00:00.000Z" };
const V2 = { resultJsonHash: "b".repeat(64), updatedAt: "2026-08-14T02:01:00.000Z" };

let changedCount = 0;
const handleChanged = () => { changedCount += 1; };

function byText(text: string): FakeElement | null {
  const matches: FakeElement[] = [];
  const walk = (node: FakeNode): void => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType !== 1) continue;
      const el = child as FakeElement;
      if ((el.textContent || "").trim() === text) matches.push(el);
      walk(el);
    }
  };
  walk(container as FakeNode);
  // 取最深匹配：最内层元素才是真正的事件目标
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

function clickByText(text: string): void {
  const el = byText(text);
  if (!el) throw new Error("element not found: " + text);
  el.dispatchEvent(new FakeEvent("click", el as unknown as FakeNode));
}

async function mountVoc(storageVersionValue: { resultJsonHash: string; updatedAt: string } | null) {
  changedCount = 0;
  await act(async () => {
    root = createRoot(container as unknown as Element);
    root.render(createElement(VocEvidenceSection, {
      taskId: "task-x",
      taskAsin: "B08NCVT244",
      evidence: null,
      analysis: null,
      storageVersion: storageVersionValue,
      capability: { state: "available" },
      onChanged: handleChanged,
    } as never));
  });
  await flush();
}

async function rerenderVoc(storageVersionValue: { resultJsonHash: string; updatedAt: string }) {
  await act(async () => {
    root!.render(createElement(VocEvidenceSection, {
      taskId: "task-x",
      taskAsin: "B08NCVT244",
      evidence: null,
      analysis: null,
      storageVersion: storageVersionValue,
      capability: { state: "available" },
      onChanged: handleChanged,
    } as never));
  });
  await flush();
}

/** 加载前预置会话草稿（等价于用户刷新后草稿恢复：importText 等已被 sessionStorage 保存过） */
function seedVocDraft(version: { resultJsonHash: string; updatedAt: string }, importText: string): void {
  const revision = version.resultJsonHash + ":" + version.updatedAt;
  const key = "qingxuan-workbench:draft:v1:anonymous:voc-import:task-x:" + revision;
  const store = (globalThis as Record<string, unknown>).window as unknown as { sessionStorage: { setItem: (k: string, v: string) => void } };
  store.sessionStorage.setItem(key, JSON.stringify({
    schema: "qingxuan-workbench:draft:v1",
    subject: "anonymous",
    pageKind: "voc-import",
    entityId: "task-x",
    data: { importText, importAsin: "B08NCVT244", importRole: "current_candidate", importRating: "" },
  }));
}

const COLLECT_OK = {
  ok: true,
  data: {
    preview: {
      previewId: "pv-1",
      items: [
        { asin: "B08NCVT244", role: "current_candidate", rating: 4, date: null, title: "好用", duplicate: false },
      ],
      pageResults: [{ asin: "B08NCVT244", status: "ok", note: null, extractedCount: 1 }],
      capturedAt: "2026-08-14T02:00:00.000Z",
    },
  },
};

describe("VocEvidenceSection 导入/采集确认冲突自动恢复（轮 12，真实组件挂载）", () => {
  it("导入首次 409 → 保留草稿 + 版本刷新后自动重试一次 → 成功并清除草稿", async () => {
    const calls: Array<{ version: string | null }> = [];
    (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      const parsed = init && init.body ? JSON.parse(init.body) as Record<string, unknown> : {};
      const action = String((parsed as Record<string, unknown>).action);
      if (action === "import") {
        const v = parsed.expectedStorageVersion as { resultJsonHash?: string } | null;
        calls.push({ version: v?.resultJsonHash ?? null });
        if (v?.resultJsonHash === V1.resultJsonHash) {
          return makeResponse(false, 409, { ok: false, error: { code: "task_result_conflict", message: "content changed" } });
        }
        return makeResponse(true, 200, { ok: true, data: { outcome: { kind: "import", importedCount: 1, duplicateCount: 0, rejectedCount: 0 } } });
      }
      return makeResponse(false, 404, { ok: false });
    });
    seedVocDraft(V1, "评论很好用");
    await mountVoc(V1);
    await act(async () => { clickByText("粘贴导入"); });
    await flush();
    // 草稿已恢复（真实组件 state 权威）
    expect(byText("当前识别 1 条评论")).not.toBeNull();
    await act(async () => { clickByText("确认导入（1 条）"); });
    await flush();
    // 首冲突：草稿保留（仍显示 1 条）+ 触发刷新
    expect(byText("当前识别 1 条评论")).not.toBeNull();
    expect(changedCount).toBeGreaterThanOrEqual(1);
    // 版本刷新后自动重试一次（V2）→ 成功：notice 出现、草稿清空
    await rerenderVoc(V2);
    await flush();
    expect(byText("已导入 1 条；重复 0 条；忽略 0 条（超限）。")).not.toBeNull();
    expect(byText("当前识别 1 条评论")).toBeNull();
    expect(changedCount).toBeGreaterThanOrEqual(2);
    expect(calls).toHaveLength(2);
    expect(calls[1].version).toBe(V2.resultJsonHash);
  });

  it("导入二次仍 409：保留草稿并显示「资料刚刚更新，请再试一次」，不再次请求", async () => {
    const calls: Array<{ version: string | null }> = [];
    (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      const parsed = init && init.body ? JSON.parse(init.body) as Record<string, unknown> : {};
      const action = String((parsed as Record<string, unknown>).action);
      if (action === "import") {
        const v = parsed.expectedStorageVersion as { resultJsonHash?: string } | null;
        calls.push({ version: v?.resultJsonHash ?? null });
        return makeResponse(false, 409, { ok: false, error: { code: "task_result_conflict", message: "content changed" } });
      }
      return makeResponse(false, 404, { ok: false });
    });
    seedVocDraft(V1, "评论一般");
    await mountVoc(V1);
    await act(async () => { clickByText("粘贴导入"); });
    await flush();
    await act(async () => { clickByText("确认导入（1 条）"); });
    await flush();
    await rerenderVoc(V2);
    await flush();
    // 二次冲突：草稿保留 + 简洁提示 + 不再请求（共 2 次 import）
    expect(byText("当前识别 1 条评论")).not.toBeNull();
    expect(byText("资料刚刚更新，请再试一次。")).not.toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("采集确认首次 409 → 保留预览 + 版本刷新后自动重试一次 → 成功并清空预览", async () => {
    const calls: Array<{ version: string | null }> = [];
    (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      const parsed = init && init.body ? JSON.parse(init.body) as Record<string, unknown> : {};
      const action = String((parsed as Record<string, unknown>).action);
      if (action === "collect") return makeResponse(true, 200, COLLECT_OK);
      if (action === "collect-confirm") {
        const v = parsed.expectedStorageVersion as { resultJsonHash?: string } | null;
        calls.push({ version: v?.resultJsonHash ?? null });
        if (v?.resultJsonHash === V1.resultJsonHash) {
          return makeResponse(false, 409, { ok: false, error: { code: "task_result_conflict", message: "content changed" } });
        }
        return makeResponse(true, 200, { ok: true, data: { confirmed: true } });
      }
      return makeResponse(false, 404, { ok: false });
    });
    await mountVoc(V1);
    await act(async () => { clickByText("采集评论"); });
    await flush();
    await act(async () => { clickByText("开始采集"); });
    await flush();
    // 预览出现，确认按钮可用（默认选中 1 条）
    expect(byText("确认加入（1 条）")).not.toBeNull();
    await act(async () => { clickByText("确认加入（1 条）"); });
    await flush();
    // 首冲突：预览保留（确认按钮仍在）+ 触发刷新
    expect(byText("确认加入（1 条）")).not.toBeNull();
    expect(changedCount).toBeGreaterThanOrEqual(1);
    // 版本刷新后自动重试一次（V2）→ 成功：preview 清空
    await rerenderVoc(V2);
    await flush();
    expect(byText("已将选中的 1 条评论加入数据集（可打开「开始分析评论」）。")).not.toBeNull();
    expect(byText("确认加入（1 条）")).toBeNull();
    expect(changedCount).toBeGreaterThanOrEqual(2);
    expect(calls).toHaveLength(2);
    expect(calls[0].version).toBe(V1.resultJsonHash);
    expect(calls[1].version).toBe(V2.resultJsonHash);
  });
});
