# V3.1 FINAL RC CLOSURE REPORT（V3_1_FINAL_RC_CLOSURE_REPORT）

> 状态：两个最终 Release Blocker 均已关闭；FINAL_PUBLIC_HUMAN_ACCEPTANCE = PENDING（等待用户本人最终验收）。
> 不创建 v3.1.0 标签。最终 Authority HEAD = f8ea081（本文档提交后重建部署，见文末 parity 记录）。

## 1. IMAGE_REAL_ACCEPTANCE = PASS
### 1.1 前置缺陷
Golden Demo 缺 exact-product authoritative reference image：模板 creativeHandoff 的批准参考（assetFingerprint f6d3762f…）无对应图片资产，且 researchContext.productImage 缺失（模板无 sourceMeta、candidate sourceMetaJson 为空、且 loadCandidateSourceMeta 对 fixture 候选 id 恒返回 undefined）→ Guest Image quota=1 但真实生成永远在 Provider 前 409。

### 1.2 最小修复（不改 Image/Listing Core、不改 Prompt/Provider/Identity Lock 代码、不绕过视觉参考门禁）
- 权威图片：Amazon US https://www.amazon.com/dp/B0F2BF31PW 主图 #landingImage = m.media-amazon.com/images/I/717sCJ7vxQL（与本模板 1688 采集证据引用的图片同一资源，._AC_SL1500_.jpg，103,588 字节 JPEG，699×1500）。可追溯：Amazon 商品页 → landingImage → media-amazon CDN → 模板既有证据引用。
- 身份锁定：productKey=amazon:US:B0F2BF31PW + candidateIdentityHash/identityHash = ProductBatch facts.itemHash（8414c17f…，exact item 绑定；无其他 ASIN/variant/Food Jar/10oz/Pink）。
- 加入位置（Golden Demo authority）：goldenDemoTemplateData.ts 新增 GOLDEN_DEMO_PRODUCT_IMAGE_SNAPSHOT（dataUrl+contentHash+bytes 与真实字节一致校验通过）+ 模板 resultJson 顶层 sourceMeta.candidateSnapshot.productImageSnapshot（task_snapshot 权威路径）+ 沙箱候选 sourceMetaJson（marketScreeningIdentity + 同一快照）；visualReferences[0].assetFingerprint 修正为 sha256(visual-reference:+contentHash)=db93088d…，并同步重算 handoffFingerprint（内容哈希校验第 951 行，新版 7ebfa663…）。
- Fresh Guest 自然获得：ensureVisitorDemoCopy 创建副本时即含 sourceMeta 与批准参考（无需人工/额外步骤）。

### 1.3 公网实测（Fresh Guest sandbox_task_demo_e2be008366e74733）
| 步骤 | 结果 | 证据 |
|---|---|---|
| Image quota 初始 | 1/1（横幅与服务端记录） | demo-access record imgUsed=0 |
| generate count=1（UI 同款 payload：requestId+storageVersion+rev3+confirmed+approvedVisualReferenceSelectionIds） | 200 | image-handoff POST 200 |
| Provider-start exactly once | imageCalls 0→1 | data/provider-usage.json day=2026-08-20 imageCalls=1 |
| result renders | 新草稿 ea6d88ec-…（gpt-image-2，1536×1024 PNG 1,330,044B，needs_human_review）落盘 data/ai-image-drafts/visitor/…；imageHandoffBinding 生成（visualReferenceFingerprint=db93088db7706db2，model=openai-compatible-relay） | sandbox resultJson + 文件系统 |
| quota = 0 | imgUsed=1 | demo-access record |
| second generate denied before Provider | 403 demo_standalone_image_quota_exceeded，elapsedMs=124（provider 前） | 响应 + 耗时 |
| global image ledger | 恰好 +1（第二次尝试未再增加） | ledger imageCalls 仍=1 |

### 1.4 判定
IMAGE_REAL_ACCEPTANCE = PASS；VARIANT_POLLUTION = 0（productKey+identityHash exact 绑定，代码与数据双核对）；IDENTITY_LOCK = PASS（mergeCandidateProductImageSnapshot 锁语义一致：marketScreeningIdentity.productKey/identityHash === snapshot.productKey/candidateIdentityHash）。

