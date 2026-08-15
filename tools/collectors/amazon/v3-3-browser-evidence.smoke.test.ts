/**
 * V3.3 — Browser Evidence 真实浏览器 Smoke（授权门禁，默认跳过）
 *
 * 运行：RUN_V33_BROWSER_SMOKE=authorized-once npx vitest run tools/collectors/amazon/v3-3-browser-evidence.smoke.test.ts
 *
 * 覆盖：
 *  A. 标准 USD 商品（B0C3NFB3CZ）→ 实体绑定 + 6 字段快照 → 保存 → 读回
 *  B. BSR/评论动态商品（B0BG3C7CNJ）→ 同上（页面观察值随时间变化，存 snapshot 语义）
 *  C. 币种/结构异常商品（B07G4VTV2F JPY）→ price fail-closed（currency_not_usd），不保存价格
 *  D. 对抗：任务绑定 ASIN 与采集页面 ASIN 不一致 → asin_mismatch 硬拒绝（Wrong Entity = 0）
 *
 * 使用临时 DEMO_SANDBOX_STORE_PATH，不触碰真实 sandbox / dev.db；零 AI 调用。
 * 证据 JSON 输出到 docs/v3/changes/v3-3-amazon-browser-connector/smoke-evidence/。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import {
  BrowserEvidenceError,
  readBrowserEvidence,
  saveBrowserEvidence,
} from "@/lib/server/browserEvidence";
import {
  buildConfirmedSnapshot,
  collectBrowserEvidencePreview,
} from "@/lib/server/browserEvidenceCollect";

const RUN_AUTHORIZED = process.env.RUN_V33_BROWSER_SMOKE === "authorized-once";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "v3-3-browser-evidence-smoke");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

const DEMO = "smoke-visitor-a";
const SMOKE_ASINS = [
  { asin: "B0C3NFB3CZ", label: "A-standard-usd" },
  { asin: "B0BG3C7CNJ", label: "B-dynamic-bsr-reviews" },
  { asin: "B07G4VTV2F", label: "C-currency-structure-odd" },
];

function visitorContext() {
  return {
    mode: "demo" as const,
    token: `tok-${DEMO}`,
    demoAccessId: DEMO,
    isActive: true,
    isExpired: false,
    remainingAiCalls: 10,
  };
}

function toStorageVersion(taskId: string) {
  const task = getSandboxTask(DEMO, taskId);
  if (!task) throw new Error("task missing");
  return {
    resultJsonHash: createHash("sha256").update(task.resultJson, "utf8").digest("hex"),
    updatedAt: task.updatedAt,
  };
}

function evidenceDir() {
  const dir = resolve(process.cwd(), "docs", "v3", "changes", "v3-3-amazon-browser-connector", "smoke-evidence");
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("V3.3 browser evidence live smoke (authorized)", () => {
  it.runIf(RUN_AUTHORIZED)(
    "collects real Amazon detail pages, saves snapshots, and hard-rejects ASIN mismatch",
    async () => {
      const context = visitorContext();
      const output: Array<Record<string, unknown>> = [];

      for (const { asin, label } of SMOKE_ASINS) {
        const task = await createTrustedSandboxTask(DEMO, {
          type: "workflow",
          title: `V3.3 Smoke ${label}`,
          platform: "amazon",
          productUrl: `https://www.amazon.com/dp/${asin}`,
          materialText: "",
          source: "demo",
          score: 0,
          level: "low",
          oneLineSummary: "",
          resultJson: JSON.stringify({
            sourceMeta: { source: "opportunity", candidateId: `candidate-${label}` },
            candidateToTask: { version: 1, candidateId: `candidate-${label}` },
          }),
          productLifecycle: "new_candidate",
          decisionStatus: "pending",
        });
        const capturedAt = new Date().toISOString();

        // 1) collect（真实浏览器，单页导航）
        const preview = await collectBrowserEvidencePreview({ asin, capturedAt });
        const extraction = preview.extraction;

        // 2) 三一致硬门禁（正常路径应通过）
        const snapshot = buildConfirmedSnapshot({
          preview,
          taskAsin: asin,
          capturedAt,
          context,
        });
        expect(snapshot.entityBinding.bound).toBe(true);

        // 3) 保存 + 读回
        const saved = await saveBrowserEvidence({
          context,
          taskId: task.id,
          expectedStorageVersion: toStorageVersion(task.id),
          snapshot,
        });
        expect(saved.kind).toBe("saved");
        const reloaded = await readBrowserEvidence(context, task.id);
        expect(reloaded).not.toBeNull();
        expect(reloaded!.snapshots).toHaveLength(1);

        const record = {
          label,
          asin,
          pageStatus: extraction.pageStatus,
          entityBound: extraction.entityBound,
          bindingProof: extraction.bindingProof,
          currency: snapshot.currency,
          fields: {
            asin: { value: snapshot.fields.asin.value, status: snapshot.fields.asin.status },
            title: { value: snapshot.fields.title.value?.slice(0, 80) ?? null, status: snapshot.fields.title.status },
            price: { value: snapshot.fields.price.value, status: snapshot.fields.price.status, reason: snapshot.fields.price.reason },
            bsr: { value: snapshot.fields.bsr.value, status: snapshot.fields.bsr.status },
            rating: { value: snapshot.fields.rating.value, status: snapshot.fields.rating.status },
            reviewCount: { value: snapshot.fields.reviewCount.value, status: snapshot.fields.reviewCount.status },
          },
          failureReasons: snapshot.failureReasons,
          savedKind: saved.kind,
          reloadedSnapshots: reloaded!.snapshots.length,
        };
        output.push(record);

        // 断言：Wrong Entity = 0；页面 ok 且绑定成功时应有至少部分字段
        expect(extraction.entityBound).toBe(true);
        expect(extraction.pageStatus).toBe("ok");
        expect(snapshot.fields.asin.value).toBe(asin);
        // price 仅在 USD 且页面渲染时保存；非 USD / 未渲染 / 无法解析 → unknown（fail-closed，不保存价格）
        if (snapshot.currency === "USD") {
          expect(snapshot.fields.price.status).toBe("correct");
          expect(snapshot.fields.price.value).toBeGreaterThan(0);
        } else {
          expect(snapshot.fields.price.status).toBe("unknown");
          expect(snapshot.fields.price.value).toBeNull();
        }
      }

      // D) 对抗：任务绑定 ASIN 与采集页面 ASIN 不一致 → asin_mismatch 硬拒绝
      const sourceAsin = "B0C3NFB3CZ";
      const wrongAsin = "B0BG3C7CNJ";
      const capturedAt = new Date().toISOString();
      const previewOfWrongPage = await collectBrowserEvidencePreview({ asin: wrongAsin, capturedAt });
      let rejected = false;
      try {
        buildConfirmedSnapshot({
          preview: previewOfWrongPage,
          taskAsin: sourceAsin, // 任务绑定 A，但页面是 B
          capturedAt,
          context,
        });
      } catch (error) {
        rejected = error instanceof BrowserEvidenceError && error.code === "asin_mismatch";
      }
      expect(rejected).toBe(true);
      output.push({
        label: "D-adversarial-asin-mismatch",
        taskAsin: sourceAsin,
        pageAsin: previewOfWrongPage.extraction.pageAsin,
        pageUrlAsin: previewOfWrongPage.extraction.urlAsin,
        hardRejected: rejected,
      });

      writeFileSync(
        join(evidenceDir(), "smoke-result.json"),
        `${JSON.stringify({ runAt: new Date().toISOString(), results: output }, null, 2)}\n`,
        "utf8",
      );
      expect(output.length).toBe(SMOKE_ASINS.length + 1);
    },
    300_000,
  );
});