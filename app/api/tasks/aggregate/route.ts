import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { checkAccessPassword, getAccessContext } from "@/lib/server/accessPassword";
import { listSandboxTasks } from "@/lib/server/demoSandbox";

export const runtime = "nodejs";

type AggregateResult = {
  productName: string;
  found: boolean;
  sourcing: Record<string, unknown> | null;
  risk: Record<string, unknown> | null;
  product: Record<string, unknown> | null;
  viral: Record<string, unknown> | null;
  material: Record<string, unknown> | null;
};

function safeParseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractResultFields(record: {
  id: string;
  type: string;
  title: string | null;
  platform: string;
  oneLineSummary: string;
  score: number;
  level: string;
  resultJson: string;
  createdAt: Date | string;
}) {
  const parsed = safeParseJson(record.resultJson);
  return {
    id: record.id,
    title: record.title,
    platform: record.platform,
    oneLineSummary: record.oneLineSummary,
    score: record.score,
    level: record.level,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : record.createdAt.toISOString(),
    ...parsed,
  };
}

export async function GET(request: NextRequest) {
  const authError = checkAccessPassword(request);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });

  const ctx = getAccessContext(request);
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_access", message: "请先登录后再操作。" } },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const productName = (searchParams.get("productName") || "").trim();

  if (!productName) {
    return NextResponse.json(
      { ok: false, error: { code: "missing_productName", message: "请提供 productName 参数。" } },
      { status: 400 },
    );
  }

  try {
    const records = ctx.mode === "demo"
      ? listSandboxTasks(ctx.demoAccessId).filter((task) => task.title === productName)
      : await prisma.viralAnalysisRecord.findMany({
        where: {
          title: productName,
        },
        orderBy: { createdAt: "desc" },
      });

    const result: AggregateResult = {
      productName,
      found: records.length > 0,
      sourcing: null,
      risk: null,
      product: null,
      viral: null,
      material: null,
    };

    for (const record of records) {
      const fields = extractResultFields(record);

      switch (record.type) {
        case "sourcing":
          result.sourcing = fields;
          break;
        case "risk":
          result.risk = fields;
          break;
        case "product":
          result.product = fields;
          break;
        case "viral":
          result.viral = fields;
          break;
        case "material":
          result.material = fields;
          break;
        // summary type not included — it's the output, not input
      }
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    console.error("Aggregate query failed", error instanceof Error ? error.message.slice(0, 200) : error);
    return NextResponse.json(
      { ok: false, error: { code: "query_failed", message: "聚合查询失败，请稍后重试。" } },
      { status: 500 },
    );
  }
}
