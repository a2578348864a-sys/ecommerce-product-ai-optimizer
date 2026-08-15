# V3.2 — Amazon Product Research Skill（validation）

## 契约测试

- `skills/amazon-product-research/SKILL.test.ts`：9/9 通过
  - 8 步流程按序存在
  - 输出白名单 6 节齐全
  - 禁止推断范围节显式声明 7 类禁止项；输出结构节无"值得卖"式结论句式
  - 身份门禁（不确定 → 停止）+ unknown 处理（不猜测/不跨商品补值）
  - VOC / 货源固定标记未收集，禁止推测
  - 不复制内部逻辑（无 createHash/parseInt/hasSearchRankColumn/conditionalSignalScore）
  - 版本纪律（版本号/失效条件/验收样本/禁止静默改历史语义）
  - 桥接文件指向唯一权威

## 真实业务走查（验收样本）

- 样本：真实任务 `cmstfxwwv0003gqq316b9ndor`（John Boos 砧板，2026-08-15 已确认读模型）
- 按 SKILL.md 规则走查 8 步，输出落盘 `.tmp/v3-2-validation/walkthrough-report.json`

| 断言 | 结果 |
|---|---|
| identityGate（身份确认通过） | true |
| eightStepsPresent（8 步流程） | true |
| whitelistOnly（输出仅 6 节白名单） | true |
| noForbiddenPhrases（无禁止词） | true |

- 走查结论示例：已有证据=身份/市场需求/关键词/人工决定；缺失=竞品未维护、VOC 未收集、货源未收集、采购价/MOQ/物流/合规 unknown；风险=品牌授权（来自研究记录）；冲突=无；下一步=人工确认品牌授权与合规、补货源信息。
- 输出与任务详情页（Evidence Workbench / 研究结论）展示一致，未出现任何白名单外内容。

## 工程验证

- targeted tests：SKILL.test.ts 9/9
- 全量：4522 passed / 0 failed（worktree，main 基线测试全绿；release-package 依赖构建产物在集成树验证）
- tsc / lint：PASS（Skill 为文档+测试，无 TS 变更）

## Git / 安全

- 基线 origin/main = 61e1e31；worktree `codex/v3-2-amazon-skill`；未 push / 未 merge / 未部署
- 未写数据库；未调真实 AI；未访问网络；未读取凭据；无新依赖
- V3 Skill 计数：sellersprite-market-preview.v1 + amazon-product-research.v1 = 2/4（上限 4）

## 判定

**AMAZON_PRODUCT_RESEARCH_SKILL = APPROVED**
