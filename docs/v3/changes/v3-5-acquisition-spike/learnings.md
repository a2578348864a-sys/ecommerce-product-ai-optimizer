# V3.5-A — Learnings

> 每条可被源码/文档/工具结果证明；禁止泛泛而谈。

1. **原假设**：OpenCLI 可能没有 1688 adapter（旧认知）。
   **实测**：`jackwener/OpenCLI`（28,205★）主仓 `clis/1688/` 确有 search/item/assets/download/store/auth 五命令 + `docs/adapters/browser/1688.md`；Bridge 机制（Extension MV3 + localhost daemon + CDP targetId↔tabId bind + `OPENCLI_CDP_TARGET` 限定）真实存在。
   **最终规则**：外部项目能力必须以**当前主仓源码**裁定，禁止基于旧认知/旧模型记忆预判 NOT_FIT。
   **证据**：sparse clone 源码 + 1688.md。
   **失效条件**：主仓重构删除 adapter。
   **下一阶段**：实测 bind/search。

2. **原假设**：官方 AK 需要企业资质（V3.5 Assessment 的推测）。
   **实测（静态）**：next-1688 的 AK 获取走 `clawhub.1688.com` + OAuth 2.1/PKCE（`air.1688.com` 授权页，本地回调服务器），文档未提企业资质强制——**真实门槛未实测确认**。
   **最终规则**：门槛结论必须实测（用户授权流程）后才能定；不擅自注册/申请。
   **证据**：configure.md + authorize.py + _auth.py。
   **失效条件**：clawhub 实际要求商家/付费。
   **下一阶段**：用户决定是否实测获取。

3. **原假设**：1688-cli 会复制用户浏览器 Cookie（风险预判）。
   **实测（静态）**：`1688 login` 扫码 + Playwright `launchPersistentContext` **工具自有 profile**（`~/.1688/profiles/`），不读用户 Chrome；Credential Model = OWN_PROFILE + USER_QR_LOGIN。
   **最终规则**：以源码裁登录模型；"会偷 Cookie"类指控必须源码验证。
   **证据**：session/context.ts + paths.ts + SAFETY.md。
   **失效条件**：未来版本改变登录实现。
   **下一阶段**：实测扫码与 session 持久。

4. **原假设**：1688-cli 走官方公开接口。
   **实测（静态）**：依赖 **MTOP 内部协议**（`mtop.1688.buycenter.*`、`hijack window.lib.mtop.request`、parseMtopJsonp）——undocumented 内部接口。
   **最终规则**：内部协议 = 合规/稳定高风险；正式采用前必须实测 + 独立评估；官方 API（Route A）优先级更高。
   **证据**：cart-add.ts/cart-list.ts 注释 + docs/playbooks/add-mtop-capture.md。
   **失效条件**：1688 官方开放 MTOP 或提供公开 API。
   **下一阶段**：Route A 实测优先。

5. **原假设**：OpenCLI 1688 adapter 会导出 Cookie/Token。
   **实测（静态）**：`page.getCookies({url:'https://www.1688.com'})` 仅用于**登录态验证**（`__cn_logon__=true`/unb/lid），不持久化/不导出/不发送；Credential Model = EXISTING_BROWSER_SESSION。
   **最终规则**：页面上下文内读 cookie 验证 ≠ COOKIE_COPY；但 Extension 权限（<all_urls>+cookies+debugger）+ daemon 无鉴权仍需安全评审。
   **证据**：clis/1688/auth.js + extension/manifest.json + background.ts。
   **失效条件**：未来版本增加 cookie 导出/上传。
   **下一阶段**：安全评审 + 实测。

6. **原假设**：三条 Route 中至少一条能直接"成功"。
   **实测（静态）**：全部 Route 的实测层均为 NOT_TESTED——静态审计只能裁定架构/安全/合同，不能裁定成功率。
   **最终规则**：成功率结论必须实测（用户配合扫码/登录/AK）；"项目存在/维护/结构化" ≠ "适合轻选"。
   **证据**：external-project-audit.md 分层表。
   **失效条件**：无。
   **下一阶段**：用户配合实测。

## 实测阶段 Learnings（2026-08-15，真实运行证据）

