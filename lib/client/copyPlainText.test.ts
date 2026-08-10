import { afterEach, describe, expect, it, vi } from "vitest";
import { copyPlainText } from "@/lib/client/copyPlainText";

/** node 环境注入 window/document mock */
function mockDom(opts: {
  secureContext?: boolean;
  clipboard?: { writeText: (t: string) => Promise<void> } | null;
  execResult?: boolean;
} = {}) {
  const execCommand = vi.fn(() => opts.execResult ?? true);
  const textarea = {
    value: "",
    setAttribute: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    remove: vi.fn(),
    style: {},
  };
  const doc = {
    createElement: vi.fn(() => textarea),
    execCommand,
    body: { appendChild: vi.fn() },
  };
  const win = {
    isSecureContext: opts.secureContext ?? true,
    navigator: opts.clipboard === undefined
      ? { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } }
      : opts.clipboard === null
        ? {}
        : { clipboard: opts.clipboard },
    document: doc,
  };
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = doc;
  return { execCommand, textarea, win };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
});

describe("v2.2.14 copyPlainText HTTP 兼容", () => {
  it("secure context + clipboard 可用 → 走 clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { win } = mockDom({ secureContext: true, clipboard: { writeText } });
    expect(await copyPlainText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(win.document.execCommand).not.toHaveBeenCalled();
  });

  it("HTTP/no clipboard → textarea fallback 成功", async () => {
    const { execCommand } = mockDom({ secureContext: false, clipboard: null, execResult: true });
    expect(await copyPlainText("fallback text")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("clipboard 拒绝 → fallback 成功", async () => {
    const { execCommand } = mockDom({
      secureContext: true,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      execResult: true,
    });
    expect(await copyPlainText("denied then fallback")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("全部失败 → false", async () => {
    const { execCommand } = mockDom({ secureContext: false, clipboard: null, execResult: false });
    expect(await copyPlainText("fail text")).toBe(false);
  });

  it("空文本 → false 且不触碰 DOM", async () => {
    const { win } = mockDom({ secureContext: true });
    expect(await copyPlainText("")).toBe(false);
    expect(win.document.execCommand).not.toHaveBeenCalled();
  });
});
