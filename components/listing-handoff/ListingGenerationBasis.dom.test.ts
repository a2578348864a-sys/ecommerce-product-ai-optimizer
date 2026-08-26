import { createElement } from "react";
import { draftSafeSummary } from "@/lib/listingHandoff/listingGenerationService";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/* ── 真实 DOM 行为测试：Listing 生成依据四组展示 + 历史空态。 ── */

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

const FULL_DRAFT = {
  generatedAt: "2026-08-24T02:00:00.000Z",
  source: "real_ai_draft",
  version: 1,
  titles: ["THERMOS FUNTAINER Kids 10oz Stainless Steel THERMOS, Pink"],
  bullets: ["Vacuum Insulated.", "Latch.", "Office, home."],
  description: "THERMOS FUNTAINER Kids THERMOS.",
  keywords: ["THERMOS", "FUNTAINER Kids"],
  sellingPoints: [],
  riskNotes: [],
  reviewChecklist: [],
  blockedClaims: [],
  complianceWarnings: [],
  draftKind: "ai_optimized_listing",
  providerAttempted: true,
  providerSucceeded: true,
  usedFactTrace: [
    { label: "材质", value: "Stainless Steel" },
    { label: "容量", value: "10oz" },
  ],
  usedKeywordTrace: ["THERMOS", "kids water bottle"],
  searchOnlyKeywordTrace: ["bento box for kids", "lunch box kids"],
  researchReferenceTrace: ["主题：真空保温结构 — 用户常问保温时长（12 条评论）"],
  humanReviewClaims: ["The dishwasher-safe bottle and lid make everyday cleaning simple and convenient."],
  keywordPlanSource: "manual",
};

describe("R2 Listing 生成依据（真实行为 fixture）", () => {
  it("完整草稿展示四组：具体事实/具体关键词/具体研究参考/逐条待确认表达", async () => {
    const { ListingGenerationBasis } = await import("@/components/listing-handoff/ListingHandoffSection");
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(ListingGenerationBasis, { draft: FULL_DRAFT as never }));
    });
    await flush();
    const text = documentInstance.body.textContent;
    // 四组标题
    expect(text).toContain("最终文案实际命中的已确认商品事实");
    expect(text).toContain("标题和正文实际采用的关键词");
      expect(text).toContain("仅用于搜索词，未进入正文");
      expect(text).toContain("bento box for kids");
    expect(text).toContain("生成时提供给 AI 的研究参考");
    expect(text).toContain("待人工确认的表达");
    // 具体内容（不是数量、不是固定说明）
    expect(text).toContain("材质");
    expect(text).toContain("Stainless Steel");
    expect(text).toContain("kids water bottle");
    expect(text).toContain("真空保温结构");
    expect(text).toContain("The dishwasher-safe bottle and lid");
    // 安全说明（R2 指定文案）
    expect(text).toContain("研究资料只用于定位和表达参考；Listing 硬属性只允许来自已确认商品事实。");
    // 禁止「AI 实际使用」措辞（研究参考只是提供给 AI，Provider 无使用记录）
    expect(text).not.toContain("AI 实际使用");
    // 安全契约：摘要序列化不含内部 field / 内部 ID / hash / runId
    const raw = JSON.stringify(FULL_DRAFT);
    expect(raw).not.toContain("\"field\"");
    expect(raw).not.toContain("usedFactIds");
    expect(raw).not.toContain("runId");
    expect(raw).not.toContain("inputEvidenceHash");
    expect(raw).not.toContain("11111111-");
    // DOM 不渲染这些内部字段
    expect(text).not.toContain("field");
    expect(text).not.toContain("usedFactIds");
    expect(text).not.toContain("runId");
    expect(text).not.toContain("inputEvidenceHash");
  });

  it("历史草稿无依据字段 → 诚实空态「这份历史草稿没有保存生成依据，重新生成后可查看。」", async () => {
    const { ListingGenerationBasis } = await import("@/components/listing-handoff/ListingHandoffSection");
    const legacyDraft = { ...FULL_DRAFT, providerAttempted: undefined, usedFactTrace: [], usedKeywordTrace: [], searchOnlyKeywordTrace: [], researchReferenceTrace: [], humanReviewClaims: [] };
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(ListingGenerationBasis, { draft: legacyDraft as never }));
    });
    await flush();
    const text = documentInstance.body.textContent;
    expect(text).toContain("这份历史草稿没有保存生成依据，重新生成后可查看。");
    expect(text).not.toContain("生成时提供给 AI 的研究参考");
  });
});

