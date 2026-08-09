import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const nginx = readFileSync(join(process.cwd(), "deploy", "nginx.conf.example"), "utf8");
const productAnalysisRoute = readFileSync(
  join(process.cwd(), "app", "api", "workflows", "product-analysis", "route.ts"),
  "utf8",
);
const productAnalysisWorkflow = readFileSync(join(process.cwd(), "lib", "workflows", "productAnalysis.ts"), "utf8");

function activeHttpServerExample() {
  return nginx.split("# HTTPS example.")[0] || "";
}

describe("product-analysis Nginx timeout contract", () => {
  it("uses an exact route timeout greater than the 180 second application contract", () => {
    const active = activeHttpServerExample();
    const route = active.match(/location\s*=\s*\/api\/workflows\/product-analysis\s*\{([\s\S]*?)\n\s*\}/)?.[1] || "";
    const seconds = Number(route.match(/proxy_read_timeout\s+(\d+)s\s*;/)?.[1]);
    const appSeconds = Number(productAnalysisRoute.match(/maxDuration\s*=\s*(\d+)/)?.[1]);
    const providerMilliseconds = Number(productAnalysisWorkflow.match(/PRODUCT_ANALYSIS_AI_TIMEOUT_MS\s*=\s*([\d_]+)/)?.[1]?.replaceAll("_", ""));

    expect(route).not.toBe("");
    expect(appSeconds).toBe(180);
    expect(providerMilliseconds).toBe(45_000);
    expect(seconds).toBeGreaterThan(appSeconds);
    expect(seconds).toBeGreaterThanOrEqual(providerMilliseconds * 3 / 1000 + 30);
    expect(route).toContain("proxy_pass http://127.0.0.1:3005;");
  });

  it("does not expand the general site timeout", () => {
    const active = activeHttpServerExample();
    const general = active.match(/location\s+\/\s*\{([\s\S]*?)\n\s*\}/)?.[1] || "";

    expect(general).not.toContain("proxy_read_timeout");
  });
});
