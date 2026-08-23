# Formal v2 对比（轮 16 最终收口）

| 项 | 修改前 | 修改后 |
| --- | --- | --- |
| 无锚点泛化句（Perfect for busy family mornings.） | 误入 review | blocked（移除） |
| 无锚点氛围话术（Adds cheerful style to every kitchen.） | 误入 verified | blocked（移除） |
| review 判定 | reviewHit && (!hardHit)（无锚点也 review） | 必须同时：低风险提示词 + 已确认功能/属性连续短语锚点（身份字段不作依据） |
| 未确认性能词（spill/leak/water-resistant） | 部分漏网（spill-resistant 判 verified） | 硬属性词表覆盖，无依据 → blocked |
| 服务端 humanReviewClaims | 保存但安全 DTO/API 不返回 | 有界返回（≤5 条 × ≤120 字符）+ usedKeywordIds（≤20）+ keywordPlanSource（manual/auto_suggested/none） |
| 前端事实级别 | 本地 classifyClaimTier 草稿词启发式 | 删除本地分类；只展示服务端结果；关键词方案三种文案 |
| keywords/backendTerms | 可能重复（kids water bottle ×2） | 输出边界大小写不敏感稳定去重（保留首次出现） |
| Claim 回退原因 | 未拦截内容移除后仍报质量 | 有内容被三级拦截 → 报「包含未经确认信息」；纯结构/质量 → 报结构/质量 |

验证：定向 10 文件 76/76（含 R3 集成恢复 17/17、claimTier 新增 10 用例、mainchain 3 用例）；tsc 0；白名单 ESLint 0；build BUILD_ID 见 PROGRESS；浏览器 1440/390 双端（截图 listing-studio-1440.png/390.png）；反向验证 ×3 红→绿；dev.db SHA 复测一致。

# Formal v2 对比（轮 5：模块按钮目标路由）

> 本轮 BUILD_ID iAQ1ME3mYJf2bj4TPgs5a；数字/截图/源码同轮。四类证据：① 真实浏览器已验证 ② 正式组件/契约自动化验证 ③ 当前仍未验证 ④ 历史全量记录。

## 1. 本轮差异（修改前 → 修改后）

| 项 | 修改前 | 修改后 |
| --- | --- | --- |
| 四张卡 aria-controls | 全部写死 formal-v2-materials | 各指自己的证据目标（market/buyer/sourcing/cost-risk ↔ 四个稳定 id） |
| 四张卡 onNext | 全部打开 formal-v2-materials/summary | 打开各自目标，focusSelector "h3"（无 H3 面板回退区本身） |
| 目标可达性 | 需要 flat details | EvidenceWorkbench 四个现有区带稳定 id；激活函数自动展开最近封闭祖先 details |
| 总入口 | 绿色「补充研究资料」打开 formal-v2-materials | 不变（未改） |
| 视觉/文案/结构 | — | 未改动任何 class/文案/页面结构（仅 id、aria-controls、目标映射、祖先展开） |

## 2. 验证
- ② 定向 3 文件 33/33 全绿（含 5 个新路由用例 + 既有 stale/决定/Listing 回归），stderr 0；tsc/限定 ESLint exit 0。
- ① 真实浏览器（1440/390）：四按钮 label/controls/hash/targetTestId/details.open/focus 全部正确（PROGRESS 表格为权威去向）；overflow=false；console 0；截图 action-routing-{key}-{1440x900|390x844}.png ×8。
- ③ 仍未验证：真实 stale 实点（库无数据）；整体观感由领导依据截图确认。
- ④ 历史全量：基线 5798/55/79；轮 3 5883/0 failed（桥失败）；轮 4 5896/1(时序 flake)/78；本轮 5891 passed / 0 failed / 89 skipped（唯一失败文件=桥启动间歇，隔离复跑通过）。

## 3. 最终状态
Formal v2 本轮目标（四按钮各去各的资料区）已完成并经 ①② 验证；整体任务仍受真实 stale 未验证与外部桥环境间歇限制——按任务书措辞，不以「全部完成」表述。

---

# Formal v2 对比（轮 8：批次「加入研究」→ 精确候选/任务 交接）

> 轮 8 BUILD_ID wAoOAPSWG7QKAFs7CTsV3（旧 rgCrGGk4XPaxg-Vpg97EZ）；数字/截图/源码同轮。

## 修前（轮 7 实际存在，轮 7 汇报曾误报）

