# 本地上游来源适配器

这些入口只生成内存预览和版本化本地 JSON，不写 Prisma、正式 Candidate 或 Task。

## 统一边界

`Fixture / JSON / CSV / human_assisted_amazon / amazon_anonymous_auto`
先转换为同一套：

`SelectionBrief → CollectionRun → RawObservation`

随后统一进入 `NormalizedProduct → EvidenceSnapshot → Quality Gate → Import Preview → Stage 1`。下游不读取 Amazon DOM、CSV 原始列名或采集器内部字段。

## JSON

- Schema：`raw-observation-batch.v1`。
- 必须包含 `brief`、`run` 和 `observations`。
- 运行时验证版本、Brief/Run 关系、市场与币种、采样 ID、页面状态和样本预算。
- Schema 错误、市场/币种冲突或页面阻断均 fail-closed。

## CSV

模板：`fixtures/stage1-import-template.v1.csv`。

字段：

- 必填列：`marketplace, market, query, sourceUrl, platformProductId, parentProductId, title, price, currency, rating, reviewCount, sponsored, brand, imageUrl, capturedAt, deliveryRegion, language, page, position`。
- `sponsored` 只接受 `true / false / unknown`；`unknown` 转为 `null`，不会获得自然位分数。
- 空值或字面量 `null` 转为 `null + csv_value_missing`。
- 非法 ASIN、非 Amazon 商品 URL、ASIN/URL 冲突、JPY/非 US、非 `en-us`、非 New York 10001、非法日期/页码/数值进入隔离，不进入下游。
- 不接受权威排名、晋级状态、人工决定或 AI 结论列；这些不属于来源事实。

每次处理输出 `source-adapter-result.v1`，记录来源类型、来源 Schema、文件 Hash、稳定 sourceBatchId、接受/隔离数、质量摘要和内存导入批次。相同文件与参数重复处理结果确定。

## 证明级别

当前只证明纯函数、Fixture 和内存适配器。没有证明 API 鉴权、OwnerOnly、ID 猜测隔离、真实数据库事务或并发安全。

## Phase 2 真实来源包验收

- `phase2-acceptance-report.v1` 从已保存的 `human-assisted-amazon-run.v2` 重新构建两次身份、Evidence、Quality/Layout 和导入预览，并与来源包中已保存的 Pipeline 比对。
- 验收同时检查身份数量、隔离对象未进入预览、Candidate/Evidence/Minimum Pack/Run/批次追溯、fresh/stale/unknown 枚举，以及正式 Candidate 和数据库均未写入。
- 报告证明级别固定为 `pure_function_fixture_real_package_in_memory`；明确不包含 API、数据库事务/并发、Owner/Visitor 鉴权或 ID 猜测防护。
- 生成器使用版本化产物保护；相同内容可重放，冲突文件不会被覆盖。

## Phase 3 Stage 1 与盲评验收

- `phase3-acceptance-report.v1` 关联已保存的 Stage 1 摘要、20/20锁定回答、盲评对照和0条 Candidate 预览，验证来源 Hash、规则版本、计数和预览边界一致。
- 当前实际结论为 `limited_scope_reduction_not_business_validated`：系统从20条减少4条，不能写成可靠缩小人工调查，更不能写成商品值得销售。
- 评审者为无 Amazon 运营经验的项目所有者；报告明确保留 `expertReviewProven=false` 和 `businessValidationProven=false`。
- 正式 Candidate 继续为0，没有调用 API、写数据库或调用 AI；产物采用同内容幂等和冲突拒绝。

## 视觉新手盲评 V2

- `solo-novice-blind-review-packet.v1` 和已填写的 V1 回答继续只读保留，不由 V2 生成器覆盖。
- `solo-novice-visual-presentation-input.v1` 为每个盲评条目补充已采集图片证据、本地图状态和中文“是什么／做什么”展示辅助。
- 图片 URL 必须标记为 `direct_observation` 并带采集时间；中文说明必须标记为 `ai_generated / presentation_aid_not_source_fact`，不能升级成来源事实。
- `generate-solo-visual-validation-materials.ts` 只写独立的 `solo-novice-visual-blind-review-packet.v2`、说明和生成摘要。声明为 `available` 的本地图必须通过根目录约束、字节数和 SHA-256 校验。
- 缺少本地图必须为 `not_cached + missingReason`；视觉完整度不足时保持 `incomplete_visual_evidence`，不得报告完整视觉盲评 ready。

