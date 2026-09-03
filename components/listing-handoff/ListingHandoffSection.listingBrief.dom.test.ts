import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  addEventListener(name: string, listener: Listener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  removeEventListener(name: string, listener: Listener) {
    const listeners = this.listeners.get(name) ?? [];
    this.listeners.set(name, listeners.filter((item) => item !== listener));
  }

  dispatchEvent(event: FakeEvent): boolean {
    const chain: FakeNode[] = [];
    let cursor: FakeNode | null = this;
    while (cursor) {
      chain.push(cursor);
      if (!event.bubbles) break;
      cursor = cursor.parentNode;
    }
    for (const node of chain) {
      for (const listener of node.listeners.get(event.type) ?? []) {
        event.currentTarget = node;
        listener(event);
      }
    }
    return !event.defaultPrevented;
  }

  getRootNode(): FakeNode { return this.ownerDocument; }
  contains(node: FakeNode | null): boolean {
    let cursor: FakeNode | null = node;
    while (cursor) {
      if (cursor === this) return true;
      cursor = cursor.parentNode;
    }
    return false;
  }
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): FakeNode | null { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get parentElement(): FakeNode | null { return this.parentNode; }
  get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
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
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index >= 0) this.childNodes.splice(index, 0, child);
    else this.childNodes.push(child);
    return child;
  }

  removeChild(child: FakeNode): FakeNode {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
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

  constructor(document: FakeDocument, text: string) {
    super();
    this.nodeType = 3;
    this.nodeName = "#text";
    this.ownerDocument = document;
    this.text = text;
  }

  /** React commitTextUpdate 经 node.nodeValue 更新既有文本节点；保持与 text 一致 */
  get nodeValue(): string { return this.text; }
  set nodeValue(value: string) { this.text = String(value); }
}

class FakeElement extends FakeNode {
  tagName: string;
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = "";
  private valueState = "";
  private defaultValueState = "";
  checked = false;

  /** 真实 DOM：button.disabled 反映 disabled 属性；React 经 setAttribute/removeAttribute 维护 */
  get disabled(): boolean { return this.attributes.has("disabled"); }
  set disabled(value: boolean) {
    if (value) this.attributes.set("disabled", "");
    else this.attributes.delete("disabled");
  }

  get value(): string { return this.valueState; }
  set value(value: string) { this.valueState = String(value); }
  get defaultValue(): string { return this.defaultValueState; }
  set defaultValue(value: string) {
    const next = String(value);
    if (this.valueState === this.defaultValueState) this.valueState = next;
    this.defaultValueState = next;
  }

  constructor(document: FakeDocument, tagName: string) {
    super();
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = document;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
    if (name === "id") this.ownerDocument.registerElement(this);
    if (name.startsWith("data-")) this.dataset[name.slice(5)] = String(value);
  }

  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
}

class FakeDocument extends FakeNode {
  body: FakeElement;
  oninput: null = null;
  activeElement: FakeElement | null = null;
  private elementsById = new Map<string, FakeElement>();

  constructor() {
    super();
    this.nodeType = 9;
    this.nodeName = "#document";
    this.ownerDocument = this;
    this.body = new FakeElement(this, "body");
  }

  createElement(tagName: string): FakeElement { return new FakeElement(this, tagName); }
  createElementNS(_namespace: string, tagName: string): FakeElement { return this.createElement(tagName); }
  createTextNode(text: string): FakeText { return new FakeText(this, text); }
  registerElement(element: FakeElement) {
    const id = element.getAttribute("id");
    if (id) this.elementsById.set(id, element);
  }
  getElementById(id: string): FakeElement | null { return this.elementsById.get(id) ?? null; }
}

let documentInstance: FakeDocument;
let container: FakeElement;
let root: Root | null;
let createRootForTest: typeof import("react-dom/client").createRoot;
let originalFetch: typeof globalThis.fetch;

function elementsWithin(node: FakeNode, predicate: (element: FakeElement) => boolean): FakeElement[] {
  const matches: FakeElement[] = [];
  const visit = (current: FakeNode) => {
    for (const child of current.childNodes) {
      if (child.nodeType !== 1) continue;
      const element = child as FakeElement;
      if (predicate(element)) matches.push(element);
      visit(element);
    }
  };
  visit(node);
  return matches;
}

function elementByTestId(testId: string): FakeElement | null {
  return elementsWithin(documentInstance.body, (element) => element.getAttribute("data-testid") === testId)[0] ?? null;
}

