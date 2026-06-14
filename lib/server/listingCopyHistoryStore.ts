import { Prisma, type ListingCopyHistory } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import type { ListingCopyResult } from "@/lib/types";

const defaultHistoryLimit = 10;
const maxHistoryLimit = 50;
const unnamedProduct = "\u672a\u547d\u540d\u5546\u54c1";

const allowedSourceInputKeys = new Set([
  "product",
  "profit",
  "listingPreview",
  "aiAnalysis",
  "keywords",
]);

const sensitiveKeyPattern =
  /api[_-]?key|authorization|bearer|token|secret|password|cookie|headers?|provider.*response|raw.*response|database[_-]?url|env[_-]?local|\.env|(^|[_-])errors?([_-]|$)|(^|[_-])stack([_-]|$)/i;

export type CreateListingCopyHistoryInput = {
  productId?: string;
  productName: string;
  data: ListingCopyResult;
  sourceInput?: unknown;
};

export type ListingCopyHistoryRecord = {
  id: string;
  productId: string | null;
  productName: string;
  title: string;
  data: ListingCopyResult;
  sourceInput: unknown | null;
  createdAt: Date;
  updatedAt: Date;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanItems(items: unknown) {
  return Array.isArray(items)
    ? items
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
    : [];
}

function normalizeListingCopyResult(data: ListingCopyResult): ListingCopyResult {
  const faq = Array.isArray(data.faq) ? data.faq : [];

  return {
    title: cleanText(data.title),
    bulletPoints: cleanItems(data.bulletPoints),
    description: cleanText(data.description),
    shortDescription: cleanText(data.shortDescription),
    keywords: cleanItems(data.keywords),
    longTailKeywords: cleanItems(data.longTailKeywords),
    faq: faq
      .filter(isRecord)
      .map((item) => ({
        question: cleanText(item.question),
        answer: cleanText(item.answer),
      }))
      .filter((item) => item.question || item.answer),
    packingList: cleanItems(data.packingList),
    afterSales: cleanText(data.afterSales),
    notes: cleanItems(data.notes),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonSafe(value: unknown): Prisma.InputJsonValue | undefined {
  if (value instanceof Error) return undefined;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;

  if (Array.isArray(value)) {
    return value
      .map(toJsonSafe)
      .filter((item): item is Prisma.InputJsonValue => item !== undefined);
  }

  if (!isRecord(value)) return undefined;

  const output: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(key)) continue;
    const safeValue = toJsonSafe(item);
    if (safeValue !== undefined) output[key] = safeValue;
  }

  return output;
}

function sanitizeSourceInput(value: unknown): Prisma.InputJsonValue | undefined {
  if (!isRecord(value)) return undefined;

  const output: Record<string, Prisma.InputJsonValue> = {};
  for (const key of allowedSourceInputKeys) {
    const safeValue = toJsonSafe(value[key]);
    if (safeValue !== undefined) output[key] = safeValue;
  }

  return Object.keys(output).length ? output : undefined;
}

function normalizeLimit(limit?: number) {
  if (limit === undefined) return defaultHistoryLimit;
  if (!Number.isFinite(limit)) return defaultHistoryLimit;
  const normalizedLimit = Math.trunc(limit);
  if (normalizedLimit < 1) return defaultHistoryLimit;
  return Math.min(normalizedLimit, maxHistoryLimit);
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asStringArray(value: string): string[] {
  const parsed = parseJson(value);

  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function asFaq(value: string): ListingCopyResult["faq"] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => {
      if (!isRecord(item)) return null;
      const question = typeof item.question === "string" ? item.question : "";
      const answer = typeof item.answer === "string" ? item.answer : "";
      return question || answer ? { question, answer } : null;
    })
    .filter((item): item is { question: string; answer: string } => item !== null);
}

function parseOptionalJson(value: string | null) {
  return value ? parseJson(value) : null;
}

function asInputJsonArray(value: string[]) {
  return value
    .map((item) => item.trim())
    .filter(Boolean);
}

function asInputFaq(value: ListingCopyResult["faq"]) {
  return value
    .map((item) => ({
      question: cleanText(item.question),
      answer: cleanText(item.answer),
    }))
    .filter((item) => item.question || item.answer);
}

function asStringArrayJson(value: string[]) {
  return stringifyJson(asInputJsonArray(value));
}

function asFaqJson(value: ListingCopyResult["faq"]) {
  return stringifyJson(asInputFaq(value));
}

function asJsonText(value: Prisma.InputJsonValue) {
  return stringifyJson(value);
}

function toHistoryRecord(row: ListingCopyHistory): ListingCopyHistoryRecord {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    title: row.title,
    data: {
      title: row.title,
      bulletPoints: asStringArray(row.bulletPoints),
      description: row.description,
      shortDescription: row.shortDescription,
      keywords: asStringArray(row.keywords),
      longTailKeywords: asStringArray(row.longTailKeywords),
      faq: asFaq(row.faq),
      packingList: asStringArray(row.packingList),
      afterSales: row.afterSales,
      notes: asStringArray(row.notes),
    },
    sourceInput: parseOptionalJson(row.sourceInput),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createListingCopyHistory(input: CreateListingCopyHistoryInput) {
  const data = normalizeListingCopyResult(input.data);
  const productName = cleanText(input.productName) || unnamedProduct;
  const sourceInput = sanitizeSourceInput(input.sourceInput);

  const row = await prisma.listingCopyHistory.create({
    data: {
      productId: cleanText(input.productId) || null,
      productName,
      title: data.title,
      bulletPoints: asStringArrayJson(data.bulletPoints),
      description: data.description,
      shortDescription: data.shortDescription,
      keywords: asStringArrayJson(data.keywords),
      longTailKeywords: asStringArrayJson(data.longTailKeywords),
      faq: asFaqJson(data.faq),
      packingList: asStringArrayJson(data.packingList),
      afterSales: data.afterSales,
      notes: asStringArrayJson(data.notes),
      ...(sourceInput === undefined ? {} : { sourceInput: asJsonText(sourceInput) }),
    },
  });

  return toHistoryRecord(row);
}

export async function listListingCopyHistories(limit?: number) {
  const rows = await prisma.listingCopyHistory.findMany({
    orderBy: { createdAt: "desc" },
    take: normalizeLimit(limit),
  });

  return rows.map(toHistoryRecord);
}

export async function deleteListingCopyHistory(id: string) {
  const normalizedId = id.trim();
  if (!normalizedId) return false;

  try {
    await prisma.listingCopyHistory.delete({
      where: { id: normalizedId },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return false;
    }

    throw error;
  }
}
