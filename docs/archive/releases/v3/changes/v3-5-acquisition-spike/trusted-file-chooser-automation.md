# V3.5-A.3 — Trusted File Chooser Automation Spike（trusted-file-chooser-automation）

> 实测完成（2026-08-15）。目标：把"每会话首次手动上传图片"通过**正规浏览器 File Chooser 流程**完全自动化。**结果：TRUSTED_FILE_CHOOSER_AUTOMATION = APPROVED**（3 Case 3/3 + Restart Fresh Session PASS；FIRST_UPLOAD_MANUAL_ACTION_COUNT=0）。

## 1. 版本信息（任务书 §43）

- Chrome **151.0.7922.138**（Stable）；CDP 经 OpenCLI Bridge；OpenCLI CLI v1.8.6；Extension **v1.0.26**（TEMP 修改版）。
- resolver/upload 版本：`native-image-upload-trigger.v3`（focus+Enter 键盘激活）；搜索按钮 resolver：`native-image-search-resolver.v1`（class 扫描 + AX 辅助）。

## 2. 上传入口定位与 Target Proof（任务书 §8/§9）

- 入口：s.1688.com 搜索页 `input#img-search-upload`（opacity:0、absolute、pointer-events:auto、主 document、非 shadow——实测）。
- UPLOAD_TARGET_PROOF：page=正确搜索页（?t= URL）；target=input[type=file]#img-search-upload；visible（rect 有效）；enabled（可 focus）；unique（页面唯一 file input，实测 matches_n=1）；box_valid（width/height>0）；wrong_target_count=0。

## 3. File Chooser 能力（任务书 §11/§12）

- 实测 Chrome 151：**Page.setInterceptFileChooserDialog + Page.fileChooserOpened + DOM.setFileInputFiles 可用**（经扩展 upload 命令）。
- **关键发现——触发 chooser 的激活方式**：
  - `Runtime.evaluate el.click()`（原扩展实现）：**无用户激活 → chooser 不弹**（Chrome 151 要求）。
  - **CDP 真实鼠标点击 input 中心**：**y<150 页面顶部区域无效**（实测：该区域 CDP 鼠标事件不达页面——浏览器级限制；y>=150 有效）；input 恰在顶部（y=17~81）→ **不可靠**。
  - **✅ 最终方案：JS `el.focus()` + CDP 可信键盘 Enter**（`Input.dispatchKeyEvent`）：聚焦的 file input 按 Enter 打开 chooser（与用户 Tab+Enter 等价）；**键盘 CDP 事件送达稳定**。**upload 实测 526ms 完成**。
  - **前置条件：Chrome 窗口须在前台**（CDP 输入事件在窗口未聚焦时被浏览器丢弃——实测：eval 正常但鼠标/键盘事件不达页面；用户正常使用场景自然满足）。

## 4. 上传流程与证明（任务书 §13-§16）

- Experiment B（真实激活后给文件）：focus → 可信 Enter → `Page.fileChooserOpened`（intercept）→ `DOM.setFileInputFiles` → 页面正常上传。**Experiment A（直接 setFile）对照**：不做主路径（首次 activation 不稳定，A.2 已证）。
- UPLOAD_STATE_PROOF：预览 dataURL 出现且长度匹配候选图（A=37311、B=43267、C=13955 与本地文件 base64 一致）→ **Candidate Identity Proof ✓**；"搜索图片"按钮出现（class 扫描）→ 上传状态激活。
- 搜索提交复用 A.2：class 扫描 → elementFromPoint proof（文本"搜索图片"）→ CDP 鼠标点击 → 验证跳转 `air.1688.com?tab=imageSearch&imageId=<id>` + 真实结果。

## 5. 验证结果（任务书 §19-§23/§31-§32）

