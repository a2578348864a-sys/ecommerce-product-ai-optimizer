# 竞品 Evidence 最小合同（competitor-evidence.v1）

> 11_PHASE2_TASK.md 要求：竞品 ASIN 新写入必须先冻结最小合同。
> 优先 resultJson/versioned namespace，禁止直接新建 Prisma 表；不得把「竞品列表」做成第四套 Candidate/Task 系统。
> 本文件为正式合同；实现与本文不一致视为规格做偏。

## 1. 数据结构 / version

- schema：`competitor-evidence.v1`
- 命名空间：`taskResultJson.competitorEvidence`（taskResultJsonMutation.ts OWNED_NAMESPACES 新增 writer `competitor-evidence` → `["competitorEvidence"]`）
- 结构：

```ts
type CompetitorEvidenceV1 = {
  schema: "competitor-evidence.v1";
  version: 1;
  /** 绑定的候选（冗余引用，用于研究上下文投影；权威绑定为 taskId） */
  candidateId: string | null;
  asins: CompetitorAsinEntry[];
  updatedAt: string; // ISO 8601
};

type CompetitorAsinEntry = {
  asin: string;          // 规范化：大写、去空白
  sourceKind: "manual";  // 首期只允许人工添加
  addedBy: { mode: "owner" | "visitor"; actorRef: string };
  addedAt: string;       // ISO 8601
  note?: string;         // 可选人工备注（≤500 字符）
};
```

## 2. 与 owner / task / candidate 的绑定关系

- 权威绑定：**taskId**（数据存在于该 task 的 resultJson；owner→Prisma ViralAnalysisRecord.resultJson / visitor→sandbox task.resultJson，经 taskResultJsonMutation 按主体分流）。
- 冗余引用：`candidateId`（来自该 task 的研究记录 candidateId；仅用于研究上下文投影，读取侧以 task 为准）。
- 写入与读取都必须走 `mutateTaskResultJson`（writer 所有权契约 + 乐观并发 expectedStorageVersion），禁止绕过。

## 3. 每条 ASIN 的来源与人工添加语义

- `sourceKind` 首期恒为 `"manual"`：**只有人工在 UI 添加**；AI/研究流程不得自动写入（V3 铁律：AI 不创造事实）。
- 添加请求必须带 `expectedStorageVersion`（resultJsonHash）防并发覆盖；服务端校验 ASIN 格式（`^[A-Z0-9]{10}$` 规范化后）。
- 人工添加语义：表示「研究者认为该 ASIN 是值得对照的竞品」，**不代表**任何自动结论（不得衍生评分/推荐）。

## 4. 最大数量（首期 3–5 个）与去重规则

- 上限：**5 个**（首期 3–5 个取上限 5）；超出返回业务错误 `competitor_evidence_limit_exceeded`。
- 去重：按规范化 ASIN（大写、去空白）去重；重复添加返回幂等成功或 `duplicate_asin`（由实现选择，读取结果必须唯一）。
- 删除：按 asin 删除单条；删除到 0 条允许（列表为空 = 未维护）。

## 5. createdAt / updatedAt 或等价时间语义

- 每条 entry：`addedAt`（添加时刻，ISO 8601）。
- 整体：`updatedAt`（每次成功 mutate 后刷新，与 resultJson.updatedAt 一致语义）；读取侧以 namespace.updatedAt 为准。

## 6. 旧记录兼容与 Evidence Read Model 的读取方式

- 旧记录：本 namespace 为新建，无历史数据；读取侧 fail-soft（namespace 缺失 = 空列表，不报错）。
- 读取方式：Evidence Read Model（`competitorEvidence` 命名空间读取投影）→ `productResearchPublicDto` 风格安全投影 → 商品研究详情页「竞品 Evidence」区域；无竞品时显示「未维护」。
- 兼容规则：schema 非 `competitor-evidence.v1` 或结构非法 → 按空列表处理并标记 `invalid_competitor_evidence` 观察（不阻断页面）。

## 7. 门禁

- 写入只允许人工（UI 按钮 + 服务端 actor 校验）；
- 不新建 Prisma 表；不新增 AI 调用；
- 有测试：写入（上限/去重/格式/并发）、读取投影（空/非法/正常）。
