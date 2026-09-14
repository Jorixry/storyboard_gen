# Seedance API 技术调研报告（v2，自检修订版）

> 调研人：lil-k ｜ 日期：2026-09-14 ｜ 项目：分镜平台（Storyboard-Platform）
> 主信源：火山引擎官方文档（docs.volcengine.com/docs/6492/2595411，更新于 2026-08-13）、seed.bytedance.com
> 第三方信源仅作交叉验证，文中逐条标注。
> ⚠️ 旧调研清单中的 seedance2api.app / seedance2video.io / evolink.ai 均为第三方转售站，非官方渠道，MVP 不依赖（仅可用其免费额度做早期测试，需注意账号与数据安全）。

---

## 一、自检结论（对照原调研清单 1.1–7.3）

| 题号 | 状态 | 说明 |
|---|---|---|
| 1.1–1.5 版本/能力/时长/分辨率/宽高比 | ✅ 已答，官方依据 | 详见第二节 |
| 2.1–2.5 参考图能力/上传方式/格式限制 | ✅ 已答，官方依据 | 详见第三节 |
| 2.6 / 5.3 图生与文生是否同价 | ✅ 本次修订补全 | 官方计费公式中只有"带输入**视频**"才改变计费时长，输入图片不另计费 → **图生与文生同价**（依据：官方计费表） |
| 3.1–3.6 认证/异步/Endpoint/回调/URL 有效期 | ✅ 已答，官方依据 | 详见第四节 |
| 4.1 Prompt 长度限制 | ⚠️ 无官方答案 | 官方文档未公布上限。清单中"中文≤500 字符/英文≤1000 单词"与第三方"5000/20000 字符"均无官方依据 → **UNCONFIRMED**，建议编译器保守按 ≤2000 字符设计 |
| 4.2 Prompt 写作建议 | ✅ 本次修订补全 | 字节官方发布了 Prompt 指南，要点见第五节 |
| 4.3 负向提示词 | ✅ 本次修订补全 | 官方请求参数表中**无 negative_prompt 字段 → 不支持**独立负向提示词参数（依据：官方参数列表） |
| 4.4 对白/语音生成 | ✅ 本次修订补全 | 支持。prompt 中直接写台词即可（官方 LAS 文档示例含角色台词写法）；引号包裹触发 + 唇形同步 8–10+ 语言为发布会/第三方信源 |
| 5.1–5.5 计费模式/费率/免费额度/单条成本 | ✅ 已答（5.4 待开户验证） | 详见第六节 |
| 6.1 国内直连 | ✅ 本次修订补全 | cn-beijing / cn-shanghai Endpoint 国内直连，无需 VPN（依据：官方文档区域列表） |
| 6.2 国内 vs 国际版 | ✅ 已答 | 国内=火山引擎（doubao-* Model ID）；国际=BytePlus ModelArk（dreamina-* Model ID），另有 ap-southeast-1 区域 |
| 6.3 企业资质要求 | ⚠️ 待实测 | 官方文档未见强制企业认证条款；火山账户需实名认证；2.5 曾分批开放（第三方 8 月起报告普遍可调）→ **开户后确认** |
| 7.1 错误码 | ⚠️ 部分 | 官方页仅集中列出 `401 ApiKey.Invalid`；任务态有 failed/expired；第三方报告过 `InvalidParameter.TaskTypeConstraint`（参数违规排队后才报错）。完整错误码表官方未集中公布 |
| 7.2 限流 | ✅ 已答，官方依据 | 非 4K：600 RPM / 并发 10；4K：15 RPM / 并发 1（LAS 算子层；账号级配额以控制台为准） |
| 7.3 重试机制 | ✅ 本次修订补全 | 官方**无自动重试**；失败/审核不通过不计费；需自行实现轮询+指数退避；`execution_expires_after`（默认 48h，3600–259200s）控制任务超时 |

**修订动作**：补全 2.6/4.2/4.3/4.4/5.3/6.1/7.3 七处；将 4.1/6.3/7.1 标记为 UNCONFIRMED 或待实测，未用第三方数据冒充官方答案。

---

## 二、模型版本与能力边界（清单第 1 节）

| 模型 | Model ID（火山引擎） | 单段时长 | 分辨率 | 定位 |
|---|---|---|---|---|
| Seedance 2.5 | `doubao-seedance-2-5-260628` | **4–30 秒**（可填 -1 模型自选） | ⚠️ **仅 480p / 720p** | 长叙事旗舰 |
| Seedance 2.0 | `doubao-seedance-2-0-260128` | 4–15 秒 | 480p / 720p / 1080p / 4K(10bit) | 画质旗舰 |
| Seedance 2.0 Fast | `doubao-seedance-2-0-fast-260128` | 4–15 秒 | 480p / 720p | 快速迭代 |
| Seedance 2.0 Mini | `doubao-seedance-2-0-mini-260615` | 4–15 秒 | 480p / 720p | 最便宜 |

