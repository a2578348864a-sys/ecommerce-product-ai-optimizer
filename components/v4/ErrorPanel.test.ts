import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorPanel } from "./ErrorPanel";

describe("ErrorPanel", () => {
  it("renders a recoverable error with a retry button", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorPanel, {
        error: { code: "TIMEOUT", recoverable: true, safeMessage: "请求超时", occurredAt: "2026-01-01T00:00:00.000Z" },
        onRetry: () => undefined,
      }),
    );
    expect(html).toContain('data-testid="error-panel"');
    expect(html).toContain("可恢复");
    expect(html).toContain("超时");
    expect(html).toContain("请求超时");
    expect(html).toContain('data-testid="error-retry-button"');
  });

  it("does not render a retry button for a terminal error", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorPanel, {
        error: { code: "TERMINAL_UNSUPPORTED", recoverable: false, occurredAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    expect(html).toContain("不可恢复");
    expect(html).not.toContain('data-testid="error-retry-button"');
  });
});