7. **原假设**：1688-cli 的 image-search 至少"能跑出结果"。
   **实测**：3 张不同 Amazon 主图 → 3 次返回**完全相同的 8 条无关商品**，`exit 0` 无告警（fail-open）；结果页实为"以图搜款"落地页；上传 imageId 有效但结果页不识别；`--headed` 复测一致（非滑块）。
   **最终规则**：第三方工具的"声称能力"必须实测 + **校验输出语义**（不是"有输出"=成功）；对结果页状态无校验的命令可能静默返回兜底数据。
   **证据**：v35-evidence 3 个 img-*.json + diag-image-result.cjs（结果页内文）+ src/session/search-capture.ts（keep:'largest' 无状态校验）。
   **失效条件**：上游修复结果页校验。
   **下一阶段**：若需图搜，改用官方 air.1688.com 能力（Route A）或浏览器人工图搜；**不得使用该命令**。

8. **原假设**：工具输出"价格"可直接当采购成本。
   **实测**：offer 930374004918 页面显示价 `priceRange=¥21.30`，实际 `priceTiers[0]=¥16.5`、`sku.multiPrice=16.5`（差 ¥4.8/个）——显示价≠实价，且工具同时暴露两个值。
   **最终规则**：任何 Route 的价格字段一律按 displayedPrice（+nature）表达；阶梯/实价需按 SKU 绑定校验后才能给用户"参考价"，永远不是采购成本。
   **证据**：v35-evidence/offer-3.json。
   **失效条件**：无（1688 展示机制如此）。
   **下一阶段**：V3.5 合同不变（displayedPrice 三态）。

9. **原假设**：第三方浏览器自动化工具输出只有商品数据。
   **实测**：`offer` 输出含 `freight.receiveAddress`（**用户 profile 默认收货地址，PII**）+ `supplier.memberId/userId/loginId`（账号标识）——工具输出面超出"公开商品数据"。
   **最终规则**：外部工具输出必须做字段级白名单/脱敏；含 PII 的字段在集成层丢弃，不进证据、不进日志。
   **证据**：v35-evidence/offer-3.json（值已脱敏，不入文档）。
   **失效条件**：上游删除该字段。
   **下一阶段**：正式集成增加脱敏层。

10. **原假设**：同一工具的失败模式一致。
    **实测**：同一后端（1688 视觉搜索）不可用时，`image-search` fail-open（静默垃圾结果）、`similar` fail-closed（SIMILAR_UNAVAILABLE 明确报错）——**同一工具内部错误处理不一致**。
    **最终规则**：集成外部工具必须逐命令验证失败模式；fail-open 命令禁用或加输出校验。
    **证据**：img-*.json（exit 0 垃圾）vs similar.json（ok:false+错误码）。
    **失效条件**：无。
    **下一阶段**：Route B 集成时只启用 search/offer 路径。

11. **原假设**：重启后必须重新登录。
    **实测**：daemon stop → 重启 → `whoami loggedIn=true`（**会话复用，无需重新扫码**）→ search 重跑成功；事件日志确认全程零写操作。
    **最终规则**：OWN_PROFILE 会话持久性实测成立；重启复测是"可日常使用"的必要证据。
    **证据**：whoami 两次输出 + events.jsonl（仅 search/image-search/offer/similar/whoami）。
    **失效条件**：1688 会话过期策略变化。
    **下一阶段**：长期稳定性需多日观察（超 Spike 范围）。

12. **原假设**：Manual benchmark 数字会自动得到。
    **实测**：用户回复"完成"但未提供定量指标（耗时/操作数）——**数据缺失**。
    **最终规则**：用户配合类数据可能缺失；裁定不依赖缺失数字，用功能可达性 + 操作结构论证，并如实标注缺口。
    **证据**：对话记录。
    **失效条件**：用户补充数据。
    **下一阶段**：最终裁定按"结构论证"口径。

## Route C 实测 Learnings（2026-08-15，真实运行证据）

13. **原假设**：`--load-extension` 命令行参数能自动装扩展。
    **实测**：Chrome 151（Windows）**忽略该参数**，扩展未加载（daemon disconnected、profile 无扩展）；手动 chrome://extensions → 开发者模式 → Load unpacked 才成功。
    **最终规则**：Chrome 扩展分发的自动化不可依赖命令行；产品化路径必须是商店安装或明确的手动加载指引（首装摩擦成本计入 UX）。
    **证据**：launch-test-chrome.bat 实测 + profile Preferences 检查 + daemon status 变化。
    **失效条件**：Chrome 恢复命令行加载。
    **下一阶段**：若采用 C，需商店版或更友好安装流。

