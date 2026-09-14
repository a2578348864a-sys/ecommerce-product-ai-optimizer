# Image Studio V2.1.4 实测报告

## 结论

本次真实浏览器验收确认：V2.1.4 的图片生成、批准参考图绑定、候选持久化和页面读取链路均可工作，两个真实商品的当前结果都能从 Image Studio 页面加载并下载，应用页面复查时 Console 没有运行时错误。

本次没有重新触发 Provider。当前版本的真实图片已经持久化在两个任务中，本轮直接从正式 Image Studio 页面读取并下载，避免无必要的重复付费调用。Onlyeasy 有可读取的旧历史图片，THERMOS 没有同槽位、同参考图的 V2.1.4 前对照结果。因此本报告可以判断当前版本的实际表现和 Onlyeasy 的方向性差异，但不能把两个商品都判定为严格受控的 V2.1.4 对照实验。

**比较结论：Onlyeasy 上当前版本相对历史图表现出更清晰的主体占比和更接近白底 Listing 的构图；THERMOS 当前细节特写符合用途并保持了商品颜色与主要结构。严格的跨商品稳定性提升结论为 CONDITIONAL，暂不以本报告单独批准进入 V2.2。**

## 环境

- 验收日期：2026-09-15（Asia/Shanghai）
- 代码根目录：`D:\Workspace\projects\project-001-跨境电商AI工具\电商工具-fix-sourcing`
- HEAD：`b880368714c4c5971d9c80175c11f953b72b5a7b`
- 本地服务：`http://127.0.0.1:3005`
- 浏览器：Playwright CLI 驱动的真实 Chromium 会话
- Provider：`openai_compatible_relay`
- 模型：`gpt-image-2`
- 输出规格：1536 × 1024，requestedFormat=`webp`，actualFormat=`png`
- Provider 调用：本轮 0 次；以下当前图片均为此前在当前版本页面中真实生成并已持久化的结果
- 代码修改：0

## 测试商品

| 商品 | taskId | 商品类型 | 已确认事实 | 已批准参考图 | 当前图片用途 |
| --- | --- | --- | ---: | ---: | --- |
| THERMOS FUNTAINER Kids Food Jar with Spoon, 10oz, Pink | `cmu0zrjjg000l9641b2a57bti` | 结构简单的儿童食物罐 | 10 | 1 | 产品细节特写 |
| Onlyeasy Sturdy Under Bed Shoe Storage Organizer, Set of 2 | `cmu13dxfa000v9641uqejz0d5` | 结构复杂的双收纳盒/鞋柜收纳 | 15（图片作用域显示 10） | 1 | 卖点信息图 |

两项任务都来自正式研究记录，参考图状态为“商品参考图已确认”，不是 fixture 或手工拼接数据。Onlyeasy 的确认事实包含品牌、商品类型、黑色、24 Pairs、型号 MXAUBSB2P、材质、尺寸、重量、拉链和可折叠/手柄等信息；THERMOS 的图片作用域包含系列、品牌、10oz、商品类型和 Pink。

## 生成记录

### A：当前 V2.1.4 持久化真实结果

| 商品 | imageId | slotType | recipeVersion | stylePreset | promptHash | reference image 标识 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| THERMOS | `e447fb07-d21e-4da1-b24c-f8ce00e6b6cb` | `detail_closeup` | `f2d80b80` | `macro_detail` | `c639bf71325bca9f3b6afc18d10b7c2993905a6e00b3ab1f3c0cb9202c599ce7` | `00d68e8b6d09000e3d07ba77eff06ca15799e5a4144598a9aa3093b87779a88a` | 成功，2,356,021 bytes，needs_human_review |
| Onlyeasy | `e30fc226-c45f-4d16-a214-d91bb5a48a00` | `selling_points` | `98a8f5c7` | `amazon_clean_hero` | `2832ab5101114661ed843aa0a52a137ea7447e7116305ae01703b29bf951c19e` | `11b18491eb392567e4ad88b587f152217de7745a99e2f510f69b4dde0c4d0557` | 成功，2,111,233 bytes，needs_human_review |

每条当前结果的尝试次数为 1，持久化 Provider 结果为 1 次；没有 fallback 记录。服务端快照中的 provider/model/尺寸与页面下载结果一致。

### B：旧版历史对照

