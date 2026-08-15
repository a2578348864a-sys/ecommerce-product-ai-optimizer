# V3.5-A.1 — Native 1688 Image Search Spike（原生图搜验证）

> 实测完成（2026-08-15）：Amazon 主图 → s.1688.com 原生相机入口 → 1688 视觉搜索 → 真实供应候选。**结果：NATIVE_1688_IMAGE_SEARCH = APPROVED（带约束）**。

## 1. 目标链（任务书 §1）

```
Amazon Candidate 主图 → 本地图片 → 用户已登录的 1688 Chrome → 1688 原生图搜入口
→ 上传图片 → 1688 自己执行视觉搜索 → 搜索结果页 → 提取 3-5 个真实 offer
→ 人工检查相关性 → 用已验证的 1688-cli detail / OpenCLI item 读取详情
```

## 2. 关键实测结果

### 2.1 UI 入口（UI_ENTRY_FOUND = TRUE）

- **s.1688.com 搜索页相机按钮**（"以图搜款"）：✅ **可用**（本 Spike 唯一可用入口）。
- **air.1688.com/kapp/1688-search/pc-image-search/ 专用图搜页**：⚠️ **上传不可用**——用户手动选文件（4 种图/2 个目录/禁用扩展/重启 Chrome 后均）报"亲，这张图片无法识别，请换一张图片！"；源码定位为**前端本地逻辑**（`imgTip.noImgFileText`，213.js 0.0.26）：上传列表为空或 base64 为空时触发——文件读取链在该页面异常，**未发起任何上传请求**（Network 观察无 imageBase64ToImageId）。**根因未完全定位（疑该页面上传组件在此 Chrome 151 环境的 FileReader/事件链问题），记录为页面级缺陷，不深挖**。
- 上传流程源码（213.js）：`input#img-search-upload` onChange → 大小 ≤30MB → `FileReader.readAsDataURL` → MTOP `imageBase64ToImageId`（`mtop.relationrecommend.WirelessRecommend.recommend`，appId 32517）→ imageId → 结果页。**"已上传1张图片"只是上传完成；必须再点"搜索图片"按钮才执行视觉搜索**（本次 Spike 关键操作发现）。

### 2.2 自动化能力（Bridge + 页面注入）

| 环节 | 结果 |
|---|---|
| 文件注入（DataTransfer + dispatch change） | ✅ **可行**（fetch 图片 → File → input.files → change；s.1688.com 页面生效，预览图确认替换） |
| "搜索图片"按钮点击 | ⚠️ **需真实用户点击**（closed shadow DOM，AX ref 坐标点击无效——自动化坐标点击多次失败；用户点击 3 次全部成功） |
| 结果提取（offerId/title/价格/MOQ/供应商） | ✅ 页面卡片 DOM 提取完整（实体同卡片绑定） |
| 详情交叉验证 | ✅ OpenCLI item / 1688-cli detail 均可读图搜候选 offerId |

- **操作模型**：半自动——文件可自动注入，按钮点击由用户完成（每图 1 次点击）；或完全手动上传（用户选文件+点按钮）。**符合任务书第一性原理**（"利用用户正常登录的 1688 网页图搜 UI，轻选只解决安全地完成流程并读取结果"）。

### 2.3 三 Case 图搜结果（真实 Amazon 主图 → 1688 原生图搜）

| Case | 输入图 | 候选数 | 相关性（人工五态） | 结果摘要 |
|---|---|---|---|---|
| A（OtterBox 保温杯） | amazon-A | 8 | **8/8 相关**（likely_similar：20oz 冰霸杯/汽车杯，无 exact） | 全部永康保温杯工厂（米凯/钛霖/瑾钰/爱洛薇/澳腾/磊诺/圣缘），¥6.38-13.08，MOQ 1-2 件 |
| B（Igloo Snoopy 午餐盒） | amazon-B | 6 | **3/6 史努比主题**；1 高度接近 | "跨境史努比联名红色房子午餐冷藏便当包"（¥35.9，50 件起批）≈ Igloo Snoopy's House（软包 vs 硬桶=实体级 partial）；其余托特包/圣诞袋=different |
| C（KINTO 杯） | amazon-C | 6 | **6/6 相关**（likely_similar：日系简约直身杯，无 exact） | 全为日式/简约/直身/随行杯（BlueBottle 小蓝瓶咖啡杯等），¥8-21.88，MOQ 1-25 件 |