## Stage 2 客观证据缺口清单

- `solo-stage2-evidence-gap-inventory.v1` 只从已封存的 `solo-stage2-objective-calibration-packet.v1` 计算“还缺哪些事实”，不采集、不估算、不修改 Stage 1。
- 每个样本把供应商/采购、包装/物流、平台费用/准备金、合规/执行风险分为 17 个客观证据字段；`humanContinueDecision` 和 `humanDecisionReason` 单独保持 `pending_user_input`，不能伪装成证据。
- 来源包 Hash、样本 ID 和 `calibration.missingInputs` 不一致时 fail-closed；所有缺失值继续为 `null`，不得从售价、评分、评论、图片或 AI 说明推算。
- “17项商业字段已填完”不等于可以计算或人工决定：来源售价也必须为可用的正数 USD；售价缺失时，逐样本与整包继续保持阻断并保留 `missing_salePrice`。
- `generate-stage2-evidence-gap-inventory.ts` 只写独立 JSON、中文取证说明和生成摘要，不覆盖原 Stage 2 包。

## Stage 2 客观证据录入与校准

- `stage2-evidence-submission.v1` 只接收 17 项客观字段、同变体确认和逐字段来源，不接收人工晋级决定。
- 非空值必须带来源类型、采集时间和来源引用；缺失继续使用 `null + missingReason`。额外字段、样本错配、不安全 URL、无来源值、变体冲突均 fail-closed。
- `stage2-evidence-validation-result.v1` 和 `stage2-evidence-calibration-run.v1` 记录提交 Hash、输入 Hash、拒绝／缺失原因和确定性利润校准；缺关键成本继续 `profit_insufficient_evidence`。
- 当前轻量利润输入中的 `bom / firstMile / platformCommission / fba / packaging / storage / returnReserve` 全部解释为 **USD/件的金额**，不是百分比；若来源只给佣金率，必须先按同一售价形成带 `inputHash` 的 `derived` 单件金额，不能把 `15%` 直接填成 `15` 或 `0.15`。
- 正常情景是广告前单件贡献利润 `salePrice - 七项单件成本`；压力情景只按既有规则把七项成本乘以 `1.15`；Break-even ACOS 是正常情景广告前贡献利润除以售价。三者都不是最终净利润，也不替代完整 R2.2 商业门禁。
- 售价必须是有限且大于 0 的 USD 金额；成本必须有限且不小于 0。无效值与缺失值一样 fail-closed 为 `profit_insufficient_evidence`，不得产生 `NaN`、`Infinity` 或伪精确利润；非 USD 缺口清单整包拒绝。
- `ready_for_calibration` 还要求该样本的实际校准状态为 `calculated`；仅把17项表格填满、但来源售价缺失的样本仍为 `incomplete`，不能开放人工决定或 Candidate 预览。
- `generate-stage2-evidence-intake.ts` 分开生成真实空白模板和 `fixture.invalid` 合成 Fixture。合成 Fixture 只证明代码路径，不构成供应链、利润、合规或业务验证。

## Stage 2 公开成本研究 Brief 与离线推导预览

