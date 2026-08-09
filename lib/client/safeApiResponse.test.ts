import { describe, expect, it } from "vitest";
import { readJsonApiResponse } from "./safeApiResponse";

describe("readJsonApiResponse", () => {
  it("parses an application/json response", async () => {
    const response = new Response(JSON.stringify({ ok: true, data: { id: "result-1" } }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });

    await expect(readJsonApiResponse(response)).resolves.toEqual({
      ok: true,
      payload: { ok: true, data: { id: "result-1" } },
      status: 200,
    });
  });

  it("returns a stable internal error for an HTML gateway response", async () => {
    const upstreamHtml = "<html><body>504 Gateway Time-out internal-upstream-detail</body></html>";
    const response = new Response(upstreamHtml, {
      status: 504,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

    const result = await readJsonApiResponse(response);

    expect(result).toEqual({
      ok: false,
      error: { code: "unexpected_non_json_response", status: 504 },
    });
    expect(JSON.stringify(result)).not.toContain("Gateway");
    expect(JSON.stringify(result)).not.toContain("internal-upstream-detail");
  });

  it("does not expose malformed JSON response text", async () => {
    const response = new Response('{"secret":"partial-provider-response"', {
      status: 502,
      headers: { "Content-Type": "application/problem+json" },
    });

    const result = await readJsonApiResponse(response);

    expect(result).toEqual({
      ok: false,
      error: { code: "unexpected_non_json_response", status: 502 },
    });
    expect(JSON.stringify(result)).not.toContain("partial-provider-response");
  });
});
