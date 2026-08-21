import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventStream } from "./EventStream";
import { makeEvent } from "./fixtures";

describe("EventStream", () => {
  it("renders empty state", () => {
    const html = renderToStaticMarkup(createElement(EventStream, { events: [] }));
    expect(html).toContain("暂无事件记录");
  });

  it("renders events with seq and type label", () => {
    const html = renderToStaticMarkup(
      createElement(EventStream, {
        events: [
          makeEvent({ seq: 1, type: "node_entered" }),
          makeEvent({ seq: 2, type: "waiting_human", node: "gate_a" }),
        ],
      }),
    );
    expect(html).toContain("#1");
    expect(html).toContain("进入节点");
    expect(html).toContain("#2");
    expect(html).toContain("等待人工");
    expect(html).toContain("门禁 A");
  });
});
