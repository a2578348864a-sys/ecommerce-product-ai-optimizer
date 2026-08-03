import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TaskDecisionControl } from "@/components/TaskRecordsList";

function versionedResult() {
  return {
    researchRecord: {
      schema: "product-research-record.v1",
      revision: 3,
      latestDecision: {
        status: "needs_information",
        reason: "Need one more source.",
        nextAction: "Collect the missing source.",
      },
    },
  };
}

function findElement(node: ReactNode, type: string): any | null {
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  let found: any | null = null;
  Children.forEach((node.props as { children?: ReactNode }).children, (child) => {
    if (!found) found = findElement(child, type);
  });
  return found;
}

describe("TaskRecordsList research decision control", () => {
  it("renders a versioned summary without the legacy decision select", () => {
    const onLegacyDecisionChange = vi.fn();
    const element = createElement(TaskDecisionControl, {
      taskId: "task-v1",
      result: versionedResult(),
      legacyDecisionStatus: "continue",
      updating: false,
      onLegacyDecisionChange,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('data-testid="versioned-research-decision-summary"');
    expect(html).toContain("版本 3");
    expect(html).toContain("/tasks/task-v1#product-research-decision");
    expect(html).not.toContain("<select");
    expect(findElement(TaskDecisionControl(element.props), "select")).toBeNull();
    expect(onLegacyDecisionChange).not.toHaveBeenCalled();
  });

  it("keeps the legacy select interactive only for Legacy records", () => {
    const onLegacyDecisionChange = vi.fn();
    const rendered = TaskDecisionControl({
      taskId: "task-legacy",
      result: { type: "workflow" },
      legacyDecisionStatus: "pending",
      updating: false,
      onLegacyDecisionChange,
    });
    const html = renderToStaticMarkup(rendered);
    expect(html).toContain('data-testid="legacy-decision-control"');
    expect(html).toContain("<select");
    const select = findElement(rendered, "select");
    expect(select).not.toBeNull();
    select.props.onChange({ target: { value: "need_info" } });
    expect(onLegacyDecisionChange).toHaveBeenCalledWith("need_info");
  });
});
