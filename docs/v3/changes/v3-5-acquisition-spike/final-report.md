# V3.5-A — Acquisition Spike 最终报告（静态审计 + 实测 + Native 图搜 + 全自动图片链）

> 状态：静态审计 PASS；**实测完成：Route B/C 真实运行验证通过；Native 1688 图搜三 Case 成功；"搜索图片"按钮自动点击（4/4、0 误点）；File Chooser 首传自动化 APPROVED（3 Case 3/3 + Restart Fresh Session PASS）——图片发现链 FULLY_AUTOMATED；Route A 无凭据（NOT_CONFIGURED）**。本报告如实标注约束。

## 第一句话（大白话回答）

**有，而且现在连"首次上传图片"也全自动了——"1688供应线索"已经有比手工复制完整得多的办法：关键词搜索+详情用 1688-cli（扫码一次，之后命令即得）；"图片找同款"整条链全自动——Amazon 主图自动注入、文件选择器自动选图（程序模拟真实点击+回车触发浏览器的正规文件选择流程）、"搜索图片"按钮自动点击，3 张图实测 3/3 全自动跑通（含重启后新会话首图自动），你的唯一业务动作只剩"哪些候选值得加入供应线索"；整体策略 HYBRID；图搜返回同类候选，最终仍需人工确认。**

## Trusted File Chooser Automation Spike 报告（任务书 §44，40 项）

1. **上传入口如何定位**：s.1688.com `input#img-search-upload`（DOM 查询；页面唯一 file input）。
2. **是否使用真实 CDP mouse click**：探索过（input 中心点击）——顶部区域（y<150）无效，未采用为主路径。
3. **File Chooser 是否真实触发**：是（`Page.fileChooserOpened` 事件 + setFileInputFiles 成功）。
4. **使用了哪个 CDP capability**：`Page.setInterceptFileChooserDialog` + `Page.fileChooserOpened` + `DOM.setFileInputFiles`（Chrome 151 实测可用）。
5. **chooser 是否提供 backend node**：是（fileChooserOpened 携带 backendNodeId）。
6. **文件如何设置**：`DOM.setFileInputFiles({files, backendNodeId})`。
7. **是否直接改 input.files**：否（走 chooser 正规流程；Experiment A 仅对照）。
8. **upload state 如何证明**：预览 dataURL 出现 + 长度匹配候选 + "搜索图片"按钮出现。
9. **Candidate identity 如何证明**：preview base64 长度与本地文件一致（A=37311/B=43267/C=13955）。
10. **preview 是否正确**：是（逐 Case 验证）。
11. **imageId 是否生成**：是（每次搜索跳转 `imageId=<id>`；4 个独立 id 记录）。
12. **Case A**：PASS（imageId=1737808815218637218，冰霸杯候选）。
13. **Case B**：PASS（imageId=1338408815172363293，史努比联名房子午餐包）。
14. **Case C**：PASS（imageId=1145708811572688961，日系保温杯候选）。
15. **Fresh Session**：PASS（每 Case 全新页面首图自动）。
16. **Restart Fresh Session**：PASS（Chrome 重启→首图自动→imageId=1313608815371631293）。
17. **FIRST_UPLOAD_MANUAL_ACTION_COUNT**：0。
18. **SEARCH_BUTTON_MANUAL_CLICK_COUNT**：0。
19. **NORMAL_IMAGE_SEARCH_USER_TECHNICAL_ACTIONS**：0（登录/CAPTCHA 不计）。
20. **WRONG_UPLOAD_COUNT**：0。
21. **WRONG_CLICK_COUNT**：0。
22. **Wrong Entity**：0（与 native spike 互证一致）。
23. **Native visual search trigger**：真实（4 个 imageId + 结果相关性）。
24. **fallback 推荐防误判**：未点搜索=默认推荐（对照）；触发以跳转+结果双重验证。
25. **Risk Control**：未触发滑块；限速（Case 间休息）。
26. **Cookie/token**：零导出。
27. **是否新增 Extension 权限**：否（TEMP 修改仅 upload 触发逻辑；allowlist 未扩）。
28. **是否使用 OS-level automation**：否。
29. **fail-closed 测试**：PROOF_FAIL/NO_TARGET/selector_not_found 均不继续（实测多次正确拦截）。
30. **重启稳定性**：PASS（Restart Fresh Session）。
31. **首次耗时**：~40-70s（页面加载+rect 稳定+上传+搜索+结果）。
32. **后续单图耗时**：~30-50s。
33. **是否值得正式采用**：是（全自动图片链；约束=窗口前台+布局重试）。
34. **若失败为何停止深挖**：未失败（APPROVED）；V3.5-A 图片自动化研究正式关闭（任务书 §41）。
35. **正式推荐 UX**：Candidate→"用图片找 1688 供应线索"→全自动链→Preview→用户选线索。
36. **当前最大遗留风险**：页面布局波动（y=17 紧凑模式需重试）；页面改版（resolver 版本化）；窗口前台依赖；高频风控。
37. **Git commit/worktree**：codex/v3-5-acquisition-spike（本轮 commit 后 clean；main 基线未动）。
38. **是否新增正式 dependency**：否（OpenCLI/1688-cli 仍 TEMP；扩展为 TEMP 修改）。
39. **是否修改业务 DB**：否。
40. **是否产生外部写动作**：否（仅页面图搜查询；零写操作）。

