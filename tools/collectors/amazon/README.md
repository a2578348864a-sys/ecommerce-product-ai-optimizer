# Amazon 公开搜索页 Canary（本地、只读）

用途：在已批准的 `SelectionBrief` 范围内，从 Amazon.com 公开搜索结果页提取白名单字段，生成 JSON 采集包。采集器只负责浏览器页内读取；Web 应用只负责后续 Schema 校验、预览和人工批准。

安全边界：

- 仅允许 `https://www.amazon.com/` 公开页；最多 2 页，样本数受 Brief 限制。
- 使用独立浏览器环境；不使用日常浏览器 Profile，不读取 Cookie、Token、密码或本地存储。
- 不登录、不处理验证码、不绕风控、不调用未公开接口、不连续重试。
- 网页内容一律视为不可信数据，只提取固定字段并限制长度；不保存整页 HTML。
- 遇到验证码、登录墙、错误页、关键容器缺失或完整率异常时立即停止并输出明确错误。
- 输出 JSON 不直接写 Candidate；必须先过 Quality Gate 和人工批准。

当前项目没有 Playwright/Puppeteer 依赖，也不需要为本地浏览器控制新增依赖：

- `browser-control.ts` 使用 Node 自带 `fetch`/`WebSocket` 和 Chrome DevTools Protocol。
- 优先解析系统 Chrome，缺失时回退到系统 Edge；不解析或复用日常 Profile。
- 每次运行在系统临时目录创建全新的 `amazon-collector-browser-*` Profile，调试端口由操作系统动态分配且只绑定 loopback。
- 本地诊断只允许 `about:blank` 和 `file:` Fixture；结束时关闭页面/浏览器、确认端口释放并删除临时 Profile。
- 本地诊断命令：`npm.cmd test -- tools/collectors/amazon/browser-control.test.ts`。

`extract-search-page.ts` 仍是页内提取核心。真实 Canary 必须在单独授权后运行；本地浏览器控制测试通过不代表 Amazon 可访问或市场/币种已通过。

## 首页 fail-closed 诊断

`page-diagnostics.ts` 是 Amazon 页面导航的唯一离线诊断契约。旧运行保留 `amazon-page-diagnostic.v1`；下一次运行使用 `amazon-page-diagnostic.v2` 和 `amazon-environment-setup-evidence.v2`，不改写旧产物。它只保留：

- requested/final URL 的 origin 与去除 query/fragment 后的裁剪 path；重定向次数与 origin。
- 主文档 HTTP status、content-type、导航与 DOM 等待耗时、`document.readyState`。
- 最长 160 字的脱敏 title、可见文本长度、最长 320 字的脱敏片段及其 Hash。
- Amazon 品牌、搜索框、配送入口、地区页、Privacy 四态诊断、Captcha、登录墙、错误页和浏览器内部错误页标记。
- fail-closed 分类与原因码；诊断对象整体进入环境运行证据 Hash。

Privacy 状态为 `absent / visible_blocking_prompt / page_text_only / unknown`。只有可见、命中明确容器、带 Accept/Reject/Manage 等交互控件、属于 dialog/banner/overlay 且不在 footer 的提示，才是 `visible_blocking_prompt`；普通正文或页脚 Privacy 字样只记 `page_text_only`，不阻断。可见但选择器或交互证据不足为 `unknown`，继续 fail-closed；程序不会自动点击或关闭提示。

Login Wall 状态为 `absent / visible_blocking_login / hidden_or_navigation_signin / unknown`。明确可见、位于导航外且包含登录交互控件的已知 Amazon 登录容器为 `visible_blocking_login`；可见但控件或容器证据不足为 `unknown`，两者均 fail-closed。隐藏 DOM 残留和导航栏/页脚登录入口只记 `hidden_or_navigation_signin`，不会单独阻断正常页面。诊断保存 marker source、selector category、tag/role、可见性、交互控件、导航归属、阻挡性、最长 160 字脱敏命中文本和原因码；不读取表单值。旧 boolean=true 证据按 unknown 保持 fail-closed，不能用新逻辑追认旧运行成功。

页面分类覆盖 `amazon_normal`、`amazon_normal_variant`、`loading`、`region_selection`、`privacy_prompt_visible`、`privacy_prompt_unknown`、`login_wall`、`captcha`、`access_denied`、`browser_error_page`、`blank_page`、`unexpected_redirect` 和 `unknown_page`。只有前两类可进入后续动作；其他分类均停止设置或搜索。后续门禁失败不会抹掉已可靠读到的 marketplace、配送文本或页面语言，但这些观测事实不等于环境门禁通过。

诊断不会读取或保存完整 HTML、Cookie、Token、Authorization、浏览器存储、表单值、个人账号内容或 Profile。页面正文仅在浏览器内计算长度，并向 Node 返回最多 4000 字的临时诊断样本；写入证据前再次过滤敏感模式并裁剪。