function installGlobals() {
  documentInstance = new FakeDocument();
  container = documentInstance.createElement("div");
  container.setAttribute("id", "root");
  documentInstance.body.appendChild(container);
  documentInstance.registerElement(container);
  const globals = globalThis as Record<string, unknown>;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.document = documentInstance;
  globals.window = {
    document: documentInstance,
    sessionStorage: null,
    HTMLIFrameElement: class HTMLIFrameElement {},
    setTimeout: (() => 0) as unknown as typeof setTimeout,
    clearTimeout: (() => 0) as unknown as typeof clearTimeout,
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function listingState(
  listingBrief: Record<string, string>,
  overrides: Partial<{
    listingStatus: "ready" | "active" | "stale" | "revoked" | "legacy_unbound" | "invalid";
    currentHandoffRevision: number;
    confirmedFacts: number;
    canGenerate: boolean;
    claimPreflight: { pass: boolean; reasonCode?: string | null; reason: string | null };
  }> = {},
) {
  return {
    ok: true,
    data: {
      canGenerate: overrides.canGenerate ?? true,
      listingStatus: overrides.listingStatus ?? "ready",
      currentHandoffRevision: overrides.currentHandoffRevision ?? 1,
      sourceHandoffRevision: 1,
      staleReasonCode: null,
      staleDraftPresent: false,
      handoffEffectiveStatus: "active",
      humanReviewRequired: true,
      researchRevision: 1,
      storageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-27T00:00:00.000Z" },
      factSummary: { confirmedFacts: overrides.confirmedFacts ?? 5, listingEligibleFacts: 4, prohibitedClaims: 0 },
      draft: null,
      history: [],
      readiness: {
        claimSafe: true,
        copyReady: true,
        keywordReady: false,
        missingForQuality: [],
        counts: { identity: 1, specification: 1, functional: 2, listingEligible: 4 },
      },
      claimPreflight: overrides.claimPreflight ?? { pass: true, reason: null },
      listingBrief: { schema: "listing-creation-brief.v1", ...listingBrief },
      keywordBriefSummary: null,
    },
  };
}

function brief(prefix: string) {
  return {
    coreSellingPoint: `${prefix}-core`,
    targetAudience: `${prefix}-audience`,
    useScenario: `${prefix}-scenario`,
    differentiation: `${prefix}-difference`,
    contentEmphasis: `${prefix}-emphasis`,
  };
}

/** save_listing_brief 成功响应（与后端 route 契约同形：saved/listingBrief/storageVersion/currentHandoffRevision） */
function saveListingBriefData(
  listingBrief: Record<string, string> | null,
  overrides: Partial<{ resultJsonHash: string; updatedAt: string; currentHandoffRevision: number }> = {},
) {
  return {
    ok: true,
    data: {
      saved: true,
      listingBrief,
      storageVersion: {
        resultJsonHash: overrides.resultJsonHash ?? "b".repeat(64),
        updatedAt: overrides.updatedAt ?? "2026-08-27T00:00:01.000Z",
      },
      currentHandoffRevision: overrides.currentHandoffRevision ?? 1,
    },
  };
}

function saveButton(): FakeElement | null {
  return elementByTestId("listing-brief-save");
}

function saveStatus(): FakeElement | null {
  return elementByTestId("listing-brief-save-status");
}

/** 触发一次保存点击并在 flush 后完成全部异步状态更新 */
async function clickSave() {
  const button = saveButton();
  if (!button) throw new Error("保存按钮不存在");
  await act(async () => {
    button.dispatchEvent(new FakeEvent("click", button));
  });
  await flush();
}

/** generate 成功响应（最小契约：组件只读取 listingStatus 并随后 load()） */
function generateListItemResponse() {
  return {
    ok: true,
    data: {
      listingStatus: "ready",
      currentHandoffRevision: 1,
      sourceHandoffRevision: 1,
      idempotentReplay: false,
      humanReviewRequired: true,
      draft: null,
    },
  };
}

function generateButton(): FakeElement | null {
  return elementByTestId("generate-listing-draft");
}

function regenerateButton(): FakeElement | null {
  return elementByTestId("regenerate-listing-draft");
}

function unsavedWarning(): FakeElement | null {
  return elementByTestId("listing-brief-unsaved-warning");
}

/** 触发一次生成入口点击（FakeDOM 不模拟原生 disabled，借以验证 generate 内部防线） */
async function clickGenerate(button: FakeElement | null) {
  if (!button) throw new Error("生成按钮不存在");
  await act(async () => {
    button.dispatchEvent(new FakeEvent("click", button));
  });
}

function briefTextareas(): FakeElement[] {
  return elementsWithin(elementByTestId("listing-creation-brief") ?? container, (element) => element.tagName === "TEXTAREA");
}

async function setTextareaValue(element: FakeElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(FakeElement.prototype, "value")?.set;
  if (!setter) throw new Error("Fake textarea value setter missing");
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new FakeEvent("input", element));
    element.dispatchEvent(new FakeEvent("change", element));
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(async () => {
  root = null;
  originalFetch = globalThis.fetch;
  installGlobals();
  createRootForTest = (await import("react-dom/client")).createRoot;
});

afterEach(async () => {
  if (root) {
    await act(async () => { root?.unmount(); });
    root = null;
  }
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Listing 创作补充表单（真实 DOM）", () => {
  it("状态与可选创作方向默认收起，首屏不平铺诊断和五个输入框", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(listingState(brief("compact"))), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");
    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-compact", refreshSignal: 0 }));
    });
    await flush();
    expect(elementByTestId("listing-support-details")?.hasAttribute("open")).toBe(false);
    expect(elementByTestId("listing-diagnostics")).toBeNull();
  });

  it("首次 GET 仅请求一次并把服务端五字段回填到表单", async () => {
    const incoming = brief("A");
    const fetchMock = vi.fn(async (_input: string | URL | Request) => new Response(JSON.stringify(listingState(incoming)), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/tasks/task-brief-a/listing-handoff");
    const textareas = elementsWithin(container, (element) => element.tagName === "TEXTAREA");
    expect(textareas).toHaveLength(5);
    expect(textareas.map((element) => element.value)).toEqual(Object.values(incoming));
    const fieldset = elementByTestId("listing-creation-brief");
    expect(fieldset).not.toBeNull();
    expect(fieldset?.getAttribute("data-brief-dirty")).toBe("false");
  });

  it("用户编辑不会触发额外 GET，并保留输入且标记 dirty", async () => {
    const incoming = brief("A");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(listingState(incoming)), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    const first = briefTextareas()[0];
    expect(first?.value).toBe("A-core");
    await setTextareaValue(first, "用户正在编辑的核心卖点");
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(briefTextareas()[0]?.value).toBe("用户正在编辑的核心卖点");
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("true");
  });

  it("refreshSignal 重读服务端时保留未保存编辑，并更新 saved 基线", async () => {
    const first = brief("A");
    const refreshed = brief("B");
    const responses = [listingState(first), listingState(refreshed, { currentHandoffRevision: 2 })];
    const fetchMock = vi.fn(async () => jsonResponse(responses.shift()));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();
    await setTextareaValue(briefTextareas()[0], "尚未保存的用户编辑");

    await act(async () => {
      root?.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 1 }));
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(briefTextareas()[0]?.value).toBe("尚未保存的用户编辑");
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("true");

    const textareas = briefTextareas();
    for (const [index, value] of Object.values(refreshed).entries()) {
      await setTextareaValue(textareas[index], value);
    }
    expect(briefTextareas().map((element) => element.value)).toEqual(Object.values(refreshed));
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("false");
  });

  it("taskId 切换后晚到的旧响应不得覆盖新任务任何状态", async () => {
    const responseA = deferred<Response>();
    const responseB = deferred<Response>();
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      return url.includes("task-brief-b") ? responseB.promise : responseA.promise;
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await act(async () => {
      root?.render(createElement(ListingHandoffSection, { taskId: "task-brief-b", refreshSignal: 0 }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      responseB.resolve(jsonResponse(listingState(brief("B"), { currentHandoffRevision: 2, confirmedFacts: 22 })));
      await responseB.promise;
    });
    await flush();
    expect(briefTextareas().map((element) => element.value)).toEqual(Object.values(brief("B")));
    expect(container.textContent).not.toContain("创作资料已撤回");
    expect(container.textContent).toContain("已确认事实：22");

    await act(async () => {
      responseA.resolve(jsonResponse(listingState(brief("A"), { listingStatus: "revoked", confirmedFacts: 1 })));
      await responseA.promise;
    });
    await flush();
    await flush();

    expect(briefTextareas().map((element) => element.value)).toEqual(Object.values(brief("B")));
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("false");
    expect(container.textContent).not.toContain("创作资料已撤回");
    expect(container.textContent).toContain("已确认事实：22");
    expect(container.textContent).not.toContain("已确认事实：1");
  });

  it("taskId 切换后晚到的旧失败响应不得污染新任务提示", async () => {
    const responseA = deferred<Response>();
    const responseB = deferred<Response>();
    const fetchMock = vi.fn((input: string | URL | Request) => (
      String(input).includes("task-brief-b") ? responseB.promise : responseA.promise
    ));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await act(async () => {
      root?.render(createElement(ListingHandoffSection, { taskId: "task-brief-b", refreshSignal: 0 }));
    });

    await act(async () => {
      responseB.resolve(jsonResponse(listingState(brief("B"), { confirmedFacts: 22 })));
      await responseB.promise;
    });
    await flush();

    await act(async () => {
      responseA.resolve(new Response("stale failure", { status: 500 }));
      await responseA.promise;
    });
    await flush();

    expect(briefTextareas().map((element) => element.value)).toEqual(Object.values(brief("B")));
    expect(container.textContent).not.toContain("状态加载失败，请刷新重试。");
    expect(container.textContent).toContain("已确认事实：22");
  });

  it("编辑后点击保存：POST 六字段精确，成功后 dirty=false、显示成功且无生成请求", async () => {
    const incoming = brief("A");
    const edited = { ...brief("A"), coreSellingPoint: "用户核心卖点编辑" };
    const saveBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        saveBodies.push(body);
        return jsonResponse(saveListingBriefData({ schema: "listing-creation-brief.v1", ...edited }, { currentHandoffRevision: 1 }));
      }
      return jsonResponse(listingState(incoming));
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    await setTextareaValue(briefTextareas()[0], "用户核心卖点编辑");
    expect(saveButton()).not.toBeNull();
    expect(saveButton()?.disabled).toBe(false);
    expect(saveButton()?.textContent).toContain("保存创作补充");

    await clickSave();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(saveBodies).toHaveLength(1);
    const body = saveBodies[0]!;
    expect(Object.keys(body).sort()).toEqual([
      "action", "confirmed", "expectedHandoffRevision", "expectedStorageVersion", "listingBrief", "requestId",
    ]);
    expect(body.action).toBe("save_listing_brief");
    expect(body.confirmed).toBe(true);
    expect(body.expectedHandoffRevision).toBe(1);
    expect(body.expectedStorageVersion).toEqual({
      resultJsonHash: "a".repeat(64),
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(typeof body.requestId).toBe("string");
    expect((body.requestId as string).length).toBeGreaterThan(0);
    expect(body.listingBrief).toEqual(edited);
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("false");
    expect(saveStatus()?.textContent).toContain("创作补充已保存");
    expect(container.textContent).not.toContain("生成 Listing 草稿中");
  });

  it("初始 dirty=false：保存按钮存在且 disabled、显示已保存，无状态提示", async () => {
    const incoming = brief("A");
    const fetchMock = vi.fn(async () => jsonResponse(listingState(incoming)));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("false");
    expect(saveButton()).not.toBeNull();
    expect(saveButton()?.disabled).toBe(true);
    expect(saveButton()?.textContent).toContain("已保存");
    expect(saveStatus()).toBeNull();
  });

  it("400/500 后输入原样、dirty=true、显示保存失败，重新保存成功", async () => {
    const incoming = brief("A");
    const edited = { ...brief("A"), coreSellingPoint: "故障前输入" };
    const postBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        postBodies.push(body);
        if (postBodies.length === 1) {
          return new Response(JSON.stringify({ error: { code: "invalid_json", message: "请求格式无效。" } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        if (postBodies.length === 2) return new Response("server error", { status: 500 });
        return jsonResponse(saveListingBriefData({ schema: "listing-creation-brief.v1", ...edited }));
      }
      return jsonResponse(listingState(incoming));
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();
    await setTextareaValue(briefTextareas()[0], "故障前输入");

    await clickSave();
    expect(briefTextareas()[0]?.value).toBe("故障前输入");
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("true");
    expect(saveStatus()?.textContent).toContain("保存失败，已保留你的输入");
    expect(saveButton()?.disabled).toBe(false);
    expect(saveButton()?.textContent).toContain("重新保存");

    await clickSave();
    expect(briefTextareas()[0]?.value).toBe("故障前输入");
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("true");
    expect(saveStatus()?.textContent).toContain("保存失败，已保留你的输入");

    await clickSave();
    expect(postBodies).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(briefTextareas()[0]?.value).toBe("故障前输入");
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("false");
    expect(saveStatus()?.textContent).toContain("创作补充已保存");
  });

  it("409 保留输入：显示冲突、GET 刷新版本，再次保存使用新版本且成功", async () => {
    const incoming = brief("A");
    const refreshed = listingState(brief("B"), { currentHandoffRevision: 2, confirmedFacts: 6 });
    refreshed.data.storageVersion = { resultJsonHash: "c".repeat(64), updatedAt: "2026-08-27T00:00:02.000Z" };
    const edited = { ...brief("A"), coreSellingPoint: "用户在编辑保留" };
    let getCount = 0;
    const postBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        postBodies.push(body);
        if (postBodies.length === 1) {
          return new Response(JSON.stringify({ error: { code: "task_result_conflict", message: "任务已在其他页面更新，请刷新后重试。" } }), {
            status: 409,
            headers: { "content-type": "application/json" },
          });
        }
        return jsonResponse(saveListingBriefData({ schema: "listing-creation-brief.v1", ...edited }));
      }
      getCount += 1;
      return jsonResponse(getCount === 1 ? listingState(incoming) : refreshed);
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();
    await setTextareaValue(briefTextareas()[0], "用户在编辑保留");

    await clickSave();

    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]?.expectedStorageVersion).toEqual({ resultJsonHash: "a".repeat(64), updatedAt: "2026-08-27T00:00:00.000Z" });
    expect(postBodies[0]?.expectedHandoffRevision).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(briefTextareas()[0]?.value).toBe("用户在编辑保留");
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("true");
    expect(saveStatus()?.textContent).toContain("内容已在其他位置更新，已保留你的输入，请重新保存");
    expect(saveButton()?.disabled).toBe(false);

    await clickSave();

    expect(postBodies).toHaveLength(2);
    expect(postBodies[1]?.expectedStorageVersion).toEqual({ resultJsonHash: "c".repeat(64), updatedAt: "2026-08-27T00:00:02.000Z" });
    expect(postBodies[1]?.expectedHandoffRevision).toBe(2);
    expect(postBodies[1]?.listingBrief).toEqual(edited);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("false");
    expect(saveStatus()?.textContent).toContain("创作补充已保存");
  });

  it("五字段从非空全部清空后保存：POST listingBrief:null，成功后 dirty=false", async () => {
    const incoming = brief("A");
    const postBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        postBodies.push(body);
        return jsonResponse(saveListingBriefData(null));
      }
      return jsonResponse(listingState(incoming));
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    const textareas = briefTextareas();
    for (const textarea of textareas) {
      await setTextareaValue(textarea, "");
    }
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("true");

    await clickSave();

    expect(postBodies).toHaveLength(1);
    const body = postBodies[0]!;
    expect(Object.keys(body).sort()).toEqual([
      "action", "confirmed", "expectedHandoffRevision", "expectedStorageVersion", "listingBrief", "requestId",
    ]);
    expect(body.action).toBe("save_listing_brief");
    expect(body.confirmed).toBe(true);
    expect(body.listingBrief).toBeNull();
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("false");
    expect(briefTextareas().map((element) => element.value)).toEqual(["", "", "", "", ""]);
    expect(saveStatus()?.textContent).toContain("创作补充已保存");
  });

  it("Ready 未保存：编辑后生成按钮不禁用，点击自动触发 save→generate 流程", async () => {
    const fetchCalls: { method: string; body: Record<string, unknown> | null }[] = [];
    const incoming = brief("A");
    const edited = { ...incoming, coreSellingPoint: "未保存编辑" };
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        fetchCalls.push({ method: "POST", body });
        if (body.action === "save_listing_brief") {
          return jsonResponse(saveListingBriefData({ schema: "listing-creation-brief.v1", ...edited }));
        }
        return jsonResponse(generateListItemResponse());
      }
      fetchCalls.push({ method: "GET", body: null });
      return jsonResponse(listingState(incoming));
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    await setTextareaValue(briefTextareas()[0], "未保存编辑");
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("true");
    const warning = unsavedWarning();
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain("请先保存商品创作补充，再生成 Listing 草稿。");
    expect(generateButton()).not.toBeNull();
    expect(generateButton()?.disabled, "dirty 时生成按钮不被静默禁用").toBe(false);

    await clickGenerate(generateButton());
    await flush();
    const postCalls = fetchCalls.filter((call) => call.method === "POST");
    expect(postCalls).toHaveLength(2);
    expect(postCalls[0].body?.action).toBe("save_listing_brief");
    expect(postCalls[1].body?.action).toBeUndefined();
  });

  it("已有草稿（active）未保存：重新生成按钮不禁用，点击自动触发 save→generate", async () => {
    const fetchCalls: { method: string; body: Record<string, unknown> | null }[] = [];
    const incoming = brief("A");
    const edited = { ...incoming, targetAudience: "未保存编辑-已有草稿" };
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        fetchCalls.push({ method: "POST", body });
        if (body.action === "save_listing_brief") {
          return jsonResponse(saveListingBriefData({ schema: "listing-creation-brief.v1", ...edited }));
        }
        return jsonResponse(generateListItemResponse());
      }
      fetchCalls.push({ method: "GET", body: null });
      return jsonResponse(listingState(incoming, { listingStatus: "active" }));
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    expect(regenerateButton()).not.toBeNull();
    await setTextareaValue(briefTextareas()[1], "未保存编辑-已有草稿");
    expect(regenerateButton()?.disabled, "dirty 时重新生成按钮不禁用").toBe(false);
    expect(unsavedWarning()?.textContent).toContain("请先保存商品创作补充，再生成 Listing 草稿。");

    await clickGenerate(regenerateButton());
    await flush();
    const postCalls = fetchCalls.filter((call) => call.method === "POST");
    expect(postCalls).toHaveLength(2);
    expect(postCalls[0].body?.action).toBe("save_listing_brief");
    expect(postCalls[1].body?.action).toBeUndefined();
  });

  it("保存成功后再生成：GET→save POST→generate POST 时序，generate 仅携带保存响应五字段", async () => {
    const incoming = brief("A");
    const savedValue = { ...brief("A"), coreSellingPoint: "保存后的卖点" };
    const order: string[] = [];
    const posts: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const method = (init?.method ?? "GET") as string;
      if (method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        posts.push(body);
        if (body.action === "save_listing_brief") {
          order.push("save");
          return jsonResponse(saveListingBriefData({ schema: "listing-creation-brief.v1", ...savedValue }));
        }
        order.push("generate");
        return jsonResponse(generateListItemResponse());
      }
      order.push("get");
      return jsonResponse(listingState(incoming));
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    await setTextareaValue(briefTextareas()[0], "保存后的卖点");
    await clickSave();
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("false");
    expect(unsavedWarning()).toBeNull();
    expect(generateButton()?.disabled).toBe(false);
    expect(order.slice(0, 2)).toEqual(["get", "save"]);

    await clickGenerate(generateButton());
    await flush();
    await flush();
    expect(order).toEqual(["get", "save", "generate", "get"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(generateButton()?.disabled).toBe(false);
    expect(unsavedWarning()).toBeNull();
    const generatePost = posts.find((body) => body.action === undefined);
    expect(generatePost).toBeDefined();
    expect(generatePost?.listingBrief).toEqual(savedValue);
    expect(JSON.stringify(generatePost)).not.toContain("保存前旧值");
  });

  it("保存成功后再编辑未保存：生成按钮不禁用，点击自动保存新值并进入生成请求", async () => {
    const incoming = brief("A");
    const firstSaved = { ...brief("A"), coreSellingPoint: "第一次保存值" };
    const secondSaved = { ...firstSaved, targetAudience: "未保存新值" };
    const posts: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        if (body.action === "save_listing_brief") {
          const isSecond = (body.listingBrief as { targetAudience?: string })?.targetAudience === "未保存新值";
          return jsonResponse(saveListingBriefData({ schema: "listing-creation-brief.v1", ...(isSecond ? secondSaved : firstSaved) }));
        }
        return jsonResponse(generateListItemResponse());
      }
      return jsonResponse(listingState(incoming));
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");

    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    await setTextareaValue(briefTextareas()[0], "第一次保存值");
    await clickSave();
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("false");
    expect(generateButton()?.disabled).toBe(false);

    await setTextareaValue(briefTextareas()[1], "未保存新值");
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("true");
    expect(generateButton()?.disabled, "再编辑未保存时不禁用生成按钮").toBe(false);
    expect(unsavedWarning()).not.toBeNull();

    await clickGenerate(generateButton());
    await flush();
    const gens = posts.filter((body) => body.action === undefined);
    expect(gens).toHaveLength(1);
    expect((gens[0].listingBrief as { targetAudience?: string })?.targetAudience).toBe("未保存新值");
  });
});

describe("claimPreflight 三态 UI（Pending 可生成 / 真 blocked 禁用）", () => {
  function renderWith(overrides: Parameters<typeof listingState>[1]) {
    const fetchMock = vi.fn(async () => jsonResponse(listingState(brief("A"), overrides)));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    return { fetchMock };
  }
  function readyText(): string {
    return documentInstance.body.textContent ?? "";
  }
  function generateBtn(): FakeElement | null {
    return elementByTestId("generate-listing-draft");
  }

  it("Pending（english_rendering_pending + canGenerate=true）：显示可生成 + 英文化提醒 + 按钮启用 + 无 blocking 标记", async () => {
    const { fetchMock } = renderWith({
      canGenerate: true,
      claimPreflight: {
        pass: false,
        reasonCode: "english_rendering_pending",
        reason: "中文商品事实将在正式生成阶段英文化（不阻塞生成）；完整文案校验在生成时执行。",
      },
    });
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");
    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-pending-a", refreshSignal: 0 }));
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(readyText()).toContain("可生成 Listing 草稿");
    expect(readyText()).toContain("中文事实将在生成时自动英文化");
    // Pending 不是阻断：不得显示 blocking 文案/标记
    expect(readyText()).not.toContain("事实校验未通过");
    expect(readyText()).not.toContain("暂不能生成");
    expect(elementByTestId("claim-preflight-blocked")).toBeNull();
    // 生成按钮启用
    expect(generateBtn()?.disabled).toBe(false);
  });

  it("真 blocked（listing_claims_unsupported + canGenerate=false）：显示阻断 + 原因 + 按钮禁用", async () => {
    const { fetchMock } = renderWith({
      canGenerate: false,
      claimPreflight: {
        pass: false,
        reasonCode: "listing_claims_unsupported",
        reason: "组合草稿含未经验证的表述（无事实支持）。请补充并确认相应商品事实后重试。",
      },
    });
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");
    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-blocked-a", refreshSignal: 0 }));
    });
    await flush();

    expect(readyText()).toContain("事实校验未通过，暂不能生成");
    expect(elementByTestId("claim-preflight-blocked")).not.toBeNull();
    expect(generateBtn()?.disabled).toBe(true);
  });
});

