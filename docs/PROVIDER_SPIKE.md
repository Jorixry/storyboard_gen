# 图像生成 API 只读调研报告（Prompt 7A / Provider Spike）

> 调研执行：zcode（验收代理）｜日期：2026-09-21｜项目：Storyboard Director MVP
> 任务来源：docs/CODEX_PROMPTS.md Prompt 7（第一阶段：只读对比 2-3 个图像生成 API，官方一手信源，不花任何 credits）
> 候选名单（开发者 2026-09-21 选定）：火山引擎 Doubao-Seedream、阿里云通义万相、Google Gemini 图像
> 用途定位：MVP 的"增强首帧"（enhanced first frame）生成适配器——输入 3D 舞台渲出的 raw 构图 + 可选角色/风格参考图 + 结构化 prompt，输出增强首帧。
> ⚠️ 本报告为**纯文档级**对比。按开发者决策（2026-09-21），实测构图保持对比与真实 API 调用全部推迟；"文档能力 ≠ 实测效果"的风险见第八节。

---

## 一、结论速览

| 维度 | 火山引擎 Seedream | 阿里云 万相 2.7 | Google Gemini 图像 |
|---|---|---|---|
| 当前推荐模型 | doubao-seedream-4-0-250828（4.5/5.0 已上线） | wan2.7-image / wan2.7-image-pro | gemini-3.1-flash-image（Nano Banana 2）等 |
| 图生图/编辑 | ✅ 生成+编辑统一架构（官方） | ✅ 四种模式含 bbox 局部编辑（官方） | ✅ 参考图编辑+多轮编辑（官方） |
| 参考图上限 | 官方页未标数；第三方口径 2–14 张（4.0）（交叉验证） | 9 张（官方） | 合计 14 张；Pro 档 6 对象+5 角色+3 风格（官方） |
| API 形态 | 同步，OpenAI Images 兼容风格 | 同步 + 异步双模（官方） | 同步 |
| 国内直连 | ✅ cn-beijing，无需 VPN | ✅ 北京 workspace 域名 | ❌ 大陆不可直连（需代理） |
| 单价（约） | 4.0 ¥0.2/张；4.5 ¥0.25/张 | ¥0.2/张（pro ¥0.5/张） | $0.034–0.24/图（按分辨率） |
| 免费额度 | UNCONFIRMED（活动期第三方实测 200 张；控制台确认） | ✅ 各 50 张（开通 90 天内，官方） | ❌ 官方标注无免费档 |
| 与本项目凭据协同 | ★ 与 Seedance 同为火山方舟，一个 ARK_API_KEY | 独立 DASHSCOPE_API_KEY 体系 | 独立 GEMINI_API_KEY + 代理 |
| 文档可核对性 | 官方文档为 SPA，本调研未能直接抓取正文；参数经交叉验证 | ★ 官方 API 参考全文可抓取，最完整 | ★ 官方文档全文可抓取 |

**工程建议（不构成选型决定，最终由开发者拍板）**：
- **Seedream 是架构协同首选候选**：与 D026 暂定的 Seedance 同厂商、同账号、同 SDK（volcengine-python-sdk[ark]）、同国内直连；一份凭据和账单同时覆盖视频模型与图像模型。
- **万相 2.7 是最强备选**：官方文档最完整（本报告唯一全文可抓取的国内厂商）、50 张免费额度对后续真实冒烟最友好、`enable_sequential` 组图（1–12 张主体连贯）对分镜多镜头一致性有独特价值、输出比例跟随最后一张输入图（构图保持利好）。
- **Gemini 列为技术标杆但落地性弱**：角色/风格参考分离（Pro 档 3 style references）与本项目 `ImageGenerationInput` 的 character/style 接口最对齐，构图编辑口碑最好；但大陆不可直连、无免费档、凭据体系独立，与目标用户（国内短剧团队，D007）环境冲突。

---

## 二、火山引擎 Doubao-Seedream（国内 = 火山方舟；国际 = BytePlus ModelArk）

### 模型版本

