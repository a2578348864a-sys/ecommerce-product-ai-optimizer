import { createElement, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ResearchCollectionOrchestratorCard,
  computeSummary,
  formatBadgeLabel,
  getAmazonFailureReason,
  normalizeState,
  sanitizeDetail,
  extractDetailFromPayload,
  type OrchestratorSourceItem,
} from "./ResearchCollectionOrchestratorCard";

/* ── Proven Lightweight FakeDOM (Aligned with CompetitorStrategyCard.dom.test.ts) ── */

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
  preventDefault() {
    this.defaultPrevented = true;
  }
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
    this.listeners.set(
      name,
      list.filter((item) => item !== fn),
    );
  }
  dispatchEvent(event: FakeEvent): boolean {
    const chain: FakeNode[] = [];
    let cursor: FakeNode | null = this;
    while (cursor) {
      chain.push(cursor);
      cursor = cursor.parentNode;
    }
    for (const node of chain) {
      for (const fn of node.listeners.get(event.type) ?? []) {
        event.currentTarget = node;
        fn(event);
      }
    }
    return !event.defaultPrevented;
  }
  getRootNode(): FakeNode {
    return this.ownerDocument;
  }
  contains(node: FakeNode | null): boolean {
    let cursor: FakeNode | null = node;
    while (cursor) {
      if (cursor === this) return true;
      cursor = cursor.parentNode;
    }
    return false;
  }
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): FakeNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get parentElement(): FakeNode | null {
    return this.parentNode;
  }
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
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
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
  get nodeValue(): string {
    return this.text;
  }
  set nodeValue(value: string) {
    this.text = String(value);
  }
  get data(): string {
    return this.text;
  }
  set data(value: string) {
    this.text = String(value);
  }
}

const SIMPLE_TAG = /^[a-z][a-z0-9]*$/i;
class FakeElement extends FakeNode {
  tagName: string;
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = "";
  value = "";
  get disabled(): boolean {
    return this.attributes.has("disabled");
  }
  set disabled(val: boolean) {
    if (val) this.attributes.set("disabled", "");
    else this.attributes.delete("disabled");
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
    if (name === "value") this.value = String(value);
    if (name === "id") this.ownerDocument.registerElement(this);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  click() {
    if (this.disabled) return;
    const evt = new FakeEvent("click", this);
    this.dispatchEvent(evt);
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
    const res: FakeElement[] = [];
    const walk = (node: FakeNode) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType !== 1) continue;
        const el = child as FakeElement;
        if (this.matchesSimple(el, selector)) {
          res.push(el);
        }
        walk(el);
      }
    };
    walk(this);
    return res;
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
    this.appendChild(this.body);
  }
  get defaultView() {
    return (globalThis as unknown as { window: unknown }).window;
  }
  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }
  createElementNS(_ns: string, tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }
  createTextNode(text: string): FakeText {
    return new FakeText(this, text);
  }
  registerElement(el: FakeElement) {
    const id = el.getAttribute("id");
    if (id) this.elementById.set(id, el);
  }
  getElementById(id: string): FakeElement | null {
    return this.elementById.get(id) ?? null;
  }
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