14. **原假设**：Route C 的 search 输出与 Route B 一样结构化。
    **实测**：C 的 `title`/`price_text` 是**整卡原文拼接**（标题+价格+销量+徽章+卖家名一个字符串，`¥ 12 .5` 空格格式），需二次解析；B 的 search 输出是分离结构（price{text,min,max}/supplier{name,shopUrl,years}）。但 C 的 **item 输出结构化良好**（price_tiers/moq_value/visible_attributes/main_images），且与 B 同一 offer 数据**完全互证**（实价 ¥16.5/MOQ=1/供应商/年限）。
    **最终规则**：同一 adapter 内不同命令的结构化程度可能差异巨大——逐命令实测字段形态，不做整体假设；跨 Route 同 offer 互证是实体绑定可靠性的强证据。
    **证据**：c-search-a/b.json vs c-item-*.json（TEMP 证据目录）。
    **失效条件**：上游改输出。
    **下一阶段**：若采用 C，search 输出需解析层或直接引导用户用 item。

15. **原假设**：daemon 重启后需要重新 bind/重新登录。
    **实测**：`daemon stop` → 直接再跑 item → **daemon 自动拉起 + Extension 自动重连 + 无需重新 bind + 无需重新登录**（绑定 Tab 原样保持）——reconnect friction ≈ 0。
    **最终规则**：重启复测必须实测"自动重连"而非假设；C 的会话持久性来自用户浏览器（天然持久），优于独立 profile 方案。
    **证据**：daemon stop → status not running → item 成功 → status connected（新 PID 19s）。
    **失效条件**：扩展更新/浏览器重启（用户侧）。
    **下一阶段**：长期稳定性需多日观察（超 Spike 范围）。

## Native 图搜 Spike Learnings（2026-08-15，真实运行证据）

16. **原假设**：1688 原生图搜入口只有一个（air.1688.com 专用页）。
    **实测**：**s.1688.com 搜索页相机按钮可用**；**air.1688.com/kapp/1688-search/pc-image-search/ 专用页上传不可用**（"无法识别"=前端本地 FileReader 链异常，未发上传请求；用户手动/自动注入/禁用扩展/重启均失败）。点"搜索图片"后结果页跳到 air.1688.com（`?tab=imageSearch&imageId=`）——**上传在 s.1688、结果页在 air.1688**。
    **最终规则**：入口差异必须实测；"同一产品不同入口行为不同"是常态。
    **证据**：三 Case 图搜 + air 页 4 图多轮失败记录。
    **失效条件**：1688 改版统一入口。

17. **原假设**：上传图片后图搜自动执行。
    **实测**：**必须再点"搜索图片"按钮**才执行视觉搜索；上传只把图放入队列（"已上传1张图片"），未点按钮时页面显示的是默认推荐（曾误判为"兜底推荐/fail-open"）。
    **最终规则**：流程断点必须用"按钮级"验证（源码定位 noImgFileText/上传流程），不能凭页面文本猜。
    **证据**：213.js 源码（z 函数）+ 未点/点按钮的结果对比（默认推荐 vs 冰霸杯/史努比/KINTO 相关结果）。
    **失效条件**：无。

18. **原假设**：自动化能完成整个图搜（含按钮点击）。
    **实测**：文件注入（DataTransfer）可行；**"搜索图片"按钮在 closed shadow DOM 中，AX ref 坐标点击失效**——真实用户点击可靠（3/3 成功）。
    **最终规则**：closed shadow 组件的自动点击不可依赖；半自动（注入+人工点击）是当前可靠模型。
    **证据**：click ref 多次失败 vs 用户点击 3 次成功。
    **失效条件**：上游改 DOM 结构或提供可点击入口。

19. **原假设**：图搜返回"同款"。
    **实测**：三 Case 返回**同类候选**（A：冰霸杯；B：史努比主题 3/6；C：日系简约杯），**exact_match=0**；卡片显示价/起批与详情实价/实批不一致（¥6.38 vs ¥11.38；1 件 vs 2 件）。
    **最终规则**：图搜=候选发现；displayedPrice/displayedMOQ 语义不变；五态人工核查保留。
    **证据**：三 Case 结果 + item/detail 交叉验证。
    **失效条件**：无。

