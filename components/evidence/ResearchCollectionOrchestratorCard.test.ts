import { createElement } from "react";
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
  normalizeState,
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

      // 保证容器具备防溢出与响应式布局类
      expect(cardSource).toContain("max-w-full");
      expect(cardSource).toContain("overflow-hidden");
      expect(cardSource).toContain("lg:grid-cols-4");
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

    it("computeSummary 准确统计复用、待确认与需人工处理数量", () => {
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
      expect(summary.text).toBe("已复用 1 项，待确认 1 项，2 项需人工处理");

      // 全部已就绪场景
      const allReadyItems = mockItems.map((i) => ({ ...i, state: "ready" as const }));
      const allSummary = computeSummary(allReadyItems);
      expect(allSummary.allReady).toBe(true);
      expect(allSummary.text).toBe("本轮资料整理完成");
    });
  });

  describe("3. 静态渲染与无障碍属性（SSR）", () => {
    it("正确渲染四项资料卡片、标题与操作按钮", () => {
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
      expect(html).toContain("研究资料编排");
      expect(html).toContain('data-testid="orchestrator-status-badge"');
      expect(html).toContain("已复用 2 项，待确认 1 项，1 项需人工处理");

      // 主操作按钮
      expect(html).toContain('data-testid="btn-orchestrate"');
      expect(html).toContain("补齐研究资料");

      // 四项来源
      expect(html).toContain('data-testid="orchestrator-item-amazon"');
      expect(html).toContain('data-testid="orchestrator-item-keywords_competitors"');
      expect(html).toContain('data-testid="orchestrator-item-voc"');
      expect(html).toContain('data-testid="orchestrator-item-sourcing_1688"');

      // 关键词待确认锚点按钮
      expect(html).toContain('data-testid="action-anchor-keywords_competitors"');
      expect(html).toContain("直达待确认");

      // 1688 登录按钮
      expect(html).toContain('data-testid="action-login-sourcing"');
      expect(html).toContain("前往登录");
    });
  });

  describe("4. 运行时 DOM 交互与真实请求行为", () => {
    it("默认加载时先触发 POST /api/tasks/:id/research-orchestrator (action: inspect)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            summary: "已复用 1 项，待确认 1 项，2 项需人工处理",
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
                summary: "本轮资料整理完成",
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
      expect(statusBadge?.textContent).toContain("本轮资料整理完成");

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

    it("生成新 Preview 时：触发 onDataChanged，展示直达待确认引导栏，绝不替用户自动确认", async () => {
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
                summary: "已复用 3 项，待确认 1 项，0 项需人工处理",
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

      // 点击前往待确认区域按钮，准确导航至市场/关键词区域
      const gotoBtn = container.querySelector('[data-testid="orchestrator-goto-pending-btn"]');
      expect(gotoBtn).toBeTruthy();

      await act(async () => {
        gotoBtn?.click();
      });

      expect(onNavigate).toHaveBeenCalledWith("market", "workbench-keyword-strategy");
    });

    it("各项操作按钮点击行为（直达锚点、重试、登录）正确派发导航或重试回调", async () => {
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

      // 1. Amazon 前往补充
      const btnAmazon = container.querySelector('[data-testid="action-anchor-amazon"]');
      await act(async () => {
        btnAmazon?.click();
      });
      expect(onNavigate).toHaveBeenCalledWith("market", "workbench-browser-evidence");

      // 2. VOC 前往处理
      const btnVoc = container.querySelector('[data-testid="action-anchor-voc"]');
      await act(async () => {
        btnVoc?.click();
      });
      expect(onNavigate).toHaveBeenCalledWith("buyers", "formal-v2-buyer-evidence");

      // 3. 1688 前往登录
      const btnSourcing = container.querySelector('[data-testid="action-login-sourcing"]');
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
});
