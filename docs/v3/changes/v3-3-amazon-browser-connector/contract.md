# V3.3 — Browser Evidence 最小合同（browser-evidence.v1）

> 正式写入前冻结的最小合同（参照 competitor-evidence.v1 模式）。优先复用现有 resultJson/versioned namespace；
> **禁止新增 Prisma Evidence 表**。实现与本文不一致视为规格做偏。

## 1. 数据结构 / version

- schema：`browser-evidence.v1`
- 命名空间：`taskResultJson.browserEvidence`（taskResultJsonMutation.ts OWNED_NAMESPACES 新增 writer `browser-evidence` → `["browserEvidence"]`）
- 产品定位：**Local Human-Assisted Amazon Browser Evidence Connector**（本机服务启动/控制**隔离**浏览器；**不**读取用户已打开浏览器 Tab；部署到远程公网后如需读本机 Tab 须另行评估 extension/bridge——见 integration-precheck.md）
- 结构：

```ts
type BrowserEvidenceV1 = {
  schema: "browser-evidence.v1";
  version: 1;
  /** 绑定候选（冗余引用，用于研究上下文投影；权威绑定为 taskId） */
  candidateId: string | null;
  /** 绑定任务中的商品 ASIN（与快照 ASIN 必须一致才允许保存） */
  targetAsin: string | null;
  /** 快照列表（新快照追加，不覆盖历史；最新在前） */
  snapshots: BrowserEvidenceSnapshot[];
  updatedAt: string; // ISO 8601
};

type BrowserEvidenceSnapshot = {
  evidenceId: string;          // uuid
  sourceType: "browser";
  sourceSite: "amazon";
  pageUrl: string;
  marketplace: string | null;  // amazon.com / null
  locale: string | null;       // 页面语言（可识别时）
  currency: "USD" | "JPY" | "other" | null; // 页面价格币种
  entityBinding: {
    bound: boolean;            // URL ASIN + 页面 ASIN 锚点双一致
    urlAsin: string | null;
    pageAsin: string | null;
    proof: { urlMatchesExpected: boolean; pageAnchorMatchesExpected: boolean; productContainerFound: boolean };
  };
  collectorVersion: string;
  capturedAt: string;          // ISO 8601（页面观察时刻）
  fields: {
    asin:      BrowserEvidenceField<string>;
    title:     BrowserEvidenceField<string>;
    price:     BrowserEvidenceField<number>;   // 仅 USD 保存；JPY/other → unknown(currency_not_usd)
    bsr:       BrowserEvidenceField<number>;
    rating:    BrowserEvidenceField<number>;
    reviewCount: BrowserEvidenceField<number>;
  };
  failureReasons: string[];    // 各字段 unknown 原因（页面级汇总，不含内部 selector）
  confirmedBy: { mode: "owner" | "visitor"; actorRef: string };
  confirmedAt: string;
};

type BrowserEvidenceField<T> = {
  value: T | null;
  status: "correct" | "unknown";
  reason: string | null;       // entity_binding_unproven / currency_not_usd / selector_not_found / format_invalid
  nature: "snapshot";          // 页面观察值，非永久事实
};
```

## 2. 与 owner / task / candidate 的绑定关系

- 权威绑定：**taskId**（数据存于该 task 的 resultJson；owner → Prisma ViralAnalysisRecord.resultJson / visitor → sandbox task.resultJson，经 taskResultJsonMutation 按主体分流）。
- 冗余引用：`candidateId`（来自该 task 的研究记录 candidateId；仅用于投影，读取侧以 task 为准）。
- 写入与读取都必须走 `mutateTaskResultJson`（writer 所有权契约 + 乐观并发 expectedStorageVersion），禁止绕过。

## 3. 字段性质

- 6 字段上限：asin / title / price / bsr / rating / reviewCount。**不扩字段**（Coupon/Seller/Variation/Dimensions/Brand/Badge/Estimated* 等一律不收）。
- 全部字段 `nature = "snapshot"`：表示"capturedAt 时页面观察值"，**不代表永久事实**。
- price / bsr / rating / reviewCount 必须带 capturedAt；页面币种与目标市场不一致（如 JPY）时 price 不保存。