- `stage2-public-cost-research-brief.v1` 同时绑定当前缺口 inventory、正式部分 submission 和真实 validation Hash；任一来源被替换时 fail-closed。
- 当前 Brief 只允许单样本 `stage2-high-01`，只请求 Federal Reserve 的 CNY/USD 官方汇率证据，以及 Amazon 官方公开的 US Referral Fee 与 FBA Fulfillment Fee；总导航最多 6 次、自动重试 0 次。Brief 文件本身不是授权。
- `stage2-public-cost-evidence.v1` 分开保存人民币供应商单价、原始汇率、Referral Fee 和 FBA Fee 适用证据。待研究模板所有值均为 `null + missingReason`，不得填 0 或预设费率。
- `stage2-public-cost-derivation-preview.v1` 只在原始输入与来源有效时预览 `bom / platformCommission / fba` 的候选 USD/件金额，不自动改写 `stage2-evidence-submission.v1`，也不计算最终利润或做人工决定。
- 包装高度仍有 3.5cm/3.8cm 冲突时，即使取得 FBA 公开费表，也必须保持 `fba=null / blocked_package_dimension_conflict`；公开研究不会估算头程、包装、仓储、退货准备金或合规结论。

## Stage 2 公开成本研究一次性授权门禁

- `stage2-public-cost-research-authorization-request.v1` 把 Brief ID/Hash、两个允许 Origin、最多6次导航、0次重试、1个样本和完整授权短语绑定为一个不可变请求；任一字段或 Hash 被改动都会 fail-closed。
- 授权文字必须逐字一致，不能模糊匹配；Grant 只保存授权文字 Hash，不保存用户原文，并固定为 `singleUse=true / consumed=false`。
- 离线生成器只输出 `not_granted` 请求、授权说明和生成摘要，不生成真实 Grant、不访问网站、不采集证据、不写数据库或调用 AI。

## Stage 2 公开成本单次真实研究

- 用户逐字授权后生成独立 Grant 并在外部读取前消费；实际运行固定为6次受控读取、3个唯一官方 URL、0次重试，来源 Origin 仅为 Federal Reserve 和 Sell on Amazon。
- Fed H.10 可确认 2026-07-10 为 `6.7766 CNY_PER_USD`；与既有18.50 CNY人工供应证据组合后，只生成 `bom=2.73 USD/件` 的只读补丁预览。
- Amazon 官方页显示 Home and Kitchen 费表为15%、最低0.30 USD，但同页明确实际 fee category 可能不同于店铺展示类目；当前商品实际 fee category 未确认，因此 `platformCommission` 保持 null。
- FBA 官方页只确认费用依赖价格、重量和尺寸；页面未提供可直接适用金额，且包装高度3.5/3.8cm冲突，因此 `fba` 保持 null。
- 运行不会自动修改 Stage 2 submission、计算利润、记录人工决定、创建 Candidate 或写数据库。

## Stage 2 公开成本人工复核请求

- `stage2-public-cost-review-request.v1` 同时绑定 Brief、真实 Run、Evidence、推导预览和只读补丁预览 Hash；任一来源或 BOM 数值被改动都会 fail-closed。
- 请求只允许用户逐字确认 `2.73 USD/件` 为暂定派生输入；决定只保存确认文字 Hash，且继续保持 `stage2SubmissionMutated=false`。
- Request 历史材料保持 `pending_user_review`；用户后续逐字确认已生成独立 Decision，并通过 BOM-only 应用器创建新的版本化 submission，原 submission 不覆盖。
- 新 submission 仅补 `stage2-high-01.bom=2.73 USD/件`，其余未知成本继续为 null；validation 仍为 incomplete、ready=0，calibration 仍为 `profit_insufficient_evidence`。

## Stage 2 剩余证据交接

- `stage2-remaining-evidence-request.ts` 绑定当前 application/validation Hash，只读取真实 `missingFields`，不手工补写缺口。
- 生成器同时输出机器 JSON 和“小白补证据清单”，按供应商变体、头程、Amazon费用、运营准备金分组；不知道的值必须保持 null。
- `stage2-package-height-conflict-evidence.ts` 接受用户新截图的白名单观察和图片 SHA-256；不保存临时绝对路径或截图本体。结构化表3.50cm与既有3.8cm证据并存时输出 `conflict_confirmed_not_resolved`，不得更新 `packageHeightCm` 或计算FBA。
- `stage2-package-height-confirmation.ts` 只接受项目所有者明确的“是3.5cm”确认，把3.5cm记录为 `manual working value` 而不是供应商确认；生成独立 successor submission/validation/calibration/remaining request，旧3.5/3.8冲突证据保持不变。
- 包装高度应用后剩余请求为9项，不再重复要求用户选择3.5/3.8；头程、实际Amazon收费类目/FBA、运营准备金和合规依据仍必须有来源，未知继续为null。
- `stage2-next-evidence-handoff.ts` 把当前权威submission、validation和9项请求绑定成两步小白卡：Amazon官方费用结果与货代头程报价。只预填ASIN、来源售价、暂定BOM、包装公制值和诊断英制换算；不联网、不计算费用/利润、不写回submission。