describe("R3 Listing AI 来源口径（providerAttempted 三态）", () => {
  it("B. 非 AI 安全草稿（providerAttempted=false 但有 aiReferences）→ 不显示「提供给 AI」，显示非 AI 诚实说明", async () => {
    const { ListingGenerationBasis } = await import("@/components/listing-handoff/ListingHandoffSection");
    const nonAiDraft = {
      ...FULL_DRAFT,
      providerAttempted: false,
      providerSucceeded: false,
      fallbackApplied: true,
      fallbackReason: "AI 服务暂不可用，已保留安全草稿。",
      researchReferenceTrace: ["主题：真空保温结构 — 用户常问保温时长（12 条评论）"],
    };
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(ListingGenerationBasis, { draft: nonAiDraft as never }));
    });
    await flush();
    const text = documentInstance.body.textContent;
    // 不得出现「提供给 AI」表述
    expect(text).not.toContain("生成时提供给 AI 的研究参考");
    expect(text).not.toContain("提供给 AI");
    // 显示非 AI 诚实说明
    expect(text).toContain("本次未调用 AI，当前内容为基于已确认事实生成的安全草稿。");
    // 保留守卫句
    expect(text).toContain("研究资料只用于定位和表达参考；Listing 硬属性只允许来自已确认商品事实。");
    // 不得显示研究参考条目（即使 aiReferences 存在）
    expect(text).not.toContain("真空保温结构");
  });
  it("C. AI 草稿（providerAttempted=true）→ 显示「生成时提供给 AI 的研究参考」+ 具体内容，不写「AI 实际使用」", async () => {
    const { ListingGenerationBasis } = await import("@/components/listing-handoff/ListingHandoffSection");
    const aiDraft = { ...FULL_DRAFT, providerAttempted: true, providerSucceeded: true };
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(ListingGenerationBasis, { draft: aiDraft as never }));
    });
    await flush();
    const text = documentInstance.body.textContent;
    expect(text).toContain("生成时提供给 AI 的研究参考");
    expect(text).toContain("真空保温结构");
    expect(text).not.toContain("AI 实际使用");
  });
  it("A. 历史草稿缺字段 → 历史空态（保持 R2 行为）", async () => {
    const { ListingGenerationBasis } = await import("@/components/listing-handoff/ListingHandoffSection");
    const legacyDraft = { ...FULL_DRAFT, providerAttempted: undefined, usedFactTrace: [], usedKeywordTrace: [], searchOnlyKeywordTrace: [], researchReferenceTrace: [], humanReviewClaims: [] };
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(ListingGenerationBasis, { draft: legacyDraft as never }));
    });
    await flush();
    const text = documentInstance.body.textContent;
    expect(text).toContain("这份历史草稿没有保存生成依据，重新生成后可查看。");
    expect(text).not.toContain("生成时提供给 AI 的研究参考");
  });
});

describe("R4 P1-4：三态判断先检查 providerAttempted 显式值（真实非 AI 安全草稿不得误判历史）", () => {
  it("providerAttempted=false + 所有 trace 空 → 显示非 AI 说明，不显示历史草稿说明", async () => {
    const { ListingGenerationBasis } = await import("@/components/listing-handoff/ListingHandoffSection");
    const nonAiDraft = {
      ...FULL_DRAFT,
      providerAttempted: false,
      providerSucceeded: false,
      fallbackApplied: true,
      fallbackReason: "AI 服务暂不可用，已保留安全草稿。",
      usedFactTrace: [],
      usedKeywordTrace: [],
      searchOnlyKeywordTrace: [],
      researchReferenceTrace: [],
      humanReviewClaims: [],
    };
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(ListingGenerationBasis, { draft: nonAiDraft as never }));
    });
    await flush();
    const text = documentInstance.body.textContent;
    // 显式 providerAttempted=false → 非 AI 说明（优先于空数组判断）
    expect(text).toContain("本次未调用 AI，当前内容为基于已确认事实生成的安全草稿。");
    expect(text).not.toContain("这份历史草稿没有保存生成依据");
    expect(text).not.toContain("生成时提供给 AI 的研究参考");
    expect(text).toContain("研究资料只用于定位和表达参考；Listing 硬属性只允许来自已确认商品事实。");
  });
  it("providerAttempted 未定义 + 无新字段 → 历史草稿", async () => {
    const { ListingGenerationBasis } = await import("@/components/listing-handoff/ListingHandoffSection");
    const legacyDraft = { ...FULL_DRAFT, providerAttempted: undefined, usedFactTrace: [], usedKeywordTrace: [], searchOnlyKeywordTrace: [], researchReferenceTrace: [], humanReviewClaims: [] };
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(ListingGenerationBasis, { draft: legacyDraft as never }));
    });
    await flush();
    const text = documentInstance.body.textContent;
    expect(text).toContain("这份历史草稿没有保存生成依据，重新生成后可查看。");
    expect(text).not.toContain("本次未调用 AI");
  });
});

/* ── ListingPlan.v2 卖点策略三态（真实 DOM） ── */