## Closed Shadow Auto-Click Spike 报告（任务书 §41，37 项）

1. **最终使用哪一层 resolver**：Level 1 CDP DOM——**class 扫描 resolver**（elementFromPoint 网格 + `search-btn` class）为主，AX backendNodeId resolver 为辅助。
2. **CDP DOM 是否能看到 closed shadow target**：能——`Accessibility.getFullAXTree` 返回 closed shadow 文本节点（backendDOMNodeId），`DOM.getBoxModel` 可解析其坐标。
3. **Accessibility Tree 是否可用**：可用但不稳定（0 vs 4000+ 节点；daemon/扩展重连后 enable 状态丢失）→ 仅作辅助。
4. **Extension closed-shadow API 是否需要**：不需要（未用 chrome.dom.openOrClosedShadowRoot）。
5. **是否修改 OpenCLI TEMP copy**：是——TEMP CLI 加最小 `cdp` 子命令（raw CDP 通道，走扩展 allowlist；非权限扩展）。
6. **是否增加权限**：否（Extension 权限面不变；无 nativeMessaging/history/clipboard/webRequest 新增）。
7. **Target Proof 结构**：page/uploaded/role/name/visible/enabled/box_valid/unique/stale 全项校验（点击前实时执行）。
8. **唯一性判断**：AX 过滤 backendDOMNodeId 后唯一；class 扫描取首个命中。
9. **enabled/visible 判断**：box 宽高>0、viewport 内、elementFromPoint 命中目标。
10. **stale node 处理**：每次点击前重新抓取（backendNodeId 每次页面加载变化，实测 6257→68388→138677→29838→231287）。
11. **点击方法**：CDP Input.dispatchMouseEvent 真实鼠标事件链（mouseMoved/Pressed/Released）。
12. **是否使用真实 CDP mouse event**：是（首选）；JS dispatchEvent 序列为备选。
13. **是否使用 element.click()**：未使用（dispatchEvent mousedown/mouseup/click 序列，非 el.click() 快捷方式）。
14. **3 Case 结果**：按钮自动点击 4/4 触发真实图搜（A 图 2 次、control 图 1 次、C 图 1 次）；B/C 端到端受上传激活环节限制（见 30）。
15. **manual click count**：SEARCH_BUTTON_MANUAL_CLICK_COUNT=0（用户全程未点击"搜索图片"）。
16. **wrong click count**：WRONG_CLICK_COUNT=0（proof 门禁拦截所有非目标；PROOF_FAIL 多次 fail-closed）。
17. **Wrong Entity**：0（卡片同实体；与 native spike 三路互证一致）。
18. **visual search trigger proof**：点击后页面跳转 `air.1688.com/...?tab=imageSearch&imageId=<id>` + 返回真实图搜结果。
19. **fallback 推荐防误判**：未点搜索时页面为默认推荐（对照）；SEARCH_TRIGGERED 以跳转+结果相关性双重验证。
20. **detail cross-check**：4 个图搜候选经 item/offer 读取一致（native spike 已证）。
21. **restart smoke**：daemon 重启自动重连；AX 需重新 enable；页面状态保持（重启后验证过按钮定位）。
22. **页面异常测试**：PROOF_FAIL 场景（遮罩覆盖/坐标偏移）fail-closed 无点击。
23. **duplicate target 测试**：AX 过滤后唯一；未见多目标（若出现则拒绝点击）。
24. **disabled target 测试**：按钮未出现（未上传）时 resolver 返回 NO_TARGET（fail-closed）。
25. **resolver missing 测试**：按钮缺失/页面异常 → NO_TARGET + USER_ACTION_REQUIRED fallback。
26. **CAPTCHA/风控**：高频操作触发 1688 滑块一次（用户人工完成；任务书 §17 允许）。
27. **Cookie/token**：零导出（页面上下文 + CDP；无凭据复制）。
28. **performance**：按钮定位 4s（class 扫描）/ AX 1-3s；点击到跳转 9-10s；注入 3s；每图全流程 ~30-60s。
29. **Chrome/CDP/OpenCLI 版本**：Chrome 151.0.7922.138；OpenCLI 1.8.6；Extension 1.0.22。
30. **是否值得正式产品化**：值得（带条件）——按钮自动点击可靠；上传激活保留每会话一次用户上传（半自动）。
31. **正式推荐实现方式**：class 扫描 resolver（search-btn）+ proof 门禁 + CDP 真实点击；resolver 版本化（v1）。
32. **是否仍保留人工 fallback**：是（resolver 失败/风控 → USER_ACTION_REQUIRED）。
33. **当前最大风险**：1688 页面改版（class/布局变化）；高频操作风控；上传激活环节依赖用户手势。
34. **Git commit/status**：codex/v3-5-acquisition-spike（本轮 commit 后 clean；main 基线未动）。
35. **是否新增正式 dependency**：否（OpenCLI/1688-cli 仍 TEMP；CLI 补丁为 TEMP 调试产物）。
36. **是否修改业务 DB**：否。
37. **是否产生任何外部写动作**：否（仅页面图搜查询；零写操作）。

