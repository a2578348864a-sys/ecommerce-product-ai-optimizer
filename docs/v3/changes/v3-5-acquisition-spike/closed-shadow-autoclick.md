# V3.5-A.2 — Closed Shadow Auto-Click Spike（closed-shadow-autoclick）

> 实测完成（2026-08-15）。目标：消灭"搜索图片"按钮的人工点击。**结果：NATIVE_IMAGE_SEARCH_AUTO_CLICK = AUXILIARY_ONLY**（按钮自动点击机制 APPROVED 级可靠；上传模式激活环节需用户每会话一次手动上传）。

## 1. 环境与版本（任务书 §31）

- Chrome **151.0.7922.138**（Stable, 64-bit）；OpenCLI CLI **v1.8.6**；Extension **v1.0.22**；CDP 经 OpenCLI Bridge（extension debugger API + allowlist）。
- 隔离 Chrome Test Profile（只登录 1688）；测试后已停 daemon。

## 2. Resolver 层级实测（任务书 §7）

### LEVEL 1 CDP DOM（含 closed shadow pierce）— **主路径，实测有效**

- `Accessibility.getFullAXTree` **能返回 closed shadow 内文本节点**（如"搜索图片" StaticText，带 `backendDOMNodeId`）——**AX 对 closed shadow 可见**（Chrome 151）。
- `DOM.getBoxModel({backendNodeId})` **对 closed shadow 内节点有效**（拿到按钮真实坐标；多次验证）。
- **稳定性限制**：AX `getFullAXTree` 在本环境**时好时坏**（0 节点 vs 4000+ 节点；daemon 重启/扩展重连后 AX enable 状态丢失）——**为此实现了第二 resolver（class 扫描）**。
- **class 扫描 resolver（绕开 AX）**：`elementFromPoint` 网格扫描命中 `search-btn` class（含 closed shadow hit-testing）→ 中心坐标——**实测稳定**（3 Case 全部 4s 内命中 (1029,307-370)）。

### LEVEL 2 Accessibility Tree — 部分可用（见上）；LEVEL 3 Extension shadow API — 未需要；LEVEL 4 Visual — 未使用。

## 3. Target Proof（任务书 §9，防误点核心）

自动点击前必须全部满足：

```
page = s.1688.com 当前图搜页面（含 ?t= 参数；URL 检查）
image_uploaded = true（AX/class 扫描确认按钮出现）
target_role = 可点击容器（DIV.search-btn）
target_name = 搜索图片（elementFromPoint innerText 精确匹配）
target_visible = true（box 宽高 > 0 且在 viewport）
target_enabled = true（元素存在且可命中）
target_box_valid = true（getBoxModel content 有效）
target_unique = true（AX 过滤 backendDOMNodeId；class 扫描首个命中）
stale = false（点击前实时重新扫描/重新 getBoxModel，废弃旧 backendNodeId）
```

- **实测**：`elementFromPoint(center)` 返回 `DIV.search-btn` 且文本"搜索图片"才点击；**PROOF_FAIL 多次正确拦截**（瞬时遮罩 `J_MIDDLEWARE_FRAME_WIDGET` 覆盖、坐标偏移等场景 fail-closed，未发生任何误点）。
- **stale 处理**：backendNodeId 每次页面加载都变化（实测 6257→68388→138677→29838→231287…）——**每次点击前实时抓取**，绝不复用旧 nodeId。

## 4. 点击方法（任务书 §8/§11/§12）

- **首选：CDP `Input.dispatchMouseEvent` 真实鼠标事件链**（mouseMoved→mousePressed→mouseReleased，按钮中心坐标；坐标来自 box model / class 扫描，**非固定坐标**）。
- **备选：JS dispatchEvent 标准事件序列**（mousedown/mouseup/click 到 elementFromPoint 命中元素；isTrusted=false 但 React 处理链验证有效）。
- **SEARCH_TRIGGERED 验证**（点击后不直接宣布成功）：页面跳转 `air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch&imageId=<id>` 且返回真实图搜结果（与 fallback 推荐区分——未点搜索时页面显示默认推荐，已作为对照）。

## 5. 实测结果（点击机制）

