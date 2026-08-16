# V3 Final Interaction & Research Navigation Correction — 最终用户旅程验收

> 环境：3005（main == daad491）headed Playwright；真实浏览器；真实 Amazon/1688 网络。

## R1 — 1688 登录/重新检测
- 两套登录说明常驻：关键词/链接=「关键词登录」、图片=浏览器助手+普通 Chrome，互不影响 ✓
- 重新检测必有反馈："刚刚检测：01:34 · 关键词工具：未安装 · 浏览器助手：已连接"（时间戳+分项）✓
- 工具未配置时 [重新检测] 按钮可用（不再死路）；工具可用时 [打开 1688 登录窗口]（固定 capability）✓
- 图片找货独立就绪（浏览器助手 ✓ 时图搜区独立）✓

## R2 — AI 动作收口
- 顶部无"AI 整理当前资料"链接（引导卡仅提示文字，指向下方「AI 证据总结」区）✓
- 点击"生成 AI 证据总结"：URL 保持 /tasks/[id]（不跳转、不离开 Workbench）✓
- 唯一 AI Evidence Summary action ✓

## R3 — Decision 保存
- 旧版：combobox 改草稿 + 显式[保存旧版状态] + "仅更新兼容状态，不生成新版决定记录" + 未保存提示 ✓
- 改"待判断"→"可继续"→ 保存 → "人工状态已保存" → 刷新后仍"可继续" → API 列表 decisionStatus=continue ✓

## R4/R6 — Studio Handoff
- 旧版任务（无新版创作上下文）：Studio CTA 不伪装可用——显示"该历史研究记录缺少新版创作资料，需要重新确认研究资料后才能用于创作" ✓
- Studio resolver：taskAccessible=false → 404（防枚举）；同 actor 业务态 → 200+gateReason（细分错误契约）✓
- 新版任务直达：creativeHandoffVisitor.e2e.test 12 用例 + gate 测试 3 用例 PASS ✓

## R5 — 商品研究/研究记录拆分
- 左侧导航：工作台 / 发现商品 / 待研究商品 / **商品研究(/research)** / **研究记录(/tasks)** / Listing / Image ✓
- /research：标题"商品研究"+副标题"继续正在进行或等待补充资料的商品研究"+Tab（进行中/待补信息/全部）+9 条 active+"继续研究"CTA ✓
- /tasks：标题"研究记录"+副标题"已经形成历史结果的研究"+Tab（已完成/已放弃/历史/全部——无"进行中"主内容）+0 条（空态合理）✓
- active 任务页（?from=research）：Sidebar 仅"商品研究"高亮（/research => page，/tasks => none）✓
- 新任务创建 → /tasks/[id]（商品研究标题）✓
- classifyResearchLifecycle 统一分类（版本决策 creative_ready/needs_information/abandoned + 旧版 pending/continue/need_info/rejected）✓

## R7 — 研究资料状态自动同步
- 清单移入 EvidenceWorkbench，从各 Evidence 区实时 state 派生 ✓
- 初始：商品基础=待补（无来源身份）/ Amazon=待补 / 评论=待补 ✓
- Amazon 采集确认保存后：**Amazon 页面 待补→已有**（即时，不刷新）✓
- VOC 批量导入 3 条确认后：**买家评论 待补→已有**（即时）✓
- 持久化派生（刷新后 Amazon 已有仍正确）✓
- preview/AI summary 不参与判定 ✓

## 币种校准（新任务）
- 复现：日本代理下 amazon.com 显示 JPY8,279 + 配送地 Japan ✓
- 校准流程真实执行：自动导航 → 配送 ZIP 10001 → 检测 → 判断非 US → 明确提示"已尝试自动校准，但当前仍不是 Amazon US 价格环境（配送地：配送至: 日本）。价格不会保存（fail-closed）" ✓
- 价格 JPY fail-closed（未保存）✓；其余字段正常提取（评分/评论数）✓
- 本机代理限制：Amazon 端基于 IP 拒绝切美国（非我们可控）；US 环境时校准会确认 USD 并显示"已校准美国配送与币种"
- 无 JPY→USD 换算、无 DOM 伪造 ✓
