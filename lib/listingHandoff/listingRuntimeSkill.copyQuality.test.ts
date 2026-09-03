import { describe, expect, it } from "vitest";
import { validateCopyQualityContract } from "@/lib/listingHandoff/listingRuntimeSkill";

describe("Copy Quality 红测：坏稿必须判不合格", () => {
  // HydroJug 坏稿复现（任务书锁定四句）
  const BAD_BULLETS = [
    "The straw lid option fits the everyday use of this Tumbler.",
    "The tumbler pairs with the Tumbler for everyday use.",
    "Easy cleaning matches the dishwasher safe option for this Tumbler.",
    "Available construction with the Tumbler of this Tumbler.",
  ];
  const FACTS = [
    { factId: "functional_feature", field: "functional_feature", label: "功能特性", value: "Leak Proof, Water Bottle" },
    { factId: "construction", field: "construction", label: "构造/做工", value: "Tumbler" },
    { factId: "care", field: "care", label: "清洁保养", value: "dishwasher safe" },
  ];

  it("红：option fits 模板句 → template_jargon", () => {
    const r = validateCopyQualityContract({
      title: "HydroJug Tumbler",
      bullets: BAD_BULLETS,
      description: "The HydroJug Tumbler with a straw lid for daily use. It has a leak proof water bottle feature.",
      facts: FACTS,
      typeLabel: "Tumbler",
      cannotSay: ["leakproof"],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "template_jargon")).toBe(true);
  });

  it("红：Tumbler pairs with Tumbler → self_reference / subject_object_duplicate", () => {
    const r = validateCopyQualityContract({
      title: "HydroJug Tumbler",
      bullets: ["The tumbler pairs with the Tumbler for everyday use."],
      description: "A Tumbler for daily use.",
      facts: FACTS,
      typeLabel: "Tumbler",
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "self_reference")).toBe(true);
  });

  it("红：Leak Proof 命中 cannotSay（同义规范化）", () => {
    const r = validateCopyQualityContract({
      title: "HydroJug Tumbler",
      bullets: ["The leak proof option fits the everyday use of this Tumbler."],
      description: "A Tumbler for daily use.",
      facts: FACTS,
      typeLabel: "Tumbler",
      cannotSay: ["leakproof"],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "cannot_say")).toBe(true);
  });

  it("红：duplicate_shopper_need — 两角色同一 shopperNeed → 不合格", () => {
    const r = validateCopyQualityContract({
      title: "HydroJug Tumbler",
      bullets: ["Good bullet one with the Tumbler.", "Good bullet two with the Tumbler."],
      description: "A Tumbler for daily use.",
      facts: FACTS,
      typeLabel: "Tumbler",
      bulletPlans: [
        { role: "core_outcome", shopperNeed: "日常使用需求", featureFactIds: ["functional_feature"] },
        { role: "ease_of_use", shopperNeed: "日常使用需求", featureFactIds: ["care"] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "duplicate_shopper_need")).toBe(true);
  });

  it("红：好稿（自然、互异、锚定事实）→ copy quality ok", () => {
    const goodFacts = [
      { factId: "functional_feature", field: "functional_feature", label: "功能特性", value: "straw lid with push-open mechanism" },
      { factId: "construction", field: "construction", label: "构造/做工", value: "double-wall vacuum insulation" },
      { factId: "care", field: "care", label: "清洁保养", value: "dishwasher safe" },
    ];
    const good = validateCopyQualityContract({
      title: "HydroJug 40oz Tumbler",
      bullets: [
        "The straw lid with push-open mechanism makes one-handed drinking easy.",
        "Double-wall vacuum insulation keeps drinks cold for hours without sweat.",
        "Dishwasher safe parts make cleaning quick after every use.",
      ],
      description: "This 40oz tumbler keeps beverages cold all day. The straw lid works for driving or gym use. Rinse and load the parts into the dishwasher.",
      facts: goodFacts,
      typeLabel: "Tumbler",
      cannotSay: ["leakproof"],
      bulletPlans: [
        { role: "core_outcome", shopperNeed: "单手饮用", featureFactIds: ["functional_feature"] },
        { role: "proof_or_fit", shopperNeed: "保冷时长", featureFactIds: ["construction"] },
        { role: "ease_of_use", shopperNeed: "快速清洁", featureFactIds: ["care"] },
      ],
    });
    expect(good.ok).toBe(true);
  });
});

describe("Listing natural editor v1 红测：真实截图形态必须被 Copy Quality 拒绝", () => {
  it("红：字段大写、悬空时间引导和 For care 模板组合不得放行", () => {
    const r = validateCopyQualityContract({
      title: "ukeetap UTO001 Organizer kitchen Plastic Silver",
      bullets: [
        "The organizer includes Expandable compartment design, multi-slot structure, molded in one piece from plastic.",
        "The organizer can hold approximately 40-50 pieces of everyday cutlery.",
        "After placing in the drawer, expand or contract to the sides according to the drawer width.",
        "Use the Organizer for storing knives, forks, spoons, and other cutlery in kitchen drawers.",
        "For care, Wipe with a damp cloth; clean with warm water and mild detergent if necessary.",
      ],
      description: "The UTO001 Organizer is an ukeetap product. The organizer measures 16.5\"D x 21\"W x 1.77\"H and weighs 0.81 kg.",
      facts: [],
      typeLabel: "Organizer",
    });
    expect(r.ok, JSON.stringify(r.issues)).toBe(false);
  });
});


/* ──────────────────────────────────────────────────────────────
 * 结构维度（本轮新增）：句法完整性 / 模板尾 / 句首大写
 *
 * 判定必须面向「英文短语形态」，不得对 ukeetap / Organizer / 具体完整字符串写特判。
 * 三类结构原因码：sentence_fragment / template_tail / sentence_capitalization。
 * ────────────────────────────────────────────────────────────── */

/** 结构用例统一事实集（值与 typeLabel 不同，避免误触 subject_object_duplicate） */
const STRUCT_FACTS = [
  { factId: "construction", field: "construction", label: "构造/做工", value: "built with an expandable multi-compartment design in molded plastic" },
  { factId: "capacity", field: "capacity", label: "容量", value: "stores about 40 to 50 pieces of cutlery" },
  { factId: "operation", field: "operation", label: "使用方式", value: "expands or collapses to the sides according to the drawer width" },
  { factId: "usage", field: "usage", label: "适用场景", value: "suitable for daily kitchen storage and carrying" },
  { factId: "care", field: "care", label: "清洁保养", value: "rinse with clean water and wipe dry" },
];

/** 干净描述（结构合法）：负例只想验证 bullet，描述不得成为噪声来源 */
const CLEAN_DESCRIPTION = "The organizer is made of molded plastic with multiple compartments. It stores about 40 to 50 pieces of cutlery.";

type StructCase = {
  name: string;
  bullet: string;
  code: "sentence_fragment" | "template_tail" | "sentence_capitalization";
};

/** 负例表：每行 = 一种病句形态 + 必须命中的结构原因码 */
const BAD_STRUCTURE_CASES: StructCase[] = [
  {
    name: "N1 主语后仅 with 短语、无谓语 → sentence_fragment",
    bullet: "The organizer with built with an expandable design for everyday use.",
    code: "sentence_fragment",
  },
  {
    name: "N2 同句同时是模板尾（for everyday use 收尾）→ template_tail",
    bullet: "The organizer with built with an expandable design for everyday use.",
    code: "template_tail",
  },
  {
    name: "N3 available with 拼接、缺正常谓语 → sentence_fragment",
    bullet: "The organizer available with rinse with clean water and wipe dry for practical use.",
    code: "sentence_fragment",
  },
  {
    name: "N4 available with 拼接同时命中模板尾 → template_tail",
    bullet: "The organizer available with rinse with clean water and wipe dry for practical use.",
    code: "template_tail",
  },
  {
    name: "N5 小写开头（谓语存在但句首未大写）→ sentence_capitalization",
    bullet: "expands or collapses to the sides according to the drawer width for standard use with this product every day.",
    code: "sentence_capitalization",
  },
  {
    name: "N6 小写开头 + for standard use ... every day 填充尾 → template_tail",
    bullet: "expands or collapses to the sides according to the drawer width for standard use with this product every day.",
    code: "template_tail",
  },
  {
    name: "N7 小写开头的 suitable 形容词短语（无谓语）→ sentence_capitalization",
    bullet: "suitable for daily kitchen storage and carrying for practical use with this product.",
    code: "sentence_capitalization",
  },
  {
    name: "N8 形容词短语无谓语 → sentence_fragment",
    bullet: "suitable for daily kitchen storage and carrying for practical use with this product.",
    code: "sentence_fragment",
  },
  {
    name: "N9 有谓语但以 for easy use with the X 填充收尾 → template_tail",
    bullet: "This stores about 40 to 50 pieces of cutlery for easy use with the Organizer.",
    code: "template_tail",
  },
];

describe("Copy Quality 结构维度（红测）：病句形态必须被拒并给出结构原因码", () => {
  for (const c of BAD_STRUCTURE_CASES) {
    it("红：" + c.name, () => {
      const r = validateCopyQualityContract({
        title: "ukeetap Organizer UTO001",
        bullets: [c.bullet],
        description: CLEAN_DESCRIPTION,
        facts: STRUCT_FACTS,
        typeLabel: "Organizer",
      });
      expect(r.ok, JSON.stringify(r.issues)).toBe(false);
      expect(r.issues.some((i) => i.code === c.code), "缺少结构原因码 " + c.code + "；实际=" + JSON.stringify(r.issues)).toBe(true);
      expect(r.issues.some((i) => i.code === c.code && i.target === "bullets")).toBe(true);
    });
  }

  it("红：description 中的无谓语句 → description 维度 sentence_fragment（不得只查五点）", () => {
    const r = validateCopyQualityContract({
      title: "ukeetap Organizer UTO001",
      bullets: ["The organizer stores about 40 to 50 pieces of cutlery."],
      description: "The organizer with an expandable multi-compartment design in molded plastic. It stores about 40 to 50 pieces of cutlery.",
      facts: STRUCT_FACTS,
      typeLabel: "Organizer",
    });
    expect(r.ok, JSON.stringify(r.issues)).toBe(false);
    expect(r.issues.some((i) => i.code === "sentence_fragment" && i.target === "description")).toBe(true);
  });

  it("红：description 中的模板尾 → description 维度 template_tail", () => {
    const r = validateCopyQualityContract({
      title: "ukeetap Organizer UTO001",
      bullets: ["The organizer stores about 40 to 50 pieces of cutlery."],
      description: "The organizer is made of molded plastic with multiple compartments. The organizer expands to the drawer width for practical use with this product.",
      facts: STRUCT_FACTS,
      typeLabel: "Organizer",
    });
    expect(r.ok, JSON.stringify(r.issues)).toBe(false);
    expect(r.issues.some((i) => i.code === "template_tail" && i.target === "description")).toBe(true);
  });

  it("红：description 句首小写 → description 维度 sentence_capitalization", () => {
    const r = validateCopyQualityContract({
      title: "ukeetap Organizer UTO001",
      bullets: ["The organizer stores about 40 to 50 pieces of cutlery."],
      description: "the Organizer is made of molded plastic with multiple compartments. It stores about 40 to 50 pieces of cutlery.",
      facts: STRUCT_FACTS,
      typeLabel: "Organizer",
    });
    expect(r.ok, JSON.stringify(r.issues)).toBe(false);
    expect(r.issues.some((i) => i.code === "sentence_capitalization" && i.target === "description")).toBe(true);
  });
});

/** 正例表：确定性受控句型产出的自然句，门禁不得误杀 */
const GOOD_STRUCTURE_SENTENCES: Array<{ name: string; bullet: string }> = [
  { name: "P1 is + built with 分词补语", bullet: "The organizer is built with an expandable multi-compartment design in molded plastic." },
  { name: "P2 三单谓语 stores", bullet: "The organizer stores about 40 to 50 pieces of cutlery." },
  { name: "P3 三单谓语 expands or collapses", bullet: "The organizer expands or collapses to the sides according to the drawer width." },
  { name: "P4 is + suitable for 形容词补语", bullet: "The organizer is suitable for daily kitchen storage and carrying." },
  { name: "P5 合法祈使句（For care, 引导）", bullet: "For care, rinse with clean water and wipe dry." },
  { name: "P6 自然句正文含 everyday use（非模板尾）不得误杀", bullet: "The reinforced handle supports everyday use." },
];

describe("Copy Quality 结构维度（正例）：自然句必须通过，门禁不得过严", () => {
  for (const c of GOOD_STRUCTURE_SENTENCES) {
    it("绿：" + c.name, () => {
      const r = validateCopyQualityContract({
        title: "ukeetap Organizer UTO001",
        bullets: [c.bullet],
        description: CLEAN_DESCRIPTION,
        facts: STRUCT_FACTS,
        typeLabel: "Organizer",
      });
      expect(r.ok, "自然句被误杀：" + JSON.stringify(r.issues)).toBe(true);
    });
  }

  it("绿：ukeetap 五条精确自然句合同整体通过（逐条 + 整体）", () => {
    const r = validateCopyQualityContract({
      title: "ukeetap Organizer UTO001",
      bullets: [
        "The organizer is built with an expandable multi-compartment design in molded plastic.",
        "The organizer stores about 40 to 50 pieces of cutlery.",
        "It expands or collapses to the sides according to the drawer width.",
        "This organizer is suitable for daily kitchen storage and carrying.",
        "For care, rinse with clean water and wipe dry.",
      ],
      description: CLEAN_DESCRIPTION,
      facts: STRUCT_FACTS,
      typeLabel: "Organizer",
    });
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });
});

describe("反向验证（防作弊）", () => {
  it("反向②：临时恢复 pairs with 模板 → Copy Quality 必须红", () => {
    const r = validateCopyQualityContract({
      title: "HydroJug Tumbler",
      bullets: ["This tumbler pairs with the Tumbler for easy use."],
      description: "A Tumbler for daily use.",
      facts: [{ factId: "included_components", field: "included_components", label: "组件", value: "Tumbler" }],
      typeLabel: "Tumbler",
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "subject_object_duplicate" || i.code === "template_jargon")).toBe(true);
  });

  it("反向③：复制同一 shopperNeed 到两角色 → 计划 Copy Quality 红", () => {
    const r = validateCopyQualityContract({
      title: "HydroJug Tumbler",
      bullets: ["Bullet one with Tumbler.", "Bullet two with Tumbler."],
      description: "Tumbler for daily use.",
      facts: [{ factId: "functional_feature", field: "functional_feature", label: "功能", value: "leakproof" }],
      typeLabel: "Tumbler",
      bulletPlans: [
        { role: "core_outcome", shopperNeed: "相同需求", featureFactIds: ["functional_feature"] },
        { role: "ease_of_use", shopperNeed: "相同需求", featureFactIds: ["functional_feature"] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "duplicate_shopper_need")).toBe(true);
  });

  it("反向①：Leak Proof 改词（同义）仍被 Claim Policy 拦截（prohibited）", async () => {
    const { classifyClaimPolicy } = await import("@/lib/listingHandoff/listingClaimPolicy");
    const verdict = classifyClaimPolicy({
      field: "functional_feature",
      value: "Leak Proof, Water Bottle",
      explicitHighRiskConfirmed: true,
      prohibited: ["leakproof"],
    });
    expect(verdict.tier).toBe("prohibited");
  });
});

describe("Organizer 结构性病句门禁", () => {
  it("红：重复谓语与错误引导框架必须被 Copy Quality 拒绝", () => {
    const r = validateCopyQualityContract({
      title: "ukeetap UTO001 Organizer",
      bullets: [
        "The organizer has a capacity of Can hold about 40-50 pieces of common cutlery.",
        "The organizer opens through its After placing in the drawer, expand or contract to the sides.",
        "The organizer is suitable for use at For storing knives, forks, and spoons in a kitchen drawer.",
        "For care, Wipe with a damp cloth; if necessary, clean with warm water.",
      ],
      description: "The organizer is made of plastic. It stores cutlery.",
      facts: [],
      typeLabel: "Organizer",
    });
    expect(r.ok, JSON.stringify(r.issues)).toBe(false);
    expect(r.issues.some((i) => ["sentence_fragment", "template_jargon", "template_filler"].includes(i.code))).toBe(true);
  });
});
/* ──────────────────────────────────────────────────────────────
 * 主句骨架谓语检测（本轮）：不得扫描整句任意 token 冒充谓语。
 *
 * 两个已知假绿：
 *  1. 商品名里的 Can / Will / May 被当成助动词 → 无谓语残片被放行；
 *  2. 从句里的 is 洗白主句残片（主句其实没有谓语）。
 * 判定必须落在**主句骨架**上：先按从属标记截断，再在截出的主句里找真谓语。
 * ────────────────────────────────────────────────────────────── */

/** 干净描述（结构合法）——负例只想验证 bullet，描述不得成为噪声来源 */
const CLEAN_DESC_2 = "The trash can is made of stainless steel. It holds about 30 liters of waste.";

type MainClauseCase = { name: string; bullet: string; typeLabel: string; expectOk: boolean; code?: string };

const MAIN_CLAUSE_CASES: MainClauseCase[] = [
  // ── 负例：商品名含 Can —— Can 是名词的一部分，不是助动词 ──
  {
    name: "N-C1 商品名 Trash Can：Can 不得充当谓语 → sentence_fragment",
    bullet: "The Trash Can with a liner for storage.",
    typeLabel: "Trash Can",
    expectOk: false,
    code: "sentence_fragment",
  },
  {
    name: "N-C2 商品名 Watering Can：仅 with 短语，无谓语 → sentence_fragment",
    bullet: "The Watering Can with a stainless steel spout.",
    typeLabel: "Watering Can",
    expectOk: false,
    code: "sentence_fragment",
  },
  // ── 负例：从句中的 is 不得洗白主句残片 ──
  {
    name: "N-S1 with 后的从句含 is，主句无谓语 → sentence_fragment",
    bullet: "The organizer with a lid that is durable.",
    typeLabel: "Organizer",
    expectOk: false,
    code: "sentence_fragment",
  },
  {
    name: "N-S2 which 从句含 is，主句无谓语 → sentence_fragment",
    bullet: "The organizer with a tray which is removable.",
    typeLabel: "Organizer",
    expectOk: false,
    code: "sentence_fragment",
  },
  // ── 正例：同一商品名 + 真实谓语 → 必须放行（证明不是对 Can 的整词封杀）──
  {
    name: "P-C1 商品名 Trash Can + 真实谓语 holds → 通过",
    bullet: "The trash can holds about 30 liters of waste.",
    typeLabel: "Trash Can",
    expectOk: true,
  },
  {
    name: "P-C2 商品名 Watering Can + 系动词 is → 通过",
    bullet: "The watering can is made of stainless steel.",
    typeLabel: "Watering Can",
    expectOk: true,
  },
  // ── 正例：主句含从句但主句自身有谓语 → 放行 ──
  {
    name: "P-S1 主句有谓语，从句另有 is → 通过",
    bullet: "The organizer includes a tray that is removable.",
    typeLabel: "Organizer",
    expectOk: true,
  },
  // ── 正例：自然句正文含 everyday use ──
  {
    name: "P-E1 supports everyday use（非模板尾）→ 通过",
    bullet: "The reinforced handle supports everyday use.",
    typeLabel: "Organizer",
    expectOk: true,
  },
  {
    name: "P-E2 The organizer is ... 自然陈述句 → 通过",
    bullet: "The organizer is made of molded plastic with multiple compartments.",
    typeLabel: "Organizer",
    expectOk: true,
  },
];

describe("Copy Quality 主句骨架谓语（红测）", () => {
  for (const c of MAIN_CLAUSE_CASES) {
    it((c.expectOk ? "绿：" : "红：") + c.name, () => {
      const r = validateCopyQualityContract({
        title: "Test product",
        bullets: [c.bullet],
        description: CLEAN_DESC_2,
        facts: [],
        typeLabel: c.typeLabel,
      });
      if (c.expectOk) {
        expect(r.ok, "自然句被误杀：" + JSON.stringify(r.issues)).toBe(true);
      } else {
        expect(r.ok, "病句未被拒：" + c.bullet).toBe(false);
        expect(
          r.issues.some((i) => i.code === c.code),
          "缺少原因码 " + c.code + "；实际=" + JSON.stringify(r.issues),
        ).toBe(true);
      }
    });
  }

  it("红：Description 同样按主句骨架检查（含 Can 商品名的残片不得漏检）", () => {
    const r = validateCopyQualityContract({
      title: "Test product",
      bullets: ["The Trash Can holds about 30 liters of waste."],
      description: "The Trash Can with a liner for storage. It holds about 30 liters of waste.",
      facts: [],
      typeLabel: "Trash Can",
    });
    expect(r.ok, JSON.stringify(r.issues)).toBe(false);
    expect(r.issues.some((i) => i.code === "sentence_fragment" && i.target === "description")).toBe(true);
  });
});

describe("R3 Copy Quality：描述整句复读与机械分词尾必须被拒（红）", () => {
  it("红4：描述整句逐字复读任一条五点 → description_bullet_repeat", async () => {
    const { validateCopyQualityContract } = await import("@/lib/listingHandoff/listingRuntimeSkill");
    const r = validateCopyQualityContract({
      title: "ukeetap Organizer",
      bullets: ["The organizer fits most medium and large kitchen drawers.", "The organizer is made of plastic.", "Wipe with a damp cloth."],
      description: "It is a plastic organizer for cutlery. The organizer fits most medium and large kitchen drawers.",
    });
    expect(r.ok, JSON.stringify(r.issues)).toBe(false);
    expect(r.issues.some((i) => i.code === "description_bullet_repeat"), JSON.stringify(r.issues)).toBe(true);
  });

  it("红5：含机械分词尾（, molded in …）的五点 → mechanical_structure", async () => {
    const { validateCopyQualityContract } = await import("@/lib/listingHandoff/listingRuntimeSkill");
    const r = validateCopyQualityContract({
      title: "ukeetap Organizer",
      bullets: ["The organizer has an expandable compartment design, molded in one piece from plastic.", "The organizer keeps 40 pieces of cutlery.", "Wipe with a damp cloth."],
      description: "The organizer is made of plastic.",
    });
    expect(r.ok, JSON.stringify(r.issues)).toBe(false);
    expect(r.issues.some((i) => i.code === "mechanical_structure"), JSON.stringify(r.issues)).toBe(true);
  });
});

describe("V2 Copy Quality：异常大写/机械and/重复主语/空洞尾句/标题从句（红）", () => {
  it("红6：正文普通名词异常大写（小写形态并存证明是普通名词）→ abnormal_capitalization", async () => {
    const { validateCopyQualityContract } = await import("@/lib/listingHandoff/listingRuntimeSkill");
    const r = validateCopyQualityContract({
      title: "ukeetap Drawer Organizer",
      bullets: ["The Organizer holds 40 pieces of cutlery.", "The Organizer expands to the drawer width.", "The Organizer stores cutlery after meals.", "Wipe with a damp cloth."],
      description: "It is a plastic organizer for a kitchen drawer.",
    });
    expect(r.ok, JSON.stringify(r.issues)).toBe(false);
    expect(r.issues.some((i) => i.code === "abnormal_capitalization"), JSON.stringify(r.issues)).toBe(true);
  });

  it("红7：机械 and 拼接（has … and is molded…）→ mechanical_and_splice", async () => {
    const { validateCopyQualityContract } = await import("@/lib/listingHandoff/listingRuntimeSkill");
    const r = validateCopyQualityContract({
      title: "ukeetap Organizer",
      bullets: ["The organizer has an expandable compartment design with multiple slots and is molded in one piece from plastic.", "The organizer keeps 40 pieces of cutlery.", "Wipe with a damp cloth."],
      description: "The organizer is made of plastic.",
    });
    expect(r.ok, JSON.stringify(r.issues)).toBe(false);
    expect(r.issues.some((i) => i.code === "mechanical_and_splice"), JSON.stringify(r.issues)).toBe(true);
  });

  it("红8：≥3 条五点以同一主语开头 → repeated_subject", async () => {
    const { validateCopyQualityContract } = await import("@/lib/listingHandoff/listingRuntimeSkill");
    const r = validateCopyQualityContract({
      title: "ukeetap Organizer",
      bullets: [
        "The organizer holds 40 pieces of cutlery.",
        "The organizer expands to the drawer width.",
        "The organizer stores knives and forks.",
        "The organizer is made of plastic.",
        "Wipe with a damp cloth.",
      ],
      description: "The organizer is made of plastic. It fits most kitchen drawers.",
    });
    expect(r.ok, JSON.stringify(r.issues)).toBe(false);
    expect(r.issues.some((i) => i.code === "repeated_subject"), JSON.stringify(r.issues)).toBe(true);
  });

  it("红9：空洞尾句（…and more. / etc.）→ hollow_tail；标题含操作从句 → title_clause", async () => {
    const { validateCopyQualityContract } = await import("@/lib/listingHandoff/listingRuntimeSkill");
    const r1 = validateCopyQualityContract({
      title: "ukeetap Organizer",
      bullets: ["The organizer stores cutlery, gadgets and more.", "The organizer is made of plastic.", "Wipe with a damp cloth."],
      description: "The organizer is made of plastic.",
    });
    expect(r1.issues.some((i) => i.code === "hollow_tail"), JSON.stringify(r1.issues)).toBe(true);
    const r2 = validateCopyQualityContract({
      title: "ukeetap Drawer Organizer, Fits Most Kitchen Drawers",
      bullets: ["The organizer holds 40 pieces of cutlery.", "The organizer is made of plastic.", "Wipe with a damp cloth."],
      description: "The organizer is made of plastic.",
    });
    expect(r2.issues.some((i) => i.code === "title_clause"), JSON.stringify(r2.issues)).toBe(true);
  });
});

describe("单件自身句 Copy Quality 兜底与大小写（第十版）", () => {
  const base = {
    title: "ukeetap UTO001 Expandable Silverware Organizer",
    description: "The ukeetap UTO001 is a plastic silverware organizer.",
    cannotSay: [],
    facts: [
      { factId: "product_type", field: "product_type", label: "类型", value: "Organizer" },
      { factId: "included_components", field: "included_components", label: "随附", value: "1 Expandable Silverware Organizer" },
    ],
    bulletPlans: [],
    typeLabel: "organizer",
  };
  it("漏过上游的单件自身句被 Copy Quality 独立拒绝", () => {
    const result = validateCopyQualityContract({ ...base, bullets: [
      "Molded in one piece from plastic, the organizer has an expandable compartment design.",
      "The organizer holds approximately 40-50 pieces of cutlery.",
      "The organizer stores knives, forks, and spoons in a kitchen drawer.",
      "Wipe clean with a damp cloth when needed.",
      "The included component is 1 expandable silverware organizer.",
    ] });
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("trivial_single_item");
    expect(result.ok).toBe(false);
  });
  it("真配件句不被误杀", () => {
    const result = validateCopyQualityContract({ ...base, bullets: [
      "The organizer has an expandable compartment design for drawers.",
      "The organizer holds approximately 40-50 pieces of cutlery.",
      "The organizer stores knives, forks, and spoons in a kitchen drawer.",
      "A removable lid is included with the organizer.",
      "Wipe clean with a damp cloth when needed.",
    ] });
    expect(result.issues.map((i) => i.code)).not.toContain("trivial_single_item");
  });
  it("品牌式 CamelCase 不误杀，普通商品名系统性大写被拦截", () => {
    const camel = validateCopyQualityContract({ ...base, bullets: [
      "The organizer works with the SoftSip lid family for daily use.",
      "The organizer holds approximately 40-50 pieces of cutlery.",
      "The organizer stores knives, forks, and spoons in a kitchen drawer.",
      "Wipe clean with a damp cloth when needed.",
      "The organizer keeps the SoftSip area tidy on the countertop.",
    ] });
    expect(camel.issues.map((i) => i.code)).not.toContain("abnormal_capitalization");
    const abnormal = validateCopyQualityContract({ ...base, bullets: [
      "The Organizer has an expandable compartment design with multiple slots.",
      "The Organizer holds approximately 40-50 pieces of cutlery.",
      "The Organizer stores knives, forks, and spoons in a kitchen drawer.",
      "Wipe the Organizer clean with a damp cloth when needed.",
      "The Organizer fits most medium and large kitchen drawers.",
    ] });
    expect(abnormal.issues.map((i) => i.code)).toContain("abnormal_capitalization");
  });

  describe("False-Pass 专项红测：五类病句必须被 Copy Quality 主动拒绝", () => {
    const FP_FACTS = [
      { factId: "brand", field: "brand", label: "品牌", value: "Owala" },
      { factId: "product_type", field: "product_type", label: "商品类型", value: "Water Bottle" },
      { factId: "operation", field: "operation", label: "操作", value: "push-button open with built-in straw for upright sipping" },
      { factId: "usage", field: "usage", label: "使用场景", value: "daily hydration at home or office" },
      { factId: "compatibility", field: "compatibility", label: "兼容性", value: "cup holder-friendly base" },
      { factId: "functional_feature", field: "functional_feature", label: "功能特性", value: "MagSlider lid with magnetic slide mechanism" },
      { factId: "usage2", field: "usage", label: "使用场景", value: "daily commuting and office desk use" },
      { factId: "color", field: "color_or_variant", label: "颜色", value: "Very, Very Dark" },
    ];

    it("红1: opens through its ... mechanism 动词机制套壳必须被拒绝", () => {
      const r = validateCopyQualityContract({
        title: "Owala FreeSip Water Bottle",
        bullets: [
          "It opens through its push-button open with built-in straw for upright sipping mechanism.",
          "Double-wall vacuum insulation keeps liquids cold for hours.",
          "A leakproof lid seals tightly for everyday travel.",
        ],
        description: "A quality water bottle for everyday use. It has a durable finish.",
        facts: FP_FACTS,
        typeLabel: "Water Bottle",
      });
      expect(r.ok).toBe(false);
      expect(r.issues.some((i) => i.code === "template_jargon" || i.code === "nested_mechanism")).toBe(true);
    });

    it("红2: suitable for use at daily... / use at ... use 介词错误与口吃必须被拒绝", () => {
      const r1 = validateCopyQualityContract({
        title: "Owala FreeSip Water Bottle",
        bullets: [
          "This water bottle is suitable for use at daily hydration at home or office.",
          "Double-wall vacuum insulation keeps liquids cold for hours.",
          "Hand wash only for optimal maintenance.",
        ],
        description: "A quality water bottle for everyday use. It has a durable finish.",
        facts: FP_FACTS,
        typeLabel: "Water Bottle",
      });
      expect(r1.ok).toBe(false);
      expect(r1.issues.some((i) => i.code === "template_jargon" || i.code === "invalid_usage_phrase")).toBe(true);

      const r2 = validateCopyQualityContract({
        title: "YETI Rambler Tumbler",
        bullets: [
          "This tumbler is suitable for use at daily commuting and office desk use.",
          "Double-wall vacuum insulation keeps liquids cold for hours.",
          "Dishwasher safe parts make cleaning simple.",
        ],
        description: "A quality tumbler for everyday use. It has a durable finish.",
        facts: FP_FACTS,
        typeLabel: "Tumbler",
      });
      expect(r2.ok).toBe(false);
      expect(r2.issues.some((i) => i.code === "template_jargon" || i.code === "invalid_usage_phrase")).toBe(true);
    });

    it("红3: [product] fits ... base 主客体倒置必须被拒绝", () => {
      const r = validateCopyQualityContract({
        title: "Owala FreeSip Water Bottle",
        bullets: [
          "The water bottle fits cup holder-friendly base.",
          "Double-wall vacuum insulation keeps liquids cold for hours.",
          "Hand wash only for optimal maintenance.",
        ],
        description: "A quality water bottle for everyday use. It has a durable finish.",
        facts: FP_FACTS,
        typeLabel: "Water Bottle",
      });
      expect(r.ok).toBe(false);
      expect(r.issues.some((i) => i.code === "template_jargon" || i.code === "part_fit_inversion")).toBe(true);
    });

    it("红4: features MagSlider lid 裸奔无冠词必须被拒绝", () => {
      const r = validateCopyQualityContract({
        title: "YETI Rambler Tumbler",
        bullets: [
          "It features MagSlider lid with magnetic slide mechanism.",
          "Double-wall vacuum insulation keeps liquids cold for hours.",
          "Dishwasher safe parts make cleaning simple.",
        ],
        description: "A quality tumbler for everyday use. It has a durable finish.",
        facts: FP_FACTS,
        typeLabel: "Tumbler",
      });
      expect(r.ok).toBe(false);
      expect(r.issues.some((i) => i.code === "template_jargon" || i.code === "missing_determiner")).toBe(true);
    });

    it("红5: 描述中出现上述五类病句同样必须被拒绝", () => {
      const r = validateCopyQualityContract({
        title: "Owala FreeSip Water Bottle",
        bullets: [
          "The water bottle is made of stainless steel.",
          "Double-wall vacuum insulation keeps liquids cold for hours.",
          "Hand wash only for optimal maintenance.",
        ],
        description: "The Owala FreeSip is a stainless steel water bottle. It has double-wall vacuum insulation. The water bottle fits cup holder-friendly base. It measures 3.24\"W x 10.68\"H.",
        facts: FP_FACTS,
        typeLabel: "Water Bottle",
      });
      expect(r.ok).toBe(false);
      expect(r.issues.some((i) => i.target === "description" && (i.code === "template_jargon" || i.code === "part_fit_inversion"))).toBe(true);
    });

    it("红6: 合法自然句与 Very, Very Dark 不得被误伤", () => {
      const r = validateCopyQualityContract({
        title: "Owala FreeSip Water Bottle, 24 oz, Stainless Steel, Very, Very Dark",
        bullets: [
          "The water bottle is made of stainless steel with a Very, Very Dark finish.",
          "Double-wall vacuum insulation keeps liquids cold for hours.",
          "The water bottle has a cup holder-friendly base for convenient travel.",
          "It features a MagSlider lid with a magnetic slide mechanism.",
          "This water bottle is designed for daily hydration at home or in the office.",
        ],
        description: "The Owala FreeSip is a stainless steel water bottle with double-wall insulation. The water bottle has a cup holder-friendly base. It measures 3.24\"W x 10.68\"H and weighs 13.6 oz.",
        facts: FP_FACTS,
        typeLabel: "Water Bottle",
      });
      expect(r.ok).toBe(true);
      expect(r.issues).toEqual([]);
    });
  });
});