- ⚠️ **2.5 的 API 没有 1080p/4K**：官方计费表只列 480P/720P 两档系数，多家第三方实测一致。发布会宣传的"4K 10bit"未在 API 开放。要高分辨率只能用 2.0。
- 能力矩阵（官方文档，四款模型均支持）：文生视频、图生视频（首帧）、图生视频（首尾帧）、多模态参考（图/视频/音频及组合）、视频编辑、视频延长、音画同生成（`generate_audio`）。
- 全系固定 24fps；宽高比 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive；输出 mp4（2.5 另有 mov/yuv444，第三方信源）。

## 三、参考图与多模态输入（清单第 2 节）

| 项 | Seedance 2.0 | Seedance 2.5 |
|---|---|---|
| 参考图数量 | 1–9 张 | **1–30 张** |
| 参考视频 | ≤3 段，单段 2–15s，共 ≤15s | ≤10 段，共 ≤30s |
| 参考音频 | ≤3 段，共 ≤15s（须搭配图/视频） | ≤10 段，共 ≤30s（**可单独用音频**） |

- **首帧/首尾帧**：支持。`content` 中 `image_url` 的 `role` 取 `first_frame` / `last_frame` / `reference_image`。
- **上传方式**（三选一）：公网 http/https URL（需任务期间持续有效）；Base64（仅图片和音频，格式 `data:image/png;base64,...`，大文件勿用）；`asset://<ASSET_ID>`（LAS 素材库，白名单功能）。
- **图片限制**：jpeg/png/webp/bmp/tiff/gif（2.x 另支持 heic/heif）；宽高 300–6000px；宽高比 [0.4, 2.5]；单张 <30MB；请求体 ≤64MB。
- **视频/音频限制**：视频 mp4/mov、FPS [24,60]、单段 <200MB；音频 wav/mp3、单段 <15MB。
- ⚠️ **真人脸限制**：2.x 系列不直接接受含真实人脸的参考图/视频，须开通 LAS 素材库白名单上传授权素材后用 asset ID 引用。AI 生成角色图是否会被误判需实测。
- **图生与文生同价**（清单 2.6/5.3）：官方计费公式中只有"带输入视频"才改变计费时长，输入图片不另计费。

## 四、API 调用流程（清单第 3 节）

- **认证**：`Authorization: Bearer $ARK_API_KEY`（API Key 制。网传"HMAC AK/SK 签名"为错误信息，与官方文档及官方 SDK 矛盾）。
- **模式**：异步任务制。
- **创建任务**：`POST {base}/contents/generations/tasks` → 返回 `{"id": "..."}`（任务 ID 自创建起保留 7 天）
- **查询任务**：`GET {base}/contents/generations/tasks/{id}` → `status`: queued / running / succeeded / failed / cancelled / expired
- **回调**：✅ 支持 `callback_url`，状态变更时 POST 通知（可免轮询）
- **Base URL**：
  - 方舟：`https://ark.cn-beijing.volces.com/api/v3`
  - LAS 智能创作云：`https://operator.las.cn-beijing.volces.com/api/v1`（区域另有 cn-shanghai、ap-southeast-1）
- **主要请求参数**：`model, content[], resolution, ratio, duration, generate_audio, seed, watermark, return_last_frame, callback_url, execution_expires_after, priority, service_tier, safety_identifier`
- ⚠️ **生成视频 URL 仅 24 小时有效 → 必须即时时转存**
- **限流**（LAS 算子）：非 4K 600 RPM / 并发 10；4K 15 RPM / 并发 1
- **SDK**：`pip install 'volcengine-python-sdk[ark]'`，兼容 OpenAI SDK 风格

### 调用示例（官方文档格式）

```bash
# 创建任务
curl --location 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks' \
--header "Authorization: Bearer $ARK_API_KEY" \
--header 'Content-Type: application/json' \
--data '{
    "model": "doubao-seedance-2-5-260628",
    "content": [
        {"type": "text", "text": "@图片1 的角色走进雨中街道，镜头缓慢推进"},
        {"type": "image_url", "image_url": {"url": "https://example.com/frame.png"}, "role": "first_frame"}
    ],
    "resolution": "720p",
    "ratio": "16:9",
    "duration": 5,
    "generate_audio": true,
    "watermark": false
}'
# → {"id": "cgt-xxxx"}

# 轮询
curl "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-xxxx" \
--header "Authorization: Bearer $ARK_API_KEY"
# status=succeeded 时从 content.video_url 取片（24h 内转存）
```

## 五、Prompt 规范（清单第 4 节）