## Stage 2 人工决定与 Candidate 导入前预览

- `stage2-human-decision-submission.v1` 把 `continue / stop / hold`、理由和已复核标记与客观证据分开；新证据不会自动替人做决定。
- 人工决定资格按 `calibration.samples[].evidenceStatus` 逐样本判断：只有 `ready_for_calibration` 的样本可以填写决定；对缺证据或无效样本填写决定会以 `decision_for_ineligible_sample` 拒绝。
- 整包仍可保持 `profit_insufficient_evidence`，但已就绪的少量样本不再被同包其他空白样本压制；所有 eligible 样本完成决定后可进入预览。
- `candidate-advancement-preview.v1` 只接受逐样本证据就绪、人工 `continue`、Stage 1=`promoted` 且 Hard Gate 通过的对象。
- 输出仍为 `formalCandidateId=null / persistenceStatus=not_written / sourceIntegrity=pending_server_proof`；不会调用 API、写数据库或证明鉴权、事务和并发安全。
- 当前真实 7 条证据仍不完整；即使 stage2-high-01 已有BOM和包装高度，七项利润成本仍未齐，所以人工决定材料为空白、Candidate 预览为 0 条；这是预期的 fail-closed 结果。

## Stage 2 单样本取证 Brief

- `stage2-evidence-collection-brief.v1` 只冻结 `stage2-high-01` 的第一轮供应商公开证据范围；当前状态必须为 `pending_user_authorization`，Brief 本身不是联网授权。
- 请求范围仅为 `https://www.alibaba.com` 公开页面，最多 4 次导航（1 个搜索结果页、3 个供应商商品页），不登录、不绕过 Captcha、不重试。
- 第一轮只请求供应商 URL、采集时间、MOQ、BOM，以及页面明确展示的包装长宽高和重量；没有展示就保持 `null + missingReason`。
- 授权材料位于 `08-Stage2-high-01取证授权材料/`，程序不会因材料存在而自动访问网站。

## Stage 2 单样本公开取证与重验

- `stage2-public-evidence-collection-run.v1` 使用独立临时 Chrome、动态 loopback CDP、精确 HTTPS origin 和固定导航预算；任一中间 redirect origin、内部错误页、登录/Captcha/拒绝页或未知状态均 fail-closed。
- DOM 探针拒绝 Cookie、Local/Session Storage、凭据和密码值；只保存脱敏诊断、白名单字段及 Hash，不保存完整 HTML 或正文。
- 第一轮真实运行因中间 HTTP redirect 后旧实现仍继续而被独立审查为 `non_authoritative_failed_evidence`；历史 JSON 不覆盖，也不得生成 Stage 2 submission。
- `stage2-public-revalidation-brief.v1` 绑定原 Brief、失败 Run、失败 Review 和离线修复证明；状态固定为 `pending_user_authorization`，材料存在不会自动重跑网站。
- `run-stage2-public-revalidation.ts` 只有在当前用户明确确认、授权 Hash 与 Brief Hash/完整 scope 一致且新输出目录不存在时才会进入真实运行；普通全量测试始终跳过该 runtime 路径。
- 重验仍是一次运行、最多4次导航、0次自动重试；相似标题不能确认同一变体，价格区间不能直接写为 BOM。
- 已消费的单次授权和输出目录不能复用；本次重验在第1次导航命中不允许的 HTTP 中间 origin 后结束，结果只证明 fail-closed 生效。

## Stage 2 替代公开来源 Brief

