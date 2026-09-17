# Image Studio V2.1 实施报告

> 本文件是仓库内的**简洁**实施记录。完整实验证据（原始图片、请求账本、浏览器截图、逐次调用记录）
> 保存在仓库外，不随仓库分发。本文件不含本地敏感环境信息与大文件。

## 1. 做了什么

在**不新建平台、不重构 Research / Listing、不新增第二套 Image Studio** 的前提下，完成五项升级：

| # | 项 | 结果 |
|---|---|---|
| 1 | 商品身份绑定的实际接线与可见性 | 生成前预览展示当前商品与已确认身份；身份标题不再把任务类型后缀喂给模型 |
| 2 | 既有 Recipe 结构化增强 | 新增 `recipeVersion`（内容派生）/`buyerQuestion`/`requiredFactKinds`/`textAllowed`/`backgroundPolicy`，既有 7 个字段语义不变 |
| 3 | Prompt 构建与安全检查对齐 | **唯一权威构建入口**，断言文本 = 实际发送文本 = `promptHash` 来源 |
| 4 | 生成前方案预览 | 现有卡片内扩充 8 项 + 身份可见性，纯计算、零新增请求 |
| 5 | 候选图最小可追溯版本记录 | 每张候选可读出槽位 / 配方版本 / 风格 / 计划版本 / 实发提示词指纹 / 参考图内容指纹 |

同时修复了排队期间确认的三类真实缺陷（详见 §3）。

## 2. 关键改动

| 文件 | 改动 |
|---|---|
| `lib/imageHandoff/realImageProvider.ts` | `buildTaskImagePromptFinal()` 成为唯一构建入口；发送前对**同一字符串**断言；`buildCandidateTrace()` 写入候选级依据；落盘失败时**隔离保留**已付费字节 |
| `lib/imageHandoff/imageGenerationService.ts` | 安全断言改用同一入口（**断言 = 实发**）；候选摘要增加依据的安全投影（hash 仅前缀） |
| `lib/imageHandoff/imagePrompt.ts` | 导出研究参考层构造；商品身份标题清洗（去任务后缀 + 词边界截断） |
| `lib/imageHandoff/slotPromptRecipes.ts` | Recipe 结构化字段；`recipeVersion` 由内容确定性派生 |
| `lib/imageHandoff/purposeRequirements.ts` | **仅新增导出**（用途→所需事实类别），既有判定逻辑零改动 |
| `lib/imageCreativeDescription.ts` | DTO `confirmedFacts` 透出 canonical `field`（前后端事实门禁同源） |
| `lib/aiImageDraft.ts` | item 契约增加可选依据字段；normalize 宽松放行（不因新字段拒绝历史数据） |
| `lib/server/aiImageDraftStorage.ts` | 新增 `quarantineAiImage()` 隔离保留区；公开读取路径拒绝保留目录键 |
| `components/image-handoff/*` | 生成前预览、身份可见性、逐槽位就绪度与门禁收口、候选卡生成依据展示 |
| `app/prototype/protoData.ts` | 原型样例数据读取收口为单一入口（见 §3.4） |

## 3. 修复的真实缺陷

1. **安全断言 ≠ 实际发送的 Prompt**：旧实现构造一份文本做断言后丢弃，Provider 内部另拼一份发出去。
   现由唯一纯函数构建，两端同源，并新增**捕获真实请求**的测试断言两者逐字一致。
2. **研究参考层（VOC / AI / 竞品）从未真正发送**：它只存在于那份被丢弃的断言文本里，
   两条真实 Provider 路径都忽略 `creativeContext`。已补齐，固定标注 `NOT FACTS`；
   无参考层时不插入任何内容，保证该类任务 Prompt 逐字节不变。
3. **构图概念路径静默丢弃用户创作描述**：用户填写的内容只到达参考图编辑路径。
   已按同一 untrusted 口径补回，排在负面约束段之前。
4. **付费结果可被落盘失败摧毁**：Provider 已计费但校验失败时结果被直接丢弃，
   用户只看到「请稍后重试」，重试即再次付费。现落盘失败会把原始字节送入
   `_quarantine/`（0o700/0o600，另存失败原因），公开读取路径拒绝保留目录键。
5. **商品身份标题脏数据**：真实请求里出现过 `… Storage Solution w 商品研究`
   （内部任务词 + 按字符硬截断产生的断词残片）。现先去后缀、再按词边界截断。
6. **`next build` 因原型数据路径失败**（跨会话文档搬迁未同步读取路径）：
   两个原型页面各自硬编码旧路径，导致整包构建失败、`/prototype` 在运行中 500。
   已收口为单一入口并兼容新旧位置，构建恢复绿色。

## 4. 验证结果

| 检查 | 结果 |
|---|---|
| 图像链 / 存储 / 路由 / 组件测试 | ✅ 全绿（19 个文件 / 312 条） |
| `npx tsc --noEmit` | ✅ 退出码 0 |
| `npx eslint`（改动范围） | ✅ 退出码 0 |
| `npm run build` | ✅ 退出码 0 |
| `git diff --check` | ✅ 退出码 0（无输出） |
| 真实 Provider 端到端 | ✅ 真实出图、落盘、候选展示、人工选择、刷新保持 |
| Prompt 三方一致性 | ✅ 用中转站后台日志原文本地重算 sha256，与候选记录的 `promptHash` **逐字节一致** |
| 浏览器闭环（1440×900 / 390×844） | ✅ 无横向溢出；未捕获错误 0、`console.error/warn` 0 |
| 历史数据兼容 | ✅ 旧候选无依据字段仍可读，界面显示「历史生成记录」，未伪造版本 |

## 5. 已知限制

1. **图片质量是否改善无法判定**：同一输入两次独立生成的结构相关系数仅约 0.58
   （平均像素差约 35/255），小样本、无 seed，主观优劣不可判读。客观可测部分
   （尺寸、格式、背景纯净度）已建立门禁，但无法替代人眼判断商品一致性与伪文字。
2. **中转站能力边界（实测）**：`size` 生效；参考图确实作为输入（`image_tokens` 可证）；
   但 `output_format` 被忽略（请求 webp 返回 png）、`quality` 被降级、
   `response_format` 声明与实际返回不一致（声明 b64_json 实际给 URL）。以上均已自动记录进候选。
3. 隔离区目前只做**留档**，「一键重试保存」尚未提供界面入口。
4. 真实模型标识不可核实（中转站路由），候选记录中记为请求模型而非已验证后端模型。
