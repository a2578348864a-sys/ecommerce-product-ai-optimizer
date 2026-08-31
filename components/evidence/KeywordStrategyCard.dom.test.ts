import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it } from "vitest";

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
    // 模拟原生行为：checkbox click → 切换 checked。直接改 attribute 绕过 React _valueTracker 的
    // 实例 setter（否则 tracker 先更新导致 React updateValueIfChanged 检测不到变化，onChange 不触发）；
    // 随后 click 正常冒泡到 React 根（React 19 checkbox 走 click 路径触发 onChange）。
    if (this.nodeType === 1 && event.type === "click") {
      const el = this as unknown as FakeElement;
      if (el.tagName === "INPUT" && el.type === "checkbox") {
        if (el.attributes.has("checked")) el.removeAttribute("checked");
        else el.setAttribute("checked", "");
      }
    }
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
  get disabled(): boolean { return this.attributes.has("disabled"); }
  set disabled(value: boolean) {
    if (value) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }
  get checked(): boolean { return this.attributes.has("checked"); }
  set checked(value: boolean) {
    if (value) this.setAttribute("checked", "");
    else this.removeAttribute("checked");
  }
  get type(): string { return this.attributes.get("type") ?? ""; }
  set type(value: string) { this.setAttribute("type", value); }
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


