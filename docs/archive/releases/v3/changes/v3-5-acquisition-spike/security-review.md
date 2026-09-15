# V3.5-A — Security Review（安全审计 + Credential Models）

> 静态审计结论（2026-08-15）+ **实测阶段发现（Route B/C 实测完成）**。

## 1. Credential Model 逐 Route（任务书二十二节）

| Route | Credential Model | 类别 | 判定 |
|---|---|---|---|
| A（next-1688/官方网关） | **API_KEY**（+ OAuth 2.1/PKCE token，本地 `.1688-oauth/` 加密存储） | API_KEY | ✅ 优先接受 |
| B（1688-cli） | **OWN_PROFILE + USER_QR_LOGIN**（Playwright 自有 profile `~/.1688/profiles/`） | OWN_PROFILE | ✅ 优先接受 |
| C（OpenCLI Bridge） | **EXISTING_BROWSER_SESSION**（复用用户已登录 Chrome；cookie 仅登录态验证） | EXISTING_BROWSER_SESSION | ✅ 优先接受（权限面需评审） |
| — | COOKIE_COPY / TOKEN_COPY | 禁止类别 | 三条 Route **均不涉及**（源码确认：无 cookie/token 导出、无用户浏览器 profile 复制） |

## 2. 凭据处置检查

- Route A：AK/OAuth token 写入 `workspace/.1688-oauth/`（本地加密 secure_store）；**无 console 打印、无日志记录**（源码未见 print/log token）。
- Route B：登录 cookie 存工具自有 profile（`~/.1688/profiles/`）；SAFETY.md 明确不把 QR URL 直接打开、logout 销毁会话。
- Route C：cookie 仅在页面上下文内 `page.getCookies` 读取验证（不存盘、不导出、不发送）。
- **本轮未执行任何真实授权/登录 → 无凭据产生**；正式 PoC 阶段凭据纪律：不打印/不 commit/不入 docs/不入 Prompt（任务书二十三节）。

## 3. 供应链与执行风险

| 项 | A | B | C |
|---|---|---|---|
| install/postinstall 风险 | 低（纯 Python 依赖） | 中（postinstall 下载 Chromium + 重启 daemon；范围限定工具自有目录） | 中（Extension 手动安装；npm CLI） |
| 任意代码执行面 | 低（官方网关） | 中（MTOP 抓包/浏览器自动化） | 中（Extension debugger 全站权限） |
| 数据外发/telemetry | 无（源码未见） | 无（未发现遥测） | 无（background 仅连 localhost daemon） |
| daemon/本地服务 | 无 | `~/.1688` daemon（自有） | localhost:19825 daemon（**无鉴权**——风险点） |

## 4. Prompt Injection 边界（任务书二十四节）

- 三 Route 返回的 title/description/seller text/specs/shop content 全部视为 **UNTRUSTED DATA**：
  - 不进入 system/developer instruction；
  - 不给页面数据工具/shell/文件/网络权限；
  - 页面文本含"运行 XXX 命令"仅作展示文本（与 V3.4 同策略）。
- 未来 AI 分析层复用 V3.4 的 evidenceRefs/fail-closed 模式（本 Spike 无 AI 调用）。

## 5. 停止条件对照（任务书四十九节）

| 条件 | 静态判定 |
|---|---|
| 必须绕 CAPTCHA | 无（B/C 滑块均由用户人工；A 无） |
| 必须复制 Cookie/token | 无（三 Route 均不复制） |
| 必须读密码 | 无 |
| 高风险浏览器权限 | C 存在（<all_urls>+cookies+debugger）——**待用户安全评审**，不可接受则 Route C 降级 |
| 外部工具供应链风险不可接受 | B 的 MTOP 属此类风险（待实测裁定） |
| Wrong Entity 无法为 0 | 待实测（A/C 静态确认实体键设计良好） |
| 大规模爬站 | 无（均按需查询） |
| 登录稳定性 | 待实测 |
| 普通用户操作比 Manual 更复杂 | 待实测（首次 friction 记录于 candidate-matrix） |

## 6. 结论（静态层）

- 三条 Route 的 Credential Model 全部落在"优先接受"区间；**无 COOKIE_COPY/TOKEN_COPY**。
- 最大静态风险点：**Route C 的 Extension 权限面 + daemon 无鉴权**（需安全评审）；**Route B 的 MTOP 内部协议**（合规/稳定）。
- Route A（官方 API）静态最干净；受 AK 获取阻塞。

## 7. 实测阶段发现（2026-08-15，Route B 完成 / Route C 待用户）

### 7.1 Credential Model 实测确认

- **Route B 实测**：扫码登录全程无凭据泄露——工具未读取/复制用户 Chrome Cookie（OWN_PROFILE 确认）；账号标识按纪律不入文档。
- **Route C 实测**：`bind` 绑定**用户真实打开的 Tab**（EXISTING_BROWSER_SESSION 实证）——登录态来自用户浏览器会话；`store` 输出 `strategy:"cookie"` 指**页面上下文内取数**（非导出/复制/持久化——无 cookie 文件、无日志外发，单独报告）；daemon 监听 **127.0.0.1:19825（仅本机回环）**；Extension 实际 manifest 复核与静态审计一致（v1.0.22，无 native messaging/无 telemetry）。

