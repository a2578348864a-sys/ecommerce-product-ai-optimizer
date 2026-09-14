# V3.5-A — Acquisition Decision（获取策略裁定）

> 静态审计（2026-08-15）+ Route B/C 实测（2026-08-15）+ **Native 图搜 Spike（2026-08-15）→ 最终裁定：ACQUISITION_STRATEGY = HYBRID**。

## 1. Route 评分（任务书二十二节：HIGH/MEDIUM/LOW，禁止伪精确分数）

| 维度 | A（官方网关） | B（1688-cli） | C（OpenCLI Bridge） |
|---|---|---|---|
| 用户体验（静态预估） | HIGH（配置一次→一键） | MEDIUM（扫码+CLI） | MEDIUM-HIGH（bind 当前 Tab；装 Bridge） |
| 获取成功率 | ⏳ 待实测（AK 门槛） | ⏳ 待实测（扫码+风控） | ⏳ 待实测（登录态复用） |
| 数据结构化 | HIGH（JSON+统一结构） | HIGH（JSON 契约） | HIGH（JSON+实体键） |
| entity binding | HIGH（静态确认） | MEDIUM（待实测） | HIGH（静态确认 offer_id+dedupe） |
| image search | HIGH（代码存在） | MEDIUM（声称，待实测） | LOW（**无此能力**） |
| SKU 支持 | HIGH（skuId+price 同 item） | MEDIUM（待实测） | MEDIUM（SKU 图 assets；规格文本 ⏳） |
| price 语义 | MEDIUM（单值 currentPrice，待实测） | MEDIUM | HIGH（文档确认 price tiers） |
| MOQ 语义 | MEDIUM（quantityBegin，待实测） | MEDIUM | MEDIUM（字段有，语义待实测） |
| supplier metadata | HIGH（结构化） | HIGH（supplier inspect） | HIGH（store 命令） |
| credential risk | LOW（API_KEY/OAuth） | LOW-MEDIUM（OWN_PROFILE） | MEDIUM-HIGH（<all_urls>+cookies+debugger） |
| CAPTCHA/risk control | LOW（无） | MEDIUM（滑块人工） | MEDIUM（滑块人工） |
| 维护成本 | LOW（官方 API） | HIGH（MTOP 内部协议） | MEDIUM-HIGH（页面 DOM） |
| 集成复杂度 | LOW-MEDIUM | MEDIUM-HIGH | HIGH（Extension+daemon） |
| 官方程度 | HIGH（官方网关） | LOW（MTOP） | MEDIUM（公开页面 DOM） |
| 可测试性 | HIGH | MEDIUM | MEDIUM |
| fail-closed | HIGH（网关错误码） | HIGH（exit codes） | HIGH（identity 硬错误） |
| License | ❌ 无（参考代码不可复制） | ✅ MIT | ✅ Apache-2.0 |

## 2. 静态层初步裁定（实测后必须复核）

- **Route A**：技术形态最正规（官方网关/结构化/实体绑定强/无风控），**静态首选**；阻塞 = AK 获取（`ROUTE_A_ACCESS = BLOCKED_BY_ACCESS_REQUIREMENT`）+ 参考代码无 license（正式实现须独立对接官方网关，不复制代码）。
- **Route B**：登录模型安全（OWN_PROFILE+扫码），但 **MTOP 内部协议 = 主要风险**（合规/稳定）；作 LOCAL_SESSION_CLI 候选（A 不可用时的次选）。
- **Route C**：UX 最贴近"打开 1688 帮我看"，但 **Extension 高权限（<all_urls>+cookies+debugger）+ daemon 无鉴权**需安全评审；无 image-search；作 BROWSER_BRIDGE 候选（安全评审通过后实测）。
- **Manual Import**：永久 fallback；本轮不改判。

## 3. 实测结果对照成功条件（任务书三十一/三十二/三十三节）