| 模型 | Model ID（方舟） | 单价 | 备注 |
|---|---|---|---|
| Seedream 4.0 | `doubao-seedream-4-0-250828` | ¥0.2/张 | 2025-09 发布；另有 `doubao-seedream-4.0-n` 计费别名（n 参数批量） |
| Seedream 4.5 | `doubao-seedream-4-5-251128` | ¥0.25/张 | 参考图 10 张（交叉验证） |
| Seedream 5.0 pro / 5.0 lite | 5.0 系列（2026-09 上线） | 未取到（模型价格页为准） | 点选/圈选/草图渲染等交互式精准编辑；高精度定位与元素控制 |

### 官方能力声明（seed.bytedance.com 产品页，2026-09-21 抓取）

- 图像生成与编辑**统一架构**：一句话完成生成或精准编辑（去物、重打光、指定保色的文字替换等示例）。
- 多参考图上传，一次生成多张输出（官方页未标注具体张数上限）。
- 单图编辑官方自我评价："prompt following 与源图对齐的平衡"，内部 Elo 第一（厂商自评，非独立结论）。
- 最高 4K 分辨率；文字渲染与图表类生成强项。

### API 形态（方舟图片生成 API，官方文档 82379/1541523；正文为 SPA 渲染，参数细节经第三方交叉验证）

- **端点**：`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`（OpenAI Images 接口风格）。
- **鉴权**：`Authorization: Bearer $ARK_API_KEY`（与 Seedance/方舟全系相同）。
- **模式**：同步调用，直接返回结果；官方文档列表另有"流式响应"文档（Streaming response，1824137）。
- **参考图**：请求体 `image` 参数传图（公网 URL 或 Base64，教程口径支持数组多图）→ **张数与取值范围以官方文档复核为准（UNCONFIRMED）**。
- **已知参数**（交叉验证）：`model, prompt, image, size, seed, response_format(url|b64_json), watermark, guidance_scale, n, sequential_image_generation(+options: max_images/default_mode 组图)`。
- **SDK**：`pip install 'volcengine-python-sdk[ark]'`；兼容 OpenAI SDK 风格。注意 GitHub issue 报告旧版 SDK 未封装 `sequential_image_generation`，需升级或裸 HTTP 传参。

### 计费、限流与区域

- **计费**：按输出图片张数结算；失败不计费；输入参考图不计费。分辨率是否分档以官方"模型价格"页为准（SPA 未抓到正文，UNCONFIRMED）。
- **免费额度**：UNCONFIRMED。官方"免费推理额度"页说明免费额度仅抵扣在线推理；Seedream 4.0 上线活动期第三方实测体验中心 200 张。开户后在控制台确认当前数值。
- **限流**：无公开集中表，控制台为准（UNCONFIRMED）。
- **区域**：国内 cn-beijing 直连无需 VPN；国际版 BytePlus ModelArk（`seedream-*` 前缀，第三方转述 $0.03–0.045/图）。

### 风险与缺口

1. 官方 API 文档正文本调研未能程序化抓取（SPA 渲染），参数精确取值（image 张数上限、size 枚举、宽高比范围、水印默认值）需在实现包开工前以浏览器打开官方文档复核——已在各条标注。
2. 5.0 系列刚上线（2026-09），能力边界与价格待稳；若选 Seedream，建议锚定 4.0/4.5 成熟版本。

---

## 三、阿里云通义万相 Wan 2.7（大模型服务平台百炼）

### 模型与端点（官方 API 参考，2026-09-21 全文抓取）

| 模型 | 定位 | 单价（北京） | 免费额度 |
|---|---|---|---|
| `wan2.7-image-pro` | 编辑精度高、组图连贯、文生图支持 4K | ¥0.50/张 | 50 张（开通 90 天内） |
| `wan2.7-image` | 生成更快（推荐默认） | ¥0.20/张 | 50 张（开通 90 天内） |

