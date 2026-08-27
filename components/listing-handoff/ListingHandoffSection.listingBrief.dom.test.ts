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
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function listingState(
  listingBrief: Record<string, string>,
  overrides: Partial<{ listingStatus: "ready" | "active" | "stale" | "revoked" | "legacy_unbound" | "invalid"; currentHandoffRevision: number; confirmedFacts: number }> = {},
) {
  return {
    ok: true,
    data: {
      canGenerate: true,
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
      claimPreflight: { pass: true, reason: null },
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

  it("Ready 未保存：编辑后生成按钮禁用、未保存警告可见、无生成 POST（generate 内部防线拦截点击）", async () => {
    const fetchCalls: { method: string; body: Record<string, unknown> | null }[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        fetchCalls.push({ method: "POST", body });
        return jsonResponse(generateListItemResponse());
      }
      fetchCalls.push({ method: "GET", body: null });
      return jsonResponse(listingState(brief("A")));
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
    expect(generateButton()?.disabled).toBe(true);

    await clickGenerate(generateButton());
    await flush();
    expect(fetchCalls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("请先保存商品创作补充，再生成 Listing 草稿。");
  });

  it("已有草稿（active）未保存：重新生成按钮禁用、警告可见、无重新生成 POST", async () => {
    const fetchCalls: { method: string; body: Record<string, unknown> | null }[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        fetchCalls.push({ method: "POST", body });
        return jsonResponse(generateListItemResponse());
      }
      fetchCalls.push({ method: "GET", body: null });
      return jsonResponse(listingState(brief("A"), { listingStatus: "active" }));
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
    expect(regenerateButton()?.disabled).toBe(true);
    expect(unsavedWarning()?.textContent).toContain("请先保存商品创作补充，再生成 Listing 草稿。");

    await clickGenerate(regenerateButton());
    await flush();
    expect(fetchCalls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("保存成功后再编辑未保存：生成重新禁用，新值不进入任何生成请求", async () => {
    const incoming = brief("A");
    const firstSaved = { ...brief("A"), coreSellingPoint: "第一次保存值" };
    const posts: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        if (body.action === "save_listing_brief") {
          return jsonResponse(saveListingBriefData({ schema: "listing-creation-brief.v1", ...firstSaved }));
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
    expect(generateButton()?.disabled).toBe(true);
    expect(unsavedWarning()).not.toBeNull();

    await clickGenerate(generateButton());
    await flush();
    expect(posts.filter((body) => body.action === undefined)).toHaveLength(0);
    expect(JSON.stringify(posts)).not.toContain("未保存新值");
    expect(fetchMock).toHaveBeenCalledTimes(2); // GET + save POST，无生成 POST
  });
});
