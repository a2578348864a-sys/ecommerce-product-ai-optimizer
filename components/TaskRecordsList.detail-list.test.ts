import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskDetailList } from "@/components/TaskRecordsList";

describe("TaskRecordsList detail facts", () => {
  it("renders a duplicated fact once while preserving distinct facts", () => {
    const html = renderToStaticMarkup(createElement(TaskDetailList, {
      title: "核心卖点",
      items: ["Same confirmed benefit", "Same confirmed benefit", "Another confirmed benefit"],
    }));

    expect(html.match(/Same confirmed benefit/g)).toHaveLength(1);
    expect(html).toContain("Another confirmed benefit");
  });
});