## 4. 实体绑定硬门禁

- 保存前必须证明：value → 当前页面 → 当前页面属于 ASIN X。
- binding：URL ASIN === 页面 ASIN 锚点 === 任务目标 ASIN（targetAsin）三一致。
- 无法证明 → 该字段 value=null、status=unknown、reason=entity_binding_unproven；页面级失败（identity）→ 整个 snapshot 不保存。
- **Wrong Entity = 0 是硬门禁**：当前页面 ASIN ≠ 任务 ASIN → save 拒绝（hard reject），不提供"仍然保存"按钮。

## 5. dedupe / 重复采集

- 幂等：同 `candidateId + targetAsin + field + capturedAt + pageUrl` 的重复保存 → 返回幂等成功（不重复写入）。
- 新采集（新 capturedAt）→ 追加为**新 snapshot**（latest + history 模式）；不覆盖历史 snapshot。
- 上限：snapshots ≤ 20；超出返回 `browser_evidence_snapshot_limit`（用户可删除旧快照）。

## 5.1 有界存储（Integration Precheck 冻结，防 resultJson 无限增长）

| 规则 | 值 |
|---|---|
| allowed fields | 6（asin/title/price/bsr/rating/reviewCount）；写入侧超白名单字段 → `invalid_snapshot`(422) 拒绝，**不自动清洗** |
| per snapshot payload 上限 | `BROWSER_EVIDENCE_SNAPSHOT_MAX_BYTES = 16KB`（JSON 序列化长度）；写入超限 → `browser_evidence_payload_too_large`(413) 拒绝；读取超限 → fail-soft 忽略 |
| snapshot 数量上限 | `BROWSER_EVIDENCE_SNAPSHOT_LIMIT = 20`（追加模式，超出 409 报错，不静默截断） |
| dedupe | 同 capturedAt + pageUrl + asin → `duplicate` 幂等 |
| malformed/oversized | 写入前 `assertSnapshotWritable` 自校验（结构/白名单/binding proof/大小），任一不满足拒绝保存 |

不新建 Prisma 表、不建设复杂历史数据库。

## 5.2 PreviewStore 绑定（Integration Precheck 冻结）

Preview 服务端缓存条目绑定：`subjectKey`（owner:v1 / visitor:{demoAccessId}）+ `taskId` + `asin` + `evidenceId` + `capturedAt/expiresAt`（TTL 15 分钟）。
`take` 时主体或任务任一不匹配 → 视为不可用（409 preview_expired）。Visitor A 不能保存 Visitor B 的 Preview；Preview 不能跨任务串用。

## 6. Preview / 人工确认语义

- collect 返回 preview（服务端生成，可信）：当前商品（ASIN/标题）、来源（Amazon/US/URL/采集时间）、6 字段状态（已获取/未知/币种不匹配/页面未显示）+ 技术详情（bindingProof/collectorVersion）折叠展示。
- save 必须带 `confirmed: true`（用户点击"确认保存"后）；确认语义仅为"把当前采集结果保存为 Evidence"，**不是**"确认数据永远正确"。
- Browser snapshot 恒为 `source_snapshot`，不升级为 human_confirmed_business_fact。

## 7. 旧记录兼容与读取

- 本 namespace 为新建，无历史数据；读取 fail-soft（namespace 缺失 = 空快照列表，不报错）。
- 读取经 `productResearchPublicDto` 风格安全投影（不直接读完整 resultJson 到 UI）。
- schema 非 `browser-evidence.v1` 或结构非法 → 按空列表处理并标记 `invalid_browser_evidence` 观察（不阻断页面）。

## 8. 安全边界

- 不保存 Cookie/Authorization/password/token/localStorage/sessionStorage secret/browser profile 数据。
- 不保存完整 HTML；只保存 pageUrl + 脱敏字段值。
- 采集不调用 AI；不消耗 AI quota；不自动触发 Research Skill / AI Summary / Handoff。