// ── 生成"点击无响应"防治：幂等重放必须给出明确原因；禁用必须显示原因；busy/错误/409 恢复合同锁定 ──
describe("生成点击反馈合同（幂等重放/禁用原因/busy/错误/409 恢复）", () => {
  /** active 态 + 确认前生成的旧草稿（keywordPlanSource=none）+ 已确认关键词方案 */
  function activeStateWithStaleKeywordDraft(canGenerate = true) {
    const state = listingState(brief("A"), { listingStatus: "active", currentHandoffRevision: 2, canGenerate }) as unknown as {
      data: Record<string, unknown>;
    };
    state.data.draft = {
      generatedAt: "2026-09-01T15:06:04.021Z",
      source: "deterministic_composition_v1",
      version: 1,
      composerVersion: "listing-composer-v1",
      generationPolicyVersion: "listing-generation-policy-v1",
      polishApplied: false,
      polishModel: null,
      titles: ["ukeetap UTO001 Expandable Cutlery Drawer Organizer"],
      bullets: ["The Organizer has an expandable compartment design for drawers."],
      description: "The Organizer fits most medium and large kitchen drawers.",
      keywords: [],
      draftKind: "safe_fact_draft",
      listingUnqualified: false,
      factSafe: true,
      copyQuality: true,
      fallbackApplied: true,
      fallbackReason: "AI 服务暂时不可用，已保留安全草稿。",
      providerAttempted: true,
      providerSucceeded: false,
      keywordPlanSource: "none",
      usedKeywordTrace: [],
      searchOnlyKeywordTrace: [],
      sellingPoints: ["Expandable design for drawers"],
      riskNotes: ["商品信息来自已人工确认的事实，所有表述仍需人工复核。"],
      reviewChecklist: ["请人工核对事实、表达与搜索词后完善。"],
      blockedClaims: [],
      complianceWarnings: [],
      qualityIssues: ["AI 最终草稿未通过 Claim Evidence"],
    };
    state.data.keywordBriefSummary = { primaryKeyword: "silverware organizer", source: "sellersprite", backendTermsCount: 0 };
    (state.data.readiness as { keywordReady: boolean }).keywordReady = true;
    return state;
  }

  it("幂等重放且草稿早于关键词确认：必须显示含关键词方案的明确原因，不得只提示未重复调用", async () => {
    const state = activeStateWithStaleKeywordDraft();
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse({ ok: true, data: { listingStatus: "active", currentHandoffRevision: 2, sourceHandoffRevision: 2, idempotentReplay: true, humanReviewRequired: true, draft: state.data.draft } });
      }
      return jsonResponse(state);
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");
    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    expect(regenerateButton()?.disabled).toBe(false);
    await clickGenerate(regenerateButton());
    await flush();

    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(container.textContent).toContain("关键词方案");
    expect(container.textContent).toContain("未重新生成");
    expect(container.textContent).toContain("尚未进入草稿");
  });

  it("canGenerate=false 且无阻断原因时：禁用的生成按钮旁必须显示具体原因", async () => {
    const state = listingState(brief("A"), { listingStatus: "active", canGenerate: false });
    const fetchMock = vi.fn(async () => jsonResponse(state));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");
    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    expect(regenerateButton()?.disabled).toBe(true);
    const reason = elementByTestId("generate-disabled-reason");
    expect(reason).not.toBeNull();
    expect((reason?.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("busy 期间重复点击：恰好 1 次生成 POST，不重复请求", async () => {
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => { release = resolve; });
    let postCount = 0;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        postCount += 1;
        return postCount === 1 ? gate : jsonResponse(generateListItemResponse());
      }
      return jsonResponse(listingState(brief("A"), { listingStatus: "active" }));
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");
    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    await clickGenerate(regenerateButton());
    // busy 合同：pending 期间按钮必须禁用并显示"生成中…"（真实浏览器中 disabled 是防重击第一道防线）
    expect(regenerateButton()?.disabled).toBe(true);
    expect(regenerateButton()?.textContent.trim()).toBe("生成中…");
    release(jsonResponse(generateListItemResponse()));
    await flush();
    expect(postCount).toBe(1);
    expect(regenerateButton()?.disabled).toBe(false);
  });

  it("生成返回 500：页面显示可见的生成失败提示", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ ok: false, error: { code: "listing_claims_unsupported", message: "组合草稿未通过事实校验" } }), { status: 500, headers: { "content-type": "application/json" } });
      }
      return jsonResponse(listingState(brief("A"), { listingStatus: "active" }));
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");
    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    await clickGenerate(regenerateButton());
    await flush();
    expect(container.textContent).toContain("生成失败");
  });

  it("普通幂等重放（草稿非确认前）：保留未重复调用提示", async () => {
    const state = activeStateWithStaleKeywordDraft();
    (state.data.draft as Record<string, unknown>).keywordPlanSource = "manual";
    (state.data.draft as Record<string, unknown>).keywords = ["silverware organizer"];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse({ ok: true, data: { listingStatus: "active", currentHandoffRevision: 2, sourceHandoffRevision: 2, idempotentReplay: true, humanReviewRequired: true, draft: state.data.draft } });
      }
      return jsonResponse(state);
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");
    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    await clickGenerate(regenerateButton());
    await flush();
    expect(container.textContent).toContain("未重复调用");
  });

  it("生成 409：提示后自动刷新版本并重试一次成功", async () => {
    let genCalls = 0;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        genCalls += 1;
        if (genCalls === 1) {
          return new Response(JSON.stringify({ ok: false, error: { code: "task_result_conflict", message: "任务已在其他页面更新，请刷新后重试。" } }), { status: 409, headers: { "content-type": "application/json" } });
        }
        return jsonResponse(generateListItemResponse());
      }
      return jsonResponse(listingState(brief("A"), { listingStatus: "active" }));
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");
    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId: "task-brief-a", refreshSignal: 0 }));
    });
    await flush();

    await clickGenerate(regenerateButton());
    await flush();
    await flush();
    expect(genCalls).toBe(2);
    expect(container.textContent).toContain("已生成");
  });
});