| 项 | 修前 | 修后 |
| --- | --- | --- |
| 服务端未转候选 destinationUrl | 通用 /opportunity-candidates（conversionResult 单一出口） | /opportunity-candidates?view=startable&candidateId=<encodeURIComponent(候选id)>（同一出口；已转仍精确 /tasks/<convertedTaskId>） |
| 服务测试断言 | Owner/Visitor 明确断言 /opportunity-candidates | 断言精确候选 URL；重复加入候选与地址均不变；URL 不含 productKey/identityHash/manifest/evidenceHash/sourceMeta/商品名；已转 URL 不含 view=startable |
| route 测试 | 断言通用地址 | 断言 route 原样下发服务端精确地址（不在 route 二次拼接） |
| ProductBatchManager | 消费 body.data.destinationUrl 但无行为测试；失败用 responseError 留在当前页 | 生产 researchItem 直接调用新纯函数 resolveBatchCandidateHandoff：仅放行服务端安全站内地址（/ 开头、非 //、非 /\、非协议地址），失败返回可读错误留在当前页（不退回通用候选池）；5 个行为测试 |
| 根因 | 轮 7 未改服务端地址、未改两处旧断言、未有客户端行为证明，却汇报「批次精确交接已成立」 | 轮 8 以源码质证 + 红绿测试（红 7 → 绿 33 → 反向红 2+2 → 恢复绿）+ 浏览器只读复验纠正 |

## 验证

- ② 定向 3 文件 33/33（28 基线 + 5 新，0 skip、stderr 0）；主链 9 文件 79/79（74 基线 + 5 新）。
- 反向验证：REV1 通用地址回退 → Owner/Visitor 精确断言 2 failed；REV2 visitor candidateId 替换为 Owner 值 → 访问域断言 2 failed；均恢复全绿（tmp/e2e-steps/r8-rev1-red.txt、r8-rev2-red.txt）。
- ① 真实浏览器只读（未点击任何写入按钮）：首页与 startable 在 1440×900、390×844 均 CTA href=/opportunity-candidates?view=startable（文案「开始研究一个商品」）、article=1（bella）、真实图 1/占位 0、overflow=false、console 0；截图 r8-home-{1440x900|390x844}.png、r8-startable-{1440x900|390x844}.png。
- ③ 仍未验证：真实「点击加入研究→服务端转换→重定向」端到端实点（浏览器只读，未许点击真实写按钮）；以隔离测试+路由层测为替代证据。
- ④ 历史全量：轮 7 527 files/5936 passed/0 failed/78 skipped EXIT 0；轮 8 全量结果见 tmp/e2e-steps/r8-fullsuite.log（final 汇报引用）。

## 修正声明

轮 7 曾误报「批次加入→精确候选已成立」；轮 8 以源码 + 红绿测试纠正。旧测试数字（轮 5/7 各段）保持原样，未做任何篡改。

---

# Formal v2 对比（轮 9：批次商品概览恢复 + Browser Use 自动采集）

修前：详情 DTO 只投影 candidateAnalysisContext{sourceLabel,asin,productUrl}（响应实际为空对象）→ 页面显示「未绑定批次」；竞品仅人工（sourceKind=manual）、关键词仅 XLSX 上传；无产品运行时 Browser Use 入口。