## Native Image Search Spike 报告（任务书 §39，34 项）

1. **原生图搜入口是否找到**：是——s.1688.com 搜索页相机按钮（"以图搜款"）；air.1688.com 专用图搜页上传实测不可用（"无法识别"）。
2. **Browser Bridge 是否能操作入口**：部分——页面注入文件可行（DataTransfer）；"搜索图片"按钮点击需真实用户（closed shadow 坐标失效）。
3. **本地图片上传是否成功**：是——自动注入（fetch→File→input.files→change）3/3 成功（预览确认）。
4. **是否真正开始 1688 图搜**：是——点"搜索图片"后跳转 `air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch&imageId=...` 结果页。
5. **3 张 Amazon 主图结果**：A（OtterBox 杯）8 候选、B（Igloo Snoopy 午餐盒）6 候选、C（KINTO 杯）6 候选——**3/3 成功**。
6. **每张返回候选数**：8 / 6 / 6（上限取 6-8，未批量爬取）。
7. **有价值候选数**：A 8、B 3（史努比主题）、C 6——合计 17 有价值（A/C 全部相关，B 半数为史努比主题）。
8. **五态分布（人工）**：A：8 likely_similar；B：1 likely_similar（史努比联名房子午餐包）+2 partial+3 different；C：6 likely_similar；**exact_match=0**（图片一样≠同款）。
9. **Wrong Entity**：**0**（卡片同实体绑定 + 三路互证：图搜卡片↔OpenCLI item↔1688-cli detail 对同一 offer 完全一致）。
10. **offerId 可得性**：100%（每卡 detail.m.1688.com?offerId=...）。
11. **URL 可得性**：100%（offerId 链接 + item_url）。
12. **title**：可得（卡片原文，含拼接需解析）。
13. **price**：可得（页面显示价；832349758315 卡片 ¥6.38 vs 详情实价 ¥11.38——displayedPrice 语义实证）。
14. **MOQ**：可得（卡片"起批"文本；832349758315 卡片 1 件 vs 详情 2 件——displayedMOQ 语义实证）。
15. **SKU/specs**：卡片不完整；详情（item/offer）完整。
16. **detail cross-check**：4 个图搜候选经 item/offer 读取，全部一致。
17. **1688-cli/OpenCLI 是否互证**：是——917424058724（史努比房子午餐包 ¥35.9/50 件起批）三路一致；1058608433836 等一致。
18. **是否观察到结构化 Network response**：部分——确认上传走 MTOP `imageBase64ToImageId`（appId 32517）；结果页为 `?imageId=` URL（结构化结果以 DOM 提取为准；响应 body 未保存）。
19. **是否导出 Cookie/token**：**否**（零导出；页面上下文操作）。
20. **是否触发风控**：未出现滑块/验证（3 次搜索全程）。
21. **用户是否需人工处理**：每图 1 次点击"搜索图片"（半自动）；首次一次性扩展加载+登录。
22. **首次耗时**：约 1-2 分钟（页面加载 15-20s + 注入 3s + 点击 + 结果 8-16s）。
23. **后续耗时**：约 30-40s/图（含 item 详情 ~10s）。
24. **重启后是否仍可用**：是——daemon 重启自动重连、会话持久（复测 PASS）。
25. **相比人工图搜是否有价值**：是——自动注入+自动提取+自动详情（人工仅剩 1 次点击与五态确认）。
26. **是否值得正式产品化**：值得（带约束：s.1688.com 入口 + 半自动点击 + 结果人工确认）。
27. **是否需要 search1688api 备用 PoC**：不需要（原生 UI 已跑通，不进入第二候选 PoC）。
28. **官方 API 未来价值**：保留——若获 AK，官方 image search API 可能替代半自动环节（本轮不申请）。
29. **Acquisition Strategy 是否改变**：是——**HYBRID**（B 关键词/详情 + 原生图搜图片发现）。
30. **正式 V3.5 推荐图片找货 UX**：Candidate 主图 → 引导打开 s.1688.com → 自动注入图片 + 用户点"搜索图片" → 自动提取候选 → 人工五态勾选 → 1688-cli 补详情。
31. **当前最大风险**：页面结构依赖（input/按钮/卡片 DOM）+ 半自动人工环节 + s.1688/air 入口行为差异。
32. **Git commit/status**：codex/v3-5-acquisition-spike（本轮 commit 后 worktree clean；main 基线未动）。
33. **是否新增正式 dependency**：否（OpenCLI/1688-cli 仍 TEMP 隔离）。
34. **是否有任何外部写动作**：否（零写操作；仅页面图搜查询）。

