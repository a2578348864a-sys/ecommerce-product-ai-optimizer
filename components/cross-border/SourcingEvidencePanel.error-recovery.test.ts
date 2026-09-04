/**
 * Sourcing Error Recovery Unit & Integration DOM Tests
 *
 * 验证：
 * 1. parseSourcingResponse 安全解析：非 JSON / HTML / 500 / 502 / 504 杜绝抛 SyntaxError；
 * 2. classifySourcingRequestError 精准分层：覆盖超时、网络连接、桥接服务、助手扩展、登录、风控、工具、服务端、数据结构等分类；
 * 3. 前端可行动指示：canRetry 与 canRecheck 准确映射；
 * 4. 真实 DOM 挂载：测试错误卡片展示、分层徽标、重试点击、重新检测点击、关闭卡片及用户输入保全。
 */

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  parseSourcingResponse,
  classifySourcingRequestError,
} from "@/lib/client/sourcingErrorRecovery";
import { SourcingEvidencePanel } from "@/components/cross-border/SourcingEvidencePanel";

describe("parseSourcingResponse 安全响应解析", () => {
  it("200 JSON 成功响应正常解析", async () => {
    const res = new Response(JSON.stringify({ ok: true, data: { preview: { candidates: [] } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const { status, data } = await parseSourcingResponse(res);
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect((data.data as { preview: unknown })?.preview).toBeDefined();
  });

  it("200 JSON 业务错误响应正常解析", async () => {
    const res = new Response(JSON.stringify({ ok: false, error: { code: "invalid_query", message: "缺少关键词" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    const { status, data } = await parseSourcingResponse(res);
    expect(status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error?.code).toBe("invalid_query");
  });

  it("204 No Content 返回 ok: true", async () => {
    const res = new Response(null, { status: 204 });
    const { status, data } = await parseSourcingResponse(res);
    expect(status).toBe(204);
    expect(data.ok).toBe(true);
  });

  it("500 HTML 响应安全降级为 server_error，绝不抛出 SyntaxError", async () => {
    const htmlError = "<!DOCTYPE html><html><body><h1>Internal Server Error</h1></body></html>";
    const res = new Response(htmlError, {
      status: 500,
      headers: { "content-type": "text/html" },
    });
    const { status, data } = await parseSourcingResponse(res);
    expect(status).toBe(500);
    expect(data.ok).toBe(false);
    expect(data.error?.code).toBe("server_error");
    expect(data.error?.message).toContain("本地服务执行异常");
  });

  it("502 / 504 网关 HTML 错误安全降级为 server_error", async () => {
    const htmlError = "<html><head><title>504 Gateway Time-out</title></head><body>504 Gateway Time-out</body></html>";
    const res = new Response(htmlError, {
      status: 504,
      headers: { "content-type": "text/html" },
    });
    const { status, data } = await parseSourcingResponse(res);
    expect(status).toBe(504);
    expect(data.ok).toBe(false);
    expect(data.error?.code).toBe("server_error");
  });

  it("404 响应安全返回 not_found", async () => {
    const res = new Response("Not Found", { status: 404 });
    const { status, data } = await parseSourcingResponse(res);
    expect(status).toBe(404);
    expect(data.ok).toBe(false);
    expect(data.error?.code).toBe("not_found");
  });

  it("空响应体安全处理", async () => {
    const res = new Response("", { status: 500 });
    const { status, data } = await parseSourcingResponse(res);
    expect(status).toBe(500);
    expect(data.ok).toBe(false);
    expect(data.error?.code).toBe("server_error");
  });
});

describe("classifySourcingRequestError 错误分层判定", () => {
  it("DOMException TimeoutError 准确判定为请求超时并允许重试", () => {
    const timeoutErr = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const result = classifySourcingRequestError({ error: timeoutErr, method: "keyword" });
    expect(result.category).toBe("timeout");
    expect(result.layer).toBe("请求超时");
    expect(result.canRetry).toBe(true);
    expect(result.canRecheck).toBe(true);
    expect(result.message).toContain("1688 关键词获取超时");
  });

  it("HTTP 504 timeout 准确判定为请求超时", () => {
    const result = classifySourcingRequestError({ status: 504, code: "timeout", message: "1688 获取超时", method: "url" });
    expect(result.category).toBe("timeout");
    expect(result.layer).toBe("请求超时");
    expect(result.canRetry).toBe(true);
  });

  it("TypeError 真实网络断开判定为网络连接", () => {
    const netErr = new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:3005");
    const result = classifySourcingRequestError({ error: netErr });
    expect(result.category).toBe("network_error");
    expect(result.layer).toBe("网络连接");
    expect(result.canRetry).toBe(true);
    expect(result.message).toContain("网络连接失败");
  });

  it("extension_bridge_not_available 判定为扩展桥接服务", () => {
    const result = classifySourcingRequestError({
      status: 503,
      code: "extension_bridge_not_available",
      message: "1688 扩展桥接服务启动失败",
    });
    expect(result.category).toBe("bridge_unavailable");
    expect(result.layer).toBe("扩展桥接服务");
    expect(result.canRecheck).toBe(true);
    expect(result.canRetry).toBe(true);
  });

  it("extension_not_installed 判定为浏览器助手并支持重新检测", () => {
    const result = classifySourcingRequestError({
      status: 503,
      code: "extension_not_installed",
    });
    expect(result.category).toBe("browser_assistant_required");
    expect(result.layer).toBe("浏览器助手");
    expect(result.canRecheck).toBe(true);
    expect(result.canRetry).toBe(false);
  });

  it("extension_version_mismatch 明确提示更新助手扩展", () => {
    const result = classifySourcingRequestError({
      status: 503,
      code: "extension_version_mismatch",
    });
    expect(result.category).toBe("browser_assistant_required");
    expect(result.message).toContain("浏览器助手版本需要更新");
    expect(result.canRecheck).toBe(true);
  });

  it("auth_required 判定为 1688 登录并区分图片与关键词入口", () => {
    const imgResult = classifySourcingRequestError({
      status: 401,
      code: "auth_required",
      method: "image",
    });
    expect(imgResult.category).toBe("login_required");
    expect(imgResult.layer).toBe("1688 登录");
    expect(imgResult.message).toContain("普通 Chrome 中登录 1688");

    const kwResult = classifySourcingRequestError({
      status: 401,
      code: "auth_required",
      method: "keyword",
    });
    expect(kwResult.category).toBe("login_required");
    expect(kwResult.message).toContain("打开 1688 登录窗口");
  });

  it("risk_control_required 判定为 1688 平台风控并提示人工验证", () => {
    const result = classifySourcingRequestError({
      status: 403,
      code: "risk_control_required",
      message: "1688 触发了风控验证（滑块/验证码）",
    });
    expect(result.category).toBe("risk_control_required");
    expect(result.layer).toBe("1688 平台风控");
    expect(result.canRetry).toBe(true);
  });

  it("acquisition_tool_not_available 判定为 1688 工具未就绪", () => {
    const result = classifySourcingRequestError({
      status: 503,
      code: "acquisition_tool_not_available",
    });
    expect(result.category).toBe("tool_unavailable");
    expect(result.layer).toBe("1688 工具");
    expect(result.canRecheck).toBe(true);
  });

  it("preview_expired 判定为搜索预览过期", () => {
    const result = classifySourcingRequestError({
      status: 410,
      code: "preview_expired",
    });
    expect(result.category).toBe("preview_expired");
    expect(result.layer).toBe("搜索预览");
    expect(result.canRetry).toBe(true);
  });

  it("输入校验错误 client_validation 不允许盲目重试", () => {
    const result = classifySourcingRequestError({
      status: 400,
      code: "invalid_query",
      message: "搜索关键词不能为空",
    });
    expect(result.category).toBe("client_validation");
    expect(result.layer).toBe("输入参数");
    expect(result.canRetry).toBe(false);
  });

  it("服务端异常 server_error 判定为本地服务端", () => {
    const result = classifySourcingRequestError({
      status: 500,
      code: "server_error",
    });
    expect(result.category).toBe("server_error");
    expect(result.layer).toBe("本地服务端");
    expect(result.canRetry).toBe(true);
  });
});

/* ── DOM 挂载测试（真实 React 19 + 错误卡片交互） ── */

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
  get textContent(): string {
    if (this.nodeType === 3) return (this as unknown as { text: string }).text;
    return this.childNodes.map((child) => child.textContent).join("");
  }
  set textContent(v: string) {
    this.childNodes = [new FakeText(this.ownerDocument, v)];
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
  get nodeValue(): string { return this.text; }
  set nodeValue(value: string) { this.text = String(value); }
}

class FakeElement extends FakeNode {
  tagName: string;
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  value = "";
  disabled = false;
  className = "";
  constructor(doc: FakeDocument, tagName: string) {
    super();
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = doc;
  }
  setAttribute(k: string, v: string) {
    this.attributes.set(k, v);
    if (k.startsWith("data-")) {
      const field = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[field] = v;
    }
    if (k === "class") this.className = v;
  }
  getAttribute(k: string): string | null { return this.attributes.get(k) ?? null; }
  hasAttribute(k: string): boolean { return this.attributes.has(k); }
  removeAttribute(k: string) { this.attributes.delete(k); }
  click() { this.dispatchEvent(new FakeEvent("click", this, true)); }
}

class FakeDocument extends FakeNode {
  body: FakeElement;
  activeElement: FakeElement | null = null;
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
}

function findByTestId(container: FakeElement, testId: string): FakeElement | null {
  let found: FakeElement | null = null;
  const walk = (node: FakeNode) => {
    if (found) return;
    for (const child of node.childNodes) {
      if (child.nodeType === 1) {
        const el = child as FakeElement;
        if (el.dataset.testid === testId) { found = el; return; }
        walk(el);
      }
    }
  };
  walk(container);
  return found;
}

function getReactProps(el: FakeElement | null): Record<string, unknown> | null {
  if (!el) return null;
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  return key ? (el as unknown as Record<string, Record<string, unknown>>)[key] : null;
}

const GET_TOOL_OK = {
  ok: true,
  data: {
    evidence: null,
    storageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-14T02:00:00.000Z" },
    toolStatus: {
      loggedIn: true,
      toolAvailable: true,
      cli: { loggedIn: true, toolAvailable: true },
      image: { extensionAvailable: true, versionCompatible: true, extensionSwVersion: "0.3.1", reasonCode: "extension_seen" },
      checkedAt: new Date().toISOString(),
    },
    capabilities: {
      keyword: { state: "available", reasonCategory: null },
      image: { state: "available", reasonCategory: null },
      detail: { state: "available", reasonCategory: null },
    },
  },
};

describe("SourcingEvidencePanel 真实 DOM 挂载与错误卡片交互", () => {
  let doc: FakeDocument;
  let container: FakeElement;
  let root: Root | null = null;

  beforeEach(() => {
    doc = new FakeDocument();
    container = doc.createElement("div");
    doc.body.appendChild(container);

    const store = new Map<string, string>();
    store.set("qx:no-auth-owner:v1", "1");
    const g = globalThis as Record<string, unknown>;
    class FakeHTMLIFrameElement {}
    g.HTMLIFrameElement = FakeHTMLIFrameElement;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    g.document = doc;
    g.window = {
      document: doc,
      HTMLIFrameElement: FakeHTMLIFrameElement,
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };
  });

  afterEach(async () => {
    if (root) {
      await act(async () => { root!.unmount(); });
      root = null;
    }
  });

  it("搜索触发超时错误：显示 [请求超时] 分层徽标、错误卡片、[重试刚才操作] 按钮与 [关闭] 按钮", async () => {
    let searchCallCount = 0;
    (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/tasks/task-error-test/sourcing")) {
        if (!init?.method || init.method === "GET") {
          return new Response(JSON.stringify(GET_TOOL_OK), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (init.method === "POST") {
          searchCallCount++;
          // 模拟超时异常
          throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        }
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });

    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(SourcingEvidencePanel, {
        taskId: "task-error-test",
        amazonContext: { title: "亚马逊测试商品", image: null, asin: null },
      } as never));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // 找到关键词输入框和搜索按钮
    const input = findByTestId(container, "sourcing-keyword-input");
    const submitBtn = findByTestId(container, "sourcing-keyword-submit");
    expect(input).not.toBeNull();
    expect(submitBtn).not.toBeNull();

    // 触发 React onChange 输入关键词
    await act(async () => {
      const inputProps = getReactProps(input);
      (inputProps?.onChange as (e: { target: { value: string } }) => void)({ target: { value: "挂钩" } });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // 点击搜索按钮
    await act(async () => {
      const submitProps = getReactProps(submitBtn);
      (submitProps?.onClick as () => void)();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(searchCallCount).toBe(1);

    // 断言错误卡片与分层徽标
    const errorCard = findByTestId(container, "sourcing-error-card");
    const errorLayer = findByTestId(container, "sourcing-error-layer");
    const errorMsg = findByTestId(container, "sourcing-error-message");
    const retryBtn = findByTestId(container, "sourcing-error-retry");
    const dismissBtn = findByTestId(container, "sourcing-error-dismiss");

    expect(errorCard).not.toBeNull();
    expect(errorLayer?.textContent).toContain("请求超时");
    expect(errorMsg?.textContent).toContain("1688 关键词获取超时");
    expect(retryBtn).not.toBeNull();
    expect(dismissBtn).not.toBeNull();

    // 验证用户输入没有被清空
    const inputAfter = findByTestId(container, "sourcing-keyword-input");
    expect(getReactProps(inputAfter)?.value).toBe("挂钩");

    // 点击 [重试刚才操作] 按钮，应以相同参数再次触发 fetch
    await act(async () => {
      const retryProps = getReactProps(retryBtn);
      (retryProps?.onClick as () => void)();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(searchCallCount).toBe(2);

    // 点击 [关闭] 按钮，错误卡片消失
    await act(async () => {
      const dismissProps = getReactProps(dismissBtn);
      (dismissProps?.onClick as () => void)();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const errorCardAfter = findByTestId(container, "sourcing-error-card");
    expect(errorCardAfter).toBeNull();
  });

  it("搜索触发服务端 500 HTML 错误：显示 [本地服务端] 徽标并允许重试，绝不伪装为网络异常", async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/tasks/task-500-test/sourcing")) {
        if (!init?.method || init.method === "GET") {
          return new Response(JSON.stringify(GET_TOOL_OK), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (init.method === "POST") {
          // 模拟 Next.js 500 HTML 崩溃页
          return new Response("<!DOCTYPE html><html><body><h1>Internal Server Error</h1></body></html>", {
            status: 500,
            headers: { "content-type": "text/html" },
          });
        }
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });

    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(SourcingEvidencePanel, {
        taskId: "task-500-test",
        amazonContext: { title: "亚马逊测试商品", image: null, asin: null },
      } as never));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const input = findByTestId(container, "sourcing-keyword-input");
    const submitBtn = findByTestId(container, "sourcing-keyword-submit");

    await act(async () => {
      const inputProps = getReactProps(input);
      (inputProps?.onChange as (e: { target: { value: string } }) => void)({ target: { value: "收纳盒" } });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    await act(async () => {
      const submitProps = getReactProps(submitBtn);
      (submitProps?.onClick as () => void)();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const errorLayer = findByTestId(container, "sourcing-error-layer");
    const errorMsg = findByTestId(container, "sourcing-error-message");
    expect(errorLayer?.textContent).toContain("本地服务端");
    expect(errorMsg?.textContent).toContain("本地服务执行异常");
    expect(errorMsg?.textContent).not.toContain("网络异常，请重试。");
  });

  it("初始 loadInitial 失败：挂出 [供应能力状态读取失败] 错误卡并展示 [状态未知 / 检测失败] 徽标，重新检测成功后自愈", async () => {
    let getCallCount = 0;
    (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string, init?: { method?: string }) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/tasks/task-load-fail/sourcing")) {
        if (!init?.method || init.method === "GET") {
          getCallCount++;
          if (getCallCount === 1) {
            // 首次 GET 模拟服务端 500 HTML 崩溃
            return new Response("<!DOCTYPE html><html><body><h1>Internal Server Error</h1></body></html>", {
              status: 500,
              headers: { "content-type": "text/html" },
            });
          }
          // 重新检测时恢复 200
          return new Response(JSON.stringify(GET_TOOL_OK), { status: 200, headers: { "content-type": "application/json" } });
        }
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });

    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(SourcingEvidencePanel, {
        taskId: "task-load-fail",
        amazonContext: { title: "测试商品", image: null, asin: null },
      } as never));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // 首次挂载失败，应展示错误卡
    const errorCard = findByTestId(container, "sourcing-error-card");
    const errorLayer = findByTestId(container, "sourcing-error-layer");
    const recheckBtn = findByTestId(container, "sourcing-error-recheck");
    const retryBtn = findByTestId(container, "sourcing-error-retry");

    expect(errorCard).not.toBeNull();
    expect(errorLayer?.textContent).toContain("供应能力状态读取失败");
    expect(recheckBtn).not.toBeNull();
    expect(retryBtn).toBeNull(); // 首次加载失败没有前置业务搜索操作，因此不提供重试刚才操作

    // 三个入口的状态徽标必须变更为“状态未知 / 检测失败”，不得伪装为组件未安装
    const kwBadge = findByTestId(container, "sourcing-kw-status-failed");
    const imgBadge = findByTestId(container, "sourcing-img-status-failed");
    const urlBadge = findByTestId(container, "sourcing-url-status-failed");
    expect(kwBadge?.textContent).toContain("状态未知 / 检测失败");
    expect(imgBadge?.textContent).toContain("状态未知 / 检测失败");
    expect(urlBadge?.textContent).toContain("状态未知 / 检测失败");

    // 点击 [重新检测]
    await act(async () => {
      const recheckProps = getReactProps(recheckBtn);
      (recheckProps?.onClick as () => void)();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // 重新检测成功后，错误卡自动关闭，徽标恢复正常登录状态
    const errorCardAfter = findByTestId(container, "sourcing-error-card");
    expect(errorCardAfter).toBeNull();
    const kwInput = findByTestId(container, "sourcing-keyword-input");
    expect(kwInput).not.toBeNull();
  });

  it("搜索失败保护现场：已选中的 checkbox 与详情在搜索失败时完整保留，关闭错误卡后依然可见", async () => {
    const SAMPLE_CANDIDATES = [
      {
        offerId: "offer-101",
        title: "高品质不锈钢保温杯 500ml",
        sourceUrl: "https://detail.1688.com/offer/101.html",
        images: ["https://cbu01.alicdn.com/img/ibank/101.jpg"],
        displayedPrice: { text: "¥18.50" },
        displayedMoq: { text: "2 个起批" },
        priceRange: { min: 18.5, max: 22.0 },
        priceTiers: [{ minQty: 2, price: 18.5 }],
        skuSpecs: [{ skuId: "s1", specs: "黑色 500ml" }],
        sellerClaims: [{ name: "材质", value: "304不锈钢" }],
        supplierDisplayName: "浙江某某实业",
        matchState: "exact_match",
      },
      {
        offerId: "offer-102",
        title: "双层真空车载便携保温杯 600ml",
        sourceUrl: "https://detail.1688.com/offer/102.html",
        images: ["https://cbu01.alicdn.com/img/ibank/102.jpg"],
        displayedPrice: { text: "¥25.00" },
        displayedMoq: { text: "5 个起批" },
        priceRange: { min: 25.0, max: 28.0 },
        priceTiers: [],
        skuSpecs: [],
        sellerClaims: [],
        supplierDisplayName: "永康某某制造",
        matchState: "likely_similar",
      },
    ];

    let postCount = 0;
    (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/tasks/task-state-preserve/sourcing")) {
        if (!init?.method || init.method === "GET") {
          return new Response(JSON.stringify(GET_TOOL_OK), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (init.method === "POST") {
          postCount++;
          if (postCount === 1) {
            // 第一次搜索成功返回 2 个 candidate
            return new Response(JSON.stringify({
              ok: true,
              data: {
                preview: {
                  previewId: "prev-1",
                  method: "keyword",
                  query: "保温杯",
                  candidates: SAMPLE_CANDIDATES,
                  expiresAt: Date.now() + 600_000,
                },
              },
            }), { status: 200, headers: { "content-type": "application/json" } });
          }
          if (postCount === 2) {
            // 第二次搜索模拟超时断开报错
            throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
          }
        }
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });

    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(SourcingEvidencePanel, {
        taskId: "task-state-preserve",
        amazonContext: { title: "亚马逊保温杯", image: null, asin: null },
      } as never));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // 第一次搜索：输入并提交
    const input = findByTestId(container, "sourcing-keyword-input");
    const submitBtn = findByTestId(container, "sourcing-keyword-submit");
    await act(async () => {
      const inputProps = getReactProps(input);
      (inputProps?.onChange as (e: { target: { value: string } }) => void)({ target: { value: "保温杯" } });
    });
    await act(async () => {
      const submitProps = getReactProps(submitBtn);
      (submitProps?.onClick as () => void)();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // 确认预览已展示，并且有 2 个候选
    const select101 = findByTestId(container, "select-offer-101");
    expect(select101).not.toBeNull();

    // 用户勾选 offer-101
    await act(async () => {
      const selectProps = getReactProps(select101);
      (selectProps?.onChange as () => void)();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // 确认按钮上显示“加入供应线索（1）”
    const confirmBtn = findByTestId(container, "sourcing-confirm-button");
    expect(confirmBtn?.textContent).toContain("加入供应线索（1）");

    // 现在触发第二次搜索（模拟用户输入新词后搜索报错）
    await act(async () => {
      const inputProps = getReactProps(input);
      (inputProps?.onChange as (e: { target: { value: string } }) => void)({ target: { value: "不锈钢杯" } });
    });
    await act(async () => {
      const submitProps = getReactProps(submitBtn);
      (submitProps?.onClick as () => void)();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // 断言出现错误卡片
    const errorCard = findByTestId(container, "sourcing-error-card");
    expect(errorCard).not.toBeNull();

    // 核心断言：旧 preview 和已有选择未被提前抹除！
    const select101AfterError = findByTestId(container, "select-offer-101");
    expect(select101AfterError).not.toBeNull();
    expect(getReactProps(select101AfterError)?.checked).toBe(true);

    // 点击关闭错误卡片
    const dismissBtn = findByTestId(container, "sourcing-error-dismiss");
    await act(async () => {
      const dismissProps = getReactProps(dismissBtn);
      (dismissProps?.onClick as () => void)();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // 关闭后完整回到 preview 状态，确认按钮仍然是已选 1 条
    const confirmBtnAfter = findByTestId(container, "sourcing-confirm-button");
    expect(confirmBtnAfter?.textContent).toContain("加入供应线索（1）");
  });

  it("搜索 0 结果时保留上一批结果并提供 [返回上一批搜索结果] 按钮", async () => {
    let postCount = 0;
    (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string, init?: { method?: string }) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/tasks/task-zero-result/sourcing")) {
        if (!init?.method || init.method === "GET") {
          return new Response(JSON.stringify(GET_TOOL_OK), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (init.method === "POST") {
          postCount++;
          if (postCount === 1) {
            return new Response(JSON.stringify({
              ok: true,
              data: {
                preview: {
                  previewId: "prev-orig",
                  method: "keyword",
                  query: "杯子",
                  candidates: [{
                    offerId: "cup-1",
                    title: "原先的杯子",
                    sourceUrl: "https://detail.1688.com/offer/1.html",
                    images: [],
                    displayedPrice: { text: "¥10.00" },
                    displayedMoq: null,
                    priceRange: null,
                    priceTiers: [],
                    skuSpecs: [],
                    sellerClaims: [],
                    supplierDisplayName: "制造厂",
                    matchState: "exact_match",
                  }],
                  expiresAt: Date.now() + 600_000,
                },
              },
            }), { status: 200, headers: { "content-type": "application/json" } });
          }
          if (postCount === 2) {
            // 第二次搜索返回 0 个候选
            return new Response(JSON.stringify({
              ok: true,
              data: {
                preview: {
                  previewId: "prev-empty",
                  method: "keyword",
                  query: "不存在的商品名称xyz123",
                  candidates: [],
                  expiresAt: Date.now() + 600_000,
                },
              },
            }), { status: 200, headers: { "content-type": "application/json" } });
          }
        }
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });

    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(createElement(SourcingEvidencePanel, {
        taskId: "task-zero-result",
        amazonContext: { title: "测试商品", image: null, asin: null },
      } as never));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const input = findByTestId(container, "sourcing-keyword-input");
    const submitBtn = findByTestId(container, "sourcing-keyword-submit");

    // 第一次搜索
    await act(async () => {
      const inputProps = getReactProps(input);
      (inputProps?.onChange as (e: { target: { value: string } }) => void)({ target: { value: "杯子" } });
    });
    await act(async () => {
      const submitProps = getReactProps(submitBtn);
      (submitProps?.onClick as () => void)();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(findByTestId(container, "select-cup-1")).not.toBeNull();

    // 第二次搜索（无结果）
    await act(async () => {
      const inputProps = getReactProps(input);
      (inputProps?.onChange as (e: { target: { value: string } }) => void)({ target: { value: "不存在的商品名称xyz123" } });
    });
    await act(async () => {
      const submitProps = getReactProps(submitBtn);
      (submitProps?.onClick as () => void)();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // 出现 no_results 和返回上一批按钮
    const backBtn = findByTestId(container, "sourcing-back-previous-preview");
    expect(backBtn).not.toBeNull();

    // 点击返回上一批
    await act(async () => {
      const backProps = getReactProps(backBtn);
      (backProps?.onClick as () => void)();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // 原结果恢复
    expect(findByTestId(container, "select-cup-1")).not.toBeNull();
  });
});

