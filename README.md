# BabyMemo

BabyMemo 是部署在 Cloudflare 上的私密家庭成长记录应用，以相册、成长曲线、成长瞬间和微信消息操作为核心。不依赖 VPS。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zhajiahe/babymemo)


## 在线演示（无真实数据）

[**打开 BabyMemo 静态 Demo**](./public/demo.html) · [查看演示页面源文件](public/demo.html)

演示使用完全虚构的「小星星」家庭和模拟相册、成长记录、成长瞬间、微信绑定状态。页面独立于真实应用，**不发送 API 请求、不读取生产 D1/R2、无需登录、没有真实个人照片或视频**。在已部署的站点访问 `/demo.html` 即可预览；GitHub 中也可下载 HTML 后在浏览器打开。演示页展示界面，不执行真实的上传或微信操作。

## 功能

- **家庭空间**：首次初始化时创建家庭管理员和第一个宝宝；可继续添加宝宝，并仅在「设置 → 宝宝资料」切换当前查看的宝宝。初始化的家庭空间名称会显示于桌面侧栏及手机顶部。家庭密码至少 6 位。
- **完整网页入口**：成长记录与成长瞬间均支持新增、日期/关键词查询、编辑和删除；相册支持日期/类型筛选、修改日期、下载和删除。首页的最近瞬间始终读取第一页，不受历史页码影响。修改采用版本校验，冲突不会静默覆盖。
- **宝宝资料**：网页可修改昵称、生日、出生时间、性别、时区、过敏信息与备注，可上传、更换和移除私有头像；不再常用的宝宝可移出列表并恢复，全部记录保留。成长曲线和30天回收站继续提供。
- **完整导出**：设置页下载 ZIP64 家庭档案，包含头像、媒体原件、现有缩略图、完整记录和瞬间关联；也可仅导出 JSON。操作采用登录鉴权和流式媒体读取。详见 [网页管理与离线使用](docs/web-management-offline.md)。
- **离线记录**：首次在线打开后可离线重新打开页面；草稿关闭标签页后仍保留。离线新增/编辑/删除记录、资料修改与选取的媒体先保存到本机，重新联网并登录后自动同步。访问过的资料与媒体可离线查看，原件可在预览里主动保存到本机。同步冲突有明确提示；退出会清除设备数据。
- **私密相册**：上传照片和视频、按月浏览、编辑拍摄日期、下载原件。网页自动日期和微信照片保存优先读取原图 EXIF 拍摄日期，支持 JPEG、HEIC/HEIF、PNG 和 WebP；无有效日期时分别使用网页默认日期或微信收到日期。照片的文件修改时间不冒充拍摄日期，手动日期和既有照片不被自动覆盖。使用私有 R2 存储与登录鉴权；5MiB 内小文件直传、大文件续传、批量有界并发；图片缩略图是可选的后台派生文件。
- **断点续传**：网页单文件上限 200 MB，8 MiB 分片；中断后须重新选取原文件，才能尝试恢复未完成的分片。
- **微信操作**：家庭成员可分别扫码绑定独立微信 iLink Bot，按成员启用、暂停、改名或移除；每个微信有独立轮询与短期会话，但记录和私有相册属于同一家庭空间。支持文字增删改查及照片、视频直传；微信单文件上限 50 MiB，每条消息最多 4 项。
  媒体先进入加密持久任务，保存期间文字操作仍可继续；接收和保存结果分别通知。每位成员最多 32 条待处理媒体消息，暂停保留任务、重绑或移除取消旧任务。设置页自动刷新中文连接、保存、重试和重新绑定状态。
- **微信 Harness（ReAct）**：受限的 LLM→工具→结果观察多轮循环，单次最多 4 轮模型决策、8 次工具调用，时间和记录查询可作为工具；支持先查后改、短期上下文、撤销、日期区间及相册操作。数据库事实仍来自私有 D1/R2，不提供网页 AI 对话或医学诊断助手。

技术栈：React 19、TypeScript、Vite、Hono、Cloudflare Workers、D1、R2、Durable Objects。

## 部署

推荐先阅读 [部署与初始化指南](docs/DEPLOY.md)，再选择其中一种部署方式：

| 方式 | 适用场景 | 操作 |
| --- | --- | --- |
| Deploy to Cloudflare | 首次从模板部署独立实例 | 点击上方按钮，按向导授权资源，然后配置密钥 |
| GitHub Actions | 长期维护自己的仓库与自动发布 | [GitHub Actions 部署与故障排查](docs/github-action-deploy.md) |

首次使用必需两个相互独立、保持稳定的 Cloudflare Worker Secrets：

| Secret | 用途 | 注意 |
| --- | --- | --- |
| `SESSION_SECRET` | 签名登录 Cookie | 更换会使旧会话失效 |
| `DATA_KEY` | 加密 D1 中的微信和 OpenRouter 凭据 | 需 64 位十六进制；更换会使旧密文无法解密 |

