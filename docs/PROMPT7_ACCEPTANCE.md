# Prompt 7 合并验收与共同开发者检查清单

日期：2026-10-02（Asia/Singapore）。独立验收：Codex，PASS。

## 合并范围

包含 1.0 上的 Prompt 7 provider spike、增强首帧 mock/server/UI、D027 单活图片适配器，以及三轮验收后的修复。不包含 Prompt 8，不生成视频，不改变导演模板批准状态。

原始分支提交为 c5ac56dd1960c2ed18c7e6c472f26a82c2e393ed；main 原基线为 b8ae099ee576c4fb3bf7f17e20867b89817d6599。合并前核对修复与通过验收的文件一致：已跟踪修改补丁 SHA256 为 664B07118C90E84E6BE1CF034A24BBE519C4781ADDB2029B23C83CB194FE3E41；新增 tests/unit/provider-http-url.test.ts SHA256 为 8F367F5F93F0289352971B074A20905C4798E034CADFED7527258F09B773DF97。上述哈希记录的是补充本交接文档前的验收版本。

## 已完成的独立验证

- 正式单测：30 files / 450 tests 通过。
- 上轮四项独立负向探针：4/4 通过。
- 浏览器：43/43 通过，包含增强首帧、失败后 raw export 和旧结果过期。
- director/studio 视觉回归通过，没有更新基线。
- Next.js 16.3.4 生产构建、TypeScript、ESLint、格式、内容验证与编译、diff whitespace 检查通过。
- 全程 mock，无真实 provider 调用、无 credits 消耗。

## 共同开发者执行清单

### 1. 同步代码

- [ ] 先检查本地 git status；有自己的未提交工作时先自行保存，不使用 reset --hard。
- [ ] git fetch origin 后切换 main，并使用 git pull --ff-only 同步。
- [ ] 记录 git rev-parse HEAD，与本次交接提供的 main 合并提交核对。
- [ ] 确认 tests/unit/provider-http-url.test.ts 已被跟踪。

### 2. 零费用自动验收

在终端明确设置 IMAGE_PROVIDER=mock。不要为验收填写真实凭据或切换真实 provider。

```powershell
$env:IMAGE_PROVIDER = 'mock'
npm ci
npm run validate:content
npm run compile:content
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```

- [ ] 单元测试至少包含本次 450 项，全部通过；不可通过删除、跳过或放宽断言减少测试。
- [ ] 浏览器 43 项全部通过，视觉基线保持不变。
- [ ] 内容仍为三个 engineering_ready 模板；OTS v2 保持 75mm，medium v1 保持 35mm。
- [ ] 浏览器验收前停止 localhost:3000 的旧服务，避免 Playwright 复用错误版本。使用项目配置要求的浏览器；如缺少浏览器安装，先记录环境问题再处理。
- [ ] 如系统 npm wrapper 损坏，使用本机实际 Node/npm CLI 路径替代，并记录命令；不要为解决本机环境问题改 package.json 或放宽测试。

### 3. Chrome 手工验收

构建后用同一 mock 环境启动 npm run start，在桌面 Chrome 检查：

- [ ] 选择任一开发模板，能调整相机、人物、画幅和单段运镜。
- [ ] 增强首帧面板默认收起；只有点击生成才发出请求。
- [ ] mock 生成完成，结果明确标注 mock；无需任何服务商凭据。
- [ ] 生成后切换模板，旧结果标记“已过期”并显示来源。
- [ ] 不切换模板，仅调整相机参数，旧结果同样标记过期。
- [ ] 重新生成后，当前结果恢复为有效状态；不会修改 canonical ShotState。
- [ ] raw ZIP 可下载，含 shot-state.json、composition-raw.png、movement-start.png、movement-end.png、manifest.json；文件对应同一冻结状态。
- [ ] 使用浏览器测试的本地故障模拟检查失败可重试且 raw export 可用；不要通过真实付费调用制造错误。

### 4. 重点回归结果核对

- [ ] 万相请求为 messages[].content，构图是最后一张图片。
- [ ] 万相总图数含构图和风格图：9 张通过，10/11 张调用前拒绝。
- [ ] 网络/5xx/结果未知不自动重新 POST；总预算到期后不再提交请求。
- [ ] 单次超时、成功响应解析/契约失败、图片解码/下载失败均明确提示可能已计费、再次生成可能增加费用。
- [ ] fd/fc/fe80 开头的正常 DNS 名不误封；映射 IPv6 回环/私网被拒绝。
- [ ] 理解 URL 检查仅为字面校验，不代表完整 DNS/重定向 SSRF 防护。

以上错误与边界优先核对正式 mock 测试，不需要真实 API。

## 验收回执

请返回：main 提交 SHA、操作系统/Node/Chrome 版本、单测与浏览器通过/失败/跳过数量、手工清单结果、是否发现阻塞及复现步骤。任何失败保留日志，不直接更新视觉基线或扩展到 Prompt 8。

本次工程 PASS 不等于真实出图质量已验证。账号可用性、真实构图保持及导演专业审批仍需各自的证据；付费实测必须另行明确授权。