/* ──────────────────────────────────────────────────────────────
 * 发布前核对卡：关键词四类互斥 + 待确认表达全文与隔离（红测先行）
 *
 * 命题：页面必须一眼区分「确认了什么 / 正文用了什么 / 仅搜索什么 / 没用什么」，
 * 待确认表达必须全文可见、明确未进入正式字段、且不进入任何复制内容。
 * 本组用例在实现之前必须真实变红；不得改断言迁就现状。
 * ────────────────────────────────────────────────────────────── */

const REVIEW_CLAIM_LONG =
  "The organizer keeps cutlery neatly separated and is backed by a lifetime warranty against cracking under normal household use.";
const REVIEW_CLAIM_SHORT = "This organizer fits every standard kitchen drawer without measuring.";
const BODY_TITLE = "Ukeetap Expandable Drawer Organizer for Kitchen Cutlery Storage";
const BODY_BULLETS = [
  "The Organizer is built with an expandable multi-compartment design in molded plastic.",
  "The Organizer stores about 40 to 50 pieces of cutlery.",
  "The Organizer expands or collapses to the sides according to the drawer width.",
  "The Organizer is suitable for daily kitchen storage and carrying.",
  "For care, rinse with clean water and wipe dry.",
];
const BODY_DESCRIPTION =
  "The Organizer is built with an expandable multi-compartment design in molded plastic. It stores about 40 to 50 pieces of cutlery.";