- **同步端点**：`POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
- **异步端点**：同 host，`X-DashScope-Async: enable` + `GET /api/v1/tasks/{task_id}`（任务 ID 24h 有效；状态 PENDING→RUNNING→SUCCEEDED/FAILED/CANCELED/UNKNOWN；结果 URL 24h 过期需及时转存）。
- **鉴权**：`Authorization: Bearer $DASHSCOPE_API_KEY`。北京/新加坡密钥与域名不通用；新版 workspace 专属域名取代旧 `dashscope.aliyuncs.com`。
- **SDK**：DashScope Python ≥1.25.15 / Java ≥2.22.13。

### 四种模式与关键参数（官方，含本项目直接相关项）

1. **文生图**：纯文本。
2. **图像编辑（图生图）**：多图输入 + 文本指令（本项目"raw 构图 + prompt → 增强首帧"主路径）。
3. **交互式编辑**：`bbox_list` 框选每张图的区域（每图最多 2 框，绝对像素，左上原点），未选图传 `[]`。
4. **组图**：`parameters.enable_sequential: true`，`n` 1–12，主体一致的多张连贯图——对分镜多镜头一致性有直接价值。

- **参考图**：`input.messages[].image`，公网 URL 或 `data:{MIME};base64,{...}`；**最多 9 张**，顺序有义（数组位次决定角色）。
- **输入约束**：JPEG/JPG/PNG（无透明通道）/BMP/WEBP；宽高各 240–8000px；比例 [1:8, 8:1]；单文件 ≤20MB。
- **输出**：PNG；`size` 取 `1K/2K/4K` 预设或显式像素（pro 文生图最高 4K，其余 2K）；**带图输入时输出宽高比跟随最后一张输入图**（构图保持利好）；无图输入默认方图。
- **其他**：`text` ≤5000 字符；`seed` [0, 2147483647]；`watermark` 默认 false（true 加"AI生成"角标）；`color_palette` 3–10 个 {hex, ratio}（组图模式禁用）；`thinking_mode` 默认 true（仅文生图且无图输入时生效）。
- **计费**：仅输出图计费，失败不计费不耗免费额度。

### 限流与错误

- 限流：官方有独立限流文档（万相小节），本调研未取具体 QPS 数值——实现前以该页为准（UNCONFIRMED）。
- 错误码：独立文档；示例 `InvalidParameter`、`InvalidApiKey`。

### 风险与缺口

1. workspace 专属域名处于迁移期（旧域名仍可用但官方推荐迁移），适配器 Base URL 必须做成配置项。
2. 同步接口单请求直接返回，符合现有 `ImageGenerationAdapter.generate(): Promise<...>` 同步语义，无需改接口；组图/4K 长任务建议走异步路径（适配器如选万相需在实现包决定是否引入轮询）。

---

## 四、Google Gemini 图像（Nano Banana 系列）

### 模型版本（官方文档，2026-09-21 抓取）

| 名称 | Model ID | 定位 | 参考图 |
|---|---|---|---|
| Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | 最快最便宜；仅 1K | 最多 14 张对象图 |
| Nano Banana 2 | `gemini-3.1-flash-image` | 通用；支持 4K 与图片搜索 grounding | 10 对象 + 4 角色 |
| Nano Banana Pro | `gemini-3-pro-image` | 旗舰；图文交错输出 | 6 对象 + 5 角色 + **3 风格参考** |
| Nano Banana（旧） | `gemini-2.5-flash-image` | 官方建议迁移至 2 Lite；**2026-10-02 下线** | — |

### API 形态与参数（官方）

- **端点**：`POST https://generativelanguage.googleapis.com/v1beta/interactions`。
- **鉴权**：`x-goog-api-key: $GEMINI_API_KEY`（aistudio.google.com/apikey 发Key）。
- **参考图**：content 数组内 `{type:"image", data:<base64>, mime_type:"image/png"|...}`；角色/风格参考是 Pro 档的显式语义，与本项目 `characterReferences`/`styleReference` 字段直接对齐。
- **多轮编辑**：`previous_interaction_id` 引用前次交互。
- **输出**：`response_format: {type:"image", aspect_ratio, image_size}`；`image_size` = 1K（默认）/2K/4K（+3.1 Flash 独有 512px）；宽高比含 16:9、9:16、21:9、3:2、4:3、1:1 等。
- **水印**：所有生成图带 SynthID 隐形水印（官方强制，不可关）。
- **thinking**：默认开启并计费（`generation_config.thinking_level` 可调 minimal/high）。

