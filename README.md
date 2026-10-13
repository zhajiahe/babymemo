# BabyMemo

BabyMemo 是部署在 Cloudflare 上的私密家庭成长记录应用，以相册、成长曲线、成长瞬间和微信消息操作为核心。不依赖 VPS。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zhajiahe/babymemo)

## 功能

- **家庭空间**：首次初始化时创建家庭管理员和第一个宝宝；可继续添加宝宝并切换档案。家庭密码至少 6 位。
- **成长记录**：体重、身高、头围、成长瞬间、历史曲线；删除项目可在 30 天内从回收站恢复。
- **私密相册**：上传照片和视频、按月浏览、收藏、编辑拍摄日期、下载原件。使用私有 R2 存储与登录鉴权；图片缩略图是可选派生文件。
- **断点续传**：网页单文件上限 200 MB，8 MiB 分片；中断后须重新选取原文件，才能尝试恢复未完成的分片。
- **微信操作**：绑定微信 iLink Bot 后，可通过文字调用受限增删改查工具，也可直接发照片和视频到相册；微信单文件上限 50 MiB，每条消息最多 4 项。
- **短期上下文**：微信操作保留有限轮次的上下文，便于引用此前查询结果。**不提供网页 AI 对话或医学诊断助手。**

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
| \`SESSION_SECRET\` | 签名登录 Cookie | 更换会使旧会话失效 |
| \`DATA_KEY\` | 加密 D1 中的微信和 OpenRouter 凭据 | 需 64 位十六进制；更换会使旧密文无法解密 |

可在独立的安全终端分别运行两次 \`openssl rand -hex 32\` 生成并保管密钥；不要把真实密钥粘贴到仓库、PR 或聊天。

OpenRouter Key 是**可选**的微信指令模型配置，支持两种方式：

1. **部署管理**：在 GitHub Actions / \`production\` Environment 添加 Secret \`OPENROUTER_API_KEY\`，正式部署后作为 Cloudflare Worker Secret 使用，优先于 D1 设置。
2. **网页管理**：管理员登录网站后，在「设置 → 微信操作引擎 · OpenRouter」填写 Key 和模型 ID。Key 用 \`DATA_KEY\` 加密保存于 D1。

已经配置部署 Secret 时，网页仍可更改模型 ID，但不能覆盖部署 Key。**从 GitHub 删除 Secret 不会自动删除云端已有 Worker Secret**；需明确到 Cloudflare 控制台撤销。Key 不会传回浏览器。

新实例初始化之前，访问者有可能抢先注册管理员。建议在首次公开访问前完成初始化，或使用 Cloudflare Access 限制访问。

## 本地开发

需要 Node.js 22+。开发前复制 \`.dev.vars.example\` 为 \`.dev.vars\`，仅在本机配置测试密钥，不要使用生产 \`DATA_KEY\`。

\`\`\`bash
npm install --no-audit --no-fund
npm run db:local
npm run dev
\`\`\`

另一个终端运行 \`npx wrangler dev --local\`，以本地 D1/R2/DO 调试后端；前端 Vite 默认使用自己的端口，具体代理行为以 \`vite.config.ts\` 为准。执行需要远端 Cloudflare 权限的命令之前，请查看 [Agent 部署 Runbook](docs/agent-deploy.md)。

## 质量检查

\`\`\`bash
npm run verify
npm run test:e2e
\`\`\`

\`verify\` 包含类型检查、单元测试和构建。\`test:e2e\` 在临时本地 Wrangler 环境里测试 HTTP/D1/R2，不读写生产数据；Chromium、WebKit 在 GitHub Actions 独立运行。详见 [测试矩阵](docs/qa-regression-matrix.md)。

合并到 \`main\` 后，**完整 CI 通过才会触发 Cloudflare 自动发布**。自动发布只检查已有 D1/R2 资源，不创建或重建生产数据库；先核验迁移，再发布 Worker。修复程序仅在 \`birth_time\` 已存在、结构精确匹配时补记缺失的 0012 迁移历史。

**未被自动化证明**：真实 iPhone Safari 下的 HEIC/HEVC/MOV、蜂窝弱网、真实微信协议持续可用性、生产 D1/R2 一致性快照与完整恢复演练。

## 文档导航

| 场景 | 文档 |
| --- | --- |
| 用户部署与初始化 | [部署指南](docs/DEPLOY.md) |
| GitHub Secrets、自动发布、迁移故障 | [GitHub Actions 部署](docs/github-action-deploy.md) |
| Agent 的生产权限边界 | [Agent 部署 Runbook](docs/agent-deploy.md) |
| 代码组织、变更质量、错误处理 | [工程规范](ENGINEERING.md) 与 [AGENTS.md](AGENTS.md) |
| 自动化范围、真机验收缺口 | [QA 回归矩阵](docs/qa-regression-matrix.md) |
| 私有 D1/R2 备份与恢复 | [备份与恢复](docs/BACKUP.md) |
| 一次性旧照片缩略图维护 | [媒体维护](docs/MEDIA_MAINTENANCE.md) |
| 旧 MyBaby 数据映射及限制 | [迁移计划](docs/MIGRATION.md) |
| 视觉、响应式与无障碍 | [设计规范](docs/design-system.md) |

## 安全边界

所有照片和视频默认保存在私有 R2。微信 iLink 是第三方协议，可能发生兼容性变化；发送给 OpenRouter 的微信文字和目标宝宝信息需由家庭管理员自行评估隐私。正式数据不应混入测试快照、CI Artifact、Issue 或 PR。旧 MyBaby 站点的 Neon/Vercel/R2 数据不在 BabyMemo 自动部署的迁移范围内。

许可证见 [LICENSE](LICENSE)。