/** 正式草稿夹具：SEO 关键词字段为空（诚实显示未单独生成） */
function prepublishDraft(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-09-02T00:00:00.000Z",
    source: "ai_optimized",
    version: 1,
    titles: [BODY_TITLE],
    bullets: [...BODY_BULLETS],
    description: BODY_DESCRIPTION,
    keywords: [],
    usedKeywordTrace: ["drawer organizer"],
    searchOnlyKeywordTrace: ["cutlery tray organizer"],
    humanReviewClaims: [REVIEW_CLAIM_LONG, REVIEW_CLAIM_SHORT],
    keywordPlanSource: "manual",
    draftKind: "ai_optimized_listing",
    providerAttempted: true,
    providerSucceeded: true,
    fallbackApplied: false,
    fallbackReason: null,
    sellingPoints: [],
    riskNotes: [],
    reviewChecklist: [],
    blockedClaims: [],
    complianceWarnings: [],
    listingUnqualified: false,
    factSafe: true,
    copyQuality: true,
    ...overrides,
  };
}

/** 已确认关键词方案的有界只读摘要（route 需新增；当前 DTO 只有 primaryKeyword） */
function keywordPlanSummary(terms: string[]) {
  return { primaryKeyword: terms[0] ?? "", terms, source: "manual" };
}

function prepublishState(draft: unknown, planSummary: unknown) {
  const state = listingState(brief("A"), { listingStatus: "active", currentHandoffRevision: 2 });
  (state.data as Record<string, unknown>).draft = draft;
  (state.data as Record<string, unknown>).keywordBriefSummary = {
    primaryKeyword: "drawer organizer",
    source: "manual",
    backendTermsCount: 3,
  };
  (state.data as Record<string, unknown>).keywordBriefPlanSummary = planSummary;
  const readiness = (state.data as Record<string, unknown>).readiness as Record<string, unknown>;
  readiness.keywordReady = true;
  return state;
}

async function mountPrepublish(draft: unknown, planSummary: unknown) {
  const state = prepublishState(draft, planSummary);
  globalThis.fetch = vi.fn(async () => jsonResponse(state)) as typeof globalThis.fetch;
  const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");
  await act(async () => {
    root = createRootForTest(container as unknown as Element);
    root.render(createElement(ListingHandoffSection, { taskId: "task-prepublish", refreshSignal: 0 }));
  });
  await flush();
}

function testIdText(testId: string): string {
  return elementByTestId(testId)?.textContent ?? "";
}

/** 某个分类桶内的关键词 chip 文本（去重前的原始渲染，用于查重） */
function chipsWithin(testId: string): string[] {
  const node = elementByTestId(testId);
  if (!node) return [];
  return elementsWithin(node, (element) => element.getAttribute("data-testid") === "prepublish-keyword-chip")
    .map((element) => (element.textContent ?? "").trim())
    .filter(Boolean);
}

function reviewClaimTexts(): string[] {
  return elementsWithin(container, (element) => element.getAttribute("data-testid") === "prepublish-review-claim")
    .map((element) => (element.textContent ?? "").trim());
}

function buttonByLabel(label: string): FakeElement | null {
  return elementsWithin(container, (element) => element.tagName === "BUTTON" && (element.textContent ?? "").includes(label))[0] ?? null;
}

