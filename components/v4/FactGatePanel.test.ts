/**
 * V4 P3 — FactGatePanel 测试（独立测试文件，components/v4）。
 * 覆盖：正常渲染、confirm 缺 method 被禁、conflict 缺 otherValue 被禁、
 * revoke 流程（原因门禁 + 撤销态展示）、rejected/unknown 状态、禁止一键全确认。
 * 使用仓库既有约定 renderToStaticMarkup（node 环境，无 jsdom/testing-library）；
 * 交互门禁通过受控子表单（controlled props）+ 导出的纯校验函数验证。
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FactGatePanel,
  FactConfirmForm,
  FactConflictForm,
  FactRevokeForm,
  canConfirmSubmit,
  canConflictSubmit,
  canRevokeSubmit,
  parseRefs,
  groupFactsByVariant,
  type FactGateItem,
} from "@/components/v4/FactGatePanel";

function makeItem(overrides: Partial<FactGateItem> = {}): FactGateItem {
  return {
    key: overrides.key ?? "item-1",
    variantKey: overrides.variantKey ?? "variant-a",
    variantLabel: overrides.variantLabel ?? "黑色 / 500ml",
    field: overrides.field ?? "material",
    value: overrides.value ?? "304 不锈钢",
    status: overrides.status,
    revision: overrides.revision,
    actor: overrides.actor,
    updatedAt: overrides.updatedAt,
    confirmationMethod: overrides.confirmationMethod,
    claimRefs: overrides.claimRefs,
    documentRefs: overrides.documentRefs,
    revokedByRevision: overrides.revokedByRevision,
    revocationReason: overrides.revocationReason,
  };
}

function noopCallbacks() {
  return {
    onConfirm: () => {},
    onReject: () => {},
    onUnknown: () => {},
    onConflict: () => {},
    onRevoke: () => {},
  };
}

function buttonTag(html: string, testId: string): string | null {
  const re = new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`);
  const m = html.match(re);
  return m ? m[0] : null;
}

function isButtonDisabled(html: string, testId: string): boolean {
  const tag = buttonTag(html, testId);
  // 只认 boolean disabled 属性（disabled=""），不能误匹配 class 里的 disabled:opacity-50。
  return tag ? /\sdisabled(\s|=|>|$)/.test(tag) : false;
}

// ─── 纯校验/分组函数 ─────────────────────────────────────────────────────

describe("parseRefs", () => {
  it("splits on ASCII/full-width commas, semicolons and newlines, trimming empties", () => {
    expect(parseRefs("a, b，c;d\n e")).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("returns an empty array for blank input", () => {
    expect(parseRefs("  , ; \n ")).toEqual([]);
  });
});

describe("canConfirmSubmit", () => {
  it("blocks confirm when no confirmation method is selected", () => {
    expect(canConfirmSubmit("", ["claim-1"], [])).toBe(false);
  });
  it("blocks confirm when neither claimRefs nor documentRefs are present", () => {
    expect(canConfirmSubmit("document", [], [])).toBe(false);
  });
  it("allows confirm with a method and a claim ref", () => {
    expect(canConfirmSubmit("document", ["claim-1"], [])).toBe(true);
  });
  it("allows confirm with a method and a document ref", () => {
    expect(canConfirmSubmit("sample", [], ["doc-1"])).toBe(true);
  });
});

describe("canConflictSubmit", () => {
  it("blocks conflict when otherValue is empty or whitespace", () => {
    expect(canConflictSubmit("")).toBe(false);
    expect(canConflictSubmit("   ")).toBe(false);
  });
  it("allows conflict when otherValue is present", () => {
    expect(canConflictSubmit("1000ml")).toBe(true);
  });
});

describe("canRevokeSubmit", () => {
  it("blocks revoke when reason is empty or whitespace", () => {
    expect(canRevokeSubmit("")).toBe(false);
    expect(canRevokeSubmit("   ")).toBe(false);
  });
  it("allows revoke when reason is present", () => {
    expect(canRevokeSubmit("页面为宣传，未获证实")).toBe(true);
  });
});

describe("groupFactsByVariant", () => {
  it("groups by variantKey and sorts items by field, preserving first-seen variant order", () => {
    const groups = groupFactsByVariant([
      makeItem({ key: "a", variantKey: "v1", field: "size", value: "10cm" }),
      makeItem({ key: "b", variantKey: "v1", field: "material", value: "钢" }),
      makeItem({ key: "c", variantKey: "v2", field: "color", value: "黑" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].variantKey).toBe("v1");
    expect(groups[0].items.map((i) => i.field)).toEqual(["material", "size"]);
    expect(groups[1].variantKey).toBe("v2");
    expect(groups[1].items).toHaveLength(1);
  });
});

// ─── confirm 缺 method 被禁 ──────────────────────────────────────────────

describe("FactConfirmForm", () => {
  it("disables the submit button when no confirmation method is selected", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactConfirmForm, {
        confirmationMethod: "",
        claimRefsText: "claim-1",
        documentRefsText: "",
        onConfirmationMethodChange: () => {},
        onClaimRefsTextChange: () => {},
        onDocumentRefsTextChange: () => {},
        onSubmit: () => {},
      }),
    );
    expect(isButtonDisabled(html, "fact-confirm-submit")).toBe(true);
    expect(html).toContain('data-testid="fact-confirm-hint"');
  });

  it("enables the submit button with a method and a reference", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactConfirmForm, {
        confirmationMethod: "document",
        claimRefsText: "claim-1",
        documentRefsText: "",
        onConfirmationMethodChange: () => {},
        onClaimRefsTextChange: () => {},
        onDocumentRefsTextChange: () => {},
        onSubmit: () => {},
      }),
    );
    expect(isButtonDisabled(html, "fact-confirm-submit")).toBe(false);
  });

  it("still disables submit when method is selected but no reference is provided", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactConfirmForm, {
        confirmationMethod: "sample",
        claimRefsText: "",
        documentRefsText: "",
        onConfirmationMethodChange: () => {},
        onClaimRefsTextChange: () => {},
        onDocumentRefsTextChange: () => {},
        onSubmit: () => {},
      }),
    );
    expect(isButtonDisabled(html, "fact-confirm-submit")).toBe(true);
  });
});

// ─── conflict 缺 otherValue 被禁 ─────────────────────────────────────────

describe("FactConflictForm", () => {
  it("disables the submit button when otherValue is empty", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactConflictForm, {
        otherValue: "",
        onOtherValueChange: () => {},
        onSubmit: () => {},
      }),
    );
    expect(isButtonDisabled(html, "fact-conflict-submit")).toBe(true);
    expect(html).toContain('data-testid="fact-conflict-hint"');
  });

  it("enables the submit button when otherValue is present", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactConflictForm, {
        otherValue: "201 不锈钢",
        onOtherValueChange: () => {},
        onSubmit: () => {},
      }),
    );
    expect(isButtonDisabled(html, "fact-conflict-submit")).toBe(false);
  });
});

// ─── revoke 流程 ─────────────────────────────────────────────────────────

describe("FactRevokeForm", () => {
  it("disables the submit button when reason is empty", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactRevokeForm, {
        reason: "",
        onReasonChange: () => {},
        onSubmit: () => {},
      }),
    );
    expect(isButtonDisabled(html, "fact-revoke-submit")).toBe(true);
    expect(html).toContain('data-testid="fact-revoke-hint"');
  });

  it("enables the submit button when reason is present", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactRevokeForm, {
        reason: "页面为宣传 304，未获样品/文件证实",
        onReasonChange: () => {},
        onSubmit: () => {},
      }),
    );
    expect(isButtonDisabled(html, "fact-revoke-submit")).toBe(false);
  });
});

// ─── 主面板渲染 ──────────────────────────────────────────────────────────

describe("FactGatePanel", () => {
  it("renders the panel header and the no-confirm-all note", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactGatePanel, {
        items: [makeItem()],
        ...noopCallbacks(),
      }),
    );
    expect(html).toContain("产品事实确认（Product Fact Gate）");
    expect(html).toContain('data-testid="fact-no-confirm-all"');
    expect(html).toContain("一键全选确认");
    expect(html).not.toContain("全部确认");
    expect(html).not.toContain('data-testid="fact-confirm-all"');
  });

  it("renders a single variant with items, values, badges, revision and actor", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactGatePanel, {
        items: [
          makeItem({ key: "m1", field: "material", value: "304 不锈钢", status: "confirmed", revision: 3, actor: "owner", confirmationMethod: "document" }),
          makeItem({ key: "s1", field: "size", value: "500ml", status: "rejected", revision: 1, actor: "owner" }),
        ],
        ...noopCallbacks(),
      }),
    );
    expect(html).toContain("Variant：");
    expect(html).toContain("黑色 / 500ml");
    expect(html).toContain("材质");
    expect(html).toContain("304 不锈钢");
    expect(html).toContain("已确认");
    expect(html).toContain("已驳回");
    expect(html).toContain("修订 3");
    expect(html).toContain("操作者 owner");
    expect(html).toContain("确认方法：文件/文档");
  });

  it("renders a revoked item grayed out with its reason and without action buttons", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactGatePanel, {
        items: [
          makeItem({
            key: "r1",
            field: "material",
            value: "304 不锈钢",
            status: "revoked",
            revision: 2,
            actor: "owner",
            revokedByRevision: 3,
            revocationReason: "页面为宣传 304，未获样品/文件证实",
          }),
        ],
        ...noopCallbacks(),
      }),
    );
    expect(html).toContain("已撤销");
    expect(html).toContain("撤销原因：页面为宣传 304，未获样品/文件证实");
    expect(html).toContain("opacity-60");
    expect(html).not.toContain('data-testid="fact-action-confirm"');
    expect(html).toContain("该事实已被撤销，不再作为当前事实");
  });

  it("renders unknown status badge", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactGatePanel, {
        items: [makeItem({ key: "u1", field: "quantity", value: "?", status: "unknown" })],
        ...noopCallbacks(),
      }),
    );
    expect(html).toContain("未知");
    expect(html).toContain("数量");
  });

  it("shows the confirm form disabled by default (no method selected)", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactGatePanel, {
        items: [makeItem({ status: "unconfirmed" })],
        ...noopCallbacks(),
      }),
    );
    expect(html).toContain('data-testid="fact-confirm-form"');
    expect(isButtonDisabled(html, "fact-confirm-submit")).toBe(true);
  });

  it("renders an empty state when there are no items", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactGatePanel, {
        items: [],
        ...noopCallbacks(),
      }),
    );
    expect(html).toContain('data-testid="fact-empty"');
    expect(html).toContain("暂无可确认的产品事实");
  });

  it("renders action buttons for confirm/reject/unknown/conflict/revoke", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactGatePanel, {
        items: [makeItem()],
        ...noopCallbacks(),
      }),
    );
    for (const action of ["confirm", "reject", "unknown", "conflict", "revoke"]) {
      expect(html).toContain(`data-testid="fact-action-${action}"`);
    }
  });
});
