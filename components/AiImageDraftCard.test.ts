import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiImageDraftCard, shouldRenewAiImageRequestKey } from "@/components/AiImageDraftCard";
import { AI_IMAGE_DRAFT_DISCLAIMER } from "@/lib/aiImageDraft";

describe("AiImageDraftCard", () => {
  it("uses a full-width review gallery without cropping generated drafts", () => {
    const source = readFileSync(resolve(process.cwd(), "components/AiImageDraftCard.tsx"), "utf8");

    expect(source).toContain('className="mt-3 grid gap-4"');
    expect(source).toContain('className="aspect-square w-full bg-slate-100 object-contain"');
    expect(source).not.toContain('className="mt-3 grid gap-3 sm:grid-cols-2"');
    expect(source).not.toContain('className="aspect-square w-full object-cover"');
  });
  it("is collapsed by default while keeping the safety statement visible", () => {
    const html = renderToStaticMarkup(React.createElement(AiImageDraftCard, { taskId: "task-1" }));
    expect(html).toContain("AI 图片素材草稿");
    expect(html).toContain(AI_IMAGE_DRAFT_DISCLAIMER);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("图片类型");
    expect(html).not.toContain("生成图片草稿");
  });

  it("does not present prohibited workflow labels or claim automatic publishing", () => {
    const html = renderToStaticMarkup(React.createElement(AiImageDraftCard, { taskId: "task-1" }));
    const disallowed = [
      String.fromCodePoint(72, 82, 32, 68, 101, 109, 111),
      String.fromCodePoint(38754, 35797, 27169, 24335),
      String.fromCodePoint(25307, 32856, 27169, 24335),
    ];
    for (const text of disallowed) {
      expect(html).not.toContain(text);
    }
    expect(html).toContain("不会自动上架");
  });

  it.each([
    "image_provider_timeout",
    "image_provider_rate_limited",
    "image_provider_unavailable",
    "image_content_blocked",
    "image_provider_error",
    "image_response_invalid",
    "image_storage_failed",
    "image_snapshot_save_failed",
    "image_request_already_failed",
  ])("requires a new idempotency key after terminal error %s", (errorCode) => {
    expect(shouldRenewAiImageRequestKey(errorCode)).toBe(true);
  });

  it.each([undefined, "", "image_request_in_progress", "image_ledger_failed"])(
    "keeps the idempotency key for response recovery when the error is %s",
    (errorCode) => {
      expect(shouldRenewAiImageRequestKey(errorCode)).toBe(false);
    },
  );
});
