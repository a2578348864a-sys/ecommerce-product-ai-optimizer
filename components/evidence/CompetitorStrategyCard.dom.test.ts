import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { visibleCompetitorEntries } from "@/components/evidence/CompetitorStrategyCard";

/* ── 竞品策略卡 真实 DOM 行为测试（第2轮） ── */

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
  scrollIntoViewCalls = 0;
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



const PRODUCT = "THERMOS FUNTAINER Kids Food Jar with Spoon 10oz Pink";
const ENTRIES = [
  { asin: "B0D1", note: "LunchBots Thermal Food Jar for Kids", sourceKind: "browser_use" as const, addedAt: "2026-08-01", detailBulletsCount: 5 },
  { asin: "B0D2", note: "Thermal Lunch Jar", sourceKind: "manual" as const, addedAt: "2026-08-02", detailBulletsCount: 0 },
  { asin: "B0D3", note: "Glass Storage Containers", sourceKind: "browser_use" as const, addedAt: "2026-08-03", detailBulletsCount: 2 },
];
describe("CompetitorStrategyCard", () => {
  it("默认只展示3个竞品，其余保持在可展开详情中", () => {
    const result = visibleCompetitorEntries(["a", "b", "c", "d", "e"]);
    expect(result.visible).toEqual(["a", "b", "c"]);
    expect(result.hidden).toEqual(["d", "e"]);
  });

  async function render(card: Parameters<typeof import("@/components/evidence/CompetitorStrategyCard").CompetitorStrategyCard>[0]) {
    const { CompetitorStrategyCard } = await import("@/components/evidence/CompetitorStrategyCard");
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(CompetitorStrategyCard, card as never));
    });
    await flush();
  }
  it("默认收起：管理竞品 details 关闭，无平铺管理操作", async () => {
    await render({ productName: PRODUCT, entries: ENTRIES, onAdd: async () => null, onDelete: async () => null });
    const mg = container.querySelector("[data-testid=cp-manage]") as unknown as { open: boolean };
    expect(mg.open).toBe(false);
  });
  it("显示 direct/adjacent/irrelevant 数量", async () => {
    await render({ productName: PRODUCT, entries: ENTRIES, onAdd: async () => null, onDelete: async () => null });
    const text = documentInstance.body.textContent;
    expect(text).toContain("直接竞品 1");
    expect(text).toContain("相邻商品 1");
    expect(text).toContain("待排除 1");
  });
  it("条目显示标题/备注、ASIN、来源（自动采集 vs 人工添加）、关系、五点数", async () => {
    await render({ productName: PRODUCT, entries: ENTRIES, onAdd: async () => null, onDelete: async () => null });
    const text = documentInstance.body.textContent;
    expect(text).toContain("LunchBots Thermal Food Jar for Kids");
    expect(text).toContain("B0D1");
    expect(text).toContain("自动采集");
    expect(text).toContain("人工添加");
    expect(text).toContain("直接竞品");
    expect(text).toContain("相邻商品");
    expect(text).toContain("已采集五点 5");
    expect(text).toContain("尚未采集五点");
  });
  it("browser_use 显示自动采集，manual 显示人工添加（绝不写人工添加假来源）", async () => {
    await render({ productName: PRODUCT, entries: ENTRIES, onAdd: async () => null, onDelete: async () => null });
    const text = documentInstance.body.textContent;
    expect(text).toContain("B0D1 · 自动采集");
    expect(text).toContain("B0D2 · 人工添加");
  });
  it("主操作「自动采集竞品」存在", async () => {
    await render({ productName: PRODUCT, entries: ENTRIES, onAdd: async () => null, onDelete: async () => null });
    expect(documentInstance.body.textContent).toContain("自动采集竞品");
  });
  it("409/失败：onAdd 返回错误 → 保留 ASIN/备注输入", async () => {
    await render({ productName: PRODUCT, entries: ENTRIES, onAdd: async () => "内容刚在其他位置更新，请刷新后重试。", onDelete: async () => null });
    const mg = container.querySelector("[data-testid=cp-manage]") as unknown as FakeElement;
    mg.open = true;
    await flush();
    const asin = container.querySelector("[data-testid=cp-asin-input]") as unknown as FakeElement;
    asin.setAttribute("value", "B0NEW");
    const note = container.querySelector("[data-testid=cp-note-input]") as unknown as FakeElement;
    note.setAttribute("value", "my note");
    const add = container.querySelector("[data-testid=cp-add]") as unknown as FakeElement;
    add.dispatchEvent(new FakeEvent("click", add as unknown as FakeNode));
    await flush();
    expect(documentInstance.body.textContent).toContain("内容刚在其他位置更新");
    expect(container.querySelector("[data-testid=cp-asin-input]")).not.toBeNull();
    // 编辑区（管理竞品）在失败后仍保持打开 = 输入不丢的语义
    const mg2 = container.querySelector("[data-testid=cp-manage]") as unknown as FakeElement;
    expect(mg2.open).toBe(true);
  });
  it("390 宽：无内部横向表格", async () => {
    await render({ productName: PRODUCT, entries: ENTRIES, onAdd: async () => null, onDelete: async () => null });
    expect(container.querySelector("[data-testid=competitor-strategy-card]")).not.toBeNull();
    expect(container.querySelector("table")).toBeNull();
  });
  it("点击 cp-collect → onCollect 恰调用 1 次", async () => {
    const onCollect = vi.fn();
    await render({ productName: PRODUCT, entries: ENTRIES, onAdd: async () => null, onDelete: async () => null, onCollect });
    const btn = container.querySelector("[data-testid=cp-collect]") as unknown as FakeElement;
    btn.dispatchEvent(new FakeEvent("click", btn as unknown as FakeNode));
    await flush();
    expect(onCollect).toHaveBeenCalledTimes(1);
  });
  it("cp-collect disabled（busy）时点击 → onCollect 调用 0 次", async () => {
    const onCollect = vi.fn();
    await render({ productName: PRODUCT, entries: ENTRIES, onAdd: async () => null, onDelete: async () => null, onCollect, busy: true });
    const btn = container.querySelector("[data-testid=cp-collect]") as unknown as FakeElement;
    btn.dispatchEvent(new FakeEvent("click", btn as unknown as FakeNode));
    await flush();
    expect(onCollect).not.toHaveBeenCalled();
  });
});
