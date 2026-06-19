import "server-only";

export type AlphaRiskTextInput = {
  productName?: string;
  category?: string;
  claims?: string;
  description?: string;
};

const PET_TERMS = [
  "宠物", "猫", "狗", "猫狗", "pet", "cat", "dog",
];

const PET_FOOD_CONTACT_TERMS = [
  "宠物慢食碗", "慢食碗", "慢食盆", "宠物碗", "宠物餐具", "宠物喂食",
  "喂食碗", "猫碗", "狗碗", "硅胶宠物碗", "塑料宠物碗",
  "pet slow feeder", "slow feeder", "pet bowl", "dog bowl", "cat bowl",
  "feeding bowl", "pet feeding", "food contact", "食品接触", "入口接触",
  "进食接触", "长期舔咬", "舔咬", "food grade",
];

const PET_FOOD_CONTACT_NEGATIONS = [
  "不接触食物", "非入口", "不入口", "non-food", "not food contact",
  "no food contact", "not for feeding",
];

export function buildRiskText(input: AlphaRiskTextInput) {
  return [
    input.productName,
    input.category,
    input.claims,
    input.description,
  ].filter(Boolean).join(" ").toLowerCase();
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

export function isPetFoodContactProduct(input: AlphaRiskTextInput) {
  const text = buildRiskText(input);
  if (!text || includesAny(text, PET_FOOD_CONTACT_NEGATIONS)) return false;
  return includesAny(text, PET_TERMS) && includesAny(text, PET_FOOD_CONTACT_TERMS);
}

export function classifyKeywordFallbackRisk(input: AlphaRiskTextInput): "red" | "yellow" {
  const text = buildRiskText(input)
    .replace(/无电池|不含电池|没有电池|no battery|without battery/g, "")
    .replace(/无儿童|非儿童|不适合儿童|不是儿童|no children|not for children|non-child/g, "")
    .replace(/无磁|不含磁|没有磁铁|no magnet|without magnet/g, "")
    .replace(/无液体|不含液体|no liquid|without liquid/g, "");
  const redTerms = [
    "儿童", "婴儿", "婴幼儿", "母婴", "宝宝", "小孩", "幼儿",
    "children", "child", "kids", "baby", "infant", "toddler",
    "电池", "锂电池", "充电", "电动", "带电", "电子",
    "battery", "lithium", "rechargeable", "electric", "electronic",
    "磁铁", "磁吸", "磁性", "magnet", "magnetic",
    "医疗", "医用", "治疗", "美妆", "化妆品", "medical", "cosmetic",
  ];

  if (includesAny(text, redTerms)) return "red";
  return "yellow";
}

export function sanitizeUnsupportedCertificationClaims(text: string) {
  if (!text) return text;

  const reviewMessage = "相关测试报告/合规文件需向供应商索取并人工复核，未验证前不要写入 listing 承诺";
  const safetyReviewMessage = "安全性和材质声明需人工复核，未验证前不要写入 listing 承诺";
  const standardGroup = String.raw`(?:FDA|CE|FCC|CPC|ASTM(?:\s*F963)?|CPSIA|RoHS)(?:\s*(?:\/|、|,|，|和|及)\s*(?:FDA|CE|FCC|CPC|ASTM(?:\s*F963)?|CPSIA|RoHS))*`;

  return text
    .replace(/\bFDA\s+(?:approved|certified|registered)\b/gi, "certification details need supplier verification")
    .replace(/\bCE\s+(?:certified|marked|compliant)\b/gi, "compliance details need supplier verification")
    .replace(/\bRoHS\s+(?:certified|compliant)\b/gi, "compliance details need supplier verification")
    .replace(/\bCPC\s+certified\b/gi, "children product documents need supplier verification")
    .replace(/\b(?:ASTM|ASTM\s+F963)\s+certified\b/gi, "safety standard documents need supplier verification")
    .replace(/\bmeets\s+ASTM\b/gi, "safety standard documents need supplier verification")
    .replace(/\bCPSIA\s+(?:certified|compliant)\b/gi, "children product documents need supplier verification")
    .replace(/\bEN71\s+(?:certified|compliant)\b/gi, "toy safety documents need supplier verification")
    .replace(/\b100%\s*safe\b/gi, "safety must be verified before listing")
    .replace(/\babsolutely\s+safe\b/gi, "safety must be verified before listing")
    .replace(/\bcompletely\s+safe\b/gi, "safety must be verified before listing")
    .replace(/\bno\s+risk\b/gi, "risk must be reviewed before listing")
    .replace(/\bzero\s+risk\b/gi, "risk must be reviewed before listing")
    .replace(/\brisk-free\b/gi, "service terms must follow platform policy")
    .replace(/\bnon-toxic\s+guaranteed\b/gi, "material safety needs supplier verification")
    .replace(/\bfood\s+grade\s+guaranteed\b/gi, "food-contact material documents need supplier verification")
    .replace(/\bguaranteed\s+safe\b/gi, "safety must be verified before listing")
    .replace(/\bchild-safe\s+certified\b/gi, "children product documents need supplier verification")
    .replace(new RegExp(`(?:通过|符合)\\s*${standardGroup}\\s*(?:认证|标准|要求|规范|检测|测试)?`, "gi"), reviewMessage)
    .replace(new RegExp(`${standardGroup}\\s*(?:认证|认证齐全)`, "gi"), (match) => {
      const standard = match.replace(/认证齐全|认证/gi, "").trim();
      return `${standard} ${reviewMessage}`;
    })
    .replace(/已通过认证/g, "需人工复核认证文件，未验证前不要写入 listing 承诺")
    .replace(/已认证/g, "需人工复核认证文件，未验证前不要写入 listing 承诺")
    .replace(/符合认证/g, "需人工复核认证文件，未验证前不要写入 listing 承诺")
    .replace(/安全认证齐全/g, safetyReviewMessage)
    .replace(/认证齐全/g, reviewMessage)
    .replace(/儿童安全认证/g, "儿童相关安全文件需人工复核，未验证前不要写入 listing 承诺")
    .replace(/100%\s*安全/g, safetyReviewMessage)
    .replace(/绝对安全/g, safetyReviewMessage)
    .replace(/无毒保证/g, "材质安全声明需向供应商索取检测报告并人工复核，未验证前不要写入 listing 承诺")
    .replace(/食品级保证/g, "食品接触材料文件需向供应商索取检测报告并人工复核，未验证前不要写入 listing 承诺")
    .replace(/婴幼儿安全/g, "婴幼儿相关安全要求需人工复核，未验证前不要写入 listing 承诺");
}

export function sanitizeStringArray(values: string[]) {
  return values.map((value) => sanitizeUnsupportedCertificationClaims(value));
}

export function appendUnique(values: string[], additions: string[], maxItems?: number) {
  const seen = new Set(values.map((value) => value.toLowerCase()));
  const merged = [...values];

  for (const addition of additions) {
    const item = addition.trim();
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    if (maxItems && merged.length >= maxItems) break;
  }

  return maxItems ? merged.slice(0, maxItems) : merged;
}