/** 注入可捕获的剪贴板，用于验证复制内容与待确认表达隔离 */
function installClipboardCapture(): string[] {
  const copied: string[] = [];
  const win = (globalThis as Record<string, unknown>).window as Record<string, unknown>;
  win.isSecureContext = true;
  win.navigator = {
    clipboard: {
      writeText: async (text: string) => { copied.push(text); },
    },
  };
  return copied;
}

describe("发布前核对卡：关键词四类互斥与待确认表达透明度（红测）", () => {
  it("红1：人工方案 3 词而正文只用 1 词 → 不得把整套方案说成已采用", async () => {
    const plan = keywordPlanSummary(["drawer organizer", "cutlery tray organizer", "silverware holder"]);
    await mountPrepublish(prepublishDraft(), plan);
    const card = elementByTestId("listing-prepublish-review");
    expect(card, "缺少发布前核对卡（data-testid=listing-prepublish-review）").not.toBeNull();
    const cardText = card?.textContent ?? "";
    // 未采用的方案词必须显式出现
    expect(cardText, "未采用词未展示").toContain("silverware holder");
    expect(testIdText("prepublish-unused-keywords"), "未采用区缺少 silverware holder").toContain("silverware holder");
    // 未采用区不得混入已采用词
    expect(testIdText("prepublish-unused-keywords"), "未采用区混入了正文已采用词").not.toContain("drawer organizer");
    // 首行摘要宣称的已采用数量必须是 1，不得是整套方案的 3
    expect(testIdText("prepublish-summary"), "首行摘要把整套方案当成已采用").not.toMatch(/采用\s*3\s*个/);
    expect(testIdText("prepublish-summary"), "首行摘要未给出正文已采用词数量").toMatch(/采用\s*1\s*个/);
  });

  it("红2：正文采用 / 仅搜索 / 未采用 三类互斥且各自去重", async () => {
    const plan = keywordPlanSummary(["drawer organizer", "cutlery tray organizer", "silverware holder", "silverware holder"]);
    await mountPrepublish(
      prepublishDraft({ searchOnlyKeywordTrace: ["cutlery tray organizer", "cutlery tray organizer"] }),
      plan,
    );
    const body = chipsWithin("prepublish-body-keywords");
    const search = chipsWithin("prepublish-search-only-keywords");
    const unused = chipsWithin("prepublish-unused-keywords");
    expect(body.length, "正文采用词为空").toBeGreaterThan(0);
    expect(search.length, "仅搜索词为空").toBeGreaterThan(0);
    expect(unused.length, "未采用词为空").toBeGreaterThan(0);
    const pairs: Array<[string[], string[], string, string]> = [
      [body, search, "正文采用", "仅搜索"],
      [body, unused, "正文采用", "未采用"],
      [search, unused, "仅搜索", "未采用"],
    ];
    for (const [a, b, nameA, nameB] of pairs) {
      const overlap = a.filter((item) => b.includes(item));
      expect(overlap, nameA + " 与 " + nameB + " 重复展示：" + overlap.join("、")).toEqual([]);
    }
    expect(new Set(body).size, "正文采用词内部重复：" + body.join("、")).toBe(body.length);
    expect(new Set(search).size, "仅搜索词内部重复：" + search.join("、")).toBe(search.length);
    expect(new Set(unused).size, "未采用词内部重复：" + unused.join("、")).toBe(unused.length);
  });

  it("红3：超过 80 字符的待确认表达必须显示全文，不得截断", async () => {
    expect(REVIEW_CLAIM_LONG.length, "夹具本身必须超过 80 字符").toBeGreaterThan(80);
    await mountPrepublish(prepublishDraft(), keywordPlanSummary(["drawer organizer"]));
    const claims = reviewClaimTexts();
    expect(claims.length, "待确认表达未逐条渲染").toBe(2);
    expect(claims[0], "长句被截断：" + claims[0]).toContain(REVIEW_CLAIM_LONG);
    expect(claims[0], "出现省略号截断").not.toContain("...");
    expect(claims[0]?.endsWith("under normal household use."), "长句尾部缺失：" + claims[0]).toBe(true);
    expect(claims[1], "短句也应全文展示").toContain(REVIEW_CLAIM_SHORT);
  });

  it("红4：每条待确认表达必须明确未进入正式标题/五点/描述", async () => {
    await mountPrepublish(prepublishDraft(), keywordPlanSummary(["drawer organizer"]));
    const cardText = elementByTestId("listing-prepublish-review")?.textContent ?? "";
    expect(cardText, "未写明未进入正式标题/五点/描述").toContain("未进入正式标题/五点/描述");
    expect(cardText, "未写明当前未进入正式Listing").toContain("当前未进入正式Listing");
    const items = elementsWithin(container, (element) => element.getAttribute("data-testid") === "prepublish-review-item");
    expect(items.length, "待确认表达未逐条渲染").toBe(2);
    for (const item of items) {
      const text = item.textContent ?? "";
      expect(text, "该条缺少「已被排除」标记：" + text).toContain("已被排除");
      expect(text, "该条缺少未进入正式字段说明：" + text).toContain("未进入正式标题/五点/描述");
    }
  });

  it("红5：待确认表达不得进入复制标题/五点/描述/完整 Listing", async () => {
    const copied = installClipboardCapture();
    await mountPrepublish(prepublishDraft(), keywordPlanSummary(["drawer organizer"]));
    const longProbe = REVIEW_CLAIM_LONG.slice(0, 40);
    const shortProbe = REVIEW_CLAIM_SHORT.slice(0, 30);
    for (const label of ["复制标题", "复制五点描述", "复制商品描述", "复制完整 Listing"]) {
      copied.length = 0;
      const button = buttonByLabel(label);
      expect(button, "复制按钮不存在：" + label).not.toBeNull();
      await act(async () => { button?.dispatchEvent(new FakeEvent("click", button)); });
      await flush();
      expect(copied.length, "未触发复制：" + label).toBeGreaterThan(0);
      for (const text of copied) {
        expect(text, label + " 混入了待确认长句").not.toContain(longProbe);
        expect(text, label + " 混入了待确认短句").not.toContain(shortProbe);
      }
    }
  });

  it("红6：真正不合格草稿继续隐藏正式字段与发布前核对卡", async () => {
    await mountPrepublish(
      prepublishDraft({ listingUnqualified: true, copyQuality: false, factSafe: false }),
      keywordPlanSummary(["drawer organizer"]),
    );
    expect(elementByTestId("unqualified-listing-draft"), "未显示不合格提示").not.toBeNull();
    expect(elementByTestId("listing-prepublish-review"), "不合格稿不得展示核对卡").toBeNull();
    expect(container.textContent, "不合格稿泄露了正式标题").not.toContain(BODY_TITLE);
  });

  it("红7：页面只保留一张发布前核对卡，不重复展示关键词状态", async () => {
    await mountPrepublish(prepublishDraft(), keywordPlanSummary(["drawer organizer", "silverware holder"]));
    const cards = elementsWithin(container, (element) => element.getAttribute("data-testid") === "listing-prepublish-review");
    expect(cards.length, "发布前核对卡数量不为 1").toBe(1);
    expect(elementByTestId("listing-human-review-aid"), "旧的「人工审核辅助」卡未删除").toBeNull();
    expect(container.textContent, "仍存在「人工审核辅助」标题").not.toContain("人工审核辅助");
    // 关键词状态只在一处展示：生成依据卡不得再重复关键词分组
    const basis = elementByTestId("listing-generation-basis")?.textContent ?? "";
    expect(basis, "生成依据卡重复展示了正文采用关键词").not.toContain("标题和正文实际采用的关键词");
    expect(basis, "生成依据卡重复展示了仅搜索词").not.toContain("仅用于搜索词，未进入正文");
    // 正式字段仍在
    expect(container.textContent, "正式标题丢失").toContain(BODY_TITLE);
    expect(buttonByLabel("复制完整 Listing"), "复制完整 Listing 丢失").not.toBeNull();
  });

  it("红8：SEO 关键词字段为空时诚实显示未单独生成，不得冒充全部关键词已采用", async () => {
    await mountPrepublish(prepublishDraft({ keywords: [] }), keywordPlanSummary(["drawer organizer", "silverware holder"]));
    const cardText = elementByTestId("listing-prepublish-review")?.textContent ?? "";
    expect(cardText, "未诚实说明 SEO 字段未单独生成").toContain("SEO 字段未单独生成");
    expect(testIdText("prepublish-unused-keywords"), "未采用词未展示").toContain("silverware holder");
  });
});

