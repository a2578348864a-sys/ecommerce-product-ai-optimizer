/**
 * V4 P6 — Replay 导出脱敏测试夹具（P6-A 所有权）。
 *
 * 各夹具模拟不同泄漏类型（secret / PII / 联系人 / Owner 私密成本 / 本地路径 /
 * EXIF / 未授权图片）；仅用于测试，不含真实密钥、联系人或真实图片。
 * 顶层含允许的 Allowlist 键（candidate/report/facts/commercial/content/events/
 * gates/timeline/evidenceRefs），并在 cleanData 中附非 Allowlist 键以验证提取。
 */

/** 无泄漏的 completed run 导出快照（含非 Allowlist 键用于验证提取）。 */
export const cleanData: Record<string, unknown> = {
  candidate: {
    id: "cand_001",
    name: "不锈钢保温杯",
    source: "1688",
    link: "https://detail.1688.com/offer/123.html",
    score: 78,
    keyword: "vacuum cup",
    riskLevel: "medium",
    status: "pooled",
  },
  report: {
    reportId: "report_001",
    runId: "run_001",
    candidateId: "cand_001",
    marketplace: "US",
    generatedAt: "2026-08-01T00:00:00.000Z",
    summary: "市场研究报告（3 条已验证证据，1 项缺口）。",
    sections: [
      {
        title: "Amazon 页面证据",
        sentences: [
          { text: "B0ABC123：可见价格 $24.99。", evidenceRefs: ["ev_1"], kind: "factual" },
        ],
      },
    ],
    gaps: [{ question: "月销量未知", reason: "缺来源" }],
    conflicts: [],
    unknowns: ["月销量未知"],
    evidence: [
      {
        evidenceId: "ev_1",
        type: "amazon_page",
        entity: "B0ABC123",
        marketplace: "US",
        observedAt: "2026-08-01T00:00:00.000Z",
        sourceRef: "raw://ev_1",
        fields: { asin: "B0ABC123", price: 24.99, rating: 4.6 },
        warnings: [],
      },
    ],
    planRevision: 1,
  },
  facts: { count: 3, items: [{ id: "f_1", text: "可见价格 $24.99" }] },
  commercial: { suggestedPrice: 29.99 },
  content: { summary: "已生成商品标题与五点。", planRevision: 1 },
  events: [
    { seq: 1, type: "node_entered", node: "load_context", payloadJson: "{}", createdAt: "2026-08-01T00:00:00.000Z" },
    { seq: 2, type: "completed", node: "complete", payloadJson: "{}", createdAt: "2026-08-01T00:00:00.000Z" },
  ],
  gates: { gateA: "pass", gateB: "pending" },
  timeline: [{ at: "2026-08-01T00:00:00.000Z", kind: "node", node: "load_context" }],
  evidenceRefs: ["ev_1"],
  // 非 Allowlist 键（应被移除）：预算与 owner 作用域。
  budget: { maxCost: 10, usedCost: 3 },
  ownerScope: "owner@local",
};

/** secret 泄漏：key 级（password/apiKey）+ 值级（password=…, sk-…, token=…, ghp_…）。 */
export const secretData: Record<string, unknown> = {
  candidate: {
    id: "cand_002",
    name: "便携榨汁杯",
    source: "1688",
    link: "https://1688.com/offer/456",
    score: 66,
    keyword: "juice cup",
    riskLevel: "low",
    status: "pooled",
    password: "sup3rS3cret",
    apiKey: "sk-live-abcdef0123456789",
  },
  report: {
    summary: "供应商后台返回 password=pass123, api_key=sk-test-1234567890ab 的凭证。",
    sections: [
      { title: "备注", sentences: [{ text: "内部 token=abcdef123456，勿外传。", evidenceRefs: ["e1"], kind: "factual" }] },
    ],
  },
  events: [
    { seq: 1, type: "tool_result_validated", node: "dispatch_tool", payloadJson: JSON.stringify({ ok: true, credential: "sk-event-1111222233334444" }), createdAt: "2026-08-01T00:00:00.000Z" },
  ],
};

/** PII 泄漏：邮箱/手机/身份证号（key 级 + 值级）。 */
export const piiData: Record<string, unknown> = {
  candidate: {
    id: "cand_003",
    name: "蓝牙耳机",
    source: "amazon",
    link: "https://amazon.com/dp/B0XYZ",
    score: 80,
    keyword: "earbuds",
    riskLevel: "low",
    status: "pooled",
    email: "buyer@example.com",
    phone: "13800001111",
  },
  report: {
    summary: "联系客户 me@example.com 或 13800001111，身份证 110101199001011234。",
    sections: [{ title: "说明", sentences: [{ text: "历史订单手机号 13912345678。", evidenceRefs: ["e2"], kind: "factual" }] }],
  },
  facts: { note: "客户邮箱 vip@corp.com" },
};

/** 联系人泄漏：供应商联系对象（key 级 contact）+ 值级电话。 */
export const contactData: Record<string, unknown> = {
  commercial: {
    supplier: {
      name: "深圳供应商",
      region: "广东",
      contact: { name: "张三", phone: "+8613900000000", email: "zhangsan@supplier.cn" },
    },
    suggestedPrice: 29.99,
  },
  report: { summary: "供应商联系人张三，电话 +8613900000000。" },
};

/** Owner 私密成本泄漏：purchasePrice/unitCost/landedCost/profitMargin/moq →移除。 */
export const costData: Record<string, unknown> = {
  commercial: {
    suggestedPrice: 29.99,
    purchasePrice: 12.34,
    unitCost: 5.6,
    landedCost: 8.9,
    profitMargin: 0.5,
    moq: 100,
  },
  report: { summary: "采购价已定。" },
};

/** 本地路径泄漏：Windows 盘符路径（值级）+ POSIX 路径。 */
export const pathData: Record<string, unknown> = {
  report: {
    summary: "本地文件位于 " + String.raw`D:\secret\purchase.xlsx` + "，另一份在 C:\\data\\cost.txt。",
  },
  content: { assetPath: String.raw`D:\images\hero.jpg` },
};

/** EXIF 元数据泄漏：图片对象含 exif/gps 元数据 → 移除；内嵌 base64 含 EXIF 魔数 → 移除。 */
export const exifData: Record<string, unknown> = {
  content: {
    imagePlan: {
      images: [
        { ref: "https://img.example.com/hero.jpg", exif: { make: "Apple", model: "iPhone 15", gpsLatitude: 31.2, gpsLongitude: 121.5 } },
        { ref: "data:image/jpeg;base64,RXhpZgAAAAwAAAABAAAAAA==" },
        { ref: "https://img.example.com/ok.jpg" },
      ],
    },
  },
  report: { summary: "含内嵌图片。" },
};

/** 未授权图片泄漏：license=unlicensed → 阻断（scanOk=false）。 */
export const unlicensedData: Record<string, unknown> = {
  content: {
    imagePlan: {
      images: [
        { ref: "https://img.example.com/pirated.jpg", license: "unlicensed" },
        { ref: "https://img.example.com/cc.jpg", license: "cc-by" },
      ],
    },
  },
  report: { summary: "检测到 unlicensed image。" },
};