const PLAN_CARDS = [
  {
    role: "core_outcome",
    shopperNeed: "买家担心保温效果与午餐适口性",
    shopperAngle: "强调真空保温的事实价值",
    factLabels: ["功能特性"],
    keywordIds: ["kw:primary", "kw:supporting:bento box for kids"],
    claimMode: "verified",
    cannotSay: ["leakproof", "12 hours"],
  },
  {
    role: "ease_of_use",
    shopperNeed: "买家希望饭后打理简单",
    shopperAngle: "强调洗碗机清洗便利",
    factLabels: ["清洁保养"],
    keywordIds: ["kw:supporting:kids lunch jar"],
    claimMode: "review",
    cannotSay: ["BPA-free"],
  },
];

describe("ListingPlan.v2 卖点策略（真实 DOM 三态）", () => {
  it("A. 历史草稿无 sellingPointPlan → 诚实空态文案", async () => {
    const { ListingSellingPointStrategy } = await import("@/components/listing-handoff/ListingHandoffSection");
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(ListingSellingPointStrategy, { plan: undefined }));
    });
    await flush();
    const text = documentInstance.body.textContent;
    expect(text).toContain("卖点策略");
    expect(text).toContain("这份历史草稿没有保存卖点策略，重新生成后可查看。");
    expect(text).not.toContain("采购者关心");
  });

  it("B. structured/safe：计划卡 + 实事标签 + 不能写 + 无内部字段", async () => {
    const { ListingSellingPointStrategy } = await import("@/components/listing-handoff/ListingHandoffSection");
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(ListingSellingPointStrategy, { plan: PLAN_CARDS as never }));
    });
    await flush();
    const text = documentInstance.body.textContent;
    expect(text).toContain("卖点策略");
    expect(text).toContain("买家关心");
    expect(text).toContain("准备表达");
    expect(text).toContain("使用事实");
    expect(text).toContain("关键词");
    expect(text).toContain("不能写");
    expect(text).toContain("leakproof");
    expect(text).toContain("12 hours");
    const raw = JSON.stringify({ plan: PLAN_CARDS });
    expect(raw).not.toContain("runId");
    expect(raw).not.toContain("Hash");
    expect(text).not.toContain("usedFactIds");
  });
});

describe("ListingPlan.v2 草稿类型标签（draftKindLabel 三态）", () => {
  it("ai_optimized → 已按卖点策略生成运营优化稿", async () => {
    const { draftKindLabel } = await import("@/components/listing-handoff/ListingHandoffSection");
    expect(draftKindLabel("ai_optimized_listing")).toContain("已按卖点策略生成运营优化稿");
    expect(draftKindLabel("ai_optimized_listing")).not.toContain("安全事实草稿");
  });

  it("structured → 安全事实草稿，不是运营优化版", async () => {
    const { draftKindLabel } = await import("@/components/listing-handoff/ListingHandoffSection");
    expect(draftKindLabel("structured_listing_draft")).toContain("安全事实草稿，不是运营优化版");
    expect(draftKindLabel("structured_listing_draft")).not.toContain("已按卖点策略生成运营优化稿");
  });

  it("safe_fact → 安全事实草稿，不是运营优化版", async () => {
    const { draftKindLabel } = await import("@/components/listing-handoff/ListingHandoffSection");
    expect(draftKindLabel("safe_fact_draft")).toContain("安全事实草稿，不是运营优化版");
  });
});


  describe("ListingPlan.v2 关键词采用三态（正文采用 / 仅搜索词 诚实分离）", () => {
    it("红：两组中文标题同时渲染；正文采用组不含搜索词；无内部 id", async () => {
      const { ListingGenerationBasis } = await import("@/components/listing-handoff/ListingHandoffSection");
      await act(async () => {
        root = createRoot(container as unknown as Element);
        root.render(createElement(ListingGenerationBasis, { draft: FULL_DRAFT as never }));
      });
      await flush();
      const text = documentInstance.body.textContent;
      expect(text).toContain("标题和正文实际采用的关键词");
      expect(text).toContain("仅用于搜索词，未进入正文");
      expect(text).toContain("THERMOS");
      expect(text).toContain("bento box for kids");
      // 搜索词不得被当作正文采用展示（bento box 不得出现在正文采用组左侧标题段内）——由分组标题隔离保证
      const usedSection = text.slice(text.indexOf("标题和正文实际采用的关键词"), text.indexOf("仅用于搜索词，未进入正文"));
      expect(usedSection).toContain("THERMOS");
      expect(usedSection).not.toContain("bento box for kids");
      // 无内部 id
      expect(text).not.toContain("kw:");
      expect(text).not.toContain("runId");
      expect(text).not.toContain("usedKeywordIds");
    });

    it("红：仅搜索词（正文采用空）→ 显示诚实空态，不把 search-only 称为正文采用", async () => {
      const { ListingGenerationBasis } = await import("@/components/listing-handoff/ListingHandoffSection");
      const onlySearchDraft = {
        ...FULL_DRAFT,
        usedKeywordTrace: [],
        searchOnlyKeywordTrace: ["bento box for kids", "lunch box kids", "kids lunch box"],
      };
      await act(async () => {
        root = createRoot(container as unknown as Element);
        root.render(createElement(ListingGenerationBasis, { draft: onlySearchDraft as never }));
      });
      await flush();
      const text = documentInstance.body.textContent;
      expect(text).toContain("仅用于搜索词，未进入正文");
      expect(text).toContain("bento box for kids");
      // 不得出现「正文实际采用」字样或把搜索词放进正文采用组
      expect(text).not.toContain("标题和正文实际采用的关键词");
    });

    it("红：两组均空 → 关键词区整体诚实空态（不渲染采用词组 nor 仅搜索词组）", async () => {
      const { ListingGenerationBasis } = await import("@/components/listing-handoff/ListingHandoffSection");
      const emptyKwDraft = { ...FULL_DRAFT, usedKeywordTrace: [], searchOnlyKeywordTrace: [] };
      await act(async () => {
        root = createRoot(container as unknown as Element);
        root.render(createElement(ListingGenerationBasis, { draft: emptyKwDraft as never }));
      });
      await flush();
      const text = documentInstance.body.textContent;
      expect(text).not.toContain("标题和正文实际采用的关键词");
      expect(text).not.toContain("仅用于搜索词，未进入正文");
      // 基本面依然存在（事实组照常）
      expect(text).toContain("最终文案实际命中的已确认商品事实");
    });
  });