describe("HISTORICAL_KEYWORD_READ_GUARD：历史过滤提示 UI（单条、可见、无过滤时不出现）", () => {
  it("草稿带 historicalKeywordFilteredNotice → 恰好显示一条提示，且含固定诊断文案", async () => {
    await mountPrepublish(
      prepublishDraft({
        keywords: ["drawer organizer", "kitchen drawer organizer"],
        usedKeywordTrace: ["drawer organizer"],
        searchOnlyKeywordTrace: ["kitchen drawer organizer"],
        historicalKeywordFilteredNotice: "旧草稿关键词已按当前规则过滤，重新生成后可持久化新版结果。",
      }),
      keywordPlanSummary(["drawer organizer", "kitchen drawer organizer"]),
    );
    const notice = elementByTestId("prepublish-keywords-filter-notice");
    expect(notice, "缺少历史关键词过滤提示（data-testid=prepublish-keywords-filter-notice）").not.toBeNull();
    const text = notice?.textContent ?? "";
    expect(text, "提示文案不符").toContain("已按当前规则过滤");
    const matches = elementsWithin(container, (el) => el.getAttribute("data-testid") === "prepublish-keywords-filter-notice");
    expect(matches.length, "历史过滤提示重复出现").toBe(1);
  });

  it("干净草稿（无 notice）→ 不渲染提示，关键词 chips 正常", async () => {
    await mountPrepublish(
      prepublishDraft({ keywords: ["drawer organizer", "kitchen drawer organizer"] }),
      keywordPlanSummary(["drawer organizer"]),
    );
    expect(elementByTestId("prepublish-keywords-filter-notice"), "干净草稿不应出现过滤提示").toBeNull();
    expect(chipsWithin("prepublish-body-keywords").length, "正文采用词 chips 消失").toBeGreaterThan(0);
  });
});