### 价格（官方定价页，2026-09-21 抓取，美元）

| 模型 | 输入 $/1M tokens | 输出每图（标准档） |
|---|---|---|
| 3.1 Flash Lite | $0.25 | 1K $0.0336 |
| 3.1 Flash | $0.50 | 0.5K $0.045 / 1K $0.067 / 2K $0.101 / 4K $0.151 |
| 3 Pro | $2.00（图输入约 $0.0011/图） | 1K/2K $0.134 / 4K $0.24 |

- **无免费档**（官方明确 unavailable）；Batch API 半价但 24h 内返回；图片搜索 grounding 每月 5000 次免费后 $14/千次。
- 限流：独立 rate-limits 页（按 Key 层级），本报告未取具体数值。

### 区域与风险

1. **中国大陆不可直连**（Gemini API 区域限制，需代理）——与目标用户环境（D007 国内短剧团队）直接冲突；凭据、计费、网络三重门槛。
2. Pro 档角色/风格分离参考是三者中与本适配器接口最贴合的官方语义，但只能在代理环境下评估使用。

---

## 五、对比矩阵（Prompt 7 要求的五维度）

| 维度 | Seedream 4.0/4.5 | 万相 2.7 | Gemini 3.1/3 Pro |
|---|---|---|---|
| 构图保持（文档级） | 统一生成/编辑架构；编辑对齐为官方卖点（厂商自评） | 输出比例跟随最后输入图；bbox 精准局部编辑 | 参考图编辑+多轮迭代；业界口碑最佳（交叉信源一致） |
| 参考图支持 | 多图融合；张数官方未标（第三方 2–14/10 张） | 9 张，顺序语义，URL/Base64 | 合计 14；Pro 档对象/角色/风格三类分离 |
| API 可用性 | 同步；OpenAI 兼容风格；SDK 成熟 | 同步+异步双模；DashScope SDK | 同步；REST/官方 SDK |
| 延迟/成本 | ¥0.2–0.25/张；推理快（官方宣称较前代提速） | ¥0.2/张（pro ¥0.5）；同步快、组图建议异步 | $0.034–0.24/图；无免费档；Batch 半价 |
| 区域约束 | 国内直连；国际走 BytePlus | 国内直连（北京）；国际新加坡等 | 大陆不可直连 |

---

## 六、与现有 `ImageGenerationAdapter` 接口的映射（实现包参考）

现有接口（src/adapters/image-generation/types.ts）：

```ts
generate(input: { compositionImage: Blob; characterReferences?: Blob[]; styleReference?: Blob; prompt: string })
  : Promise<{ adapterId; adapterVersion; image: Blob; metadata: Record<string,string> }>
```

- **Seedream**：`compositionImage + characterReferences` → `image[]` 参数（URL 或 Base64）；`styleReference` 并入 image 数组（无独立风格槽，靠 prompt 内 @图N 角色说明）。同步返回 `b64_json` 或 `url`。
- **万相**：`compositionImage + characterReferences` → `input.messages[].image`（≤9 张）；`styleReference` 同上并入。注意比例跟随"最后一张输入图"——构图图应放在数组末位以锁定输出画幅。
- **Gemini**：三类输入可分别映射对象/角色/风格参考（Pro 档），语义最贴合；但区域不可用。
- **鉴权环境变量约定（7B1 将提交 .env.example）**：`ARK_API_KEY`（Seedream）/ `DASHSCOPE_API_KEY`（万相）/ `GEMINI_API_KEY`（Gemini），一律服务端读取，缺失回落 mock。
- 单张增强首帧成本量级：万相/Seedream 约 ¥0.2，Gemini 约 $0.05–0.15（1–2K）——与 Seedance 报告"生成前决策省钱"的 MVP 卖点一致（视频 ¥5–15/条 vs 首帧 ¥0.2/张）。