- `stage2-alternative-source-brief.v1` 绑定原取证 Brief 和 Alibaba 权威失败结果，替代来源固定为 Made-in-China.com；Brief 本身仍不是联网授权。
- 唯一允许 Origin 为 `https://www.made-in-china.com`；HTTP、供应商子域名、登录/询盘、Captcha、未知页和自动重试均禁止。商品页只接受契约中的精确路径正则；政策请求最多1次、浏览器导航最多3次、总外部请求最多4次。
- 真实运行前必须检查 robots/站点政策；unknown 或 disallow 在浏览器导航前阻断。
- 平台公开页的价格、MOQ、包装信息只能标记为 `direct_observation`，不是确认报价。Amazon 标题只观察到6层、灰色、悬挂式，材料未知；属性相似不能单独确认同一变体，缺少明确供应链关联时停止为 `variant_identity_cannot_be_confirmed`。
- `generate-stage2-alternative-source-brief.ts` 只生成来源调查、待授权 Brief、离线能力探针规格、用户复核清单、校验结果和中文交接，不运行浏览器、不生成 Stage 2 submission、Candidate 或数据库写入。

## Stage 2 替代来源离线能力探针

- `stage2-alternative-source-probe.ts` 负责精确 URL、robots/条款预检、白名单 DOM 信号和 Made-in-China 页面 fail-closed 分类；不保留 robots 原文、完整 HTML、页面正文或私人会话数据。
- `run-stage2-alternative-source-probe.ts` 当前只接受显式 `offline_fixture` 会话适配器，复用现有独立浏览器会话接口验证导航预算和 finally 清理；它不会作为真实网站运行入口。
- 能力探针只确认搜索页是否可识别以及最多2个契约允许的商品 URL，不导航商品页、不提取价格、MOQ、包装或供应商字段。Captcha、登录/询盘、403/503、浏览器错误页、异常 origin、非 HTML、unknown 页面或不安全商品链接均阻断。
- `stage2-alternative-source-capability-probe-offline-validation.v1` 覆盖28个页面、URL和政策 Fixture，证明级别固定为 `offline_fixture_only`；真实网站访问、真实 robots/DOM、供应商证据和 Stage 2 结论均未验证。

## Stage 2 替代来源能力探针待授权请求

- `stage2-alternative-source-capability-probe-authorization-request.v1` 绑定 Brief Hash、离线验证 Evidence Hash、固定单次范围和授权短语；生成文件固定为 `pending_user_authorization / not_granted`，不能因为文件存在而访问网站。
- 真实探针范围收窄为 robots 请求1次、搜索页导航1次、商品页0次、总外部请求2次、重试0次；只允许发现最多2个白名单商品 URL，供应商字段采集为0。
- 验证同时检查 Hash 和语义；即使重新计算 Hash，扩大用途、商品页导航、链接数量、登录/Captcha/数据库等边界仍会 fail-closed。
- `generate-stage2-alternative-source-probe-authorization.ts` 只离线生成交接包和核对清单，不创建真实运行入口，也不把用户此前确认 Brief 解释为当次网站授权。

## Stage 2 替代来源单次真实能力探针

- `run-stage2-alternative-source-capability-probe.ts` 只接受与待授权请求完全一致的当前对话短语，生成独立单次 grant 并在运行开始前标记已消费；历史请求文件继续保持 `not_granted`，已消费 grant 不可复用。
- 真实入口先执行1次 HTTPS robots 请求；非 200、非 `text/plain`、重定向、超长响应、unknown 或 disallow 均在浏览器启动前阻断。robots 正文只在内存中用于规则计算，落盘只保留长度与 Hash。
- 只有政策允许时才以系统 Chrome、全新临时 Profile、动态 loopback CDP 执行1次搜索页主导航。商品页导航、自动重试和供应商字段采集固定为0；任何页面分类或清理异常都 fail-closed。
- 首次真实运行政策通过，但页面分类为 `unknown_page / search_container_marker_missing`；该结果只证明门禁按边界停止，不证明来源能力可用，也不得自动重试。