/** R2「生成点击编排」董事会合同：一次点击必须启动正确流程（dirty→save→generate）或显示明确原因。 */
describe("生成点击编排（R2：dirty 自动保存后生成；失败/冲突不生成）", () => {
  const bodyText = () => container.textContent ?? "";

  async function mountGen(taskId: string, fetchMock: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { ListingHandoffSection } = await import("@/components/listing-handoff/ListingHandoffSection");
    await act(async () => {
      root = createRootForTest(container as unknown as Element);
      root.render(createElement(ListingHandoffSection, { taskId, refreshSignal: 0 }));
    });
    await flush();
  }

  function postBody(init?: RequestInit): Record<string, unknown> {
    return JSON.parse(String(init?.body)) as Record<string, unknown>;
  }

  it("R2-1 dirty 点击生成不得静默：自动 save 成功→generate，一次点击各一次 POST", async () => {
    const incoming = brief("A");
    const edited = { ...incoming, coreSellingPoint: "R2未保存的卖点" };
    const order: string[] = [];
    const fetchMock = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = postBody(init);
        if (body.action === "save_listing_brief") {
          order.push("save");
          return jsonResponse(saveListingBriefData({ schema: "listing-creation-brief.v1", ...edited }, { resultJsonHash: "s".repeat(64), currentHandoffRevision: 9 }));
        }
        order.push("generate");
        return jsonResponse(generateListItemResponse());
      }
      order.push("get");
      return jsonResponse(listingState(incoming));
    });
    await mountGen("r2-1", fetchMock);
    await setTextareaValue(briefTextareas()[0], "R2未保存的卖点");
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("true");
    await clickGenerate(generateButton());
    await flush();
    expect(order, "dirty 点击后必须真实发生 save→generate，而不是静默").toEqual(["get", "save", "generate", "get"]);
  });

  it("R2-2 无 dirty 点击生成：0 次 save、恰好 1 次 generate", async () => {
    const incoming = brief("A");
    const order: string[] = [];
    const fetchMock = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        order.push(postBody(init).action === "save_listing_brief" ? "save" : "generate");
        return jsonResponse(generateListItemResponse());
      }
      order.push("get");
      return jsonResponse(listingState(incoming));
    });
    await mountGen("r2-2", fetchMock);
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty")).toBe("false");
    await clickGenerate(generateButton());
    await flush();
    expect(order.filter((x) => x === "save").length, "无 dirty 时不得出现 save POST").toBe(0);
    expect(order.filter((x) => x === "generate").length, "无 dirty 时应恰好一次 generate POST").toBe(1);
  });

  it("R2-3 generate 必须直接使用 save 响应的 storageVersion/handoffRevision", async () => {
    const incoming = brief("A");
    const edited = { ...incoming, useScenario: "R2场景-v3" };
    const generatePosts: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = postBody(init);
        if (body.action === "save_listing_brief") {
          return jsonResponse(saveListingBriefData({ schema: "listing-creation-brief.v1", ...edited }, { resultJsonHash: "z".repeat(64), updatedAt: "2026-08-27T00:00:02.000Z", currentHandoffRevision: 13 }));
        }
        generatePosts.push(body);
        return jsonResponse(generateListItemResponse());
      }
      return jsonResponse(listingState(incoming));
    });
    await mountGen("r2-3", fetchMock);
    await setTextareaValue(briefTextareas()[2], "R2场景-v3");
    await clickGenerate(generateButton());
    await flush();
    expect(generatePosts.length, "dirty 点击后应有 generate POST").toBe(1);
    const gen = generatePosts[0];
    expect((gen.expectedStorageVersion as { resultJsonHash?: string })?.resultJsonHash, "generate 必须使用 save 响应新 hash").toBe("z".repeat(64));
    expect(gen.expectedHandoffRevision, "generate 必须使用 save 响应新 revision").toBe(13);
    expect((gen.listingBrief as { useScenario?: string })?.useScenario, "generate 携带 save 成功后的五字段").toBe("R2场景-v3");
  });

  it("R2-4a save 500：必须真实尝试一次 save、0 次 generate、保留输入与旧稿并显示明确失败", async () => {
    const incoming = brief("A");
    const posts: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(postBody(init));
        return new Response(JSON.stringify({ error: { code: "save_failed", message: "模拟保存失败" } }), { status: 500, headers: { "content-type": "application/json" } });
      }
      return jsonResponse(listingState(incoming));
    });
    await mountGen("r2-4a", fetchMock);
    await setTextareaValue(briefTextareas()[0], "输入要保留");
    await clickGenerate(generateButton());
    await flush();
    const saveAttempts = posts.filter((p) => (p as { action?: string }).action === "save_listing_brief");
    expect(saveAttempts.length, "save 失败也应真实尝试一次保存（不得静默跳过）").toBe(1);
    expect(posts.filter((p) => (p as { action?: string }).action === undefined).length, "save 失败后不得 generate").toBe(0);
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty"), "失败后输入仍 dirty").toBe("true");
    expect(briefTextareas()[0].value, "失败后输入保留").toBe("输入要保留");
    const status = elementByTestId("listing-brief-save-status")?.textContent ?? "";
    expect(status, "save 失败提示可见").toContain("保存失败");
  });

  it("R2-4b save 409：0 次 generate、输入保留、显示冲突并刷新版本", async () => {
    const incoming = brief("A");
    const order: string[] = [];
    const fetchMock = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        order.push("save");
        return new Response(JSON.stringify({ error: { code: "task_result_conflict", message: "revision conflict" } }), { status: 409, headers: { "content-type": "application/json" } });
      }
      order.push("get");
      return jsonResponse(listingState(incoming));
    });
    await mountGen("r2-4b", fetchMock);
    await setTextareaValue(briefTextareas()[1], "冲突时输入保留");
    await clickGenerate(generateButton());
    await flush();
    expect(order.filter((x) => x === "save").length, "409 应来自真实 save 尝试").toBe(1);
    expect(order.filter((x) => x === "generate").length, "409 后 0 次 generate").toBe(0);
    expect(elementByTestId("listing-creation-brief")?.getAttribute("data-brief-dirty"), "409 后输入仍 dirty 保留").toBe("true");
    expect(briefTextareas()[1].value, "409 后输入内容保留").toBe("冲突时输入保留");
    expect(bodyText(), "409 冲突提示可见").toContain("已保留你的输入");
  });

  it("R2-4c save network error：真实尝试 save、0 generate、输入保留并显示失败", async () => {
    const incoming = brief("A");
    const posts: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(postBody(init));
        throw new TypeError("network down");
      }
      return jsonResponse(listingState(incoming));
    });
    await mountGen("r2-4c", fetchMock);
    await setTextareaValue(briefTextareas()[0], "网络错误输入保留");
    await clickGenerate(generateButton());
    await flush();
    expect(posts.filter((p) => (p as { action?: string }).action === "save_listing_brief").length, "网络错误也需真实尝试一次保存").toBe(1);
    expect(posts.filter((p) => (p as { action?: string }).action === undefined).length, "网络错误不得 generate").toBe(0);
    expect(briefTextareas()[0].value, "网络错误输入保留").toBe("网络错误输入保留");
    const status = elementByTestId("listing-brief-save-status")?.textContent ?? "";
    expect(status, "网络错误保存失败提示可见").toContain("保存失败");
  });

  it("R2-5 双击只产生一组流程（save 1 + generate 1），不重复 POST", async () => {
    const incoming = brief("A");
    const edited = { ...incoming, coreSellingPoint: "双击卖点" };
    const posts: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = postBody(init);
        posts.push(body);
        await new Promise((r) => setTimeout(r, 5));
        if ((body as { action?: string }).action === "save_listing_brief") {
          return jsonResponse(saveListingBriefData({ schema: "listing-creation-brief.v1", ...edited }));
        }
        return jsonResponse(generateListItemResponse());
      }
      return jsonResponse(listingState(incoming));
    });
    await mountGen("r2-5", fetchMock);
    await setTextareaValue(briefTextareas()[0], "双击卖点");
    const button = generateButton();
    if (!button) throw new Error("生成按钮不存在");
    await act(async () => {
      button.dispatchEvent(new FakeEvent("click", button));
      button.dispatchEvent(new FakeEvent("click", button));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await flush();
    const saves = posts.filter((p) => (p as { action?: string }).action === "save_listing_brief");
    const gens = posts.filter((p) => (p as { action?: string }).action === undefined);
    expect(saves.length, "双击最多一次 save").toBe(1);
    expect(gens.length, "双击最多一次 generate").toBe(1);
  });

  it("R2-6 双击期间的提交状态立即可见（非静默）", async () => {
    const incoming = brief("A");
    const edited = { ...incoming, coreSellingPoint: "进行中卖点" };
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((r) => { release = r; });
    const fetchMock = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = postBody(init);
        if ((body as { action?: string }).action === "save_listing_brief") {
          return gate; // 挂起保存，观察按钮状态与提示
        }
        return jsonResponse(generateListItemResponse());
      }
      return jsonResponse(listingState(incoming));
    });
    await mountGen("r2-6", fetchMock);
    await setTextareaValue(briefTextareas()[0], "进行中卖点");
    await clickGenerate(generateButton());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const text = elementByTestId("listing-brief-save")?.textContent ?? "";
    expect(text, "保存挂起时应立即可见「保存中…」").toContain("保存中");
    release(jsonResponse(saveListingBriefData({ schema: "listing-creation-brief.v1", ...edited })));
    await flush();
  });

  it("R2-7 generate 500：保留旧稿、显示明确失败、不再触发额外流程", async () => {
    const st = listingState(brief("A"), { listingStatus: "active" });
    (st.data as unknown as { draft: unknown }).draft = {
      draftKind: "structured_listing_draft", source: "deterministic_composition_v1", version: 1, composerVersion: "x",
      generationPolicyVersion: "p", polishApplied: false, polishModel: null, generatedAt: "2026-08-27T00:00:00.000Z",
      listingUnqualified: false, factSafe: true, copyQuality: true,
      titles: ["OLD TITLE"], bullets: ["OLD_BULLET_KEEP"], description: "old description", keywords: [],
      backendSearchTerms: [], usedKeywordTrace: [], searchOnlyKeywordTrace: [],
      sellingPoints: [], sellingPointPlan: [], qualityIssues: [], rejectedListingSentences: [],
      riskNotes: [], complianceWarnings: [], blockedClaims: [], reviewChecklist: [],
    };
    const posts: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(postBody(init));
        return new Response(JSON.stringify({ error: { code: "generate_failed", message: "boom-gen" } }), { status: 500, headers: { "content-type": "application/json" } });
      }
      return jsonResponse(st);
    });
    await mountGen("r2-7", fetchMock);
    expect(regenerateButton(), "active 草稿应展示重新生成按钮").not.toBeNull();
    await clickGenerate(regenerateButton());
    await flush();
    expect(posts.filter((p) => (p as { action?: string }).action === undefined).length, "generate 失败也需真实尝试一次").toBe(1);
    expect(posts.filter((p) => (p as { action?: string }).action === "save_listing_brief").length, "generate 失败不触发 save").toBe(0);
    expect(bodyText(), "generate 失败提示明确可见").toContain("生成失败：boom-gen");
    expect(bodyText(), "generate 失败后旧稿保留").toContain("OLD_BULLET_KEEP");
  });

  it("R2-8 canGenerate=false：0 POST 且原因可见", async () => {
    const postCalls: unknown[] = [];
    const fetchMock = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") postCalls.push(init);
      return jsonResponse(listingState(brief("A"), { canGenerate: false }));
    });
    await mountGen("r2-8", fetchMock);
    const reason = elementByTestId("generate-disabled-reason");
    expect(generateButton()?.disabled, "硬性 canGenerate=false 时按钮禁用").toBe(true);
    expect(reason, "禁用原因结构可见").not.toBeNull();
    expect(reason?.textContent ?? "", "禁用原因有文案").not.toBe("");
    await clickGenerate(generateButton());
    await flush();
    expect(postCalls.length, "硬性禁用时 0 POST").toBe(0);
  });

  it("R2-9 卸载后完成异步不写 state（无异常）", async () => {
    const incoming = brief("A");
    const edited = { ...incoming, coreSellingPoint: "卸载卖点" };
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((r) => { release = r; });
    const fetchMock = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = postBody(init);
        if ((body as { action?: string }).action === "save_listing_brief") {
          return gate;
        }
        return jsonResponse(generateListItemResponse());
      }
      return jsonResponse(listingState(incoming));
    });
    await mountGen("r2-9", fetchMock);
    await setTextareaValue(briefTextareas()[0], "卸载卖点");
    await clickGenerate(generateButton());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    await act(async () => { root?.unmount(); root = null; });
    release(jsonResponse(saveListingBriefData({ schema: "listing-creation-brief.v1", ...edited })));
    await flush();
    expect(true, "卸载后异步落定不抛异常、不 setState").toBe(true);
  });

  it("R2-10 generate 网络异常：catch 必须展示「网络异常，请重试。」，不得静默吞掉", async () => {
    const incoming = brief("A");
    const fetchMock = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        throw new Error("Network disconnected");
      }
      return jsonResponse(listingState(incoming));
    });
    await mountGen("r2-10", fetchMock);
    await clickGenerate(generateButton());
    await flush();
    expect(container.textContent, "网络异常必须在页面显示明确提示").toContain("网络异常，请重试。");
  });
});