## 2. SOURCE COMMIT PARITY
- 修复链（main）：235cb47 → 248fba8（参考图资产+指纹）→ 748c508（handoffFingerprint 重算）→ f8ea081（studio 响应携带 demoAccess 快照）→ 本文档提交（docs only）。
- 部署前：LOCAL_MAIN_HEAD = ORIGIN_MAIN_HEAD = PUBLIC_DEPLOYED_SOURCE_HEAD = f8ea081；BUILD_ID = 5nqSpmRxoecuFm_0Rrhfn；产物 v31-final.next.tar.gz（sha256 54D1535B…29AE）；artifact↔SOURCE 映射：clean HEAD f8ea081 → npm run build（EXIT 0）→ BUILD_ID → 部署 → 健康门 200/200。
- 本文档提交后按「唯一 final candidate HEAD」重建部署（docs-only 不改变 .next 内容语义，但 BUILD_ID 重新生成），收口时三段再次完全一致（见文末记录）。

## 3. 最终公网 Fresh Guest QA（Homepage → One Click → THERMOS → Evidence → Listing → Image → quotas → refresh/re-entry）
- Homepage：无密码、单一 CTA ✓；One Click 进入 THERMOS 金标演示（任务页 Evidence/Facts/VOC 齐全）✓
- Listing real quota：UI 点击生成 → 200 草稿；textCalls 1→2；listingUsed 0→1；再次生成 → 403 demo_standalone_listing_quota_exceeded ✓
- Image real quota：见 §1.3 ✓
- refresh/re-entry：刷新 URL/Cookie/横幅不变（配额不重置）；新标签重入幂等 ✓
- 横幅实时性（发现并修复 P1，两轮）：第一轮修复 Studio 客户端（standalone 处理器）+ 两路由响应携带 buildDemoAccessSnapshot；浏览器走查（用户亲自要求）暴露真实 task-linked 流程由 ListingHandoffSection / ImageHandoffSection 组件驱动（未被第一轮覆盖）→ 横幅仍陈旧。第二轮补丁：两组件 generate 成功与拒绝分支同步 updateDemoAccessSnapshot（commit fb4a1c9）。最终实测（Fresh Guest bb342a6f19a947bd，全 UI 操作）：生成 Listing 后横幅实时变「Listing 剩余 0 次」，生成图片后实时变「生图剩余 0 张」，刷新后保持 0/0（配额不重置），二次生成 403 demo_standalone_image_quota_exceeded（provider 前）✓

## 4. 质量门
- 全量测试：5348→5337 passed / 3 failed = 既有基线 3 项（productUiPolish、handoff.product-journey-quota 为 40470a1 既有失败；demoSandbox.store-consistency 并行 flaky 隔离通过）+ native1688Bridge.integration 并行 flaky（隔离 11/11 通过）→ NEW_FAILURES = 0
- lint：0 errors（8 既有 warning）；build：EXIT 0；release gate 语义：public_showcase 显式 + fork_mode 单实例（最终 pid 见 §6）
- 部署后错误日志：error log mtime 保持 03:44:33（全程零新增）；pm2 unstable_restarts=0
- PUBLIC_P0 = 0；PUBLIC_P1 = 0（banner 快照缺陷已修复并实测）

## 5. 遗留与交接
- 遗留：Image Studio 的「生成图片」UI 默认候选数量=2 > guest 配额 1 → 默认点击得 403（文案明确）；UI 提供「1 张/2 张」选择器，选 1 张即正常生成（走查实测）。产品后续可将 guest 模式默认候选数量与配额对齐（非本轮 blocker，未改 UI 默认值以免扩审）。
- 遗留：guest 快照经 sessionStorage 缓存 12h；服务端始终为权威（失败路径已带快照更新）。
- FINAL_PUBLIC_HUMAN_ACCEPTANCE = PENDING；无 v3.1.0 标签。

## 6. Parity 最终记录
- 唯一 final candidate HEAD = 包含本文档的提交（git rev-parse HEAD 即 authority；本文档提交后从该 clean HEAD 重建并部署 exact artifact）。
- BUILD_ID = CpHKSvJSouFkW7vAEiaxG；artifact = v31-final.next.tar.gz（sha256 3355F083774FD7FB5265FC11BE68BA0727BF8FDEAD96C81D0934BE735DF3BC61）；pm2 pid 95518（fork 单实例，unstable_restarts=0）。
- 验证：LOCAL_MAIN_HEAD = ORIGIN_MAIN_HEAD = PUBLIC_DEPLOYED_SOURCE_HEAD（deployed artifact 由该 HEAD 的 clean build 产生，BUILD_ID/artifact sha 双重映射）。