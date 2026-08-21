import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CancelResumeControls } from "./CancelResumeControls";

describe("CancelResumeControls", () => {
  it("shows the terminal disabled note for cancelled", () => {
    const html = renderToStaticMarkup(
      createElement(CancelResumeControls, { runId: "run_1", status: "cancelled", revision: 3, onAction: () => undefined }),
    );
    expect(html).toContain('data-terminal="true"');
    expect(html).toContain("该运行已结束，不能继续操作");
    expect(html).not.toContain('data-testid="cancel-run-button"');
  });

  it("shows a cancel button while running", () => {
    const html = renderToStaticMarkup(
      createElement(CancelResumeControls, { runId: "run_1", status: "running", revision: 3, onAction: () => undefined }),
    );
    expect(html).toContain('data-testid="cancel-run-button"');
    expect(html).not.toContain('data-testid="primary-action"');
  });

  it("offers 开始研究 for draft", () => {
    const html = renderToStaticMarkup(
      createElement(CancelResumeControls, { runId: "run_1", status: "draft", revision: 0, onAction: () => undefined }),
    );
    expect(html).toContain('data-testid="primary-action"');
    expect(html).toContain("开始研究");
  });

  it("offers 重试 for failed_recoverable", () => {
    const html = renderToStaticMarkup(
      createElement(CancelResumeControls, { runId: "run_1", status: "failed_recoverable", revision: 3, onAction: () => undefined }),
    );
    expect(html).toContain('data-testid="primary-action"');
    expect(html).toContain("重试");
  });
});