describe("LISTING_HISTORICAL_DRAFT_READ_GUARD DOM：历史坏快照经读取边界安全降级", () => {
  it("unqualified 历史快照 → draftSafeSummary 清空正式字段且 listingUnqualified=true、rejected 有界、Basis 诚实空态", async () => {
    const badSnapshot = {
      draftKind: "structured_listing_draft",
      humanReviewRequired: true,
      generatedAt: "2026-08-26T00:00:00.000Z",
      source: "deterministic_composition_v1",
      version: 1,
      composerVersion: "listing-composer-v1",
      generationPolicyVersion: "listing-generation-policy-v1",
      polishApplied: false,
      polishModel: null,
      titles: ["HydroJug CUPPNK Tumbler water bottle 40oz Stainless Steel Pink"],
      bullets: [
        "The Leak Proof, Water Bottle option fits the everyday use of this Tumbler.",
        "Easy cleaning matches the Dishwasher Safe option for this Tumbler.",
        "Available construction with the 40oz of this Tumbler.",
        "The Tumbler pairs with the Tumbler for everyday use.",
      ],
      description: "A Tumbler for daily use.",
      keywords: ["HydroJug", "Tumbler"],
      backendSearchTerms: ["water bottle"],
      sellingPoints: ["A Tumbler"],
      providerAttempted: true,
      providerSucceeded: true,
      fallbackApplied: true,
      fallbackReason: "AI 文案未匹配卖点策略。",
      usedFactIds: ["functional_feature", "care", "material"],
      // 无 factSafe/copyQuality —— 历史
    };
    const summary = draftSafeSummary(badSnapshot);
    expect(summary?.listingUnqualified).toBe(true);
    expect(summary?.factSafe).toBe(false);
    expect(summary?.copyQuality).toBe(false);
    expect(summary?.bullets).toEqual([]);
    expect(summary?.titles).toEqual([]);
    expect(summary?.description).toBe("");
    expect(summary?.keywords).toEqual([]);
    expect((summary?.rejectedListingSentences ?? []).length).toBeGreaterThan(0);
    expect((summary?.rejectedListingSentences ?? []).length).toBeLessThanOrEqual(5);
    for (const r of summary?.rejectedListingSentences ?? []) {
      expect(r.text.length).toBeLessThanOrEqual(500);
      expect(/[\u4e00-\u9fff]/.test(r.reason)).toBe(true);
    }
    // Basis 渲染：数据通过安全摘要后不显示"当前有效"式内容,显示诚实空态或拒绝诊断
    const { ListingGenerationBasis: Basis } = await import("@/components/listing-handoff/ListingHandoffSection");
    root = createRoot(container as unknown as Element);
    root.render(createElement(Basis, { draft: summary as never }));
    await flush();
    const text = documentInstance.body.textContent;
    // Basis 显示诚实空态（无依据字段时）或研究资料说明——不展示正式坏句字段
    expect(text).not.toContain("option fits");
    expect(text).not.toContain("pairs with");
    // 诚实空态/研究说明必然存在其一
    expect(text.includes("这份历史草稿") || text.includes("研究资料只用于定位和表达参考")).toBe(true);
  });
});
