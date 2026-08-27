/**
 * 商品创作补充（五个字段）唯一前端状态模型。
 * 只表达“文案方向/运营意图”，不是商品事实；不包含 schema/requestId/版本等内部字段。
 */
export type ListingCreationBriefForm = {
  coreSellingPoint: string;
  targetAudience: string;
  useScenario: string;
  differentiation: string;
  contentEmphasis: string;
};

export function emptyListingCreationBrief(): ListingCreationBriefForm {
  return { coreSellingPoint: "", targetAudience: "", useScenario: "", differentiation: "", contentEmphasis: "" };
}

const FIELDS: Array<keyof ListingCreationBriefForm> = [
  "coreSellingPoint",
  "targetAudience",
  "useScenario",
  "differentiation",
  "contentEmphasis",
];

const EMPTY = emptyListingCreationBrief();

export const EMPTY_LISTING_CREATION_BRIEF: Readonly<ListingCreationBriefForm> = EMPTY;

/** 只提取五个字符串字段；忽略 schema/未知字段；不修改输入；不截断。 */
export function normalizeListingCreationBriefForm(value: unknown): ListingCreationBriefForm {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyListingCreationBrief();
  const record = value as Record<string, unknown>;
  const out = emptyListingCreationBrief();
  for (const field of FIELDS) {
    const v = record[field];
    out[field] = typeof v === "string" ? v : "";
  }
  return out;
}

/** 只比较五字段（逐字符）；不依赖键顺序；任何字段不同即 false。 */
export function listingCreationBriefFormsEqual(a: ListingCreationBriefForm, b: ListingCreationBriefForm): boolean {
  return FIELDS.every((field) => a[field] === b[field]);
}

/**
 * GET 回填决策（唯一入口）：
 * - preserveEdits=false：incoming 同时覆盖 editing 与 saved；
 * - preserveEdits=true 且当前有未保存修改（editing !== 旧 saved）：保留 editing，saved 更新为 incoming；
 * - preserveEdits=true 且无未保存修改：editing/saved 都采用 incoming。
 */
export function resolveLoadedListingCreationBrief({
  incoming,
  editing,
  saved,
  preserveEdits,
}: {
  incoming: unknown;
  editing: ListingCreationBriefForm;
  saved: ListingCreationBriefForm;
  preserveEdits: boolean;
}): { editing: ListingCreationBriefForm; saved: ListingCreationBriefForm } {
  const next = normalizeListingCreationBriefForm(incoming);
  if (!preserveEdits || listingCreationBriefFormsEqual(editing, saved)) {
    return { editing: next, saved: next };
  }
  return { editing, saved: next };
}