## Closed Shadow Auto-Click Learnings（2026-08-15）

20. **原假设**：closed shadow 内按钮无法通过 CDP 定位。
    **实测**：`Accessibility.getFullAXTree` 返回 closed shadow 内文本节点（含 backendDOMNodeId）；`DOM.getBoxModel(backendNodeId)` 对 closed shadow 节点有效——**Level 1 CDP DOM 可定位 closed shadow 目标**。但 **AX 域在本环境时好时坏**（0 vs 4000+ 节点；daemon/扩展重连后 enable 状态丢失）。
    **最终规则**：AX 作为 resolver 之一；**class 扫描 resolver（elementFromPoint 网格 + `search-btn` class）更稳定**（closed shadow hit-testing 有效）；每次点击前实时抓取（backendNodeId 每次页面加载都变——实测 6257→68388→138677→29838→231287）。
    **证据**：4 次自动点击成功（imageId 1539808815442953643/1273208815446377332/1730108816945124731/1159808815372524974）。
    **失效条件**：1688 改版（class 变化）——resolver 版本化。

21. **原假设**：脚本 dispatchEvent click 可以激活页面上传模式。
    **实测**：`.image-upload-button-container` 无 React onClick（事件委托未响应 dispatch）；CDP 点击容器区域被隐藏 input 覆盖；**上传模式（O(true)）只能由真实用户手势可靠激活**；新页面注入概率性成功；**bfcache 恢复页面点击无效**。
    **最终规则**：上传激活=用户每会话一次手动上传（产品模型：激活后同页面注入替换+自动点击全自动）；不依赖脚本激活。
    **证据**：12+ 次脚本激活尝试失败 vs 用户手动激活后按钮秒现且自动点击成功。
    **失效条件**：1688 改版改变激活机制。

22. **原假设**：自动点击最怕"点不到"。
    **实测**：真正防线是**防误点**——`elementFromPoint` Target Proof（命中元素文本必须"搜索图片"）在多次瞬态遮罩（J_MIDDLEWARE_FRAME_WIDGET）、坐标偏移场景正确 fail-closed（PROOF_FAIL），**WRONG_CLICK_COUNT=0**。
    **最终规则**：自动点击必须 proof-gated；不能证明 target==搜索提交按钮就不点。
    **证据**：PROOF_FAIL 多次拦截记录。
    **失效条件**：无。

## Trusted File Chooser Learnings（2026-08-15）

23. **原假设**：file chooser 必须靠真实鼠标点击触发。
    **实测**：Chrome 151 中 **JS `el.focus()` + CDP 可信键盘 Enter** 可稳定打开 file chooser（聚焦的 file input 回车=用户 Tab+Enter 等价）；CDP 鼠标点击在页面顶部区域（y<150）不达页面（浏览器级限制），input 恰在顶部——鼠标方案不可靠、键盘方案可靠（upload 526ms）。
    **最终规则**：chooser 触发方式按页面/区域实测选择；键盘激活是正规路径（等价用户操作）。
    **证据**：focus+Enter 方案 3 Case 3/3 + Restart Fresh Session PASS。
    **失效条件**：页面/浏览器改版改变键盘激活行为。

24. **原假设**：CDP 输入事件与窗口焦点无关。
    **实测**：**窗口未聚焦时 CDP 鼠标/键盘事件被浏览器丢弃**（eval 正常但输入不达页面）；窗口前台时全部正常——早期多次"CDP 点击无效"即因此。
    **最终规则**：浏览器自动化必须保证目标窗口在前台；产品化时引导用户保持窗口可见。
    **证据**：聚焦前后对比（聚焦前 c=0/k=0；聚焦后 3/3 PASS）。
    **失效条件**：无（浏览器行为）。

25. **原假设**：页面布局稳定。
    **实测**：s.1688.com 有两种布局（标准 y=81 与紧凑 y=17）——y=81 时上传链全自动成功；y=17 时 input 在顶部死区（上传失败）。**处理**：rect 稳定等待 + y<50 重开页面重试（实测重试成功）。
    **最终规则**：页面布局波动必须纳入 resolver（版本化+重试）；不能假设布局恒定。
    **证据**：y=81 4 次成功 vs y=17 多次失败→重试恢复。
    **失效条件**：1688 改版统一布局。
