# V3.5 Implementation — Architecture Decision（浏览器架构裁决）

> 来源：`docs/v3/V3_5_PRE_IMPLEMENTATION_CONTRACT.md` §7/§8/§86
> 状态：已裁决（2026-08-16，基于现有代码实审 + Spike A.1/A.2/A.3 实测证据）

## 1. 结论

**正式图片链架构 = Option A′：复用 V3.3 Local Browser/CDP 架构模式，为 1688 新增 dedicated persistent profile driver（`tools/collectors/1688/`）。**

不选 OpenCLI（Option B）、不自研 Companion（Option C）、不新增 Extension（Option D）。

## 2. 为什么选 A′

| 评估项 | A′（V3.3 模式复用 + 1688 专用 driver） | B（OpenCLI upstream） | D（专用 Extension + bridge） |
|---|---|---|---|
| 现有 V3.3 复用 | ✅ 复用 CDP 传输/loopback/profile/进程清理架构模式 | ❌ 引入第二套独立浏览器基础设施 | ❌ 引入新权限面 |
| 图搜能力 | ✅ Spike A.3 实测：focus+Enter 激活 chooser + 拦截 + setFileInputFiles + class 扫描点击 3/3 PASS | ❌ **实测 IMAGE_SEARCH_WORKS=NO**（fail-open 缺陷，静默返回兜底数据） | ✅ 可行但权限面大 |
| 依赖 | ✅ 零新依赖（原生 WebSocket/fetch） | ⚠️ playwright 全家桶（已在 TEMP，不入正式依赖） | ⚠️ 新 Extension 维护 + 加载负担 |
| 合规/稳定性 | ✅ 用户正常登录的官方页面 UI（s.1688.com 相机入口） | ❌ MTOP 内部协议 + 图搜后端受限 | ⚠️ 页面 DOM 依赖同 A′ |
| 安全面 | ✅ 最小权限：1688 域白名单 + loopback CDP + 专用 profile | ⚠️ 工具自带 daemon + 写命令存在 | ⚠️ Extension 常驻权限 |
| 长期替换 Official API | ✅ Adapter 层已隔离（ImageAcquisitionDriver 接口），可换 Official1688ApiDriver | ⚠️ 绑定 MTOP | ✅ 可换 |

**关键实测依据（Spike，2026-08-15）**：
- A.3 TRUSTED_FILE_CHOOSER_AUTOMATION = APPROVED：3 Case 3/3 + Restart Fresh Session PASS，FIRST_UPLOAD_MANUAL_ACTION_COUNT=0、WRONG_UPLOAD=0、WRONG_CLICK=0。
- A.2 closed-shadow-autoclick：按钮 class 扫描 + elementFromPoint proof + CDP 鼠标点击 4/4、0 误点。
- Route B 的 `image-search` 命令实测 **fail-open 缺陷**（3 张不同图返回同一批无关商品、exit 0 无告警）→ 禁止使用。
- V3.3 现有 `tools/collectors/amazon/browser-control.ts`：隔离 profile + loopback CDP + fail-closed 分类已成熟 → 架构模式直接复用。

**为什么不是直接 import V3.3 代码**：V3.3 的 `openIsolatedPublicBrowserSession` 语义是"临时 profile + 公开页单页导航"；1688 图搜需要"持久登录 profile + 前台交互"（用户首次登录后 session 由专用 profile 合法保留）。两者 profile 生命周期与交互模型不同，且 Amazon 代码含大量 Amazon 专用逻辑（environment-gate 等）。故新增 1688 专用目录，复用其架构模式（不复制代码、不修改 Amazon 现有代码）。

## 3. 权限与安全边界（A′ 落地）

- 只监听 `127.0.0.1` loopback CDP（`--remote-debugging-address=127.0.0.1`）。
- 专用持久 profile：`V35_1688_BROWSER_PROFILE` 可配置，默认 `%USERPROFILE%/.qingxuan/1688-browser-profile`；**不读取、不复制任何其他浏览器 profile / Cookie / Token**。
- 页面域白名单：`s.1688.com`（上传入口）+ `air.1688.com`（结果页）+ 1688.com 兜底。
- 无任意命令：驱动只执行固定 CDP 方法（Runtime.evaluate 表达式为 resolver 内建、Page/DOM/Input 固定命令）。
- 上传文件仅来自：已知 Candidate image（服务端 SSRF 校验 + https + 公网 + 类型/大小限制）或用户明确选择。
- 前台窗口硬前置：`BROWSER_FOREGROUND_REQUIRED`（CDP 输入事件在窗口未聚焦时被浏览器丢弃）。

## 4. 长期替换 Official API

`ImageAcquisitionDriver`（`lib/server/sourcingImageAcquisition.ts`）是业务层唯一入口；未来若 Route A（官方 API）可用，新增 `Official1688ApiDriver` 实现同一接口即可替换，上层 Evidence/Preview/Confirm 不动。

## 5. 未选方案的保留理由

- **Option B 保留为 Keyword/Detail 主链**（`LocalSession1688CliDriver`，只读 allowlist search/offer/whoami）——这是 Contract 已冻结的 KEYWORD_SEARCH=LOCAL_SESSION_CLI；但其图搜命令因 fail-open 缺陷永久禁用。
- **Manual fallback 保留**：CLI/浏览器坏、1688 改版、风控时，用户可人工粘贴/导入供应线索（UI 可见，非隐藏废代码）。