async function flush(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/* ── 测试套件 ─────────────────────────────────────────── */

describe("ResearchCollectionOrchestratorCard (Phase 3 UI / Interaction)", () => {
  const cardSource = readFileSync(
    resolve(process.cwd(), "components/evidence/ResearchCollectionOrchestratorCard.tsx"),
    "utf8",
  );
  const workbenchSource = readFileSync(
    resolve(process.cwd(), "components/evidence/EvidenceWorkbench.tsx"),
    "utf8",
  );

  let originalDocument: unknown;
  let originalWindow: unknown;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalDocument = (globalThis as unknown as { document?: unknown }).document;
    originalWindow = (globalThis as unknown as { window?: unknown }).window;
    originalFetch = globalThis.fetch;
    installGlobals();
    root = null;
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    (globalThis as unknown as { document?: unknown }).document = originalDocument;
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("1. 第一性原理与克制视觉规范（对抗式审查）", () => {
    it("严格遵守沉稳 B2B 风格：基调使用 Slate / Neutral，禁止 AI 炫光、机器人图标、弹窗轰炸", () => {
      // 禁止 AI 浮夸词汇与图标
      expect(cardSource).not.toContain("sparkles");
      expect(cardSource).not.toContain("Sparkles");
      expect(cardSource).not.toContain("Bot");
      expect(cardSource).not.toContain("Robot");
      expect(cardSource).not.toContain("from-purple");
      expect(cardSource).not.toContain("from-violet");
      expect(cardSource).not.toContain("bg-gradient");

      // 必须包含沉稳 Slate / Emerald / Amber / Rose 状态配色
      expect(cardSource).toContain("bg-slate-50");
      expect(cardSource).toContain("text-emerald-700");
      expect(cardSource).toContain("text-amber-800");
      expect(cardSource).toContain("text-rose-700");

      // 保证容器具备防溢出与紧凑列表布局类
      expect(cardSource).toContain("max-w-full");
      expect(cardSource).toContain("overflow-hidden");
      expect(cardSource).toContain("divide-y divide-slate-100");
    });

    it("正确挂载在 EvidenceWorkbench 顶部（位于简明结论/分类导航之上，紧贴研究资料主区域）", () => {
      expect(workbenchSource).toContain("import { ResearchCollectionOrchestratorCard }");
      expect(workbenchSource).toContain("<ResearchCollectionOrchestratorCard");

      // 必须位于 workbench-summary 和 tabs 之前
      const orchestratorIndex = workbenchSource.indexOf("<ResearchCollectionOrchestratorCard");
      const summaryIndex = workbenchSource.indexOf('data-testid="workbench-summary"');
      const tabsIndex = workbenchSource.indexOf('data-testid="workbench-tabs"');

      expect(orchestratorIndex).toBeGreaterThan(-1);
      expect(summaryIndex).toBeGreaterThan(-1);
      expect(tabsIndex).toBeGreaterThan(-1);

      // 卡片必须在 summary 和 tabs 之上
      expect(orchestratorIndex).toBeLessThan(summaryIndex);
      expect(orchestratorIndex).toBeLessThan(tabsIndex);

      // 工作台中包含对应的锚点容器
      expect(workbenchSource).toContain('id="workbench-keyword-strategy"');
      expect(workbenchSource).toContain('id="workbench-competitor-strategy"');
    });
  });

  describe("2. 纯函数逻辑与状态归一化", () => {
    it("normalizeState 正确映射各数据源状态，防御无效或未知入参", () => {
      // Amazon: ready / needs_supplement
      expect(normalizeState("amazon", "ready")).toBe("ready");
      expect(normalizeState("amazon", "已有")).toBe("ready");
      expect(normalizeState("amazon", "needs_supplement")).toBe("needs_supplement");
      expect(normalizeState("amazon", "unknown_xxx")).toBe("needs_supplement");

      // Keywords & Competitors: ready / pending_review / pending / failed
      expect(normalizeState("keywords_competitors", "ready")).toBe("ready");
      expect(normalizeState("keywords_competitors", "pending_review")).toBe("pending_review");
      expect(normalizeState("keywords_competitors", "待确认")).toBe("pending_review");
      expect(normalizeState("keywords_competitors", "failed")).toBe("failed");
      expect(normalizeState("keywords_competitors", "失败")).toBe("failed");
      expect(normalizeState("keywords_competitors", "pending")).toBe("pending");

      // VOC: ready / needs_action
      expect(normalizeState("voc", "ready")).toBe("ready");
      expect(normalizeState("voc", "needs_action")).toBe("needs_action");
      expect(normalizeState("voc", "需要处理")).toBe("needs_action");

      // 1688: ready / pending_review / needs_login
      expect(normalizeState("sourcing_1688", "ready")).toBe("ready");
      expect(normalizeState("sourcing_1688", "needs_login")).toBe("needs_login");
      expect(normalizeState("sourcing_1688", "需要登录")).toBe("needs_login");
      expect(normalizeState("sourcing_1688", "pending_review")).toBe("pending_review");
    });

    it("formatBadgeLabel 返回规范的徽章文案与样式变体", () => {
      expect(formatBadgeLabel("ready")).toEqual({
        icon: "check",
        text: "✓ 已有",
        variant: "emerald",
      });
      expect(formatBadgeLabel("pending_review")).toEqual({
        icon: "alert",
        text: "⚠ 待确认",
        variant: "amber",
      });
      expect(formatBadgeLabel("needs_supplement")).toEqual({
        icon: "alert",
        text: "⚠ 需要补充",
        variant: "amber",
      });
      expect(formatBadgeLabel("needs_action")).toEqual({
        icon: "alert",
        text: "⚠ 需要处理",
        variant: "amber",
      });
      expect(formatBadgeLabel("needs_login")).toEqual({
        icon: "alert",
        text: "⚠ 需要登录",
        variant: "amber",
      });
      expect(formatBadgeLabel("pending")).toEqual({
        icon: "circle",
        text: "○ 待补齐",
        variant: "slate",
      });
      expect(formatBadgeLabel("failed")).toEqual({
        icon: "x",
        text: "❌ 失败",
        variant: "rose",
      });
    });

    it("computeSummary 准确统计复用、待确认与需人工处理数量并输出简短摘要", () => {
      const mockItems: OrchestratorSourceItem[] = [
        {
          key: "amazon",
          title: "Amazon 商品资料",
          state: "ready",
          anchorId: "a1",
          tabKey: "market",
        },
        {
          key: "keywords_competitors",
          title: "关键词与竞品",
          state: "pending_review",
          anchorId: "a2",
          tabKey: "market",
        },
        {
          key: "voc",
          title: "买家评论 / VOC",
          state: "needs_action",
          anchorId: "a3",
          tabKey: "buyers",
        },
        {
          key: "sourcing_1688",
          title: "1688 供应链",
          state: "needs_login",
          anchorId: "a4",
          tabKey: "sourcing",
        },
      ];

      const summary = computeSummary(mockItems);
      expect(summary.reusedCount).toBe(1);
      expect(summary.pendingReviewCount).toBe(1);
      expect(summary.manualActionCount).toBe(2);
      expect(summary.allReady).toBe(false);
      expect(summary.text).toBe("1 项待确认 · 2 项需要处理");

      // 全部已就绪场景
      const allReadyItems = mockItems.map((i) => ({ ...i, state: "ready" as const }));
      const allSummary = computeSummary(allReadyItems);
      expect(allSummary.allReady).toBe(true);
      expect(allSummary.text).toBe("全部资料已就绪");
    });
  });

  describe("3. 静态渲染与无障碍属性（SSR）", () => {
    it("正确渲染四项紧凑资料列表、标题与规范操作按钮", () => {
      const html = renderToStaticMarkup(
        createElement(ResearchCollectionOrchestratorCard, {
          taskId: "task-001",
          skipAutoInspect: true,
          initialData: {
            summary: "已复用 2 项，待确认 1 项，1 项需人工处理",
            items: {
              amazon: { state: "ready", detail: "已有 10 项商品事实" },
              keywords_competitors: { state: "pending_review", detail: "产生 30 条关键词预览" },
              voc: { state: "ready", detail: "已有 25 条评论" },
              sourcing_1688: { state: "needs_login", detail: "需要 1688 授权" },
            },
          },
        }),
      );

      // 卡片结构与标题
      expect(html).toContain('data-testid="research-orchestrator-card"');
      expect(html).toContain("研究资料");
      expect(html).toContain('data-testid="orchestrator-status-badge"');
      expect(html).toContain("已复用 2 项，待确认 1 项，1 项需人工处理");

      // 主操作按钮
      expect(html).toContain('data-testid="btn-orchestrate"');
      expect(html).toContain("补齐研究资料");

      // 四项来源行
      expect(html).toContain('data-testid="source-row-amazon"');
      expect(html).toContain('data-testid="source-row-keywords_competitors"');
      expect(html).toContain('data-testid="source-row-voc"');
      expect(html).toContain('data-testid="source-row-sourcing_1688"');

      // 关键词待确认行按钮：action-review-keywords_competitors + 查看并确认
      expect(html).toContain('data-testid="action-review-keywords_competitors"');
      expect(html).toContain("查看并确认");

      // 1688 登录待处理行按钮：action-handle-sourcing_1688 + 前往处理
      expect(html).toContain('data-testid="action-handle-sourcing_1688"');
      expect(html).toContain("前往处理");
    });
  });

  describe("4. 运行时 DOM 交互与真实请求行为", () => {
    it("默认加载时先触发 POST /api/tasks/:id/research-orchestrator (action: inspect)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            summary: "1 项待确认 · 2 项需要处理",
            sources: {
              amazon: { state: "ready", detail: "已有商品事实" },
              keywords_competitors: { state: "pending_review", detail: "待确认关键词" },
              voc: { state: "needs_action", detail: "未分析评论" },
              sourcing_1688: { state: "needs_login", detail: "未登录" },
            },
          },
        }),
      });
      globalThis.fetch = fetchSpy;

      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-002",
          }),
        );
      });
      for (let i = 0; i < 6; i++) {
        await flush(10);
      }

      // 校验请求发送
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/tasks/task-002/research-orchestrator",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "content-type": "application/json",
          }),
          body: JSON.stringify({ action: "inspect" }),
        }),
      );

      // 校验数据已同步至 DOM
      const kwBadge = container.querySelector('[data-testid="badge-keywords_competitors"]');
      expect(kwBadge?.textContent).toContain("待确认");
    });

    it("点击「补齐研究资料」：按钮进入 loading、发送 orchestrate 请求并更新状态", async () => {
      const fetchSpy = vi.fn().mockImplementation((_url, opts) => {
        const body = JSON.parse(opts?.body as string);
        if (body.action === "inspect") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                summary: "待补充",
                sources: {
                  amazon: { state: "needs_supplement" },
                  keywords_competitors: { state: "pending" },
                  voc: { state: "needs_action" },
                  sourcing_1688: { state: "needs_login" },
                },
              },
            }),
          });
        }
        if (body.action === "orchestrate") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                summary: "全部资料已就绪",
                sources: {
                  amazon: { state: "ready", detail: "商品资料已补充" },
                  keywords_competitors: { state: "ready", detail: "关键词与竞品已就绪" },
                  voc: { state: "ready", detail: "买家评论分析完毕" },
                  sourcing_1688: { state: "ready", detail: "货源线索已确认" },
                },
              },
            }),
          });
        }
        return Promise.reject(new Error("unexpected"));
      });
      globalThis.fetch = fetchSpy;

      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-003",
          }),
        );
      });
      await flush();
      await flush();

      const btn = container.querySelector('[data-testid="btn-orchestrate"]');
      expect(btn).toBeTruthy();

      // 点击补齐按钮
      await act(async () => {
        btn?.click();
      });
      await flush();
      await flush();

      const orchestrateCalls = fetchSpy.mock.calls.filter((call) => {
        return JSON.parse(call[1]?.body).action === "orchestrate";
      });
      expect(orchestrateCalls.length).toBe(1);

      // 校验徽章更新为全部就绪
      const statusBadge = container.querySelector('[data-testid="orchestrator-status-badge"]');
      expect(statusBadge?.textContent).toContain("全部资料已就绪");

      // 4 项全部为已就绪
      const amazonBadge = container.querySelector('[data-testid="badge-amazon"]');
      const kwBadge = container.querySelector('[data-testid="badge-keywords_competitors"]');
      const vocBadge = container.querySelector('[data-testid="badge-voc"]');
      const sourcingBadge = container.querySelector('[data-testid="badge-sourcing_1688"]');

      expect(amazonBadge?.textContent).toContain("已有");
      expect(kwBadge?.textContent).toContain("已有");
      expect(vocBadge?.textContent).toContain("已有");
      expect(sourcingBadge?.textContent).toContain("已有");
    });

    it("生成新 Preview 时：触发 onDataChanged，渲染警示栏，绝不替用户自动确认", async () => {
      const onDataChanged = vi.fn();
      const onNavigate = vi.fn();

      const fetchSpy = vi.fn().mockImplementation((_url, opts) => {
        const body = JSON.parse(opts?.body as string);
        if (body.action === "inspect") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                sources: {
                  amazon: { state: "ready" },
                  keywords_competitors: { state: "pending" },
                  voc: { state: "ready" },
                  sourcing_1688: { state: "ready" },
                },
              },
            }),
          });
        }
        if (body.action === "orchestrate") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                hasNewPreview: true,
                summary: "1 项待确认",
                sources: {
                  amazon: { state: "ready" },
                  keywords_competitors: {
                    state: "pending_review",
                    detail: "产生 15 条待复核关键词",
                    previewId: "prev-123",
                  },
                  voc: { state: "ready" },
                  sourcing_1688: { state: "ready" },
                },
              },
            }),
          });
        }
        return Promise.reject(new Error("unexpected"));
      });
      globalThis.fetch = fetchSpy;

      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-004",
            onDataChanged,
            onNavigate,
          }),
        );
      });
      await flush();
      await flush();

      const btn = container.querySelector('[data-testid="btn-orchestrate"]');
      await act(async () => {
        btn?.click();
      });
      await flush();
      await flush();

      // 必须调用 onDataChanged 刷新外层待确认卡片
      expect(onDataChanged).toHaveBeenCalledTimes(1);

      // 必须渲染新预览待确认警示栏
      const alert = container.querySelector('[data-testid="orchestrator-new-preview-alert"]');
      expect(alert).toBeTruthy();
      expect(alert?.textContent).toContain("绝不替用户代做确认");

      // 关键词来源行内出现「查看并确认」按钮，点击导航至市场/关键词区域
      const reviewBtn = container.querySelector(
        '[data-testid="action-review-keywords_competitors"]',
      );
      expect(reviewBtn).toBeTruthy();
      expect(reviewBtn?.textContent).toContain("查看并确认");

      await act(async () => {
        reviewBtn?.click();
      });

      expect(onNavigate).toHaveBeenCalledWith("market", "formal-v2-market-evidence");
    });

    it("dataRevision 回流后 inspect 不再次向父级反馈同一 Preview，避免反馈循环", async () => {
      let inspectCount = 0;
      let onDataChangedCount = 0;
      const fetchSpy = vi.fn().mockImplementation((_url, opts) => {
        const body = JSON.parse(opts?.body as string);
        if (body.action === "inspect") {
          inspectCount += 1;
          const hasPendingPreview = inspectCount > 1;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                ...(hasPendingPreview ? { hasNewPreview: true } : {}),
                sources: {
                  amazon: { state: "ready" },
                  keywords_competitors: hasPendingPreview
                    ? { state: "pending_review", previewId: "stable-preview-1" }
                    : { state: "pending" },
                  voc: { state: "ready" },
                  sourcing_1688: { state: "ready" },
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              hasNewPreview: true,
              sources: {
                amazon: { state: "ready" },
                keywords_competitors: {
                  state: "pending_review",
                  previewId: "stable-preview-1",
                },
                voc: { state: "ready" },
                sourcing_1688: { state: "ready" },
              },
            },
          }),
        });
      });
      globalThis.fetch = fetchSpy;

      function RevisionHarness() {
        const [revision, setRevision] = useState(0);
        return createElement(ResearchCollectionOrchestratorCard, {
          taskId: "task-stable-preview",
          dataRevision: revision,
          onDataChanged: () => {
            onDataChangedCount += 1;
            if (onDataChangedCount === 1) setRevision((current) => current + 1);
          },
        });
      }

      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(createElement(RevisionHarness));
      });
      await flush();
      await flush();

      const btn = container.querySelector('[data-testid="btn-orchestrate"]');
      await act(async () => {
        btn?.click();
      });
      await flush();
      await flush();
      await flush();
      await flush();
      await flush();

      expect(inspectCount).toBe(2);
      expect(onDataChangedCount).toBe(1);
    });

    it("各项操作按钮点击行为（处理/补充/登录全部收敛为「前往处理」）正确派发导航回调", async () => {
      const onNavigate = vi.fn();

      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-005",
            skipAutoInspect: true,
            onNavigate,
            initialData: {
              items: {
                amazon: { state: "needs_supplement" },
                keywords_competitors: { state: "failed" },
                voc: { state: "needs_action" },
                sourcing_1688: { state: "needs_login" },
              },
            },
          }),
        );
      });
      await flush();

      // 1. Amazon 前往处理
      const btnAmazon = container.querySelector('[data-testid="action-handle-amazon"]');
      expect(btnAmazon?.textContent).toContain("前往处理");
      await act(async () => {
        btnAmazon?.click();
      });
      expect(onNavigate).toHaveBeenCalledWith("market", "fact-candidate-review");

      // 2. VOC 前往处理
      const btnVoc = container.querySelector('[data-testid="action-handle-voc"]');
      expect(btnVoc?.textContent).toContain("前往处理");
      await act(async () => {
        btnVoc?.click();
      });
      expect(onNavigate).toHaveBeenCalledWith("buyers", "formal-v2-buyer-evidence");

      // 3. 1688 前往处理
      const btnSourcing = container.querySelector('[data-testid="action-handle-sourcing_1688"]');
      expect(btnSourcing?.textContent).toContain("前往处理");
      await act(async () => {
        btnSourcing?.click();
      });
      expect(onNavigate).toHaveBeenCalledWith("sourcing", "formal-v2-sourcing-evidence");
    });

    it("inspect 失败时展示克制错误栏，并提供重试检查入口", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          ok: false,
          error: { message: "当前网络不可达，请检查后重试" },
        }),
      });
      globalThis.fetch = fetchSpy;

      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-006",
          }),
        );
      });
      await flush();
      await flush();

      const errBanner = container.querySelector('[data-testid="orchestrator-error-banner"]');
      expect(errBanner).toBeTruthy();
      expect(errBanner?.textContent).toContain("当前网络不可达，请检查后重试");

      const retryBtn = container.querySelector('[data-testid="orchestrator-retry-btn"]');
      expect(retryBtn).toBeTruthy();

      // 点击重试检查，再次发起 inspect
      await act(async () => {
        retryBtn?.click();
      });
      await flush();
      await flush();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("5. 重试 UX、防重复并发与错误安全脱敏（子 Agent C 核心验收）", () => {
    describe("纯函数脱敏与载荷提取（sanitizeDetail & extractDetailFromPayload）", () => {
      it("extractDetailFromPayload: 严格按照优先级提取 detail > message > error.message", () => {
        // 1. detail 优先
        expect(
          extractDetailFromPayload({
            detail: "优先 detail",
            message: "次选 message",
            error: { message: "最低 error" },
          }),
        ).toBe("优先 detail");

        // 2. detail 缺失或为空白，回退到 message
        expect(
          extractDetailFromPayload({
            detail: "  ",
            message: "有效 message",
            error: { message: "最低 error" },
          }),
        ).toBe("有效 message");

        // 3. detail & message 缺失，回退到 error.message
        expect(
          extractDetailFromPayload({
            error: { message: "错误详情说明" },
          }),
        ).toBe("错误详情说明");

        // 4. 全部为空
        expect(extractDetailFromPayload({})).toBeUndefined();
        expect(extractDetailFromPayload(null)).toBeUndefined();
        expect(extractDetailFromPayload("string")).toBeUndefined();
      });

      it("sanitizeDetail: 过滤消除堆栈、本地绝对路径及 token/cookie 等敏感信息并安全降级", () => {
        // 正常业务文案原样保留
        expect(sanitizeDetail("SellerSprite 采集引擎不可用（未启动或超时）")).toBe(
          "SellerSprite 采集引擎不可用（未启动或超时）",
        );
        expect(
          sanitizeDetail("任务未绑定权威商品身份（批次/卖家精灵事实缺失），无法启动自动采集"),
        ).toBe("任务未绑定权威商品身份（批次/卖家精灵事实缺失），无法启动自动采集");

        // 堆栈信息：降级
        expect(
          sanitizeDetail("Error: connection refused at Object.<anonymous> (file.ts:12:34)"),
        ).toBe("采集未成功，请稍后重试");
        expect(
          sanitizeDetail("Traceback (most recent call last):\n  File 'main.py', line 5"),
        ).toBe("采集未成功，请稍后重试");

        // 本地绝对路径：降级
        expect(sanitizeDetail("Failed to open C:\\Users\\Administrator\\app\\cache.json")).toBe(
          "采集未成功，请稍后重试",
        );
        expect(sanitizeDetail("Permission denied at /home/user/project/file")).toBe(
          "采集未成功，请稍后重试",
        );

        // 敏感凭证：降级
        expect(sanitizeDetail("invalid access token in authorization header")).toBe(
          "采集未成功，请稍后重试",
        );
        expect(sanitizeDetail("session cookie missing or expired")).toBe(
          "采集未成功，请稍后重试",
        );
        expect(sanitizeDetail("api-key is invalid")).toBe(
          "采集未成功，请稍后重试",
        );

        // 空白防呆
        expect(sanitizeDetail("   ")).toBeUndefined();
        expect(sanitizeDetail(undefined)).toBeUndefined();
      });
    });

    describe("运行时重试交互与状态流转", () => {
      it("点击重试立即（<100ms 内）展示局部重试状态，按钮统一文案为「处理中…」并禁用", async () => {
        let resolveOrchestrate: (val: any) => void;
        const fetchPromise = new Promise((res) => {
          resolveOrchestrate = res;
        });

        const fetchSpy = vi.fn().mockImplementation((_url, opts) => {
          const body = JSON.parse(opts?.body as string);
          if (body.action === "inspect") {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                ok: true,
                data: {
                  sources: {
                    amazon: { state: "ready" },
                    keywords_competitors: { state: "failed", detail: "上次采集未完成" },
                    voc: { state: "ready" },
                    sourcing_1688: { state: "ready" },
                  },
                },
              }),
            });
          }
          if (body.action === "orchestrate") {
            return fetchPromise;
          }
          return Promise.reject(new Error("unexpected"));
        });
        globalThis.fetch = fetchSpy;

        root = createRoot(container as unknown as Element);
        await act(async () => {
          root?.render(
            createElement(ResearchCollectionOrchestratorCard, {
              taskId: "task-retry-001",
            }),
          );
        });
        await flush();
        await flush();

        // 初始状态：关键词卡片失败，展示「重试」按钮
        const retryBtn = container.querySelector('[data-testid="action-retry-keywords"]');
        expect(retryBtn).toBeTruthy();
        expect(retryBtn?.disabled).toBe(false);
        expect(retryBtn?.textContent).toContain("重试");

        const initialBadge = container.querySelector('[data-testid="badge-keywords_competitors"]');
        expect(initialBadge?.textContent).toContain("失败");

        // 点击重试按钮
        await act(async () => {
          retryBtn?.click();
        });

        // 验证即时视觉反馈（进行中）：
        // 1. 徽章立即变为“正在重试”
        const retryingBadge = container.querySelector('[data-testid="badge-keywords_competitors"]');
        expect(retryingBadge?.textContent).toContain("正在重试");

        // 2. 说明文字立即展示“正在重新采集关键词与竞品…”
        const itemContainer = container.querySelector('[data-testid="source-row-keywords_competitors"]');
        expect(itemContainer?.textContent).toContain("正在重新采集关键词与竞品…");

        // 3. 关键词重试按钮 disabled={true}，文案统一为“处理中…”
        expect(retryBtn?.disabled).toBe(true);
        expect(retryBtn?.textContent).toContain("处理中…");

        // 结束请求
        await act(async () => {
          resolveOrchestrate!({
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                sources: {
                  keywords_competitors: { state: "ready", detail: "关键词与竞品已就绪" },
                },
              },
            }),
          });
        });
        await flush();
        await flush();

        // 4. 请求结束后状态复位，呈现成功状态，按钮不显示
        const finishedBadge = container.querySelector('[data-testid="badge-keywords_competitors"]');
        expect(finishedBadge?.textContent).toContain("已有");
        expect(container.querySelector('[data-testid="action-retry-keywords"]')).toBeNull();
      });

      it("重试期间按钮 disabled，多次快速点击不重复发送请求（request delta = 1）", async () => {
        let resolveOrchestrate: (val: any) => void;
        const fetchPromise = new Promise((res) => {
          resolveOrchestrate = res;
        });

        const fetchSpy = vi.fn().mockImplementation((_url, opts) => {
          const body = JSON.parse(opts?.body as string);
          if (body.action === "inspect") {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                ok: true,
                data: {
                  sources: {
                    keywords_competitors: { state: "failed", detail: "失败重试中测试" },
                  },
                },
              }),
            });
          }
          if (body.action === "orchestrate") {
            return fetchPromise;
          }
          return Promise.reject(new Error("unexpected"));
        });
        globalThis.fetch = fetchSpy;

        root = createRoot(container as unknown as Element);
        await act(async () => {
          root?.render(
            createElement(ResearchCollectionOrchestratorCard, {
              taskId: "task-retry-002",
            }),
          );
        });
        await flush();
        await flush();

        const retryBtn = container.querySelector('[data-testid="action-retry-keywords"]');
        expect(retryBtn).toBeTruthy();

        // 第一次点击
        await act(async () => {
          retryBtn?.click();
        });

        // 模拟用户在 loading 期间多次连击
        await act(async () => {
          retryBtn?.click();
          retryBtn?.click();
          retryBtn?.click();
        });

        const orchestrateCalls = fetchSpy.mock.calls.filter((call) => {
          return JSON.parse(call[1]?.body).action === "orchestrate";
        });
        // 彻底防止重复并发请求：request delta 严格为 1
        expect(orchestrateCalls.length).toBe(1);

        // 释放请求
        await act(async () => {
          resolveOrchestrate!({
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                sources: {
                  keywords_competitors: { state: "failed", detail: "再次失败" },
                },
              },
            }),
          });
        });
        await flush();
        await flush();

        // finally 阶段重置，重试按钮再次恢复可点击
        expect(retryBtn?.disabled).toBe(false);
        expect(retryBtn?.textContent).toContain("重试");
      });

      it("1688 失败态点击重试会真实发送统一编排请求并显示完成状态", async () => {
        const fetchSpy = vi.fn().mockImplementation((_url, opts) => {
          const body = JSON.parse(opts?.body as string);
          if (body.action === "inspect") {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                ok: true,
                data: {
                  sources: {
                    amazon: { state: "ready" },
                    keywords_competitors: { state: "ready" },
                    voc: { state: "ready" },
                    sourcing_1688: { state: "failed", detail: "1688 助手连接中断，请重试" },
                  },
                },
              }),
            });
          }
          if (body.action === "orchestrate") {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                ok: true,
                data: {
                  sources: {
                    amazon: { state: "ready" },
                    keywords_competitors: { state: "ready" },
                    voc: { state: "ready" },
                    sourcing_1688: { state: "ready", detail: "1688 货源证据已就绪" },
                  },
                },
              }),
            });
          }
          return Promise.reject(new Error("unexpected"));
        });
        globalThis.fetch = fetchSpy;

        root = createRoot(container as unknown as Element);
        await act(async () => {
          root?.render(createElement(ResearchCollectionOrchestratorCard, { taskId: "task-retry-sourcing" }));
        });
        await flush();
        await flush();

        const retryBtn = container.querySelector('[data-testid="action-retry-sourcing_1688"]') as HTMLButtonElement | null;
        expect(retryBtn).toBeTruthy();
        expect(retryBtn?.textContent).toContain("重试");

        await act(async () => {
          retryBtn?.click();
        });
        await flush();
        await flush();

        expect(fetchSpy.mock.calls.filter((call) => JSON.parse(call[1]?.body).action === "orchestrate")).toHaveLength(1);
        expect(container.querySelector('[data-testid="badge-sourcing_1688"]')?.textContent).toContain("已有");
      });

      it("后端返回 error.message / message 时，detail 能正确渲染真实脱敏错误信息", async () => {
        const fetchSpy = vi.fn().mockImplementation((_url, opts) => {
          const body = JSON.parse(opts?.body as string);
          if (body.action === "inspect") {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                ok: true,
                data: {
                  sources: {
                    // 后端通过 message 字段返回错误原因
                    keywords_competitors: {
                      status: "failed",
                      error: {
                        code: "seller_sprite_keyword_failed",
                        message: "SellerSprite 采集引擎不可用（未启动或超时）",
                      },
                    },
                    amazon: {
                      status: "needs_user",
                      message: "任务未绑定权威商品身份（批次/卖家精灵事实缺失）",
                    },
                  },
                },
              }),
            });
          }
          return Promise.reject(new Error("unexpected"));
        });
        globalThis.fetch = fetchSpy;

        root = createRoot(container as unknown as Element);
        await act(async () => {
          root?.render(
            createElement(ResearchCollectionOrchestratorCard, {
              taskId: "task-error-mapping",
            }),
          );
        });
        await flush();
        await flush();

        // 关键词项应当渲染真实的 error.message，而非默认的“上次采集未完成”
        const kwItem = container.querySelector('[data-testid="source-row-keywords_competitors"]');
        expect(kwItem?.textContent).toContain("SellerSprite 采集引擎不可用（未启动或超时）");
        expect(kwItem?.textContent).not.toContain("上次采集未完成");

        // Amazon 项应当渲染真实的 message
        const amazonItem = container.querySelector('[data-testid="source-row-amazon"]');
        expect(amazonItem?.textContent).toContain("任务未绑定权威商品身份（批次/卖家精灵事实缺失）");
      });

      it("采集成功转为 pending_review 并展示「查看并确认」按钮，点击平滑滚动并切换 Tab", async () => {
        const onNavigate = vi.fn();
        const onDataChanged = vi.fn();

        const fetchSpy = vi.fn().mockImplementation((_url, opts) => {
          const body = JSON.parse(opts?.body as string);
          if (body.action === "inspect") {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                ok: true,
                data: {
                  sources: {
                    keywords_competitors: { status: "failed" },
                  },
                },
              }),
            });
          }
          if (body.action === "orchestrate") {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                ok: true,
                data: {
                  hasNewPreview: true,
                  sources: {
                    keywords_competitors: {
                      status: "pending_review",
                      detail: "已生成 20 条待复核关键词",
                      hasPreview: true,
                      previewId: "prev-kw-999",
                    },
                  },
                },
              }),
            });
          }
          return Promise.reject(new Error("unexpected"));
        });
        globalThis.fetch = fetchSpy;

        root = createRoot(container as unknown as Element);
        await act(async () => {
          root?.render(
            createElement(ResearchCollectionOrchestratorCard, {
              taskId: "task-preview-success",
              onNavigate,
              onDataChanged,
            }),
          );
        });
        await flush();
        await flush();

        // 点击重试
        const retryBtn = container.querySelector('[data-testid="action-retry-keywords"]');
        await act(async () => {
          retryBtn?.click();
        });
        await flush();
        await flush();

        // 1. onDataChanged 触发
        expect(onDataChanged).toHaveBeenCalled();

        // 2. 关键词项状态自动变为 pending_review（⚠ 待确认）
        const kwBadge = container.querySelector('[data-testid="badge-keywords_competitors"]');
        expect(kwBadge?.textContent).toContain("待确认");

        // 3. 规范展示「查看并确认」按钮
        const reviewBtn = container.querySelector(
          '[data-testid="action-review-keywords_competitors"]',
        );
        expect(reviewBtn).toBeTruthy();
        expect(reviewBtn?.textContent).toContain("查看并确认");

        // 4. 点击「查看并确认」触发 handleNavigate("market", "formal-v2-market-evidence")
        await act(async () => {
          reviewBtn?.click();
        });

        expect(onNavigate).toHaveBeenCalledWith("market", "formal-v2-market-evidence");
      });
    });
  });

  describe("6. 四行紧凑列表与撤销重复 Queue 视图块（任务书 XIV ~ XVIII 节核心验收）", () => {
    it("撤销重复 Queue 视图块：pending-review-queue 与 needs-user-queue 不再渲染", async () => {
      const mockRawSources: any = {
        amazon: { source: "amazon", status: "ready", ready: true },
        keywordCompetitor: {
          source: "keyword_competitor",
          status: "awaiting_confirmation",
          ready: false,
          itemCount: 5,
        },
        voc: {
          source: "voc",
          status: "awaiting_confirmation",
          ready: false,
          itemCount: 2,
        },
        sourcing1688: {
          source: "sourcing_1688",
          status: "needs_user",
          ready: false,
          message: "需要登录",
        },
      };

      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-queue-removed-1",
            skipAutoInspect: true,
            initialData: {
              rawSources: mockRawSources,
            },
          }),
        );
      });
      await flush();

      // 1. 独立的待确认资料队列容器绝对不渲染
      const pendingQueue = container.querySelector('[data-testid="pending-review-queue"]');
      expect(pendingQueue).toBeNull();

      // 2. 独立的人工处理队列容器绝对不渲染
      const needsUserQueue = container.querySelector('[data-testid="needs-user-queue"]');
      expect(needsUserQueue).toBeNull();

      // 3. 状态摘要依然正确计算
      const statusBadge = container.querySelector('[data-testid="orchestrator-status-badge"]');
      expect(statusBadge?.textContent).toContain("2 项待确认");
      expect(statusBadge?.textContent).toContain("1 项需要处理");
    });

    it("四行紧凑来源列表正确展示各来源行与丰富说明文字", async () => {
      const mockRawSources: any = {
        amazon: { source: "amazon", status: "ready", ready: true, message: "Amazon 详情资料已就绪" },
        keywordCompetitor: {
          source: "keyword_competitor",
          status: "awaiting_confirmation",
          ready: false,
          itemCount: 5,
        },
        voc: {
          source: "voc",
          status: "awaiting_confirmation",
          ready: false,
          itemCount: 13,
        },
        sourcing1688: {
          source: "sourcing_1688",
          status: "needs_user",
          ready: false,
          message: "需要登录",
        },
      };

      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-compact-list-display",
            skipAutoInspect: true,
            initialData: {
              rawSources: mockRawSources,
            },
          }),
        );
      });
      await flush();

      // 1. 列表容器存在
      const listContainer = container.querySelector('[data-testid="orchestrator-sources-list"]');
      expect(listContainer).toBeTruthy();

      // 2. 四行来源全部渲染
      const amazonRow = container.querySelector('[data-testid="source-row-amazon"]');
      const kwRow = container.querySelector('[data-testid="source-row-keywords_competitors"]');
      const vocRow = container.querySelector('[data-testid="source-row-voc"]');
      const sourcingRow = container.querySelector('[data-testid="source-row-sourcing_1688"]');

      expect(amazonRow).toBeTruthy();
      expect(kwRow).toBeTruthy();
      expect(vocRow).toBeTruthy();
      expect(sourcingRow).toBeTruthy();

      // 3. 说明文字验证
      expect(amazonRow?.textContent).toContain("Amazon 详情资料已就绪");
      expect(kwRow?.textContent).toContain("5 项采集结果等待确认");
      expect(vocRow?.textContent).toContain("13 条评论等待确认");
      expect(sourcingRow?.textContent).toContain("需要登录");
    });

    it("统一按钮文案规范：待确认展示「查看并确认」，needs_user展示「前往处理」，绝无歧义文案", async () => {
      const mockRawSources: any = {
        amazon: {
          source: "amazon",
          status: "needs_user",
          ready: false,
          message: "待采集 Amazon 详情资料",
        },
        keywordCompetitor: {
          source: "keyword_competitor",
          status: "awaiting_confirmation",
          ready: false,
          itemCount: 5,
        },
        voc: {
          source: "voc",
          status: "ready",
          ready: true,
        },
        sourcing1688: {
          source: "sourcing_1688",
          status: "needs_user",
          ready: false,
          message: "需要登录或选择采集方式",
        },
      };

      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-button-labels-uniform",
            skipAutoInspect: true,
            initialData: {
              rawSources: mockRawSources,
            },
          }),
        );
      });
      await flush();

      // 待确认按钮：必须为「查看并确认」
      const reviewBtn = container.querySelector(
        '[data-testid="action-review-keywords_competitors"]',
      );
      expect(reviewBtn).toBeTruthy();
      expect(reviewBtn?.textContent).toBe("查看并确认");

      // needs_user 按钮：无论 Amazon 还是 1688，统一为「前往处理」
      const amazonHandleBtn = container.querySelector('[data-testid="action-handle-amazon"]');
      expect(amazonHandleBtn).toBeTruthy();
      expect(amazonHandleBtn?.textContent).toBe("前往处理");

      const sourcingHandleBtn = container.querySelector(
        '[data-testid="action-handle-sourcing_1688"]',
      );
      expect(sourcingHandleBtn).toBeTruthy();
      expect(sourcingHandleBtn?.textContent).toBe("前往处理");

      // 已就绪项（VOC）：不显示操作按钮
      expect(container.querySelector('[data-testid="action-review-voc"]')).toBeNull();
      expect(container.querySelector('[data-testid="action-handle-voc"]')).toBeNull();

      // 源码审查与 DOM 审查：绝不出现“直达待确认”或“查看待确认列表”
      expect(cardSource).not.toContain("直达待确认");
      expect(cardSource).not.toContain("查看待确认列表");
      expect(container.textContent).not.toContain("直达待确认");
      expect(container.textContent).not.toContain("查看待确认列表");
    });

    it("点击「查看并确认」与「前往处理」触发正确的导航回调（包含正确 tab 与无前导 # 的 anchorId）", async () => {
      const onNavigate = vi.fn();
      const mockRawSources: any = {
        amazon: { source: "amazon", status: "ready", ready: true },
        keywordCompetitor: {
          source: "keyword_competitor",
          status: "awaiting_confirmation",
          ready: false,
          itemCount: 5,
        },
        voc: {
          source: "voc",
          status: "awaiting_confirmation",
          ready: false,
          itemCount: 2,
        },
        sourcing1688: {
          source: "sourcing_1688",
          status: "needs_user",
          ready: false,
          message: "需要登录",
        },
      };

      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-nav-callbacks",
            skipAutoInspect: true,
            onNavigate,
            initialData: {
              rawSources: mockRawSources,
            },
          }),
        );
      });
      await flush();

      // 1. 点击关键词「查看并确认」
      const kwBtn = container.querySelector(
        '[data-testid="action-review-keywords_competitors"]',
      );
      expect(kwBtn).toBeTruthy();
      await act(async () => {
        kwBtn?.click();
      });
      expect(onNavigate).toHaveBeenCalledWith("market", "formal-v2-market-evidence");

      // 2. 点击 VOC「查看并确认」
      const vocBtn = container.querySelector('[data-testid="action-review-voc"]');
      expect(vocBtn).toBeTruthy();
      await act(async () => {
        vocBtn?.click();
      });
      expect(onNavigate).toHaveBeenCalledWith("buyers", "formal-v2-buyer-evidence");

      // 3. 点击 1688「前往处理」
      const sourcingBtn = container.querySelector(
        '[data-testid="action-handle-sourcing_1688"]',
      );
      expect(sourcingBtn).toBeTruthy();
      await act(async () => {
        sourcingBtn?.click();
      });
      expect(onNavigate).toHaveBeenCalledWith("sourcing", "formal-v2-sourcing-evidence");
    });

    it("dataRevision 变化且大于 0 时触发重新 inspect 刷新状态", async () => {
      const fetchSpy = vi.fn().mockImplementation((_url, opts) => {
        const body = JSON.parse(opts?.body as string);
        if (body.action === "inspect") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                summary: "已刷新状态",
                sources: {
                  amazon: { source: "amazon", status: "ready", ready: true },
                  keywordCompetitor: { source: "keyword_competitor", status: "ready", ready: true },
                  voc: { source: "voc", status: "ready", ready: true },
                  sourcing1688: { source: "sourcing_1688", status: "ready", ready: true },
                },
              },
            }),
          });
        }
        return Promise.reject(new Error("unexpected"));
      });
      globalThis.fetch = fetchSpy;

      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-revision-test",
            skipAutoInspect: true,
            dataRevision: 0,
          }),
        );
      });
      await flush();

      // 此时尚未触发 inspect
      expect(fetchSpy).not.toHaveBeenCalled();

      // 模拟下游完成确认，dataRevision 从 0 变为 1
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-revision-test",
            skipAutoInspect: true,
            dataRevision: 1,
          }),
        );
      });
      await flush();
      await flush();

      // 触发了 inspect 请求
      const inspectCalls = fetchSpy.mock.calls.filter((call) => {
        return JSON.parse(call[1]?.body).action === "inspect";
      });
      expect(inspectCalls.length).toBe(1);
    });

    it("严禁任何 autoConfirm / autoSave 调用！保证用户是唯一裁决者", () => {
      // 源码审查
      expect(cardSource).not.toContain("autoConfirm");
      expect(cardSource).not.toContain("autoSave");
      expect(workbenchSource).not.toContain("autoConfirm");
      expect(workbenchSource).not.toContain("autoSave");
    });

    it("顺畅导航联动：EvidenceWorkbench 规范剔除前导 # 并展开所有祖先 <details>", () => {
      // 1. 验证清理 anchorId 前导 # 逻辑
      expect(workbenchSource).toContain('anchorId.replace(/^#+/, "")');

      // 2. 验证递归展开祖先 <details>
      expect(workbenchSource).toContain('parent.tagName === "DETAILS"');
      expect(workbenchSource).toContain("(parent as HTMLDetailsElement).open = true");

      // 3. 验证平滑居中滚动
      expect(workbenchSource).toContain('scrollIntoView({ behavior: "smooth", block: "center" })');

      // 4. 验证 dataRevision 状态在 EvidenceWorkbench 中维护并传递
      expect(workbenchSource).toContain("const [dataRevision, setDataRevision] = useState(0)");
      expect(workbenchSource).toContain("dataRevision={dataRevision}");
      expect(workbenchSource).toContain("handleDataChanged");
    });

    it("1688 具备主图时仅展示图搜状态，不再提供独立搜索入口", async () => {
      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-sourcing-ready",
            skipAutoInspect: true,
            initialData: {
              items: {
                sourcing_1688: {
                  state: "ready_to_search",
                  detail: "已准备商品素材，可进入 1688 图片找货",
                },
              },
            },
          }),
        );
      });
      await flush();

      const badge = container.querySelector('[data-testid="badge-sourcing_1688"]');
      expect(badge?.textContent).toContain("⚡ 图搜已就绪");

      const searchBtn = container.querySelector('[data-testid="action-search-sourcing_1688"]');
      expect(searchBtn).toBeNull();
      expect(container.textContent).not.toContain("去1688图片搜索");
    });

    it("VOC 历史 no_public_reviews 结果不再伪装成暂无公开评论", async () => {
      const onNavigate = vi.fn();
      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-voc-no-reviews",
            skipAutoInspect: true,
            onNavigate,
            initialData: {
              items: {
                voc: {
                  state: "no_public_reviews",
                  detail: "未找到公开评论",
                },
              },
            },
          }),
        );
      });
      await flush();

      const badge = container.querySelector('[data-testid="badge-voc"]');
      expect(badge?.textContent).toContain("⚠ 评论状态未确认");

      // 关键断言：no_public_reviews 状态不渲染任何操作按钮
      expect(container.querySelector('[data-testid="action-handle-voc"]')).toBeNull();
      expect(container.querySelector('[data-testid="action-retry-voc"]')).toBeNull();
      expect(container.querySelector('[data-testid="action-review-voc"]')).toBeNull();
      expect(container.querySelector('[data-testid="action-search-voc"]')).toBeNull();

      // 行为校验：直接传入 error.code 也应被归一化为 no_public_reviews
      const sourcesPayload: any = {
        voc: {
          state: "failed",
          error: { code: "no_public_reviews", message: "未找到公开评论" },
        },
      };
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-voc-no-reviews-2",
            skipAutoInspect: true,
            onNavigate,
            initialData: {
              rawSources: sourcesPayload,
            },
          }),
        );
      });
      await flush();
      const badge2 = container.querySelector('[data-testid="badge-voc"]');
      expect(badge2?.textContent).toContain("⚠ 评论状态未确认");
      expect(container.querySelector('[data-testid="action-handle-voc"]')).toBeNull();
    });

    it("VOC 新状态分别显示提取未完成与确认无公开评论", async () => {
      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-voc-extraction-empty",
            skipAutoInspect: true,
            initialData: {
              items: {
                voc: { state: "extraction_empty" },
              },
            },
          }),
        );
      });
      await flush();
      const extractionRow = container.querySelector('[data-testid="source-row-voc"]');
      expect(extractionRow?.textContent).toContain("评论提取未完成");
      expect(extractionRow?.textContent).not.toContain("暂无公开评论");

      root?.unmount();
      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-voc-confirmed-empty",
            skipAutoInspect: true,
            initialData: {
              items: {
                voc: { state: "confirmed_no_reviews" },
              },
            },
          }),
        );
      });
      await flush();
      const confirmedRow = container.querySelector('[data-testid="source-row-voc"]');
      expect(confirmedRow?.textContent).toContain("确认无公开评论");
    });

    it("Amazon verification blocker is not presented as an ASIN error", () => {
      expect(getAmazonFailureReason("Amazon验证阻断")).toBe("Amazon验证阻断");
    });

    it("Amazon 失败时展示 ○ 获取失败徽章、收敛原因与双按钮（重新尝试+人工补充），消除恐慌红字", async () => {
      root = createRoot(container as unknown as Element);
      await act(async () => {
        root?.render(
          createElement(ResearchCollectionOrchestratorCard, {
            taskId: "task-amazon-failed",
            skipAutoInspect: true,
            initialData: {
              items: {
                amazon: {
                  state: "failed",
                  detail: "Amazon 商品详情页未识别到有效商品容器或标题",
                },
              },
            },
          }),
        );
      });
      await flush();

      const badge = container.querySelector('[data-testid="badge-amazon"]');
      expect(badge?.textContent).toContain("○ 获取失败");

      const row = container.querySelector('[data-testid="source-row-amazon"]');
      expect(row?.textContent).toContain("页面无法识别");

      const retryBtn = container.querySelector('[data-testid="action-retry-amazon"]');
      expect(retryBtn).not.toBeNull();
      expect(retryBtn?.textContent).toContain("重新尝试");

      const manualBtn = container.querySelector('[data-testid="action-manual-amazon"]');
      expect(manualBtn).not.toBeNull();
      expect(manualBtn?.textContent).toContain("人工补充");
    });
  });
});