| 项 | 结果 |
|---|---|
| 自动点击触发图搜 | **4/4 成功**（imageId：1539808815442953643 / 1273208815446377332 / 1730108816945124731 / 1159808815372524974）；点击方法含 CDP_MOUSE 与 JS_DISPATCH 两种 |
| WRONG_CLICK_COUNT | **0**（proof 门禁全程拦截；PROOF_FAIL 多次 fail-closed） |
| SEARCH_BUTTON_MANUAL_CLICK_COUNT | **0**（用户全程未点击"搜索图片"；用户只做上传激活） |
| Wrong Entity | 0（卡片同实体；与 V3.5-A native spike 三路互证一致） |
| 结果真实性 | 跳转结果页 + 保温杯/冰霸杯相关结果（A 图）；非 fallback（对照验证） |
| 风控 | 高频操作触发 1688 滑块验证一次（用户人工完成；符合任务书 §17） |
| Cookie/Token | 零导出（全程页面上下文 + CDP；无凭据复制） |

## 6. 端到端限制（AUXILIARY_ONLY 的依据）

- **上传模式激活**（"搜索图片"按钮出现）是**页面级 React 状态**（`O(true)`），只能由**真实用户手势**（点相机→上传→选文件）可靠激活：
  - 新页面注入（DataTransfer+change）：**概率性成功**（native spike 中成功过；本 Spike 脚本化 12+ 次尝试中大部分失败）；
  - `dispatchEvent` 到 `.image-upload-button-container`：**不可靠**（点击处理不在 React props/事件委托未响应）；
  - CDP 点击容器区域：**被隐藏 input 覆盖**（elementFromPoint 命中 input）；
  - **浏览器后退（bfcache）恢复的页面：点击无效**（冻结/恢复后事件链失效）。
- 因此**产品模型**：用户**每会话一次手动上传**（激活上传模式）→ 后续同一页面内**注入替换图片 + 自动点击"搜索图片"全部自动**（按钮存在时 4/4 成功）。
- 高频操作会触发 1688 滑块（人工处理一次后放慢节奏可继续）。

## 7. 判定（任务书 §33-§36/§42）

```
NATIVE_IMAGE_SEARCH_AUTO_CLICK = AUXILIARY_ONLY   # 按钮自动点击可靠（4/4、0 误点）；上传激活环节需用户每会话一次
AUTO_CLICK_METHOD = CDP_DOM                        # class-scan resolver 主路径 + AX backendNodeId resolver 辅助
SEARCH_BUTTON_MANUAL_CLICK_COUNT = 0
WRONG_CLICK_COUNT = 0
IMAGE_DISCOVERY = BROWSER_BRIDGE_NATIVE_UI_SEMI_AUTOMATED  # 上传激活半自动；搜索提交全自动
ACQUISITION_STRATEGY = HYBRID                      # 不变
V3_5_CLOSED_SHADOW_AUTO_CLICK_SPIKE = DONE
V3_5_IMPLEMENTATION_AUTHORIZATION_REQUIRED = TRUE
V3_6_AUTHORIZATION_REQUIRED = TRUE
PUBLIC_DEPLOY = FORBIDDEN
```

## 8. 采用与产品化建议（任务书 §38）

- 正式 UX：Candidate 主图 → 引导打开 s.1688.com → **用户首次上传一张图**（激活）→ 系统自动注入替换后续图 + 自动点击"搜索图片" → 自动提取候选 → 人工五态确认 → detail 补全。
- 实现：**class 扫描 resolver**（`search-btn` class + elementFromPoint + proof）为主，AX backendNodeId resolver 为辅助；**TEMP CLI 的 `cdp` 子命令**（raw CDP 通道，allowlist 约束）为本次调试产物，正式实现可复用该机制（不引入新权限；未修改 Extension 权限面）。
- 人工 fallback 保留：resolver 失败/风控 → USER_ACTION_REQUIRED。
- 风险：1688 页面改版（search-btn class/布局变化）需 resolver 版本化（resolverVersion v1）；高频操作风控（限速）。
- **不自动保存**：图搜结果仍只到 Search Result Discovery（Preview→Human Confirm 不变）。