## 报告（54 项）

| # | 项 | 结论 |
|---|---|---|
| 1 | Route A 当前真实状态 | **NOT_TESTED**；实测确认 **NOT_CONFIGURED**（产品代码无任何 1688/AK 配置点）；ROUTE_A_ACCESS=BLOCKED_BY_ACCESS_REQUIREMENT（不强迫申请） |
| 2 | Route B 当前真实状态 | **APPROVED（带条件）**：AUTH/SEARCH/DETAIL/重启复测实测 PASS；image-search 实测 NO（fail-open 缺陷，禁用该命令）；similar 官方引擎不可用（fail-closed） |
| 3 | Route C 当前真实状态 | **已实证备选**：bind 当前 Tab/search/item/store/重启复测全部 PASS（重连摩擦≈0）；无 image-search；高权限扩展+首装手动加载为代价 |
| 4 | Manual Benchmark | **已执行**（用户回复"完成"）；**定量指标（耗时/操作数/难度）未提供——缺口如实标注，不虚构** |
| 5 | next-1688 当前真实能力 | 静态确认：官方 Skills 网关（skills-gateway.1688.com / air.1688.com / clawhub.1688.com）；find_product 统一商品结构；text/image/link search 代码存在；**无 license** |
| 6 | AK 获取门槛 | 静态推断：clawhub.1688.com OAuth 授权流程；**真实门槛未实测**（不擅自申请） |
| 7 | API 是否实际调用 | **否**（无 AK，不伪造调用） |
| 8 | 1688-cli 安装是否成功 | **YES**（TEMP 隔离；npm install + build；v0.1.47） |
| 9 | 1688-cli 登录是否成功 | **YES**（`login --headed` 用户扫码；OWN_PROFILE；未读用户 Chrome） |
| 10 | search 是否成功 | **B=YES**（3 关键词，6.2–10.5s，10/10 唯一，search→detail 3/3 一致）；**C=YES**（2 关键词，5.6–6.8s，8/8 唯一）；A 未测 |
| 11 | image search 是否成功 | **Native 1688 图搜=YES（3/3 Case 成功）**：s.1688.com 相机入口（B 的 1688-cli image-search 仍=NO，fail-open 禁用）；A 未测 |
| 12 | offer detail 是否成功 | **B=YES**（3 offer，15 字段全结构化）；**C=YES**（1 offer，item 结构化 + 与 B 互证）；A 未测 |
| 13 | OpenCLI 是否真有 1688 Adapter | **是**（search/item/assets/download/store/login/whoami；无 image-search——实测 help 复核） |
| 14 | Browser Bridge 是否真实可用 | **实测可用**（Extension v1.0.22 连接 + bind 用户真实 Tab + search/item/store 成功） |
| 15 | 是否绑定用户现有 Chrome Tab | **实测确认：是**（bind 绑定用户真实打开的 1688 工作台 Tab；EXISTING_BROWSER_SESSION 实证） |
| 16 | 是否读取/复制 Cookie | **不复制/不导出**：B=OWN_PROFILE（实测）；C=页面上下文内取数（`strategy:"cookie"` 指上下文取数，无 cookie 文件/日志外发——单独报告）；均无 COOKIE_COPY/TOKEN_COPY |
| 17 | 三个 Candidate 结果 | **B/C 均已实测**（candidate-matrix.md）：A=同类候选无同款（图搜失败）；B=4 条 Snoopy（实体级 partial）；C=砧板 5 候选（B）；B/C 同 offer 数据互证 |
| 18 | 图片找货质量 | **APPROVED（带约束）**：Native 图搜 3/3 成功（A 8/8 相关、B 3/6 史努比、C 6/6 相关）；exact_match=0（同类候选，人工确认） |
| 19 | Wrong Entity | **B/C search/detail=0**（结构层 + 交叉验证 + 跨路线互证）；**Native 图搜=0**（卡片同实体 + 三路互证：图搜卡片↔item↔detail）；B image-search=100% 无关（禁用） |
| 20 | title/URL/image | 三 Route 静态 AVAILABLE_STRUCTURED；**B/C 实测确认**（同对象绑定；C search title 为整卡拼接需解析） |
| 21 | displayed price | **B/C 实测**：B 显示价≠实价（¥21.30 vs ¥16.5）；C item 直接给阶梯实价（¥16.5，与 B 互证）——均按 displayedPrice/参考价处理，非采购成本 |
| 22 | price tiers | **B/C 实测 AVAILABLE_STRUCTURED**（B priceTiers[] / C price_tiers[] quantity_min+price+currency）；A ⏳ |
| 23 | MOQ | **B/C 实测**：minOrderQty / moq_value=1（互证）；**维持 displayedMOQ，不升级语义** |
| 24 | SKU/specs | **B 实测 AVAILABLE_STRUCTURED**（skus[] skuId/specs/price/multiPrice/stock/saleCount/image）；**C 未结构化**（无 SKU 明细） |
| 25 | supplier metadata | **B/C 实测**：B=name/shopUrl/years/verified/turnover/saledCount；C=store 入驻年限/badges/回头率/类目——仅展示不计分 |
| 26 | Credential Model | A=API_KEY/OAuth；B=OWN_PROFILE+扫码（实测）；C=EXISTING_BROWSER_SESSION（实测）——全部优先接受，无 COOKIE_COPY/TOKEN_COPY |
| 27 | CAPTCHA/risk control | **实测未出现滑块**（B/C 全程）；图搜失败非滑块（headed 复测）；B/C 滑块策略=用户人工 |
| 28 | 海外 IP 影响 | 匿名撞登录墙（确认）；**扫码/已登录会话可用**（B/C 实测） |
| 29 | 首次用户操作量 | **B=扫码 1 次（实测）**；**C=手动装扩展+登录 1 次（实测，命令行加载失效→手动 Load unpacked，摩擦高于 B）**；A=配置 AK 1 次；Manual=每次手工 |
| 30 | 后续用户操作量 | **B/C=命令即得（实测）**；C 另需保持浏览器+扩展存在；A 待；Manual=无复用 |
| 31 | Manual 耗时 | **未提供**（用户未给定量；缺口保留） |
| 32 | 自动比 Manual 节省 | **B/C 结构论证成立**（一次登录→命令即得、零复制粘贴 vs 每次手工多步）；量化判据缺口如实标注 |
| 33 | 哪条结构化最好 | **B 实测 15 字段全结构化 + SKU 明细**；C item 结构化但 search 原文拼接、无 SKU；A 静态最强（SKU 同 item 绑定） |
| 34 | 哪条最稳定 | **B/C 实测均通过重启复测**（B 会话复用；C 自动重连无需重新 bind/登录）；A 待 |
| 35 | 哪条最容易维护 | A（官方 API）> C（页面 DOM）> B（MTOP 内部协议）；B 另需跟踪图搜缺陷（已禁用） |
| 36 | 哪条最适合小白 | **B 候选**（扫码后命令即得，首装摩擦最低）；C UX 直观但扩展安装摩擦高（实测）；Manual 每次手工 |
| 37 | 哪条最符合 Evidence-first | 全部可（Search→Preview→Human Confirm 不变）；**B/C 实测结构化+绑定可靠**，适配 Evidence Matrix |
| 38 | 哪条正式值得接 | **B（LOCAL_SESSION_CLI），带强制条件**：禁 image-search、显式 ok 校验、字段脱敏（receiveAddress/卖家账号/地址电话）、写命令零暴露、MTOP 风险登记；C 为已实证备选；A 若日后有 AK 可复评 |
| 39 | 是否值得做图片找货 | **是（Native 图搜）**：s.1688.com 相机入口 3/3 成功、实体绑定可靠、半自动（每图 1 次点击）；B 实现仍 NOT_FIT（禁用）；A 未测 |
| 40 | 原 Assessment 哪些 CONFIRMED | NARROW_APPROVAL / Sourcing Evidence 定位 / Seller Claim≠Fact / 页面价≠成本（新增实测证据）/ MOQ 语义 / Evidence Matrix / Unknown / Question Generation / Supplier Score 禁止 / PROFIT=ASSUMPTION_ONLY / 旧 Agent 不复活——全部保持 |
| 41 | 哪些 SUPERSEDED | **"Manual Import 唯一路径"正式 SUPERSEDED**（B/C 双路线实测可用）；**图片找同款环节仍不可替代** → Manual=KEEP_AS_FALLBACK |
| 42 | 正式 V3.5 推荐 UX | Candidate→B 自动获取候选/详情→Preview→人工勾选→Evidence Matrix→询盘问题；禁"推荐供应商"；图搜入口=引导人工；按钮保持证据门禁 |
| 43 | 正式最大允许范围 | 冻结不变（自动/半自动找候选 + Preview + Confirm + Evidence + 询盘问题生成；禁评分/采购/利润/合规/询盘/下单） |
| 44 | 最大风险 | **B**：MTOP 合规/稳定 + image-search fail-open（已禁用）+ receiveAddress PII（脱敏）；**C**：Extension 权限面+常驻 + 卖家公司地址/电话 PII（脱敏）；**A**：license/AK 门槛 |
| 45 | Git branch/commits/clean | codex/v3-5-acquisition-spike；提交：e1fb585（静态）/ 8ced93f（validation prep）/ f871c18（fail-closed 记录）/ 88b612a（B 实测报告）/ 本轮（C 实测+最终裁定）；worktree clean（提交后） |
| 46 | 是否新增正式 dependency | **否**（外部项目仅 TEMP 安装/审计，未入 package.json） |
| 47 | 是否写业务 DB | **否** |
| 48 | 是否产生采购/询盘外部动作 | **否**（零外部写操作；B daemon 事件日志审计仅 search/image-search/offer/similar/whoami；C 仅 bind/search/item/store） |
| 49 | 是否读取敏感 credential | **否**（B 扫码 OWN_PROFILE；C 复用用户浏览器会话；均无 cookie 复制/导出/打印；账号标识未入文档） |
| 50 | 是否需要正式 V3.5 Implementation | 由用户决定；本 Spike 不开始；**V3_5_IMPLEMENTATION_AUTHORIZATION_REQUIRED=TRUE** |
| 51 | Route B 实测总结 | INSTALL/AUTH/SEARCH/DETAIL/重启复测=**PASS**；IMAGE_SEARCH=**FAIL（fail-open）**；similar=fail-closed 不可用；写操作=0；结论=**APPROVED（带条件）** |
| 52 | 图搜实测细节（B） | 3 张不同 Amazon 主图→同一批 8 条无关商品、exit 0；结果页实为"以图搜款"落地页；imageId 有效但结果页不识别；headed 复测一致；**设计缺陷（capture 无结果页校验）→ MAINTENANCE_RISK_HIGH，不 fork；该命令禁用** |
| 53 | Route C 实测总结 | 首装=命令行 --load-extension 失效→手动加载（摩擦记录）；bind 当前 Tab=PASS（EXISTING_BROWSER_SESSION）；search 8/8、item 结构化+与 B 互证、store 含公开联系信息（脱敏）；**重启复测=自动重连、无需重新 bind/登录（摩擦≈0）**；测试后已停 daemon，建议移除扩展+删测试 profile |
| 54 | 实测新发现安全项 | B：`freight.receiveAddress`=用户默认收货地址（PII）+ 卖家账号标识 + LOCK_BUSY 残留锁；C：`store` 卖家公司完整地址+电话（PII）+ seller member_id；两 Route 均需字段级脱敏；C daemon 127.0.0.1 回环确认、无 telemetry |

