# Image Studio V2.1.5 图片质量基线实验报告

**结论先行：CONDITIONAL_PASS（严格基线未成立，暂缓进入 V2.2）**

本轮只做了真实浏览器只读复核和已保存图片的人工对照，没有重新生成图片、没有调用 Provider、没有修改业务代码。当前 V2.1.4 的两组真实输出均可读，未发现明显的商品事实安全回归；但数据库中没有同时满足“同商品、同批准参考图、同 slotType、同配方/输出规格”的两组新旧结果，且没有找到软商品的真实图片快照。因此不能把本轮结果写成严格的三商品 A/B，也不能据此宣称转化率或全面泛化。

## 环境与方法

- 代码 HEAD：`b880368714c4c5971d9c80175c11f953b72b5a7b`
- 本地服务：`http://127.0.0.1:3005`
- 浏览器：真实 Chrome（Playwright CLI，headed）
- 当前 Provider：`openai_compatible_relay`
- 当前模型：`gpt-image-2`
- 当前输出规格：1536 × 1024 PNG（部分请求声明 webp，但实际保存为 PNG）
- 评价对象：已保存的真实图片快照；V2.1.4 输出时间均在 V2.1 代码提交之后
- 生成次数：本轮 0 次；使用已存在的真实生成记录
- 人工修改次数：记录中没有图像编辑或修图操作，按 0 计；`needs_human_review` 仍表示必须人工复核，不等于已修改

浏览器复核路径：

- Onlyeasy：`/image-studio?taskId=cmu13dxfa000v9641uqejz0d5`
- THERMOS：`/image-studio?taskId=cmu0zrjjg000l9641b2a57bti`

两个页面均能加载研究资料、批准参考图、视觉方案、生成记录和候选结果；本轮页面 Console 只有 React DevTools/HMR 信息，Errors = 0。

## 真实商品与基线可用性

| 类别 | 商品 / taskId | 真实资料 | 当前 V2.1.4 图片 | 旧版可比图片 | 严格同条件 A/B |
|---|---|---|---|---|---|
| 简单结构 | THERMOS FUNTAINER Kids Food Jar with Spoon, 10oz, Pink / `cmu0zrjjg000l9641b2a57bti` / ASIN B08NCVT244 | 10 项确认事实；1 张批准参考图 | 有，`e447fb07-d21e-4da1-b24c-f8ce00e6b6cb` | 未找到同商品旧版图片 | **否**，只有当前结果 |
| 复杂结构 | Onlyeasy Sturdy Under Bed Shoe Storage Organizer, Set of 2 / `cmu13dxfa000v9641uqejz0d5` / ASIN B07VBJ5MSH | 15 项确认事实；1 张批准参考图 | 有，`e30fc226-c45f-4d16-a214-d91bb5a48a00` | 有历史图，但缺 slot、配方、prompt、参考图指纹 | **否**，只能方向性比较 |
| 软商品 | 本地真实任务扫描未找到服饰/布料类且有图片快照的任务 | 没有可用样本 | 无 | 无 | **否** |

扫描到的其他真实任务（Owala FreeSip、HydroJug Traveler）没有 `aiImageDraftSnapshot` 图片结果，不能在不调用 Provider 的前提下补成实验样本。没有使用 fixture、手工补造数据或历史 fallback 结果替代。

## 图片生成记录

### THERMOS（当前 V2.1.4）

- taskId：`cmu0zrjjg000l9641b2a57bti`
- imageId：`e447fb07-d21e-4da1-b24c-f8ce00e6b6cb`
- slotType / recipe：`detail_closeup` / `f2d80b80`
- stylePreset：`macro_detail`
- promptHash：`c639bf71325bca9f3b6afc18d10b7c2993905a6e00b3ab1f3c0cb9202c599ce7`
- reference image hash：`00d68e8b6d09000e3d07ba77eff06ca15799e5a4144598a9aa3093b87779a88a`
- provider / model：`openai_compatible_relay` / `gpt-image-2`
- 规格：1536 × 1024，2,356,021 bytes，PNG
- 创建时间：2026-09-14 22:44:48（本地时间）
- 成功 / 失败：1 / 0
- 人工修改：0
- 状态：`needs_human_review`
- 证据图：[thermos-v214.png](.playwright-cli/thermos-v214.png)、[页面截图](.playwright-cli/thermos-baseline-page.png)

人工观察：粉色主体、白色随附勺、盖体接缝和按钮结构清晰，未见陌生配件、错误文字或虚构参数。它是细节特写，适合展示结构，不等同于 Amazon 主图或完整卖点图。

### Onlyeasy（当前 V2.1.4）

- taskId：`cmu13dxfa000v9641uqejz0d5`
- imageId：`e30fc226-c45f-4d16-a214-d91bb5a48a00`
- slotType / recipe：`selling_points` / `98a8f5c7`
- stylePreset：`amazon_clean_hero`
- promptHash：`2832ab5101114661ed843aa0a52a137ea7447e7116305ae01703b29bf951c19e`
- reference image hash：`11b18491eb392567e4ad88b587f152217de7745a99e2f510f69b4dde0c4d0557`
- provider / model：`openai_compatible_relay` / `gpt-image-2`
- 规格：1536 × 1024，2,111,233 bytes，PNG
- 创建时间：2026-09-14 22:34:43（本地时间）
- 成功 / 失败：1 / 0
- 人工修改：0
- 状态：`needs_human_review`
- 证据图：[onlyeasy-v214.png](.playwright-cli/onlyeasy-v214.png)、[页面截图](.playwright-cli/onlyeasy-baseline-page.png)