### 7.2 新发现（Route B/C）

1. **image-search fail-open 缺陷（B，中-高风险）**：3 张不同图返回同一批无关结果且 `exit 0` 无告警——**静默垃圾数据 = 下游 Wrong Entity 风险源**；采用本工具时必须显式校验 `ok:true` + 结果相关性人工核查，或**完全禁用该命令**。
2. **PII 输出面（B/C，中风险）**：B `offer` 含用户默认收货地址（receiveAddress）+ 卖家账号 id；C `store` 含**卖家公司完整地址+电话**、`item` 含卖家 member_id——两 Route 集成都必须字段级脱敏。
3. **C 扩展首装摩擦（低风险但 UX 成本）**：Chrome 151 忽略 `--load-extension` 命令行参数 → 必须手动 Load unpacked（实测）；`<all_urls>`+cookies+debugger 权限面与静态一致，**测试后已停 daemon，建议用户移除扩展并删除测试 profile**（不留高权限 Bridge 后台运行）。
4. **残留锁（B，低风险）**：崩溃/强杀后 `LOCK_BUSY` 需手动清理 `.lock.lock`（实测一次）。
5. **fail-closed 对照（正面）**：B 未登录 exit 3 / similar SIMILAR_UNAVAILABLE、C 未连接 exit 69——明确报错不伪造；唯 B image-search 例外（fail-open）。

### 7.3 停止条件对照更新（任务书四十九节）

| 条件 | 实测判定 |
|---|---|
| 必须绕 CAPTCHA | 未出现（B/C 全程无滑块；B 图搜失败非滑块导致） |
| 必须复制 Cookie/token | 未出现（B OWN_PROFILE；C 页面上下文内取数，无导出） |
| 必须读密码 | 未出现 |
| 高风险浏览器权限 | C 已实测（权限面与静态一致，无外发行为；代价=高权限扩展常驻用户浏览器） |
| Wrong Entity 无法为 0 | **B/C 的 search/detail 实测均为 0**（结构层 + 跨路线同 offer 互证）；B image-search 100% 无关（该命令禁用） |
| 登录稳定性 | B：daemon 重启会话复用；C：daemon 重启自动重连、无需重新 bind/登录（摩擦≈0） |
| 普通用户操作比 Manual 更复杂 | B 首次=扫码 1 次；C 首次=手动装扩展+登录（比 B 重）；后续均命令即得；Manual 每次手工 |

### 7.4 Native 图搜 Spike 安全发现（2026-08-15）

- **零凭据暴露**：图搜全程页面上下文操作（注入文件/提取 DOM），无 Cookie/Token 导出、无 MTOP 复刻（上传请求由页面自身签名发出，仅观察）。
- **无风控触发**：3 次图搜无滑块/验证（与 Route B image-search 的静默失败无关——那是 1688-cli 实现缺陷）。
- **半自动模型的安全收益**：图片注入+结果提取由工具做，搜索动作由用户点击（每图 1 次）——**人工在环**，符合证据门禁。
- **新增风险**：① air 专用页上传缺陷（页面级，不涉及安全）；② closed shadow 按钮点击不可自动化（UX 摩擦非安全）；③ 结果=候选发现（人工五态确认不变）。

### 7.5 Closed Shadow Auto-Click 安全结论（2026-08-15）

- **自动点击零误点**：Target Proof（elementFromPoint 命中元素文本必须"搜索图片"）在瞬态遮罩/坐标偏移场景多次正确 fail-closed（PROOF_FAIL），**WRONG_CLICK_COUNT=0**——防误点是安全核心（宁可点不到不可点错）。
- **无权限扩展**：未修改 Extension 权限面（无 nativeMessaging/history/clipboard/webRequestBlocking 新增）；raw CDP 通道（TEMP CLI `cdp` 子命令）受扩展 allowlist 约束（Accessibility/DOM 只读 + Input 输入事件 + 截图等白名单方法）。
- **零凭据**：全程页面上下文 + CDP；无 Cookie/Token 导出。
- **风控**：高频操作触发 1688 滑块一次（正常人工验证，用户完成；无绕过）。
- **产品模型**：上传激活=用户每会话一次手动上传（真实手势，天然人工在环）；搜索提交自动——自动化范围严格限定在"用户允许点击的搜索按钮"。

### 7.6 Trusted File Chooser 安全结论（2026-08-15）

- **全自动图片链安全边界**：上传=浏览器正规 File Chooser 流程（focus+Enter 键盘激活 + `DOM.setFileInputFiles`）——**与用户操作等价**，无 monkey patch、无 React 内部 hook、无 MTOP 复刻、无 Cookie/Token 导出、无 OS 宏。
- **权限零扩增**：Extension 权限面未变（allowlist 未扩；TEMP 修改仅 upload 触发逻辑，聚焦+键盘属既有 CDP 能力）。
- **窗口前台依赖**：CDP 输入需要窗口前台（浏览器行为）——产品化需引导用户保持窗口可见（非安全风险，UX 约束）。
- **fail-closed 保持**：上传失败（chooser 超时/selector 缺失）、proof 失败（PROOF_FAIL）一律不继续搜索、不误点——实测多次正确拦截。