可在独立的安全终端分别运行两次 `openssl rand -hex 32` 生成并保管密钥；不要把真实密钥粘贴到仓库、PR 或聊天。

默认通过 Cloudflare Workers AI（`@cf/qwen/qwen3.8-27b`）进行微信指令识别，关闭思考，无需额外 API Key；Workers AI Free 每日账号共享 10,000 Neurons。若要改用 OpenRouter，Key 是**可选提供方的必需配置**，支持两种方式：

1. **部署管理**：在 GitHub Actions / `production` Environment 添加 Secret `OPENROUTER_API_KEY`，正式部署后作为 Cloudflare Worker Secret 使用，优先于 D1 设置。
2. **网页管理**：管理员登录网站后，在「设置 → AI 模型配置」选择 OpenRouter 并填写 Key 和模型 ID。Key 用 `DATA_KEY` 加密保存于 D1。

已经配置部署 Secret 时，网页仍可更改模型 ID，但不能覆盖部署 Key。**从 GitHub 删除 Secret 不会自动删除云端已有 Worker Secret**；需明确到 Cloudflare 控制台撤销。Key 不会传回浏览器。

新实例初始化之前，访问者有可能抢先注册管理员。建议在首次公开访问前完成初始化，或使用 Cloudflare Access 限制访问。

## 本地开发

需要 Node.js 22+。开发前复制 `.dev.vars.example` 为 `.dev.vars`，仅在本机配置测试密钥，不要使用生产 `DATA_KEY`。

```bash
npm install --no-audit --no-fund
npm run db:local
npm run dev
```

另一个终端运行 `npx wrangler dev --local`，以本地 D1/R2/DO 调试后端；前端 Vite 默认使用自己的端口，具体代理行为以 `vite.config.ts` 为准。执行需要远端 Cloudflare 权限的命令之前，请查看 [Agent 部署 Runbook](docs/agent-deploy.md)。

## 质量检查

```bash
npm run verify
npm run test:e2e
```

`verify` 包含类型检查、单元测试和构建。`test:e2e` 在临时本地 Wrangler 环境里测试 HTTP/D1/R2，不读写生产数据；Chromium、WebKit 在 GitHub Actions 独立运行。详见 [测试矩阵](docs/qa-regression-matrix.md)。

合并到 `main` 后，**完整 CI 通过才会触发 Cloudflare 自动发布**。自动发布只检查已有 D1/R2 资源，不创建或重建生产数据库；先核验迁移，再发布 Worker。修复程序仅在 `birth_time` 已存在、结构精确匹配时补记缺失的 0012 迁移历史。

**未被自动化证明**：真实 iPhone Safari 下的 HEIC/HEVC/MOV、蜂窝弱网、真实微信协议持续可用性、生产 D1/R2 一致性快照与完整恢复演练。

## 文档导航

| 场景 | 文档 |
| --- | --- |
| 用户部署与初始化 | [部署指南](docs/DEPLOY.md) |
| GitHub Secrets、自动发布、迁移故障 | [GitHub Actions 部署](docs/github-action-deploy.md) |
| Agent 的生产权限边界 | [Agent 部署 Runbook](docs/agent-deploy.md) |
| 代码组织、变更质量、错误处理 | [工程规范](ENGINEERING.md) 与 [AGENTS.md](AGENTS.md) |
| 自动化范围、真机验收缺口 | [QA 回归矩阵](docs/qa-regression-matrix.md) |
| 微信 Harness 自动化测试设计 | [Harness 测试计划](docs/wechat-harness-test-plan.md) |
| 微信 iLink/DO 长期降本架构与 Cron/Queues 对比 | [微信接收架构 ADR-002](docs/wechat-transport-architecture.md) |
| AI 默认模型、免费 Neurons / DO 额度与双模型 Benchmark | [AI 模型评估和额度](docs/ai-model-benchmark-and-quotas.md) |
| 私有 D1/R2 备份与恢复 | [备份与恢复](docs/BACKUP.md) |
| 一次性旧照片缩略图维护 | [媒体维护](docs/MEDIA_MAINTENANCE.md) |
| 网页与微信媒体上传性能、日志和回归测试 | [媒体上传性能](docs/media-upload-performance.md) |
| 旧 MyBaby 数据映射及限制 | [迁移计划](docs/MIGRATION.md) |
| 视觉、响应式与无障碍 | [设计规范](docs/design-system.md) |

## 多微信家庭成员

管理员在「设置 → 微信操作」输入成员称呼并生成二维码，让该成员用自己的微信扫码确认。成功后在成员列表中单独启用。每个成员独立维护微信 Token、iLink 消息游标、回复去重与多轮上下文；同一家庭的所有成员可操作全部宝宝的数据。移除成员只会停止该微信接入，不会删除任何相册或成长记录；如需在微信侧解除授权，也应在微信内取消 Bot 绑定。