---

## 七、D026 状态落账建议（Seedance，与本调研并行）

docs/Seedance-API-调研报告-2026-09-14.md 已完成 D026 的**文档级**验证（Model ID、API 形态、价格、区域、输入类型）。建议 DECISIONS.md 下次更新时将 D026 备注改为："documentation-level verification complete (2026-09-14 report); account-level items remain open（开户、免费额度、Seedance 2.5 开放性、个人/企业认证、完整错误码）"，状态维持 Provisionally selected。此项不阻塞图像适配器任何阶段。

---

## 八、实测推迟声明（有意接受的权衡）

1. WORKFLOWS §4 与 IMPLEMENTATION_PLAN §0.2 设想"同一 3D 构图 fixture 实测各家的构图保持"，因零成本决策（开发者 2026-09-21）**本阶段未做**。本报告的构图保持结论全部基于官方文档宣称与交叉信源口碑，**不能替代实测**。
2. 后续验证钩子：① 开发者选定 provider 并开户后（Prompt 7B2 之后），用 `dialogue_ots_a_to_b` 的 raw 导出（composition-raw.png 1280×720）+ 现有角色参考图，每家 1–2 张真实调用做构图保持抽查（万相可用 50 张免费额度）；② 若实测不达标，选型回滚窗口在 Prompt 8 导出包冻结之前。
3. 万相免费额度（50 张 ×2 模型）与 Seedream 活动额度是未来零成本实测的最优路径；Gemini 无免费档，若纳入实测需单独授权预算。

---

## 九、下一步行动（停止点①：开发者选型）

- [ ] 开发者从本报告选定 1 家图像 provider（或明确 defer）→ 记入 DECISIONS.md D027
- [ ] 若选 Seedream：复用 Seedance 报告的火山开户清单（注册/实名/控制台确认免费额度与限流）
- [ ] 若选万相：开通百炼、建 workspace、领 50 张免费额度、确认限流页数值
- [ ] 选型确认后由开发者下达"开始 Prompt 7B1"（mock 收尾包，无需凭据）
- [ ] 凭据就绪后下达"开始 Prompt 7B2"（生产适配器实现，合同测试仍全 mock）

---

## 十、信源清单

**官方（一级信源，均为 2026-09-21 访问）**
- 火山方舟图片生成 API：https://www.volcengine.com/docs/82379/1541523 （2026-09-09 更新；正文 SPA 渲染，参数细节经交叉验证并逐条标注）
- 火山方舟模型价格 / 免费推理额度页（www.volcengine.com 文档中心）
- Seedream 4.0 官方产品页：https://seed.bytedance.com/en/seedream4_0 （能力声明全文已核）
- Seedream 4.0–5.0 提示词指南（火山方舟，2026-05-11）
- 万相-图像生成与编辑 2.7 API 参考：https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference （全文已核）
- 阿里云百炼模型推理计费：https://help.aliyun.com/zh/model-studio/model-pricing （万相价格与免费额度已核）
- Gemini 图像生成官方文档：https://ai.google.dev/gemini-api/docs/image-generation （全文已核）
- Gemini API 定价：https://ai.google.dev/gemini-api/docs/pricing （逐档已核）；限流：/gemini-api/docs/rate-limits

**第三方（仅交叉验证，标注处使用）**
- 知乎《基于 Seedream 4.0 的多图融合应用开发实战》（参数与 2–14 张参考图口径）
- API易 / LaoZhang AI（BytePlus 国际价格 $0.03–0.045/图、4.5 十张参考图口径）
- GitHub issue #5089（旧版 ARK SDK 未封装 sequential_image_generation）
- 掘金用户实测（Seedream 4.0 活动期 200 张体验额度）
- lovart.ai（Seedream 4.5 免费指南，交叉）