| 项 | 结果 |
|---|---|
| Case A（OtterBox 杯） | **PASS**（自动上传→自动点击→imageId=1737808815218637218→冰霸杯候选） |
| Case B（Igloo Snoopy 盒） | **PASS**（imageId=1338408815172363293→史努比联名房子午餐包 ¥35.9 等） |
| Case C（KINTO 杯） | **PASS**（imageId=1145708811572688961→日系保温杯候选） |
| Fresh Session（新页面首图） | **PASS**（每 Case 全新 ?t= 页面，自动上传零人工） |
| Restart Fresh Session（§32） | **PASS**（Chrome 完全重启→登录态恢复→首图自动上传→自动点击→imageId=1313608815371631293） |
| FIRST_UPLOAD_MANUAL_ACTION_COUNT | **0** |
| SEARCH_BUTTON_MANUAL_CLICK_COUNT | **0** |
| WRONG_UPLOAD_COUNT | **0**（Candidate Identity 逐张验证） |
| WRONG_CLICK_COUNT | **0**（proof 门禁） |
| Wrong Entity | **0**（结果与 native spike 互证一致） |
| Native visual search 触发 | **真实**（4 个独立 imageId + 结果相关性） |
| fallback 防误判 | 未点搜索=默认推荐（对照）；触发验证以跳转+结果双重确认 |
| Risk Control | 未触发滑块（限速：每 Case 间休息）；窗口前台为硬前置 |
| Cookie/Token | 零导出 |
| Extension 权限 | **未新增**（TEMP 修改仅 upload 触发逻辑；allowlist 未扩） |
| OS-level automation | **未使用**（无 pyautogui/AHK/固定坐标） |
| fail-closed | PROOF_FAIL/NO_TARGET/selector_not_found 均不继续（实测多次正确拦截） |

## 6. 布局波动与重试（残留约束）

- 页面布局两种模式：**标准 y=81**（input 中心 (998,109)，focus+Enter 有效）与**紧凑 y=17**（input 中心 (998,45)，顶部死区+键盘激活失败）。
- **处理**：upload 前等待 input rect 稳定 + **y<50 时重开页面重试**（最多 3 次；实测重试后成功率高）。正式实现保留该重试机制并记录 resolver 版本。

## 7. 判定（任务书 §36/§45）

```
TRUSTED_FILE_CHOOSER_AUTOMATION = APPROVED   # 3 Case 3/3 + Restart Fresh Session PASS + 17 项门禁满足
FIRST_UPLOAD_MANUAL_ACTION_COUNT = 0
SEARCH_BUTTON_MANUAL_CLICK_COUNT = 0
WRONG_UPLOAD_COUNT = 0
WRONG_CLICK_COUNT = 0
IMAGE_DISCOVERY_AUTOMATION = FULLY_AUTOMATED
IMAGE_DISCOVERY = BROWSER_BRIDGE_NATIVE_UI_AUTOMATED
ACQUISITION_STRATEGY = HYBRID
V3_5_TRUSTED_FILE_CHOOSER_SPIKE = DONE
V3_5_IMAGE_AUTOMATION_SPIKES = CLOSED
V3_5_IMPLEMENTATION_AUTHORIZATION_REQUIRED = TRUE
V3_6_AUTHORIZATION_REQUIRED = TRUE
PUBLIC_DEPLOY = FORBIDDEN
```

## 8. 正式图片链（任务书 §39）与约束

```
Candidate → 自动拿主图 → 自动打开/绑定 1688 → 自动点击上传入口（focus+Enter 触发 chooser）
→ 自动 File Chooser 选图 → 自动激活上传状态 → 自动点击"搜索图片" → 自动等待结果
→ 自动提取候选 → 自动 detail 补全 → Preview → 用户选择供应线索
```
- **正式实现约束**：窗口前台（用户使用场景自然满足）；布局重试（y<50 重开页面）；resolver 版本化（页面改版更新）；仍保留人工 fallback（风控/异常 → USER_ACTION_REQUIRED）；图搜结果仍是 Search Result（Preview→Human Confirm 不变）。
- **不改变产品边界**：不做推荐/评分/采购；图搜=候选发现。
