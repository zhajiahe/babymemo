# BabyMemo

Cloudflare 原生家庭成长记录系统。参考 MyBaby 的宝宝档案、成长记录、里程碑和相册功能，并借鉴 FlareMo 的部署向导与轻量设计。当前为 v0.1 开发预览，不要替换旧 MyBaby 生产环境。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zhajiahe/babymemo)

## 功能

- 首次初始化必须填写**家庭名称、管理员登录名、家庭密码、宝宝名字、出生日期、性别和时区**；全部完成后才开放数据录入。
- 家庭密码登录；PBKDF2 哈希、HttpOnly/Secure/SameSite Cookie、D1 登录限流和同源保护。
- D1 中的成长记录、里程碑、分页相册；体重/身高 SVG 趋势图；R2 私有媒体、8 MiB 分片、至多 3 路并行与失败重试，支持视频 Range 读取。
- 网页配置 OpenRouter Key 和模型，测试连接并通过 AI 对话。
- 网页获取微信 iLink 二维码，扫码配对并手动启用 Durable Object Alarm Bot。只处理绑定微信用户的一对一文字消息，支持查询最近的成长测量与里程碑，以及明确的新增记录。
- React + Vite + Hono + Workers + D1 + R2 + Durable Objects；不需要 VPS、Next.js、Neon 或 OpenClaw。

## 一键部署

点击上方 Deploy to Cloudflare：Cloudflare 会克隆仓库并尝试自动部署 Worker、D1、R2、Durable Objects；deploy 脚本包含数据库迁移。首次上线前必须由所有者设置三个 Secret。Cloudflare 部署向导会参考仓库内 `.dev.vars.example` 提供配置提示；若没有在向导中填写，务必到 Worker 控制台手动添加。不能通过公共网页匿名占用新实例。

在 Cloudflare Workers → BabyMemo → Settings → Variables and Secrets 中添加三个类型为 Secret 的值：

- BOOTSTRAP_SECRET：终端运行 openssl rand -hex 32
- SESSION_SECRET：单独再次运行 openssl rand -hex 32
- DATA_KEY：再单独运行 openssl rand -hex 32（必须保留，轮换将导致原有加密凭据无法解密）

完成后访问 Worker 域名，根据 `/api/bootstrap/status` 状态进入初始化界面，完成家庭名称、管理员及第一位宝宝的必填资料。绑定自定义域名后不用修改认证 Origin 环境变量，仍要测试完整登录。

**完整步骤及故障排查：见 [部署与初始化指南](docs/DEPLOY.md)。** 这是一键创建基础云资源的部署模式，三个私密 Secret 仍需要由所有者配置，不代表扫码后零步骤就能使用。

## GitHub Actions 部署

操作指南：[GitHub Actions 部署](docs/github-action-deploy.md) · [Coding Agent 部署 Runbook](docs/agent-deploy.md)。默认先运行 **Dry Run**，不触碰生产 D1。

在仓库 Settings → Secrets and variables → Actions 配置：

| Secret | 来源 |
| --- | --- |
| CLOUDFLARE_API_TOKEN | Cloudflare API Token（部署、D1、R2、DO 所需权限） |
| CLOUDFLARE_ACCOUNT_ID | Cloudflare Account ID |
| BOOTSTRAP_SECRET | 随机十六进制 32 字节 |
| SESSION_SECRET | 独立随机 32 字节 |
| DATA_KEY | 独立随机 32 字节 |

Actions → Deploy BabyMemo to Cloudflare → Run workflow：默认 `dry_run=true`，检验已有 D1/R2、类型检查、单元测试、构建和发布预演；正式发布设置 `dry_run=false`，校验 Secrets、准备 D1/R2、迁移数据库、发布 Worker、同步 Secrets、健康检查。首次无资源时 Dry Run 失败是预期行为。只有手动运行才发布，不随 Push 自动部署。

本地开发（Node.js 22+）：先 npm install、npm run build，再执行 npx wrangler d1 migrations apply DB --local；另开终端启动 npx wrangler dev 和 npm run dev。把上面的密钥写入仅供本地使用、已被 .gitignore 忽略的 .dev.vars。登录及 Secret 不要提交到 Git。运行 `npm run test:unit` 可检查首次部署 D1 ID 解析逻辑。

## 网页配置微信与 AI

先初始化 → 设置 → OpenRouter，填写 sk-or-v1- 开头的 Key 和有效模型 ID并测试；然后设置 → 微信 ClawBot，扫描二维码完成授权；手动启用 Bot。微信 iLink 适配依赖第三方协议，可能随协议变更失效。暂时只处理白名单微信单聊文字，不支持群聊、微信语音、自动推送或第三方 AI 供应商。

OpenRouter 与微信凭据使用 DATA_KEY 经 AES-GCM 加密存放于 D1，UI 不读取明文。消息处理仅保存去重 ID 和状态；用户文字及宝宝上下文可能传给 OpenRouter，请评估家庭隐私。

## 性能与限制

D1 日期索引 + 有界分页，Cloudflare Assets 静态托管；照片懒加载，视频 Range，浏览器最多 3 个 8 MiB 分片并行上传与单片重试，失败时尝试取消 R2 multipart。暂未做 iPhone HEVC/MOV 转码或自动缩略图；上传上限 200MB，最终可播放性依客户端解码器。未完成上传的自动垃圾回收、微信失效自动恢复、生产数据导入/备份、跨站隐私与端到端验收仍未完成。新站暂未恢复旧 MyBaby 的照片编辑、HEIC 自动转换、视频封面、出生体格信息等全部功能。

**数据安全**：新仓库不会读取或修改 MyBaby 的生产 Neon、R2、Vercel；迁移旧数据需要另外做只读导出、哈希核验、媒体复制和最终切换流程。不要用空的新 D1 覆盖旧数据。详细字段映射和只读迁移验收清单见 [MyBaby 迁移计划](docs/MIGRATION.md)。

## 验证

先运行 npm install、npm run check、npm run build，再在隔离 Cloudflare 环境验证初始化、登录、记录 CRUD、相册上传/读取、OpenRouter、微信配对和持续轮询。当前尚未真实验收，不宣称可直接用于生产。

许可证见 LICENSE；旧 MyBaby 项目及其版权保持不变。
