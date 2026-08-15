# V3.5 Implementation — Sourcing Evidence / Human Confirm / UI

> 合同：§26-§30/§42-§51/§65-§73

## 1. 存储（§26/§28，无 DB migration）

- 复用 versioned `taskResultJson`：新增 writer `"sourcing-evidence"` → namespace `sourcingEvidence`（`lib/server/taskResultJsonMutation.ts`，原子乐观并发 + 越权 namespace 拒绝）。
- Pack 版本：`sourcing-evidence.v1`（禁止无版本 blob）。
- 不新增 Prisma 表（现有结构可表达，§93 无需 migration）。

## 2. Sourcing Evidence 模型（§27/§29）

```ts
SourcingEvidenceV1 = {
  schema: "sourcing-evidence.v1", taskId, capturedAt,
  acquisition: { method, query, runTrace },   // 溯源
  candidates: AcquisitionCandidate[],          // 仅人工确认过的候选
  humanConfirmed: [{ offerId, confirmedAt, note }],
  updatedAt,
}
```
- 字段分类在候选内保留：seller_claim / platform_metadata / displayed_price / price_range / price_tier / displayed_moq。
- 每个候选保留 source / sourceUrl / offerId / capturedAt / acquisitionMethod（provenance）。

## 3. Search Result ≠ Evidence（§17/§43）

- 搜索得到 AcquisitionCandidate，**不自动写 Evidence**。
- 流程：Search → Preview（服务端内存 store，TTL 15min）→ Human Confirm → save 才写 `sourcingEvidence`。
- 客户端只传 `previewId + selectedOfferIds`；字段值全部**服务端重建**（§69）：
  - save 时从 Preview Store 取回候选（subjectKey+taskId 绑定，跨主体/跨任务取用 → null）；
  - 对选中候选逐个拉详情（≤3）并做 Entity Binding 交叉验证（offerId 硬门禁）→ 详情补全后落盘。
- 幂等：重复确认同 offerId 不重复追加候选，更新 confirmedAt。

## 4. Preview Store（§42）

- 服务端内存暂存：`previewId`（UUID）+ `subjectKey`（owner:v1 / visitor:{demoAccessId}）+ `taskId` + `expiresAt`（15min）+ 候选 + trace。
- 取用一次性（take）；TTL 过期 → `preview_expired`（410）；跨主体尝试不消耗原条目。

## 5. Owner / Visitor 隔离（§44）

- 全链路（search/preview/save/detail/evidence 读取）经 `requireAuthenticated` / `requireOwnerOnly` + sandbox task id 校验。
- Visitor A 不能读/写 Visitor B 的 sandbox 任务（route 测试覆盖）。

## 6. UI（§45-§51/§65-§70）

`components/cross-border/SourcingEvidencePanel.tsx`（挂载于任务详情页 TaskRecordDetail）：

- 三个获取入口：关键词找货 / 图片找货（注明"会打开本地浏览器窗口（需前台运行）"）/ 已有 1688 链接。
- UI 状态：idle / searching / preview / need_login / need_user_verification / no_results / error / saving / confirmed（无伪 loading）。
- Preview 卡片：图片 / 标题 / 页面显示价 / 展示起批 / 供应商显示名 / matchState 五态文案 / 查看来源 / 查看详情（服务端实时 detail）。
- 确认按钮"加入供应线索（n）"+ 提示"未确认的搜索结果不会保存为证据"。
- 已确认证据列表：displayedPrice / 展示 MOQ / 供应商 / 卖家自报（≠ 事实）/ 未知项 / **下一步询盘问题**（确定性模板生成，§51，不自动发送）。
- 对比对象标注：亚马逊候选标题 + "相似与差异需人工结合商品图片与规格判断，系统不自动评分"。

## 7. 文案纪律（§46，测试锁定）

- 允许：供应线索 / 查看来源 / 加入比较 / 查看差异 / 加入供应线索 / 下一步询盘问题。
- 禁止（测试断言零出现）：最佳供应商 / 推荐供应商 / 最优货源 / 靠谱指数 / 采购指数 / 成功率 / 建议购买 / 采购成本。

## 8. AI 边界（§49/§50/§71/§72）

- 本轮 UI **不调用真实 AI**：询盘问题为确定性模板；相似/差异由人工结合图片与规格判断；避免扩大 AI 调用范围与付费消耗。
- 1688 title/description/specs 等均为 UNTRUSTED DATA：在本实现中不进入任何 AI/system prompt 路径；未来接 AI Summary 时必须隔离 + evidenceRefs mandatory。
