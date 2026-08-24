# VOC 买家评论研究区收口 PROGRESS（执行者自记）

## 任务 0：只读核对（完成）
- 分支 feature/v4.1-ui-productization；HEAD 1623a1e…；暂存空；status 86 条目（既有 dirty）。
- dev.db SHA 开工：e5b04e86ec351d725713a65804fb59ef9889c3ba8cff2835dc6001a3c9d816a1（注：已非 R5 基线 d29d45db…，为既有历史变化；本轮以 e5b04e86… 为一致标准）。
- 页面证据（真实 DOM）：imgSrcStrings=31（HTML 污染）、runHits/modelHits/verHits=1（运行噪声）、中文标题后直接英文分析（Perfect for schoo…）。
- 根因：① VOC 生成指令全英文（SYSTEM_PROMPT 无中文约束）；② 评论原文直接渲染（含 <img>）；③ 运行 trace 在 1135 行显示；④ 英文已保存分析数据（历史）+ 服务端投影未剥离。

## 实现（4 项）
1. lib/client/vocReviewText.ts（新增小文件+测试）：cleanReviewDisplayText（删 HTML 标签/头像、清多余空格、解码常见实体、空→占位）+ isEmptyReviewText；纯函数、无 dangerouslySetInnerHTML。
2. VocEvidenceSection.tsx：
   - import 清洁函数；
   - ThemeCard「为什么这么说」→ 改为「查看原始评论（原文）」details（默认收起），原文经 cleanReviewDisplayText，空显示占位；
   - ConflictCard 正/负观点原文 → 各自 details 收起 + 清洁；
   - 主分析区：抽取 VocAnalysisBody（主题区+统计）；英文判定 isEnglishThemeText；历史英文分析 → 中文提示 + 「查看历史英文分析」按钮（默认不渲染主题，点击才渲染）+ 当次样本信息；
   - trace 行删除 → 中文业务信息（分析时间/本次使用 N 条评论/抽样分析（共采集 M 条））。
3. lib/server/vocAnalysis.ts：新增 VOC_CHINESE_REQUIREMENT（简体中文约束 + evidenceId 引用保留 + 不篡改评论原意 + 单条评论不写普遍结论 + 不输出运行信息），注入 SYSTEM_PROMPT。
4. 测试：VocEvidenceSection.test.ts +6 R6 用例；vocAnalysis.test.ts +2 中文契约；vocReviewText.test.ts 新 5 用例。既有「仅使用 2/10 条（采样）」断言更新为「抽样分析（共采集 10 条）」中文文案（保持断言强度，未删除）。

## 反向验证（红→绿，三项）
1. 绕清洁（直接输出 review.reviewText）→ avatar.png 泄漏红；恢复绿。
2. 恢复运行 trace → run/model/voc-analysis 泄漏红；恢复绿。
3. 去掉中文输出约束 → 契约测试红；恢复绿。

## 验证结果
- VOC 定向：4 文件 / 50 tests 全绿。
- tsc --noEmit：0 错误。
- ESLint（VOC 改动文件）：0 errors 0 warnings。
- next build：✓ Compiled successfully（11.7s）。
- dev.db SHA 前后一致（e5b04e86…）。
- 浏览器验收（1440/390 双端）：imgSrcStrings 0（原31）、runHits/modelHits/verHits/hashHits 全 0、英文主题默认不渲染（defaultEnglishTheme:false）、中文历史提示在、历史英文按钮在、无横向滚动、console 0/0。
- 剩余英文仅「评论期 April 23 ~ September 01」——采集期数据标签（必要标头），非分析正文。

## 追溯关系
- 单条评论不展示为普遍结论：R6 测试断言「引用 1 条」存在（主题引用数保留）。
- 引用数量/身份/星级/ASIN：R6 测试断言保留通过。
- 评论证据引用与来源身份未变（evidenceId 链未动）。
