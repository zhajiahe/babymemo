# 测试与 CI

本文只记录**测试入口和不能由自动化证明的风险**。用例、断言和具体结果以代码和 [GitHub Actions 记录](https://github.com/zhajiahe/babymemo/actions) 为准，不在 Markdown 重写随版本变化的成绩表。

## 自动化入口

| 入口 | 检查 |
| --- | --- |
| `npm run verify` | TypeScript、Node 单测、构建 |
| `npm run test:e2e` | 隔离本地 Worker/D1/R2/DO：鉴权、媒体、幂等、宝宝隔离 |
| `BROWSER_E2E=1 npm run test:e2e` | Chromium 浏览器交互；可设 `BROWSER_ENGINE=webkit` |
| [Check BabyMemo](https://github.com/zhajiahe/babymemo/actions/workflows/ci.yml) | CI 四类 Job：检查、Worker、Chromium、Linux WebKit；截图见各 Run Artifacts |
| [PR OpenRouter Harness Gate](https://github.com/zhajiahe/babymemo/actions/workflows/ci.yml) | 每个合并至 `main` 的仓库所有者 PR 自动调用 OpenRouter 30 题；评分、费用与安全检查独立报告 |
| [Manual Harness Deep E2E](https://github.com/zhajiahe/babymemo/actions/workflows/harness-deep-e2e.yml) | 离线合成场景或人工确认的真实模型 30 题评估 |
| [Manual OpenRouter Live E2E](https://github.com/zhajiahe/babymemo/actions/workflows/openrouter-live-e2e.yml) | 真实模型工具协议；手动、付费、虚构数据 |

Node / Worker / 浏览器自动测试不能连接生产 D1/R2，也不使用真实家庭照片。只有 `main` PR 的 30 题合成 Harness 自动基准测试会调用收费 OpenRouter；真实微信账号与任何生产资料均不进入 CI。

## 必须防回归

- 跨宝宝/未登录/跨 Origin 写入不得访问或篡改其他人的数据；目标歧义时不得擅自修改。
- 重复消息、掉线重试、R2 成功但 D1 失败、分片恢复不得导致重复记录、假成功或丢原件。
- 微信图片上传可与后续独立文本并行：图片先生成 `processing` 占位；描述只由现有 Agent 在确定目标后修改，**不可假设照片后的第一句一定是描述**；上传完成不得覆盖用户编辑。
- 离线草稿和队列须按宝宝隔离，冲突停止并告知；回收站恢复和 ZIP 备份校验不能退化。
- 移动端无横向溢出，有键盘焦点、44px 触控目标、safe area；相册故事、封面和视频预览可用。

## 自动化无法证明

真实 iPhone Safari 的 HEIC/HEVC/MOV、后台/蜂窝网络；真实微信扫码、iLink 消息时序与长时间运行；真实模型稳定性和实际账单；生产 D1+R2 同一时刻的备份一致性及完整恢复演练。必须分别验收，不能把 Linux WebKit 或 HTTP 健康检查当作替代。

### 一次性启用合并门禁

在 GitHub `Settings → Environments` 中创建 `harness-benchmark`，只存放低额度的专用 `HARNESS_OPENROUTER_API_KEY`；不要直接复用生产服务的密钥。在 OpenRouter 为此 Key 设置硬性额度限制。PR 只接受同仓库且由仓库所有者提交；Fork PR 不接收 Key，会被该工作流拒绝。GitHub `Settings → Rules → Rulesets`（或 Branch protection）中对 `main` 将 `Harness OpenRouter / 30 Cases` 设为 **Required status check**，才能确保红灯阻止合并。变更这份检查工作流本身也应做代码审阅。

评测使用 `deepseek/deepseek-v4.1-flash`（由默认模型常量解析），只调用 OpenRouter，每题最多按 ReAct 上限调用、总请求数最多 180；软预算 0.25 USD / PR，实际扣费必须通过模型 Key 硬额度控制。模型费用缺失、30 题未跑完、任何安全关键错误、通过率低于 80% 均使检查失败。PR 修订会重新触发评测；逐题 JSON 报告保留 30 天。

PR 应记录本次 CI Run 及未完成的验收项目。
