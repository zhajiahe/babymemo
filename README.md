# BabyMemo

私密的家庭成长记录：照片/视频、成长测量、成长瞬间，以及通过微信 iLink 自然语言管理。基于 Cloudflare Workers、D1、私有 R2、Durable Objects 和 React，无需 VPS。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zhajiahe/babymemo) · [查看合成数据 Demo](public/demo.html)

## 能做什么

- **家庭与多宝宝**：一个家庭管理员；记录、草稿、相册和回收站按宝宝隔离。
- **私密相册**：故事描述、照片/视频封面、续传、编辑与恢复；原件始终在私有 R2。网页单文件上限 200 MB。
- **离线使用**：本机草稿与上传队列，恢复联网后同步；可下载家庭档案。详见 [离线与导出](docs/web-management-offline.md)。
- **微信操作**：绑定家庭成员，使用受限工具查询或维护记录；媒体单项不超过 50 MiB、每消息最多 4 项。默认模型为 Workers AI，可手动选择 OpenRouter。

## 开始

1. 按 [部署指南](docs/DEPLOY.md) 安装；正式发布及 Secrets 见 [GitHub Actions 部署](docs/github-action-deploy.md)。
2. 在公开访问前完成 HTTPS 首页的管理员和首位宝宝初始化，或先用 Cloudflare Access 保护空实例。
3. 本地开发（Node.js 22+，只用测试数据）：`npm install --no-audit --no-fund` → `npm run db:local` → `npm run dev`；另开终端运行 `npx wrangler dev --local`。
4. 提交前运行 `npm run verify`、`npm run test:e2e`。自动 CI 包含模拟 Worker / Chromium / Linux WebKit；不代表真实 iPhone 或微信验收。

**安全**：`SESSION_SECRET` 和 64 位十六进制 `DATA_KEY` 必须分别安全保存，升级时不得随意轮换；不要将真实家庭数据、密钥或 Token 放入代码、Issue、PR、日志或测试 Artifact。

## 文档

| 需要做什么 | 阅读 |
| --- | --- |
| 安装、自动发布、Agent 运维 | [部署](docs/DEPLOY.md) · [Actions](docs/github-action-deploy.md) · [Agent Runbook](docs/agent-deploy.md) |
| 开发约束与设计 | [工程规范](ENGINEERING.md) · [Agent 约束](AGENTS.md) · [设计规范](docs/design-system.md) |
| 微信行为与架构探索 | [Harness](docs/wechat-harness-implementation.md) · [轮询 ADR（未实施）](docs/wechat-transport-architecture.md) |
| 测试入口与模型对比 | [QA 与 CI](docs/qa-regression-matrix.md) · [模型 Benchmark](docs/ai-model-benchmark-and-quotas.md) |
| 数据与媒体维护 | [备份](docs/BACKUP.md) · [MyBaby 迁移](docs/MIGRATION.md) · [媒体维护](docs/MEDIA_MAINTENANCE.md) |
| 功能与性能 | [离线导出](docs/web-management-offline.md) · [上传观测](docs/media-upload-performance.md) |

历史测试结果请直接查看 [Actions](https://github.com/zhajiahe/babymemo/actions) 和 PR；它们不是当前部署状态的替代品。项目许可证见 [LICENSE](LICENSE)。
