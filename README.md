# BabyMemo

隐私优先的家庭成长记录：**照片与视频、成长测量、成长瞬间，以及通过微信直接增删改查**。运行于 Cloudflare Workers + D1 + 私有 R2 + Durable Objects，无需 VPS。前端采用 React、TypeScript 和 Vite。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zhajiahe/babymemo)

## 功能

- **家庭空间**：家庭名称、一个管理员、多宝宝；在「设置 → 宝宝资料」添加或切换宝宝。成长记录、成长瞬间、回收站（30 天）均按宝宝隔离。
- **私密相册**：照片和视频区分播放标记，按日期浏览、修改、下载、软删除。原件存储于私有 R2；小文件直传、大文件 8 MiB 分片续传；支持受保护的缩略图。网页单文件上限 200 MB。
- **网页和离线**：成长曲线、资料/头像管理、编辑冲突提示、家庭 JSON/ZIP64 导出；访问过的内容可离线查看，离线操作在设备上暂存并在重新联网后同步。参见 [离线与导出](docs/web-management-offline.md)。
- **微信 iLink**：多家庭成员分别绑定微信，通过自然语言工具操作家庭数据、发送照片或视频；每条消息最多 4 项媒体，单项 50 MiB。ReAct 工具执行、持久化媒体队列和短期会话均有权限与幂等边界。微信侧兼容性取决于腾讯实际提供的协议数据。
- **模型**：微信操作默认使用 Cloudflare Workers AI Qwen3.8，可选 OpenRouter；不提供单独的网页 AI 聊天或医学诊断助手。

## 静态 Demo（合成数据）

[查看 Demo 页面](public/demo.html)。部署后可在站点访问 `/demo.html`。展示完全虚构的「小星星」家庭、模拟相册及微信连接状态；**不登录、不调用家庭 API、不读取生产 D1/R2、无真实照片或视频**。模拟界面不执行上传或真实微信操作。

## 部署与首次初始化

先阅读 [部署与初始化](docs/DEPLOY.md)，可选择页面上方 Cloudflare 一键部署，或参考 [GitHub Actions 发布](docs/github-action-deploy.md)。部署需保留两项独立的 Worker Secrets：

| Secret | 用途 |
| --- | --- |
| `SESSION_SECRET` | 登录 Cookie 签名；更换会使会话失效 |
| `DATA_KEY` | D1 中微信和模型凭据加密；必须是 **64 位 hex**，更换后旧密文可能无法解密 |

可在本地安全终端各执行一次 `openssl rand -hex 32` 生成；**不得在聊天、Git 或测试日志中粘贴真实密钥**。如果使用 OpenRouter，可以通过受控部署 Secret `OPENROUTER_API_KEY` 或管理员设置页配置；部署 Secret 优先，网页中保存的 Key 使用 `DATA_KEY` 加密。具体操作、优先级与撤销方式见部署指南。

首次初始化在 HTTPS 首页完成，创建家庭管理员与第一位宝宝，密码至少 6 位。空实例没有额外初始化密钥，**应在公开访问前完成初始化或通过 Cloudflare Access 保护**。已有实例升级不得重建 D1/R2 或擅自轮换 Secrets。

## 本地开发与检查

需要 Node.js 22+；在本机配置测试用 `.dev.vars`，不要使用生产密钥。

```bash
npm install --no-audit --no-fund
npm run db:local
npm run dev
# 后端另开终端：npx wrangler dev --local
npm run verify
npm run test:e2e
```

`verify` 执行类型检查、单元测试与构建；常规 E2E 使用隔离的本地 Worker/D1/R2。GitHub Actions 还运行 Chromium 与 Linux WebKit 模拟测试。**CI 通过不等于真实 iPhone Safari、真实微信、线上网络或完整备份恢复已验收**。真实外部模型测试仅允许手动触发、只用虚构数据，可能产生调用费用。自动生产部署只在 `main` 的完整 CI 成功后触发，详见 [QA 回归矩阵](docs/qa-regression-matrix.md)。

## 文档导航

| 目的 | 权威文档 |
| --- | --- |
| 安装、升级与 D1/R2 安全 | [部署指南](docs/DEPLOY.md)、[GitHub Actions](docs/github-action-deploy.md)、[Agent Runbook](docs/agent-deploy.md) |
| 开发约定与安全规范 | [ENGINEERING](ENGINEERING.md)、[AGENTS](AGENTS.md)、[设计规范](docs/design-system.md) |
| 微信 Harness、测试与 iLink 长期架构 | [实施边界](docs/wechat-harness-implementation.md)、[测试计划](docs/wechat-harness-test-plan.md)、[ADR-002](docs/wechat-transport-architecture.md) |
| 模型能力、费用及评测 | [模型选型与 Benchmark](docs/ai-model-benchmark-and-quotas.md) |
| 备份、历史数据、媒体维护 | [备份恢复](docs/BACKUP.md)、[MyBaby 迁移](docs/MIGRATION.md)、[旧缩略图维护](docs/MEDIA_MAINTENANCE.md) |
| 离线与上传性能 | [离线管理](docs/web-management-offline.md)、[媒体上传与监测](docs/media-upload-performance.md) |

照片、健康信息和微信消息属于家庭隐私；不得上传生产数据到 CI Artifact、公开 Demo、Issue 或 PR。项目许可证见 [LICENSE](LICENSE)。