- **Wrong Entity = 0**（实测）：每张结果卡 title/价格/MOQ/供应商/offerId 同卡片绑定；且 **三路互证**：图搜卡片 ↔ OpenCLI item ↔ 1688-cli detail 对同一 offer（917424058724：史努比房子午餐包 ¥35.9/50 件起批/白沟新城卓诗箱包厂）完全一致；另 628609896086/832349758315/1058608433836 卡片↔详情一致。
- **价格语义**：图搜卡片价格为页面显示价（如 832349758315 卡片 ¥6.38 促销价 vs 详情实价 ¥11.38；卡片"1件起批" vs 详情"2件起批"）——**displayedPrice/displayedMOQ 语义维持，不升级**。
- **无 CAPTCHA/滑块出现**（3 次搜索全程）；**零凭据导出**（页面上下文操作，无 Cookie/Token 复制）。

### 2.4 性能与摩擦

- 图搜单次：页面加载（首次 15-20s）→ 文件注入 ~3s → 用户点按钮 → 结果 8-16s（跳转 air 结果页 `?tab=imageSearch&imageId=...`）→ 提取即时。
- 用户动作：**每图 1 次点击**（自动注入下）；首次一次性：扩展加载（手动 Load unpacked）+ 1688 登录（扫码）。
- 重启复测：**PASS**——daemon stop → 自动拉起 + 扩展自动重连（11s）→ item 可读图搜候选；浏览器会话持久（用户登录态不变）。

## 3. 失败模式与约束（如实记录）

1. **air.1688.com 专用图搜页上传不可用**（"无法识别"）——必须使用 **s.1688.com 相机入口**。
2. **"搜索图片"按钮需真实用户点击**（closed shadow AX 坐标失效）——半自动操作模型。
3. 图搜=**同类候选发现**，非精确匹配（A/C 全相关但无 exact；B 主题召回 3/6）——五态人工核查环节保留。
4. 自动化注入依赖页面 DOM（input#img-search-upload 存在性）——页面改版需适配。
5. 上传前页面必须完成加载（注入需页面 React 就绪，实测等待 ≥15s）。

## 4. 判定（任务书 §26/§40）

```
NATIVE_1688_IMAGE_SEARCH = APPROVED   # 带约束：s.1688.com 入口；上传激活需用户每会话一次；结果=候选发现
IMAGE_SEARCH = APPROVED               # 原生图搜链路实测可用（替代 1688-cli 损坏的 image-search）
ACQUISITION_STRATEGY = HYBRID         # B(关键词/详情) + 原生图搜(图片发现) 真实互补
KEYWORD_SEARCH = LOCAL_SESSION_CLI
IMAGE_DISCOVERY = BROWSER_BRIDGE_NATIVE_UI_SEMI_AUTOMATED  # 见 closed-shadow-autoclick.md（按钮自动点击 4/4、0 误点）
DETAIL = LOCAL_SESSION_CLI            # 次要：BROWSER_BRIDGE item
SECONDARY_CURRENT_TAB = BROWSER_BRIDGE
MANUAL_IMPORT = KEEP_AS_FALLBACK
V3_5_NATIVE_IMAGE_SEARCH_SPIKE = DONE
```

- **不改变产品边界**：图搜结果 = 候选发现（Search Result），必须 Search→Preview→Human Confirm→（未来）Sourcing Evidence；不自动保存、不做视觉 AI 评分、不做推荐/采购。
- 正式 V3.5 推荐图片找货 UX：Candidate 主图 → 应用内引导打开 s.1688.com（或应用内嵌 Bridge 会话）→ **用户首次上传一张图激活** → 自动注入替换图片 + **自动点击"搜索图片"**（closed-shadow-autoclick.md）→ 自动提取候选卡片 → 人工五态勾选 → 1688-cli 补详情。
- 最大风险：页面结构依赖（input/按钮/卡片 DOM）+ 上传激活半自动 + s.1688 与 air 入口行为差异。