| 商品 | imageId | 可用元数据 | 结果 |
| --- | --- | --- | --- |
| Onlyeasy | `2ff552e1-5e4c-4e1c-850d-8e66779eb642` | provider=`openai_compatible_relay`，model=`gpt-image-2`，1536×1024；旧记录没有 slotType、recipeVersion、promptHash、reference image hash | 历史图可读取，2,193,743 bytes |
| THERMOS | 无 | 当前数据库没有 V2.1.4 前的同商品历史图 | 无法构造有效旧版对照 |

Onlyeasy 的历史图属于旧创作资料，页面也明确标记为“不能作为正式商品图”。由于旧记录没有槽位和配方元数据，本组比较是视觉方向对照，不是严格同 slotType 的因果 A/B。THERMOS 不使用历史结果补齐对照。

## 图片文件与浏览器证据

以下文件均由真实浏览器页面的“下载”动作或候选图片截图产生，文件保留在仓库现有 `.playwright-cli` 证据目录：

- 当前 THERMOS 原图下载：[thermos-v214.png](.playwright-cli/thermos-v214.png)
- 当前 Onlyeasy 原图下载：[onlyeasy-v214.png](.playwright-cli/onlyeasy-v214.png)
- Onlyeasy 旧版历史原图浏览器读取：[onlyeasy-legacy-1-full.png](.playwright-cli/onlyeasy-legacy-1-full.png)
- 当前 THERMOS 候选卡截图：[thermos-candidate-v214.png](.playwright-cli/thermos-candidate-v214.png)
- 当前 Onlyeasy 候选卡截图：[onlyeasy-candidate-v214.png](.playwright-cli/onlyeasy-candidate-v214.png)
- Onlyeasy 当前结果与历史草稿页面证据：[image-studio-onlyeasy-history-comparison.png](.playwright-cli/image-studio-onlyeasy-history-comparison.png)、[image-studio-onlyeasy-history-thumbnails.png](.playwright-cli/image-studio-onlyeasy-history-thumbnails.png)
- THERMOS 桌面页面证据：[image-studio-thermos-final-desktop.png](.playwright-cli/image-studio-thermos-final-desktop.png)

浏览器操作路径：

1. 打开 `http://127.0.0.1:3005/image-studio?taskId=cmu13dxfa000l9641b2a57bti`，确认 THERMOS 的研究资料、批准参考图、产品细节特写策略和候选结果。
2. 使用候选卡的“下载”保存当前结果，随后读取候选图片并检查尺寸与主体。
3. 打开 `http://127.0.0.1:3005/image-studio?taskId=cmu13dxfa000v9641uqejz0d5`，确认 Onlyeasy 的研究资料、批准参考图、白底/卖点策略和当前候选。
4. 展开“历史草稿”，通过旧候选的图片路由读取 `2ff552e1...`，保存旧版全图用于方向性对照。
5. 返回 Onlyeasy Image Studio 页面，确认正式候选和历史草稿都能读取；页面接口返回 200。

当前页面的关键接口均返回 200，包括 `creative-handoff`、`image-handoff` 和每个 `image-draft` 读取接口。应用页面最后一次 Console 检查为 2 条信息日志（React DevTools、HMR），**Errors=0、Warnings=0**。直接打开图片二进制路由时浏览器会把二进制页当文档处理，这个过程产生的错误不属于 Image Studio 应用页面验收，不计入应用 Console 结果。

## 视觉检查结果

### THERMOS：产品细节特写

当前图是粉色 THERMOS 食物罐的正面近景。粉色外壳、金属下筒、上盖接缝、中央按钮和白色折叠勺都清晰可见；没有额外配件、尺寸数字或画面文字。近距离构图确实回答了“做工细节、接缝和表面质感”的用途，主体占画面比例高，适合作为 Amazon Listing 副图或 A+ 重点细节图。

限制是特写裁掉了完整商品轮廓和容量信息，不能单独承担主图或规格图；这属于用途边界，不是生成失败。由于没有 THERMOS 旧版同槽位图，不能据此量化 V2.1.4 比旧链路提升多少。

### Onlyeasy：卖点信息图

当前图展示两只黑色收纳盒，每只收纳盒内部有鞋位分隔和鞋子，主体放大、居中偏右，左侧保留大片干净留白；白底干净，没有文字、假标尺或陌生道具。两只收纳盒和黑色外观与确认事实一致，画面比历史图更接近可用于 Listing 的产品展示图。

当前图的优点是商品主体清楚、边缘和材质纹理可辨、留白可供后期信息排版，适合卖点副图/A+ 视觉底图。它没有在图内呈现“24 Pairs”、尺寸或拉链等文字化卖点，因此信息表达仍依赖后期排版或另行生成规格图；不能把这张图当作尺寸/容量信息图。