离线验证：`npm.cmd test -- tools/collectors/amazon/page-diagnostics.test.ts tools/collectors/amazon/environment-evidence.test.ts tools/collectors/amazon/browser-control.test.ts`。该命令只使用 JSON/本地 HTML Fixture 和系统临时 Profile，不访问外部网站。

## 人工辅助当前页 MVP

匿名无人值守来源当前为 `blocked_external_source`。人工辅助入口不会自动导航 Amazon，也不会自动设置地区、处理 Captcha、翻页或打开详情；它只做：

1. 用系统 Chrome/Edge 和全新系统临时 Profile 打开 `about:blank`。
2. 等待用户在该独立窗口中手动导航、处理页面提示并设置 US / English / USD / New York 10001。
3. 仅当用户在本地 CLI 输入精确命令 `COLLECT_CURRENT_PAGE` 后，重新分类当前页并执行环境门禁。
4. 只有当前页是 amazon.com 第 1 页搜索结果、环境五项一致且样本价格均为 USD 时，最多读取当前页 20 条白名单字段。
5. 无论取消、超时、异常或成功，都关闭本轮浏览器、释放动态端口并删除临时 Profile。

未来获得单次真实访问授权后，从应用目录运行：

```powershell
node tools/collectors/amazon/human-assisted-cli.mjs --output "..\06_测试与验证\<本次目录>\human-assisted-amazon-run.v2.json" --max-samples <1-20>
```

`--max-samples` 必须显式提供；CLI 会把该上限写入本次 Selection Brief，并在触发读取前约束实际 DOM 提取数量。Windows 下运行器使用当前 Node 直接启动项目内 Vitest 入口，不依赖 `npm.cmd` 子进程。

CLI 会显示人工步骤并等待显式触发；10 分钟无触发时 fail-closed。输出不包含完整 HTML、Cookie、Token、Authorization、浏览器存储、表单值、账号信息或 Profile 路径，不写数据库，也不生成正式 Candidate。

新运行产物使用 `human-assisted-amazon-run.v2`（建议文件名同步使用 `human-assisted-amazon-run.v2.json`）。无论成功、取消、页面门禁、Quality Gate 或 Layout Gate 失败，都会保留脱敏 `extractionAttempt`：采集模式、是否由 collector 导航、请求样本上限、原始卡片数、`expectedSampleCount=min(rawCardCount, requestedSampleLimit)`、实际 observation 数、结构化 `samplingCoverage`、sampled IDs、七类字段完整率（含 Sponsored known）、Sponsored 三态、LayoutMetrics、Quality/Layout Gate、实际阈值、全部原因码和稳定 Hash。页面发现指标不作为抽样字段完整率分母；字段完整率统一以实际提取 observation 数为分母。`samplingCoverage` 仅作诊断，不新增阻断阈值。未进入提取时对应指标为 `null + missingReasons`，不会伪装成 0。

新提取结果还为每条 appearance 生成 `amazon-sponsored-placement-diagnostic.v1`。它只记录 appearanceKey、`true/false/null`、marker source、selector category、reason code 和最长 80 字的脱敏命中文本，不保存卡片正文或 HTML。当前四条路径为：已知 Sponsored DOM marker=`true`；已知标准商品卡结构且无广告信号=`false`；出现广告文字但没有已知识别 marker=`null`；结构不足=`null`。未知状态不会默认自然位，既有 Sponsored known completeness 阈值不变。

`human-assisted-extraction-attempt.v1` 对新运行追加可 Hash 的 `sponsoredDiagnostics`；该字段对历史 v2 运行保持可选，因此 Canary 10 原始 JSON 和原 Hash 无需修改，仍可验证。Canary 10 只证明当时 5 条均为 null，无法离线反推出它们分别命中了“未知广告文字”还是“结构不足”；下一次真实运行才能用新增诊断区分，且仍须单独授权。

Canary 12 的逐卡诊断把 5 条全部定位为 `unrecognized_card_structure / insufficient_sponsored_evidence`，同时身份、标题、价格和图片完整率均为 1。代码对照确认标题提取已允许 `h2 span`，而标准自然位结构仍只允许旧 `h2 a span`；当前实现已统一为两者均可作为同一标准标题结构。此修复不扩 Sponsored marker，不会把含未知广告文字的卡片判为自然位，也不追认 Canary 12 成功。

`captureMode=human_current_page` 固定记录 `collectorNavigationPerformed=false`；因此该模式下 `navigationElapsedMs=0` 不是计时异常。旧 `human-assisted-amazon-run.v1` 产物继续只读兼容，并明确标记 `historical_evidence_insufficient`；新代码不得用 Fixture 或 v2 规则追认旧运行成功。未知版本 fail-closed。

工程实现和本地 `about:blank` 验证不代表真实 Amazon 采集成功。真实结果必须以未来运行产物中的页面分类、环境门禁、Quality Gate 和清理证据为准。