人工观察：两只黑色收纳盒、分隔结构、鞋子和手柄均可辨识，主体占画面较大，左侧留白利于后续排版；未见新增配件、错误数量或文字。当前图更接近 Listing 副图/卖点图，而不是白底主图。

### Onlyeasy（历史旧结果，仅作非严格方向性对照）

- imageId：`2ff552e1-5e4c-4e1c-850d-8e66779eb642`
- 创建时间：2026-09-14 18:33:47（本地时间）
- provider / model：`openai_compatible_relay` / `gpt-image-2`
- 规格：1536 × 1024 PNG，2,193,743 bytes
- 缺失：slotType、recipeVersion、stylePreset、promptHash、referenceImageContentHash
- 证据图：[onlyeasy-legacy-1-full.png](.playwright-cli/onlyeasy-legacy-1-full.png)

人工观察：仍然能看到两只收纳盒和鞋子，但主体较小，背景带斜向窗光和地面环境，空白与光影更像生活方式草图。由于参考图指纹和槽位信息缺失，不能排除输入条件不同。

## 评分

评分标准为 1–5：5 = 在该用途下可直接作为候选并只需常规人工复核；3 = 可用但需要明显人工处理或用途受限；1 = 关键商品身份/安全错误。

| 商品 / 结果 | 商品身份 | Listing/A+适用性 | 构图 | 光线 | 主体比例 | 专业感 | 安全 |
|---|---:|---:|---:|---:|---:|---:|---:|
| THERMOS V2.1.4 detail_closeup | 4 | 3 | 4 | 4 | 4 | 4 | 5 |
| Onlyeasy V2.1.4 selling_points | 4 | 4 | 4 | 4 | 5 | 4 | 5 |
| Onlyeasy 历史图（非严格对照） | 4 | 3 | 3 | 4 | 3 | 3 | 4 |

Onlyeasy 的方向性变化是：当前结果主体更大、背景更干净、排版留白更可控，电商用途评分提高；这不是严格 A/B 结论。THERMOS 没有旧图，不能计算前后提升。

## 通过项

- 两个真实商品的当前图片均保留了主要商品身份：颜色、基本结构、数量和随附件没有明显错误。
- 未发现虚假文字、错误尺寸数字、陌生配件或未经确认功能。
- Onlyeasy 当前图的主体占比和留白更适合后续 Amazon Listing/A+ 信息排版。
- 研究资料、批准参考图、槽位/配方/风格/Prompt 指纹和人工复核提示在真实浏览器页面可见。
- 刷新读取链路在本轮复核中能显示已保存的候选；页面 Console Errors = 0。

## 未通过项与失败案例

- **严格 A/B：未成立。** 仅 Onlyeasy 有历史旧图，而且旧记录缺少关键实验元数据；THERMOS 没有旧版图；软商品没有可用图片。
- **三类商品覆盖：未完成。** 当前数据库没有带图片快照的真实软商品任务。
- **用途覆盖有限。** 本轮现有快照主要是 `detail_closeup` 和 `selling_points`；没有在相同条件下验证白底主图、尺寸/规格图和场景图。
- 当前保存格式出现“请求 webp、实际 PNG”的格式差异，说明仍需在后续实验中把“请求规格”和“落盘规格”分别记录并作为比较条件。
- 所有结果仍是 `needs_human_review`，不能直接当成已发布素材。

## 问题归类

- **Provider 能力限制：** 当前证据不足以评估跨品类稳定性；已有图片未显示明显身份错误，但没有足够的同条件重复样本。
- **Prompt / Recipe：** THERMOS 的细节特写表达清楚，但用途是局部结构展示，不能替代主图或尺寸图；这更像用途选择限制，不能归因于生成质量提升。
- **参考图：** 严格对照的主要缺口是旧图缺少参考图指纹，无法证明前后使用了同一批准参考图。
- **产品资料：** 软商品样本缺失，不能评价布料/服饰的形变、纹理和颜色稳定性。
- **产品逻辑：** 未发现本轮新增的产品逻辑问题。

## V2.2 决策

**暂不进入 V2.2。**

进入 V2.2 前至少补齐：

1. 两个不同品类各自一组可复现的新旧对照，固定同一批准参考图、slotType、recipe/style、Provider/model、尺寸和质量参数，并保存 prompt/reference hash。
2. 一个真实软商品样本，完成至少一张当前结果和一张可比历史结果；若没有历史结果，明确把该商品标为“无法严格 A/B”，不要补造旧版。
3. 至少覆盖一个主图用途和一个信息表达用途（卖点或尺寸），同时记录成功/失败和人工修改。
4. 对每个结果保留可复核的原图、元数据和人工评分；结果仍需人工审核后才能进入发布流程。

在这些证据到位前，本轮最多支持以下判断：

> 当前 V2.1.4 的已保存真实结果在两个已验证商品上没有显示商品身份或安全下降，Onlyeasy 的方向性画面更适合 Listing 排版；严格三商品基线和 V2.2 进入条件尚未满足。

不宣称转化率提升，不宣称全面泛化，不新增 Provider 调用。

## 证据索引

- [Onlyeasy 当前图片](.playwright-cli/onlyeasy-v214.png)
- [Onlyeasy 历史图片](.playwright-cli/onlyeasy-legacy-1-full.png)
- [THERMOS 当前图片](.playwright-cli/thermos-v214.png)
- [Onlyeasy Image Studio 页面](.playwright-cli/onlyeasy-baseline-page.png)
- [THERMOS Image Studio 页面](.playwright-cli/thermos-baseline-page.png)
- 既有报告：[V2.1.4 视觉验收报告](IMAGE_STUDIO_V2.1.4_VISUAL_ACCEPTANCE_REPORT.md)