## 最终状态（实测完成 + Native 图搜 + Auto-Click + File Chooser 全自动，2026-08-15）

```
ACQUISITION_STRATEGY = HYBRID            # B(关键词/详情) + 原生图搜(图片发现) 真实互补
KEYWORD_SEARCH = LOCAL_SESSION_CLI
IMAGE_DISCOVERY = BROWSER_BRIDGE_NATIVE_UI_AUTOMATED  # 上传+搜索+提取全自动
IMAGE_DISCOVERY_AUTOMATION = FULLY_AUTOMATED
DETAIL = LOCAL_SESSION_CLI               # 次要：BROWSER_BRIDGE item
SECONDARY_CURRENT_TAB = BROWSER_BRIDGE
ROUTE_A_API = NOT_TESTED                 # （ROUTE_A_ACCESS=BLOCKED_BY_ACCESS_REQUIREMENT；CONFIGURED=NO）
ROUTE_B_1688_CLI = APPROVED              # 带强制条件（禁 1688-cli image-search；脱敏；ok 校验；写命令零暴露）
ROUTE_C_BROWSER_BRIDGE = APPROVED        # 已实测
MANUAL_IMPORT = KEEP_AS_FALLBACK
IMAGE_SEARCH = APPROVED                  # Native 1688 图搜三 Case 实测成功
NATIVE_1688_IMAGE_SEARCH = APPROVED
NATIVE_IMAGE_SEARCH_AUTO_CLICK = APPROVED  # 按钮自动点击 4/4、0 误点
AUTO_CLICK_METHOD = CDP_DOM
TRUSTED_FILE_CHOOSER_AUTOMATION = APPROVED # 首传自动（3/3 + Restart Fresh PASS）
FIRST_UPLOAD_MANUAL_ACTION_COUNT = 0
SEARCH_BUTTON_MANUAL_CLICK_COUNT = 0
WRONG_UPLOAD_COUNT = 0
WRONG_CLICK_COUNT = 0
NORMAL_IMAGE_SEARCH_USER_TECHNICAL_ACTIONS = 0

V3_5_ACQUISITION_STATIC_AUDIT = PASS
V3_5_ACQUISITION_SPIKE = DONE
V3_5_NATIVE_IMAGE_SEARCH_SPIKE = DONE
V3_5_CLOSED_SHADOW_AUTO_CLICK_SPIKE = DONE
V3_5_TRUSTED_FILE_CHOOSER_SPIKE = DONE
V3_5_IMAGE_AUTOMATION_SPIKES = CLOSED
V3_5_IMPLEMENTATION_AUTHORIZATION_REQUIRED = TRUE
V3_6_AUTHORIZATION_REQUIRED = TRUE
PUBLIC_DEPLOY = FORBIDDEN
```

## 下一步（等待用户指示）

1. **是否开始正式实现**（LOCAL_SESSION_CLI + 强制条件清单）——需用户授权（V3_5_IMPLEMENTATION_AUTHORIZATION_REQUIRED=TRUE）；本 Spike 不开始。
2. （可选）用户补充 Manual 定量指标 → 量化"优于 Manual"判据。
3. （可选）用户自行获取 Route A AK → 补测官方 API（可能优于 B：结构化最强、无 MTOP 风险；届时复评 API_FIRST）。
4. 收尾清理（建议）：关闭 Route C 测试 Chrome 窗口 → 在 chrome://extensions 移除 OpenCLI 扩展 → 删除 `D:\Workspace\tmp\opencli-route-c\test-profile`（含测试登录会话）。