## Stage 2 替代来源 unknown_page 独立诊断

- `stage2-alternative-source-unknown-page-diagnostic.v1` 只在主分类已经是 `unknown_page` 时记录独立的 main/heading/image/anchor、已知容器、通用 product class、精确/宽松/供应商子域名商品路径计数，以及最多8个不含 query/hash 的同 Origin 路径样本。
- 诊断不保存完整 HTML、正文、查询参数或私人浏览器状态；所有状态都固定 `failClosedRequired=true / allowsCollection=false`，不能反向覆盖主分类。
- 未来真实 runner 使用 `stage2-alternative-source-capability-probe-run.v3` 把诊断和主页面 Hash 绑定；正常页仍只读取一次 DOM，unknown 页增加一次本地 DOM 读取但不增加网络导航。
- 离线包覆盖 evidence present/absent/insufficient、上下文阻断、输入无效和不适用；它不能追认历史 run.v2，也不能证明真实站点结构已识别。

## Capability-Probe-02 v2 待授权链

- `stage2-alternative-source-capability-probe-authorization-request.v2` 同时绑定 Brief、基础离线验证、Probe-01 已消费授权、Probe-01 权威失败 Run 和 unknown_page 诊断验证 Hash；任一证据被改动都会 fail-closed。
- v2 文件始终为 `pending_user_authorization / not_granted`。只有用户在当前对话原样确认包内短语，才能生成 `authorization.v2` 单次 grant；消费后不可复用。
- 外部预算与 Probe-01 相同：robots 1、搜索页导航1、商品页0、自动重试0、供应商字段0。诊断证据不能自行授权，也不能放行商品采集。
- `run-stage2-alternative-source-capability-probe.ts` 同时兼容历史 v1 和新 v2；v2 缺任一前置证据文件会在浏览器或网络动作前停止。

## Capability-Probe-02 结果与来源决策

- Probe-02 已消费独立一次性 grant，并按 robots 1、搜索页1、商品页0、重试0、供应商字段0完成；结果仍为 `failed_closed / unknown_page / search_container_marker_missing`，精确允许商品路径为0。
- `stage2-alternative-source-decision-brief.v1` 同时绑定 Probe-01/02 运行 Hash；通用 product class、宽松同 Origin 路径和供应商子域名路径只作为诊断，不能解释为访问许可、商品身份或来源能力。
- `generate-stage2-alternative-source-decision-brief.ts` 只生成 A停止当前策略、B另行设计供应商子域名安全探针、C更换公开来源三项交接材料；`selectedOption=null`，不自动选择、不授权外部动作、不生成 Stage 2 submission、Candidate 或数据库写入。

## Global Sources C1A 最小来源发现

- 用户对 Decision Brief-03 选择 C/C1A 后，由独立 `stage2-alternative-source-selection.v1` 记录 successor 决定；历史 Decision Brief 继续保持 `selectedOption=null`，Made-in-China Probe-01/02 失败不重分类。
- `stage2-global-sources-discovery-brief.v1` 只冻结未来来源发现边界：robots请求1次、两个精确公开页面最多2次主导航、商品页0、供应商字段0、自动重试0；Brief 固定 `pending_user_authorization / not_granted`。
- 既有 Global Sources 官方帮助页只属于 `offline_reference_only`，不能证明当前主站、搜索路径或商品能力可用。任何重定向、非精确 Origin/路径、注册/登录、Captcha、访问拒绝、错误或 unknown 页面均 fail-closed。
- `generate-stage2-global-sources-discovery.ts` 只离线生成选择、Brief、验证、交接和摘要；没有真实网站访问、Stage 2 submission、Candidate、数据库或 AI 调用。未来真实来源发现仍需新的单次明确授权。

## Global Sources C1A-R1 单 Origin 运行工具链