| Route | 条件 | 实测 |
|---|---|---|
| **B**（LOCAL_SESSION_CLI 候选） | 真实成功 | ✅ SEARCH/DETAIL/AUTH/重启复测全部 PASS |
| | 明显优于 Manual | ✅ 结构论证（首次扫码 1 次→命令即得、零复制粘贴 vs 手工多步）；量化缺口（用户未提供 Manual 数字）如实标注 |
| | 安全可接受 | ✅ OWN_PROFILE+USER_QR_LOGIN，未复制凭据；残留风险：MTOP 内部协议（稳定/合规）、PII 输出面（可脱敏）、图搜 fail-open（禁用命令即可规避） |
| | 重启稳定 | ✅ daemon 重启会话复用 |
| | 实体绑定可靠 | ✅ Wrong Entity=0（10/10 唯一 + search→detail 3/3 + 跨路线互证） |
| **C**（BROWSER_BRIDGE 候选） | 真实成功 | ✅ bind/search/item/store/重启复测全部 PASS（摩擦≈0） |
| | Current Tab 明显价值 | ✅ HIGH VALUE（驱动用户已登录浏览器，无扫码无复制） |
| | 权限可控 | ⚠️ 权限面重（<all_urls>+cookies+debugger）但审计无外发、daemon 仅 127.0.0.1、OPENCLI_CDP_TARGET 可限定；代价=高权限扩展常驻 + 首装需手动 Load unpacked（实测命令行加载失效） |
| | 实体绑定可靠 | ✅ Wrong Entity=0（8/8 唯一 + 与 B 互证） |
| | 明显优于 Manual | ✅（同上结构论证） |
| **A** | — | NOT_CONFIGURED（无 AK；不强迫申请；Access Friction 本身是产品证据） |

## 4. 最终裁定（2026-08-15，Native 图搜 Spike 后更新）

- **ACQUISITION_STRATEGY = HYBRID**——任务书六选一，**两路线真实互补**（native-image-search.md 实测）：
  - **KEYWORD_SEARCH = LOCAL_SESSION_CLI**（1688-cli：关键词搜索+详情，实测 APPROVED，六条件满足）；
  - **IMAGE_DISCOVERY = BROWSER_BRIDGE_NATIVE_UI**（OpenCLI Bridge + s.1688.com 原生图搜：3 张 Amazon 主图全部成功召回同类候选，Wrong Entity=0，三路互证）——**B 的 image-search 实测损坏（fail-open），C 路线原生图搜实测成功 → 图片发现能力真实互补**；
  - **DETAIL = LOCAL_SESSION_CLI**（1688-cli detail）+ **SECONDARY_CURRENT_TAB = BROWSER_BRIDGE**（OpenCLI item，实测互证）；
  - **MANUAL_IMPORT = KEEP_AS_FALLBACK**（fallback + 人工确认环节）。
- **IMAGE_SEARCH = APPROVED（带约束）**：原生图搜链路可用（s.1688.com 相机入口）；约束=air 专用页上传不可用、按钮点击需用户（半自动）、结果=同类候选非精确匹配（五态人工核查）、displayedPrice/displayedMOQ 语义不变。
- **采用 B 的强制条件不变**：禁 1688-cli image-search（fail-open）、显式 ok 校验、字段脱敏、写命令零暴露、MTOP 风险登记。
- **ROUTE_A_API = NOT_TESTED**（NOT_CONFIGURED；BLOCKED_BY_ACCESS_REQUIREMENT）；官方 image search API 若未来获得 AK 可复评（可能进一步替代半自动环节）。

## 5. 剩余缺口（如实）

- Manual 定量指标未提供（"明显优于 Manual"以结构论证 + 实测功能成立）。
- Native 图搜的按钮点击依赖人工（closed shadow 坐标失效）——产品化可考虑引导式点击或等待上游修复。
- Route A 若日后获得 AK，可补测官方 API（届时复评 API_FIRST）。
