import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BudgetMeter } from "./BudgetMeter";
import { makeBudget } from "./fixtures";

describe("BudgetMeter", () => {
  it("renders used/max cost and cost bar", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetMeter, { budget: makeBudget({ usedCost: 2.5, maxCost: 10, currency: "CNY" }) }),
    );
    expect(html).toContain('data-testid="budget-meter"');
    expect(html).toContain('data-testid="budget-cost-bar"');
    expect(html).toContain("￥2.50");
    expect(html).toContain("￥10.00");
    expect(html).toContain("25%");
  });

  it("marks over budget in rose", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetMeter, { budget: makeBudget({ usedCost: 12, maxCost: 10 }) }),
    );
    expect(html).toContain("bg-rose-500");
    expect(html).toContain("text-rose-600");
  });
});