历史 Onlyeasy 图的主体更小，使用了斜向窗光和地面阴影，视觉上更接近生活场景草稿；当前图背景更干净、主体比例更大、商品轮廓更适合作为白底或信息图底图。由于历史记录缺少 slotType/recipeVersion/promptHash/reference hash，这个改善只能作为方向性观察。

## 验收结果表

| 项目 | THERMOS | Onlyeasy | 证据 |
| --- | --- | --- | --- |
| 商品主体一致 | PASS（当前图） | PASS（当前图） | 当前原图与批准参考图、已确认事实对照 |
| 颜色/结构/数量/配件未见错误 | PASS；粉色、罐体、白勺保留 | PASS；黑色、双盒结构保留 | 原图人工复核；最终仍需人工审核 |
| 未出现不存在功能或参数 | PASS | PASS | 无文字、无尺寸数字、无陌生配件 |
| 图片用途正确 | PASS：细节特写 | CONDITIONAL PASS：卖点视觉底图，未表达数字卖点 | 页面 recipe/用途说明 + 原图 |
| 主体清晰度与占比 | PASS | PASS | 当前原图 |
| Amazon Listing/A+ 适配度 | PASS：副图/A+ 细节 | PASS：副图/A+ 底图 | 页面推荐用途 + 原图 |
| 旧版严格可比 | FAIL/未验证 | CONDITIONAL（历史元数据不完整） | 历史记录缺少控制变量 |
| 页面刷新后读取 | PASS | PASS | 页面重新打开后当前候选和历史草稿均可读取 |
| 应用 Console error | PASS（0） | PASS（0） | Playwright console |

## 失败与限制分类

### Provider 能力限制

- 参考图生图仍然不能保证每次都完整呈现所有数量、配件或细小结构；本次结果没有发现错误，但必须保留人工审核。
- 生成图片不自动承担尺寸、容量和事实文字排版；Onlyeasy 当前图没有直接表达 24 Pairs 或 29.3" × 23.6" × 5.9"。
- 细节特写天然牺牲全貌，不能替代主图和规格图。

### Prompt / Recipe 限制

- 当前配方已经把用途、禁止文字、真实参考图和事实边界放入生成前预览，能约束构图方向。
- 卖点视觉仍偏“主体底图”而非完整的信息图，需要后期排版或单独规格配方；本次不修改 Prompt/Recipe。

### 参考图限制

- 每个任务当前只有 1 张批准参考图。多角度参考不足时，背面、内部和细节一致性无法充分验证。
- 历史图片没有统一保存槽位和提示词元数据，限制了跨版本严格比较。

### 产品逻辑问题

- 本次没有发现生成、保存或读取逻辑故障。
- `needs_human_review` 是正常安全状态，不是失败；页面明确要求人工核对外观、Logo 和文字。

## 是否进入 V2.2

建议：**暂缓把本次结果作为进入 V2.2 的充分依据，先补一轮严格受控的回归样本。**

进入 V2.2（候选审核/图片包）前至少补齐：

1. THERMOS 或另一个简单商品的 V2.1.4 前同 slotType、同参考图、同输出规格旧结果。
2. Onlyeasy 的同 slotType、同 recipeVersion、同参考图旧结果，或重新建立冻结的旧版控制。
3. 至少一张尺寸/规格用途和一张包装/配件用途的受控结果，验证事实信息表达，而不是只验证主体底图。
4. 记录统一的生成次数、失败次数和 Provider request id，避免依赖历史记录缺失元数据。

候选审核和图片包可以作为 V2.2 的产品方向，但本次证据还不足以证明它们会提升图片专业度。当前更稳妥的状态是：保留 V2.1.4 的身份绑定、配方化策略、生成前预览和人工审核，先完成可比基线，再决定 V2.2 范围。

## 最终判定

- 当前 V2.1.4 真实生成链路：**PASS**
- 两个真实商品当前结果可读取/可下载：**PASS**
- 商品身份和安全边界：**PASS（以本次样本人工复核为限）**
- Onlyeasy 相对历史图的视觉方向：**当前版本更适合白底/Listing 底图，方向性改善**
- 两商品严格 V2.1.4 vs 旧版 A/B：**未完成，证据不足**
- 是否宣称转化率提升：**否**
- 是否立即进入 V2.2：**暂缓，先补齐受控基线**

本报告没有修改业务代码、Prompt、Recipe、Provider 参数、数据库或 Git 历史。