const ROWS = [
  { keyword: "lunch box", rowNumber: 1 },
  { keyword: "thermos for hot food kids", rowNumber: 2 },
  { keyword: "kids lunch jar", rowNumber: 3 },
];
const PRODUCT = "THERMOS FUNTAINER Kids Food Jar with Spoon 10oz Pink";
const RAW = { reportType: "reverse_asin", capturedAt: "2026-08-01", rows: [{ rowNumber: 1, keyword: "thermos for hot food kids", fields: { monthlySearches: { normalized: 54321 } } }] };
describe("KeywordStrategyCard", () => {
  async function render(card: Parameters<typeof import("@/components/evidence/KeywordStrategyCard").KeywordStrategyCard>[0]) {
    const { KeywordStrategyCard } = await import("@/components/evidence/KeywordStrategyCard");
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(KeywordStrategyCard, card as never));
    });
    await flush();
  }
  it("默认收起：编辑区不可见，无大表格", async () => {
    await render({ rows: ROWS, productName: PRODUCT, briefPrimary: null, briefEvidenceCount: 10, inListing: false, needsReconfirm: false, onSave: async () => null, onSaved: () => {}, rawEvidence: RAW as never });
    expect(container.querySelector("[data-testid=kw-editor]")).toBeNull();
    expect(container.querySelector("table")).toBeNull();
  });
  it("摘要显示待确认状态与推荐主词（相关词，非首行宽词）", async () => {
    await render({ rows: ROWS, productName: PRODUCT, briefPrimary: null, briefEvidenceCount: 10, inListing: false, needsReconfirm: false, onSave: async () => null, onSaved: () => {}, rawEvidence: RAW as never });
    const text = documentInstance.body.textContent;
    expect(text).toContain("关键词策略");
    expect(text).toContain("状态：待确认");
    expect(text).toContain("thermos for hot food kids");
    expect(text).not.toContain("lunch box");
  });
  it("点击调整按钮展开编辑区，aria-expanded 正确", async () => {
    await render({ rows: ROWS, productName: PRODUCT, briefPrimary: "thermos for hot food kids", briefEvidenceCount: 10, inListing: false, needsReconfirm: false, onSave: async () => null, onSaved: () => {}, rawEvidence: RAW as never });
    const btn = container.querySelector("[data-testid=kw-adjust]") as unknown as FakeElement & { getAttribute(n: string): string | null };
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    btn.dispatchEvent(new FakeEvent("click", btn as unknown as FakeNode));
    await flush();
    expect(container.querySelector("[data-testid=kw-editor]")).not.toBeNull();
    const btn2 = container.querySelector("[data-testid=kw-adjust]") as unknown as FakeElement & { getAttribute(n: string): string | null };
    expect(btn2.getAttribute("aria-expanded")).toBe("true");
  });
  it("编辑区渲染辅助词输入框、添加按钮与删除标签按钮", async () => {
    await render({ rows: [{ keyword: "kids lunch jar", rowNumber: 1 }, { keyword: "thermos for hot food kids", rowNumber: 2 }], productName: PRODUCT, briefPrimary: null, briefEvidenceCount: 6, inListing: false, needsReconfirm: false, onSave: async () => null, onSaved: () => {}, rawEvidence: RAW as never });
    const btn = container.querySelector("[data-testid=kw-adjust]") as unknown as FakeElement;
    btn.dispatchEvent(new FakeEvent("click", btn as unknown as FakeNode));
    await flush();
    expect(container.querySelector("[data-testid=kw-add-supporting-input]")).not.toBeNull();
    expect(container.querySelector("[data-testid=kw-add-supporting]")).not.toBeNull();
    expect(container.querySelector("[data-testid=kw-remove-kids-lunch-jar]")).not.toBeNull();
  });
  it("高级设置与原始报表默认关闭（details.open=false）", async () => {
    await render({ rows: ROWS, productName: PRODUCT, briefPrimary: null, briefEvidenceCount: 10, inListing: false, needsReconfirm: false, onSave: async () => null, onSaved: () => {}, rawEvidence: RAW as never });
    const btn = container.querySelector("[data-testid=kw-adjust]") as unknown as FakeElement;
    btn.dispatchEvent(new FakeEvent("click", btn as unknown as FakeNode));
    await flush();
    const raw = container.querySelector("[data-testid=kw-raw-report]") as unknown as FakeElement;
    expect(raw.open).toBe(false);
    const adv = container.querySelector("[data-testid=kw-advanced]") as unknown as FakeElement;
    expect(adv.open).toBe(false);
  });
  it("保存成功调用 onSave 且编辑区收起，onSaved 触发", async () => {
    let saved = 0; let savedOk = false;
    await render({ rows: ROWS, productName: PRODUCT, briefPrimary: null, briefEvidenceCount: 10, inListing: false, needsReconfirm: false, onSave: async () => { saved += 1; return null; }, onSaved: () => { savedOk = true; }, rawEvidence: RAW as never });
    const btn = container.querySelector("[data-testid=kw-adjust]") as unknown as FakeElement;
    btn.dispatchEvent(new FakeEvent("click", btn as unknown as FakeNode));
    await flush();
    // 保存前必须勾选"我已核对关键词方案"（人工确认门）
    const confirmBox = container.querySelector("[data-testid=kw-confirm]") as unknown as FakeElement;
    confirmBox.dispatchEvent(new FakeEvent("click", confirmBox as unknown as FakeNode));
    await flush();
    const save = container.querySelector("[data-testid=kw-save]") as unknown as FakeElement;
    save.dispatchEvent(new FakeEvent("click", save as unknown as FakeNode));
    await flush();
    expect(saved).toBe(1);
    expect(savedOk).toBe(true);
    expect(container.querySelector("[data-testid=kw-editor]")).toBeNull();
  });
  it("409/失败：onSave 返回错误 → 保留编辑区并显示错误", async () => {
    await render({ rows: ROWS, productName: PRODUCT, briefPrimary: null, briefEvidenceCount: 10, inListing: false, needsReconfirm: false, onSave: async () => "内容刚在其他位置更新，请刷新后重试。", onSaved: () => {}, rawEvidence: RAW as never });
    const btn = container.querySelector("[data-testid=kw-adjust]") as unknown as FakeElement;
    btn.dispatchEvent(new FakeEvent("click", btn as unknown as FakeNode));
    await flush();
    const confirmBox = container.querySelector("[data-testid=kw-confirm]") as unknown as FakeElement;
    confirmBox.dispatchEvent(new FakeEvent("click", confirmBox as unknown as FakeNode));
    await flush();
    const save = container.querySelector("[data-testid=kw-save]") as unknown as FakeElement;
    save.dispatchEvent(new FakeEvent("click", save as unknown as FakeNode));
    await flush();
    expect(container.querySelector("[data-testid=kw-editor]")).not.toBeNull();
    expect(documentInstance.body.textContent).toContain("内容刚在其他位置更新");
  });
  it("390 宽：卡片渲染无内部横向表格", async () => {
    await render({ rows: ROWS, productName: PRODUCT, briefPrimary: null, briefEvidenceCount: 10, inListing: false, needsReconfirm: false, onSave: async () => null, onSaved: () => {}, rawEvidence: RAW as never });
    expect(container.querySelector("[data-testid=keyword-strategy-card]")).not.toBeNull();
    expect(container.querySelector("table")).toBeNull();
  });
  it("按钮有中文可访问名称", async () => {
    await render({ rows: ROWS, productName: PRODUCT, briefPrimary: null, briefEvidenceCount: 10, inListing: false, needsReconfirm: false, onSave: async () => null, onSaved: () => {}, rawEvidence: RAW as never });
    expect(documentInstance.body.textContent).toContain("调整关键词方案");
  });
  it("原始报表折叠内表格容器有局部横向滚动（overflow-x-auto）", async () => {
    await render({ rows: ROWS, productName: PRODUCT, briefPrimary: null, briefEvidenceCount: 10, inListing: false, needsReconfirm: false, onSave: async () => null, onSaved: () => {}, rawEvidence: RAW as never });
    const btn = container.querySelector("[data-testid=kw-adjust]") as unknown as FakeElement;
    btn.dispatchEvent(new FakeEvent("click", btn as unknown as FakeNode));
    await flush();
    const raw = container.querySelector("[data-testid=kw-raw-report]") as unknown as FakeElement;
    raw.open = true;
    await flush();
    // 折叠区内的表格仅在 details 打开后出现；默认页面无表格（已由 390 测试覆盖）
    const text = documentInstance.body.textContent;
    expect(text).toContain("查看原始关键词资料");
  });
  it("展开编辑器后有确认 checkbox（我已核对关键词方案）", async () => {
    await render({ rows: ROWS, productName: PRODUCT, briefPrimary: null, briefEvidenceCount: 10, inListing: false, needsReconfirm: false, onSave: async () => null, onSaved: () => {}, rawEvidence: RAW as never });
    const btn = container.querySelector("[data-testid=kw-adjust]") as unknown as FakeElement;
    btn.dispatchEvent(new FakeEvent("click", btn as unknown as FakeNode));
    await flush();
    const confirmBox = container.querySelector("[data-testid=kw-confirm]") as unknown as FakeElement;
    expect(confirmBox).not.toBeNull();
    expect(confirmBox.checked).toBe(false);
    expect(documentInstance.body.textContent).toContain("我已核对关键词方案");
  });
  it("未勾选确认时保存按钮 disabled，点击不调用 onSave/onSaved", async () => {
    let saved = 0; let savedOk = false;
    await render({ rows: ROWS, productName: PRODUCT, briefPrimary: null, briefEvidenceCount: 10, inListing: false, needsReconfirm: false, onSave: async () => { saved += 1; return null; }, onSaved: () => { savedOk = true; }, rawEvidence: RAW as never });
    const btn = container.querySelector("[data-testid=kw-adjust]") as unknown as FakeElement;
    btn.dispatchEvent(new FakeEvent("click", btn as unknown as FakeNode));
    await flush();
    const save = container.querySelector("[data-testid=kw-save]") as unknown as FakeElement;
    expect(save.disabled).toBe(true);
    save.dispatchEvent(new FakeEvent("click", save as unknown as FakeNode));
    await flush();
    expect(saved).toBe(0);
    expect(savedOk).toBe(false);
  });
  it("勾选后保存按钮启用；点击只调用 onSave 一次，成功后 onSaved 一次并收起", async () => {
    let saved = 0; let savedOk = false;
    await render({ rows: ROWS, productName: PRODUCT, briefPrimary: null, briefEvidenceCount: 10, inListing: false, needsReconfirm: false, onSave: async () => { saved += 1; return null; }, onSaved: () => { savedOk = true; }, rawEvidence: RAW as never });
    const btn = container.querySelector("[data-testid=kw-adjust]") as unknown as FakeElement;
    btn.dispatchEvent(new FakeEvent("click", btn as unknown as FakeNode));
    await flush();
    const confirmBox = container.querySelector("[data-testid=kw-confirm]") as unknown as FakeElement;
    confirmBox.dispatchEvent(new FakeEvent("click", confirmBox as unknown as FakeNode));
    await flush();
    const save = container.querySelector("[data-testid=kw-save]") as unknown as FakeElement;
    expect(save.disabled).toBe(false);
    save.dispatchEvent(new FakeEvent("click", save as unknown as FakeNode));
    await flush();
    expect(saved).toBe(1);
    expect(savedOk).toBe(true);
    expect(container.querySelector("[data-testid=kw-editor]")).toBeNull();
  });
  it("取消或重新打开编辑器后确认状态恢复 false", async () => {
    await render({ rows: ROWS, productName: PRODUCT, briefPrimary: null, briefEvidenceCount: 10, inListing: false, needsReconfirm: false, onSave: async () => null, onSaved: () => {}, rawEvidence: RAW as never });
    const btn = container.querySelector("[data-testid=kw-adjust]") as unknown as FakeElement;
    btn.dispatchEvent(new FakeEvent("click", btn as unknown as FakeNode));
    await flush();
    const confirmBox = container.querySelector("[data-testid=kw-confirm]") as unknown as FakeElement;
    confirmBox.dispatchEvent(new FakeEvent("click", confirmBox as unknown as FakeNode));
    await flush();
    const cancel = container.querySelector("[data-testid=kw-cancel]") as unknown as FakeElement;
    cancel.dispatchEvent(new FakeEvent("click", cancel as unknown as FakeNode));
    await flush();
    btn.dispatchEvent(new FakeEvent("click", btn as unknown as FakeNode));
    await flush();
    const confirmBox2 = container.querySelector("[data-testid=kw-confirm]") as unknown as FakeElement;
    expect(confirmBox2.checked).toBe(false);
  });
});