修后：① 详情 DTO 增加 facts 安全 allowlist（productName/marketplace/asin/reportType/query/category/capturedAt + productFacts 13 标量）——真实 THERMOS 任务返回 9 项批次事实（品牌/价格/评分/评论/BSR/月销等）；不投影 productBatchId/productBatchItemId/evidenceHash/itemHash/productKey/sourceMeta。② 服务端 Browser Use 适配层（lib/server/browserUseResearch*：严格 Preview、只读服务端身份 seed、仅 local owner、一次性预览缓存、来源仅 Amazon 官方域）；采集器工具（tools/collectors/browser-use/*：确定性 5 步脚本 + 无管道文件式 spawn——真实可运行）；两个动作（competitor-evidence / keyword-evidence route action=collect_browser_use / save_browser_use，确认保存复用既有写入器，竞品写入器已扩展 browser_use 可追溯来源，关键词行直写 reverse_asin 证据）；UI 两个「自动采集竞品/自动采集关键词」按钮 + 状态机（启动中/需登录/验证码/权限不足/采集失败/预览待确认/取消无残留）。

真实验证：关键词自动采集经产品路由 HTTP 200 返回 10 条真实 SellerSprite 反查关键词 Preview（未点确认保存，dev.db 前后 SHA-256 一致）；竞品视图遇插件图形验证码 → fail-closed 未绕过，竞品段未闭环（如实）。
---

# Formal v2 对比（轮 10：SellerSprite 关键词驱动 Amazon 搜索竞品发现）

修前：竞品仅人工维护（sourceKind=manual）；自动采竞争品在 SellerSprite 插件竞品视图上被图形验证码阻断（轮 9 终态）。
修后：collect_browser_use 服务端串联 = 权威 seed（任务身份）→ SellerSprite 关键词（复用轮 9 成功链路，只读）→ 可靠词选择（第一个非空非纯品牌词，跳过 owala 类品牌词，不做标题猜测）→ Amazon 搜索结果采集器（无管道文件式 Browser Use；合法 10 位 ASIN+标题+Amazon 详情 URL+采集时间；排除 seed/广告/重复/外站；图片仅 Amazon 官方图床；验证码/登录墙/无结果/结构变化/畸形 → 显式失败原因，绝不冒充无竞品）→ 严格 Preview（搜索词、来源 URL、捕获时间、竞品字段；缺失 null）→ 人工确认复用既有写入器（CAS，可追溯 sourceUrl）。
真实验证：真实 THERMOS 任务 → HTTP 200 Preview：5 条真实竞品（HOTOR B0DBDKT4QC $7.98 4.4/8300；Lifewit $7.98 4.5/9；Full Moon $19.99 等），来源均为 amazon.com 搜索卡片 URL，搜索词 lunch box（SellerSprite 真实关键词），previewId 一次使用，未确认保存。TDD 反向：seed/Sponsored 放行→红；amazon.evil.example 放行→红；恢复绿。
未验证项：详情页浏览器视觉（密码门限制，无凭据——与轮 9 相同记录）；竞品图片在预览中以 URL 呈现（未渲染校验）。
---

# Formal v2 对比（轮 11：确认保存契约 + 隔离库真实用户闭环）

修前：BrowserUseCollectButton 确认保存发送 expectedStorageVersion: undefined → 服务端 400 storage_version_required；保存后不刷新另一证据区版本 → 顺序保存第二次必 409。
修后：① 按钮接收当前证据区 storageVersion（竞品按钮←竞品 GET、关键词按钮←keyword GET）；保存 payload 由 buildSaveBrowserUsePayload 构建（版本未就绪→null + 确认按钮禁用提示刷新，绝不发送 undefined）；保存成功后 onSaved 刷新两个证据区版本（双向）；409 显示明确冲突文案、不得冒充成功；已保存数量来自服务端。② 契约测试 3 例全绿；反向（恢复 undefined+移除 builder）→ 红 → 恢复绿。
真实验证（隔离库 3011，原始库未动）：真实 UI 顺序完成 关键词采集→确认保存（KW_ROWS=10）→ 同页竞品采集→确认保存（5 条非 seed：B0DBDKT4QC/B0B56CHMSC/B0H2ZBDWR4/B07VLFFV5F/B017SGIMV2，无 storage_version_required）→ 刷新后 10+5 仍在；DECISION_UNCHANGED / AI_UNCHANGED = true；1440×900 与 390×844 overflow=false；截图 round11-1440-saved/refresh、round11-390-refresh.png。原始 dev.db 前后 SHA-256 一致（b4d0f149…）；隔离库 SHA-256=19ad60f4e463…（已写入并保留）。


---

# Formal v2 对比（轮 12：正式商品研究页可用性纠偏）

> 本轮 BUILD_ID H0VBXDbwc6k0P5WKCXK7m；修改前=HEAD（轮 11 终态构建 jo0o3n9x6EytY6aPq3_GZ），修改后=轮 12 最终构建。视觉效果未重新设计（同色板/组件令牌/信息结构）。

## 1. 本轮差异（修改前 → 修改后）

| 项 | 修改前 | 修改后 |
| --- | --- | --- |
| 供应线索（本地 Owner 免密） | accessReady 写死「密码非空」，无密码时显示「输入访问密码」，无法进入能力检测 | resolveSourcingAccessState 三态：hydration 中「正在读取供应能力…」；local_owner+noAuthOwner→直接检测能力；仅真实缺密码时才提示密码。面板显示真实状态：1688 登录 ✓ / 浏览器助手已连接 / 需确认普通 Chrome 登录 1688；与「工作台访问密码」明确分离 |
| 保存冲突（Amazon 资料） | 保存失败清空预览；无版本刷新重试 | 409→保留预览→刷新 storageVersion→自动重试一次；二次 409→「资料刚刚更新，请再试一次」；CAS 严格（expectedStorageVersion 不放宽）；输入/预览全程保留 |
| 评论导入/采集确认冲突 | 仅提示「已自动刷新…请重新采集」，无自动重试 | 同口径首冲突自动重试、二次简洁提示（共用 evidenceConflictRecovery） |
| 当前商品 ASIN | 可编辑，可改成任意值提交；提示「换一个 ASIN」 | 只读输入框（值=服务端 GET taskAsin，B08NCVT244）；只当前商品模式；竞品模式才可编辑；Route current_candidate 不匹配→409 current_candidate_asin_mismatch 零写入 |
| 用户语言 | Evidence/VOC/Missing/unknown/AI 证据总结/fact-risk-conflict 分散在 4 个组件 | 资料 / 买家评论与需求 / AI 研究摘要 / 待补资料 / 尚未取得 / 事实、风险和矛盾信息；仅白名单外 2 文件残留（见 BLOCKED） |
| 重复假缺失卡 | 固定 4 张 unknown 卡（还缺什么）与真实成本表单重复 | 删除假卡；保留 #formal-v2-cost-risk-evidence 锚点并指向真实「成本与风险资料」表单；四模块跳转（market/buyer/sourcing/cost-risk）全部指向稳定 id，未回归 |
| 新共享模块 | — | lib/client/evidenceConflictRecovery.ts（决策函数 + 统一提示文案），保存/导入/确认三口共用 |

## 2. 验证
- ② 定向 8 文件 88/88 全绿（55 基线 + 33 新增：路由 16、交互 5、库 5、组件 7 等）；tsc 0；白名单 ESLint 0 error；build 成功。
- ① 真实浏览器（3005 最终构建）：1440×900 / 390×844 页面就绪；「访问密码/输入密码」0 出现；Evidence/VOC/Missing/unknown/fact-risk-conflict 0 出现；供应线索真实状态+两套登录分离；ASIN 只读（value=B08NCVT244 disabled）；无横向溢出（1425≤1440、375≤390）；console 0/0；按钮聚焦 1 个主按钮 active；截图 usability-fix-r12-{1440,390}-{detail,expanded}.png。
- ③ 未验证：真实 409 冲突只读页无法在 3005 触发（需并发写），由交互测试 + 路由契约承担（任务书允许「组件请求序列验证」）。
- ④ 全量 5983 passed / 89 skipped / 2 failed（桥端口占用 + demoSandbox 超时，均隔离复跑通过，BLOCKED #3）。


## 3. 轮 12 门态复测（闭环）

- 用「轮询 hydration 完成」的规范读法复测 2/2：READY=true、GATE=false、访问密码/输入密码 0 命中、PAGE_ERR_COUNT=0，hydration 耗时 289ms。
- 之前的 3 次「命中门」为脚本时序伪影（只读 SSR 锁态），非产品缺陷；仅对验收方法记录注意事项，不作为产品展示结果。


---

# Formal v2 对比（轮 15：Listing 五点内容专项）

> BUILD_ID 6sGWmfbpSVfny989HxClK（含轮 15 全部变更）；截图 r15-*.png（docs/v4.1/evidence/d-formal-v2/）。

## 修改前 → 修改后

| 项 | 修改前 | 修改后 |
| --- | --- | --- |
| Listing 409 冲突 | 提示「创作资料已经更新，请生成新版本」→ 用户再点一次 | 首次自动刷新版本并重试一次；二次冲突 → 「创作资料又发生变化，请再试一次」+ 保留草稿 |
| 五点来源 | 功能事实句 + spec 碎片补足（"Plastic, Stainless Steel." / "Backlit Display."） | 只保留 ≥3 词功能事实句；spec 碎片不进五点；不足时 UI 提示缺口 |
| 竞品参考 | 只有 ASIN+标题 note | 新增详情页五点采集（amazon-detail-observation.v1）+ 存储 detailBullets + competitiveContext.bullets（reference-only）+ 提示词 COMPETITIVE_REFERENCE 传入 |
| Claim Evidence | 严格（拦截编造） | 严格不变（AI 优化仍被拦截时 → safe_fact_draft + 「AI 草稿未通过事实校验」+ 提示补事实） |
| 缺失提示 | UI 只显示前 2 项缺失 | 逐项显示「生成高质量 Listing 还缺：…」 |

# Formal v2 对比（P1 修复，代码审查后）

| 项 | 修改前（审查 NO_GO） | 修改后（READY_FOR_RE_REVIEW） |
| --- | --- | --- |
| research/historical 分页 | SQL 启发式预过滤 + 页内二次过滤，total=页过滤后长度（失真/丢页） | 两阶段精确分页：全量窗口精确分类→切片，total/hasMore/nextOffset 同源；窗口上限 fail-closed |
| Amazon 来源校验 | /^https?:\\/\\/(www\\.)?amazon\\./i（后缀欺骗可绕过） | new URL + 协议白名单 + userinfo 拒绝 + hostname 精确集合（com/co.uk/de/co.jp/ca + www） |
| abandoned 展示 | "研究已完成/查看研究结果"（与详情 historical_abandoned 矛盾） | "已放弃/查看研究记录"（第三列，creative_ready 不变） |