旧版单微信设置会通过 **0014 增量 D1 迁移**自动变为「原有微信」，保留原有 Durable Object 游标；无需重新扫码，既有密文凭据不会暴露给前端。为支持旧版 Worker 回滚，遗留配置键暂时保留。真实账号 iLink 多绑定行为仍需上线后使用不同微信账号验收。

## 安全边界

所有照片和视频默认保存在私有 R2。微信 iLink 是第三方协议，可能发生兼容性变化；发送给 Cloudflare Workers AI（或可选的 OpenRouter）的微信文字和目标宝宝信息需由家庭管理员自行评估隐私。正式数据不应混入测试快照、CI Artifact、Issue 或 PR。旧 MyBaby 站点的 Neon/Vercel/R2 数据不在 BabyMemo 自动部署的迁移范围内。

许可证见 [LICENSE](LICENSE)。

## 默认 Workers AI Qwen3.8 与可选 OpenRouter

新版本默认使用 Cloudflare-hosted [`@cf/qwen/qwen3.8-27b`](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/)，`chat_template_kwargs.enable_thinking=false` 关闭思考，`reasoning_effort=low`，并直接复用内部微信 ReAct 工具，不依赖新 MCP 服务或 OpenRouter Key。可在「设置 → AI 模型配置」切回 OpenRouter；先前保存的 OpenRouter 模型 ID 和加密 Key 不删除。没有保存 `ai_provider` 偏好的旧实例也会使用新的 Qwen 默认提供方，切换前应关注每日 Neurons 额度和 DO 消耗。

实测场景、消耗和上线限制详见 [Qwen3.8 模型测试报告](docs/workers-ai-qwen38-evaluation.md)。

**OpenRouter 的默认模型**已从 Muse 调整为 **`deepseek/deepseek-v4.1-flash`（Relace，关闭思考）**，仅影响没有保存过 OpenRouter 模型偏好的实例；已明确保存的模型选择不会被覆盖。Workers AI Qwen 仍是未选择提供方时的默认服务，使用 OpenRouter 需要在网页设置中切换提供方。可选的 OpenRouter 模型包括原有 Muse、`deepseek/deepseek-v4.1-flash`（固定 Relace）、`openai/gpt-6-luna` 和 `anthropic/claude-haiku-5.5`。前三个新候选默认优先**关闭思考**，如果服务商明确不支持关闭思考，则用一次兼容性重试降到最低思考档（GPT-6 Luna `minimal`，Haiku 5.5 `low`）。可以在网站「设置 → 微信 AI 模型 → 切换模型或配置 OpenRouter」直接选择建议模型 ID，也可以手工填写其他 OpenRouter 模型。相关参数及同题测试说明见 [模型 Benchmark 文档](docs/ai-model-benchmark-and-quotas.md)。以上模型需 OpenRouter Key，**不改变默认 Workers AI Qwen**；真实模型调用可能产生费用。

若要验证真实 OpenRouter **自动工具调用冒烟测试**（与 Harness Live 采用同样的 `tool_choice: auto` 请求方式，检验只读工具路由），前往 **GitHub Actions → Manual OpenRouter Live E2E → Run workflow**，选中 `main` 后主动运行。该测试只发送合成宝宝的只读查询、不读写真实 D1/R2、不会运行真实微信，也**不会由 PR、push、定时任务或自动部署触发**。需事先配置 GitHub Secret `OPENROUTER_API_KEY`，可能产生少量模型费用。

也可在安全的本地终端提供 OpenRouter Key，设置 `OPENROUTER_E2E_CONFIRM=YES` 后执行 `npm run test:openrouter:live`。该开关缺失时脚本直接拒绝执行。Contributor 模型的提示词和输出可能用于改进 Meta 产品，真实家庭隐私请谨慎处理。

## 微信 Harness 深度测试（手动触发）

普通 PR / main CI 仅运行本地模拟的快速测试。耗时的合成场景回归和真实 OpenRouter 调用**不自动执行**，需前往 GitHub Actions → **Manual Harness Deep E2E** 主动选择 `offline` 或 `live`。`offline` 默认运行 240 组离线场景；`live` 单独选择付费请求数（**默认 5 次，最多 60 次**）和模型。`live` 会调用可能计费的外部模型，需配置 GitHub Secret `OPENROUTER_API_KEY`；测试仅发送合成文本，不访问生产 D1/R2 或微信。也可在本地使用 `npm run test:harness:deep`，真实模型需主动设置 `OPENROUTER_E2E_CONFIRM=YES`、`HARNESS_LIVE_CONFIRM=YES` 后执行 `npm run test:harness:live`。

详情见 [Harness 实施与限制](docs/wechat-harness-implementation.md)、[场景审查](docs/wechat-harness-review.md)和[自动化测试方案](docs/wechat-harness-test-plan.md)。
