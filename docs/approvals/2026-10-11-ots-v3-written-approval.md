# [归档说明 / Archive note]

- 归档时间：2026-10-12（技术部，随 D031 内容状态翻转包入库）
- 文件来源：导演 KAY YAN 于 2026-10-11 签发、经开发者转交的书面批准文件（微信文件原名「导演书面批准-模板IDs@versions-2026-10-11(1).md」）
- 效力：本文件是 `content/intake/README.md` 流程中「written director approval」环节的书面凭证，`dialogue_ots_a_to_b@v3` 与 `dialogue_ots_b_to_a@v3` 的 `reviewStatus` 由 `engineering_ready` 改为 `approved` 以本文件为唯一依据
- 以下为原文逐字归档，未作任何改动

---

# 导演书面批准：镜头模板 IDs@versions

**日期：** 2026-10-11
**批准人：** KAY YAN（项目发起人 / 导演）
**适用仓库：** storyboard_gen @ branch 1.0
**效力：** 本文件是 `content/intake/README.md` 流程中「written director approval」环节的书面凭证；技术部在收到本文件后，方可将下列模板的 `reviewStatus` 由 `engineering_ready` 改为 `approved`。

---

## 签署前确认项（导演本人勾选）

- [x] 我已在 Web 3D 预览中亲自过目 `dialogue_ots_a_to_b` v3 与 `dialogue_ots_b_to_a` v3 的新机位，确认前景肩（角色后脑/肩部）在画面内的占比符合「过肩前景约占画面 1/4–1/3」的验收线（2026-10-11 目视终验通过；数值检查 NDC x ≈ −0.90 头 / −0.65 肩此前已在 D029 通过）。
- [x] 我已在 Web 3D 预览中复核 `dialogue_medium_two_shot` v1（2026-10-11）：**不通过**——取景太松，需更近、胸部以下不入画。该模板已从批准清单移除并退回，见文末「退回项」。

> OTS 两条目视终验已通过，本批准自签署起生效；中景双人退回修改，不在本批准范围。

## 评审结论（2026-10-11 导演 Web 3D 目视终验）

- `dialogue_ots_a_to_b` v3：**通过**。前景肩入画、占比符合 1/4–1/3 验收线。
- `dialogue_ots_b_to_a` v3：**通过**。与 a_to_b 镜像对称，视线可缝合为对视。
- `dialogue_medium_two_shot` v1：**不通过，退回修改**（详见文末「退回项」），本批准不含此模板。

## 批准清单（IDs@versions）

| 模板 ID | 版本 | 批准内容 |
|---|---|---|
| `dialogue_ots_a_to_b` | v3 | 几何/构图：OTS A→B，相机 [-2.15, 1.45, 0.8] → [0.85, 1.55, -0.2]，75mm（D025），blocking 不变。按导演校准图 reposition 后前景肩入画，予以批准。 |
| `dialogue_ots_b_to_a` | v3 | 几何/构图：OTS B→A，相机 [2.15, 1.45, 0.8] → [-0.85, 1.55, -0.2]，75mm（D025），blocking 不变。与 a_to_b 互为镜像反打，予以批准。 |

## 退回项（不在本批准范围内）

| 模板 ID | 版本 | 结论 | 导演意见 |
|---|---|---|---|
| `dialogue_medium_two_shot` | v1 | ❌ 不通过 | 取景太松：需要更近，画框下缘裁在胸部，人物胸部以下不入画。修改后 bump v2 重新走 3D 评审 + 书面批准流程。 |

## 批准范围限定（重要）

本批准**仅覆盖**上表所列模板在所列版本号下的：

1. 相机几何（位置、目标点、焦段）
2. 角色站位与朝向（blocking）
3. 构图验收线达标状态

本批准**不覆盖**，以下事项维持开放：

- 三个模板的详细 blocking/运动设计（D029 记录为导演意图、推迟到后续版本；当前默认运动——中景 static、OTS 4 秒 dolly-in——为「暂时够用」的临时接受，不构成对运动设计的正式批准）
- Prompt 编译器中的工程验证 pairs（`focal_*mm`、`character_*_primary`、motion tokens）及其「unverified engineering template」警告措辞——仍待导演确认、扩展或替换
- 轴线/视线的可计算安全容差（OPEN_QUESTIONS 开放项）
- 参考图的独立法律核验（rights 已由导演声明确认为自有 AI 生成资产，但 approved/公开发布前的独立法律核验为既定政策，不因本批准免除）

## 附注

- 后续任何模板版本号变更（v3 → v4 等）即超出本批准范围，需重新走「3D 评审 → 书面批准」流程。
- 50–70 条新模板的批准将按批次分别出具同类书面文件，本文件不构成对未来模板的预批准。

**导演签名：** ______________（KAY YAN）
**日期：** 2026-10-11