- **长度上限**：官方未公布 → UNCONFIRMED（清单的 500/1000 与第三方 5000/20000 均无官方依据；建议保守设计）。
- **官方 Prompt 指南要点**（字节官方发布，第三方转述交叉一致）：
  - 2.0：精确时间码（如"0–3 秒"）支持但不稳定，官方建议用"Shot 1 / Shot 2 / Shot 3"分镜结构让模型自定节奏；**2.5：秒级时间码是一等公民**，响应可靠。
  - 避免 f 值、ISO、毫米焦距等参数化表述，用描述性语言（"slow dolly in"优于"35mm, f/1.8"）。
  - 单次生成只安排一个主运镜；运镜描述节奏（slow/smooth）而非技术参数。
  - 多参考资产时给每个资产明确角色（形象/动作/色调/节奏），别让资产互相打架；prompt 中用 `@图片1 / @视频1 / @音频1` 位置引用。
- **负向提示词**：官方参数表无 `negative_prompt` 字段 → 不支持。负向需求只能写进正 prompt，但模型对否定语义响应弱，尽量避免。
- **对白/语音**：支持。在 prompt 中直接写角色台词（官方 LAS 示例即含台词写法）；第三方信源称引号包裹触发、唇形同步支持 8–10+ 语言。

## 六、成本与计费（清单第 5 节，官方 LAS 计费表）

公式：`费用 ≈ 单价 × 计费时长 × 分辨率系数`；基础版 ¥1.6/s，增强版 ¥2/s；**仅成功任务计费**，失败/审核不通过不收费。

| 模型 | 480p | 720p | 1080p | 4K |
|---|---|---|---|---|
| **2.5** | ¥1.34/s | ¥3.02/s | — | — |
| 2.0 | ¥0.93/s | ¥2.00/s | ¥5.01/s | ¥6.38/s |
| 2.0 Fast | ¥0.74/s | ¥1.60/s | — | — |
| 2.0 Mini | ¥0.47/s | ¥1.00/s | — | — |

- **5 秒 720p 一条（清单 5.5）**：2.5 ≈ ¥15.1 / 2.0 ≈ ¥10 / Fast ≈ ¥8 / Mini ≈ ¥5。
- 带输入视频时计费时长 = `[max(输入时长, 输出×2/3) + 输出] / 2` → **编辑/延长比重新生成更贵**，别为省钱走编辑。
- **免费额度（清单 5.4）**：官方未公布统一数字 → 开户后在控制台确认（转售站的"免费额度"与官方无关）。

## 七、地域、错误与稳定性（清单第 6、7 节）

- **国内直连**：cn-beijing / cn-shanghai Endpoint 国内直连，无需 VPN。
- **国内 vs 国际**：国内=火山引擎（`doubao-seedance-*`）；国际=BytePlus ModelArk（`dreamina-seedance-*`），区域 ap-southeast-1。
- **资质**：官方文档未见强制企业认证条款，账户需实名认证；2.5 曾分批开放 → 开户后确认可用性（UNCONFIRMED）。
- **错误码**：官方集中列出的仅 `401 ApiKey.Invalid`；任务级失败看 `status=failed/expired` 及 `error` 对象；已知第三方报告 `InvalidParameter.TaskTypeConstraint`（2.5 编辑/延长的约束违规，**排队后才报错**，提交时不校验）。
- **重试**：官方无自动重试。建议自行实现：创建任务记录幂等键 → 轮询指数退避（或用 callback_url）→ failed 不计费可直接重提 → `execution_expires_after` 兜底超时。

## 八、对分镜平台 MVP 的含义

1. 首帧/首尾帧 + 多参考图官方支持，"分镜图 → 首帧增强 → 视频"链路可行。
2. 用户侧单条预览成本 ¥5–15（720p/5s），印证"生成前决策"的省钱卖点。
3. 视频 URL 24h 过期 → 导出包必须即时时转存。
4. 真人脸限制 → 内测用户上传真人参考会踩坑，FAQ/前端校验提前说明。
5. 编辑/延长更贵且 2.5 无 1080p+ → 预览链路锁定 2.0 Mini/Fast 或 2.5 的 720p 即可。

## 九、下一步行动

- [ ] KAY YAN 注册火山引擎账户并完成实名认证（约 10 分钟）
- [ ] 控制台确认：免费额度、Seedance 2.5 是否已开放、个人 vs 企业认证差异
- [ ] lil-k 按确认后的费率出 MVP 生成预算测算
- [ ] （测试期）如需零成本跑通链路，可用转售站免费额度，但代码层把 Base URL / Model ID 做成配置项，确保一键切回官方

## 十、信源清单

**官方（一级信源）**
- 火山引擎 LAS 视频生成文档：https://docs.volcengine.com/docs/6492/2595411 （2026-08-13 更新；能力矩阵/输入输出要求/计费表/请求参数/限流）
- Seedance 官方主页：https://seed.bytedance.com/seedance2_5 、/seedance2_0
- 火山引擎官网：https://www.volcengine.com/

**第三方（仅交叉验证，标注处使用）**
- apimodels.app / atlascloud.ai / aireiter.com / rgb.ir / seed-video.com 等（2.5 无 1080p/4K、时长 4–30s、参考 30/10/10、编辑约束、mov 格式的交叉确认）
- suno.bi / picxstudio.com（官方 Prompt 指南要点的转述）