- 历史 `stage2-global-sources-discovery-brief.v1` 保持只读，不再作为真实运行输入。`stage2-global-sources-discovery-brief.v2` 只允许 `https://www.globalsources.com/robots.txt` 1 次与首页 1 次；`s.globalsources.com` 帮助页仅作离线参考。
- `stage2-global-sources-discovery-r1.ts` 直接分类正常首页、轻微选择器变化、loading、登录/注册、Captcha、403/5xx、浏览器错误、跨域/路径/重定向和 unknown；只输出最多5个去 query/hash 的同 Origin 候选搜索 path。
- `global-sources-robots-request.ts` 使用现有 SSRF 校验并把已验证 DNS 地址固定到实际 HTTPS socket；非精确 URL、非200、非 text/plain、超 256 KiB 或连接失败均阻断。
- `stage2-global-sources-discovery-r1-authorization.ts` 把 v2 Brief、精确停止条件、确定性 Brief/Request ID 与离线 Fixture 14/14 Evidence Hash 绑定；request 文件始终 `not_granted`，只有未来当前对话中的完整授权短语才能生成单次 grant，消费后不可复用。
- `run-stage2-global-sources-discovery-r1.ts` 复用系统 Chrome、全新临时 Profile、动态 loopback CDP 和 finally 清理；任一页面门禁或清理字段失败都输出 `failed_closed`。本轮只完成离线实现和验证，没有调用该真实入口。
- robots 固定连接只使用 DNS 校验结果中的第一个地址；连接失败立即返回，禁止在同一逻辑 policy request 内轮换其他地址掩盖为“0重试”。Real-04 历史运行发生在该修复前，连接尝试次数未记录，保持只读并标记范围计数证据不足。

## 版本化产物保护

- Stage 2 录入、人工决定／Candidate 预览和取证 Brief 生成器统一使用 `artifact-writer.ts`。
- 同路径同字节重放只返回 `unchanged`，不改文件时间；任一文件内容冲突时先整包拒绝，不覆盖已有文件，也不补写其他缺失文件。
- 拒绝绝对路径、目录穿越和重复相对路径；该能力只证明本地文件产物安全，不是数据库事务。

## 填写后的离线验证入口

填写副本后，使用项目现有本地 Vitest 运行，不联网、不安装依赖：

```powershell
& .\tools\upstream\run-stage2-offline-validation.ps1 `
  -SubmissionFile "..\06_测试与验证\填写后的-stage2-evidence-submission.v1.json" `
  -OutputDirectory "..\06_测试与验证\新的版本化验证目录" `
  -DecidedAt "2026-07-14T15:00:00.000Z"
```

输入和输出必须位于当前项目的 `06_测试与验证`；`.env` 或项目外路径会被拒绝。相同输出只允许相同内容重放，冲突时停止。
只补齐一条样本时，其余样本继续保持 `null + missingReason`；只有该条证据状态为 `ready_for_calibration` 后才允许填写对应人工决定，不能给未就绪样本填 `continue`。
- `stage2-public-cost-application.ts` 是复核后的最小本地应用器：同时校验研究来源、Request、Decision、原 submission 和 gap inventory，只允许把 Brief 目标样本原本为 null 的 `bom` 补成暂定派生值。
- 应用器不会覆盖已有 BOM，不会修改其他样本或字段，不会写数据库、创建 Candidate、改 Stage 1 或把部分成本描述为完整利润。真实用户 BOM Decision 已生成并应用到独立 successor；包装高度的真实人工确认又生成了下一份 successor，两次均未覆盖历史产物。

## Stage 2 下一证据离线收件

- `stage2-next-evidence-receipt.v1` 绑定当前两步交接 Hash，并把 Amazon 官方费用结果与货代报价的原始证据字段分开保存。
- 空白模板保持 `pending_evidence`；收到截图后由代码生成 successor，用户不需要手改 JSON。图片本体不进入 JSON，只保留 SHA-256、采集时间和白名单事实。
- USD 货代总价可以按报价数量生成每件头程预览；CNY 报价没有同期汇率证据时保持不可换算，不得猜汇率。
- validation 通过后也只生成 `stage2-next-evidence-patch-preview.v1`，必须再次人工复核；不自动修改 submission、计算利润、创建 Candidate 或写数据库。
