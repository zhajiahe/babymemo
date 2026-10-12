# BabyMemo · Agent 开发指南

本文件约束 Codex、Claude Code、Cursor、Pi 等自动化编码 Agent 在本仓库中的行为。**先读事实来源，再做最小改动，验证后如实报告。** 这是一份为 BabyMemo 编写的规则，不是 FlareMo 技术栈的镜像。

## 1. 产品目标与不可改变的边界

BabyMemo 是小型、隐私优先的家庭成长记录服务。核心体验是手机上快速记录宝宝的成长数据、里程碑、照片和视频；微信私聊是核心远程操作入口（可插拔工具 Harness），网页负责管理与查阅；没有独立的网页 AI 聊天或育儿分析助手。

- 前端：React 19 + TypeScript + Vite + `lucide-react`，目前主要页面在 `src/App.tsx`，样式在 `src/styles.css`。
- 后端：Hono on Cloudflare Workers，路由在 `src/worker.ts`，登录/初始化在 `src/auth.ts`。
- 持久化：Cloudflare D1（业务事实来源）；R2 `MEDIA`（私有照片和视频）；Durable Object `BOT` / `WechatSession`（微信 iLink 轮询）。
- 配置：`wrangler.jsonc`；数据库迁移：`migrations/`；构建及脚本：`package.json`。
- OpenRouter **仅用作微信消息→工具调用路由**，不是网页聊天模型。Key 在设置页保存并通过 `DATA_KEY` 加密；微信 iLink 可选，不需要 OpenClaw、VPS 或常驻 Node 服务。
- 当前是**单家庭管理员**的初始化和登录流程，使用应用层 HttpOnly Cookie，不使用 FlareMo 的 Better Auth / PAT / Memos API。不要未经产品决策增设公开注册、多租户、第二套登录或匿名数据访问。
- MyBaby 旧生产站（Vercel/Neon/R2）与 BabyMemo 新环境隔离。**没有授权不得触碰、迁移、覆盖旧生产数据**。迁移计划参见 `docs/MIGRATION.md`。

## 2. 开工前先看哪里

| 任务 | 先阅读 |
| --- | --- |
| UI / 交互 | `docs/design-system.md`、`src/styles.css`、`src/App.tsx` |
| 初始化 / 登录 | `src/auth.ts`、`src/worker.ts`、`docs/DEPLOY.md` |
| D1 / 成长记录 | `migrations/`、`src/worker.ts`、`src/types.ts` |
| 相册上传 / 视频 | `src/App.tsx` 的 `Album`、`src/worker.ts` 的 `/api/upload/*` 和 `/api/media/*`、R2 binding |
| 微信操作 Harness | `src/wechat-harness.mjs` 工具白名单与 D1 执行、`src/wechat.ts` 绑定/路由/轮询、`src/worker.ts` 配置 API |
| 部署 / Cloudflare | `docs/agent-deploy.md`、`docs/github-action-deploy.md`、`.github/workflows/deploy.yml`、`wrangler.jsonc` |
| 新旧系统迁移 | `docs/MIGRATION.md`；只做规划和核验，除非另获明确执行授权 |

修改之前查看当前 `main`、正在进行的 PR 和工作树；**不要假设 GitHub 历史状态没有变化**。一个变更只聚焦一个目标，避免无关的重构和大批量格式化。

## 3. 常用命令

环境：Node.js 22+，包管理器使用 **npm**，不要照搬 FlareMo 的 `pnpm` 脚本或目录结构。

```bash
npm install --no-audit --no-fund
npm run check          # TypeScript
npm run test:unit      # scripts/*.test.mjs
npm run build          # TypeScript + Vite
npm run verify         # check + test:unit + build
```

本地开发时按需要运行：

```bash
npx wrangler d1 migrations apply DB --local
npx wrangler dev       # Worker /api，通常在 8787
npm run dev            # Vite HMR，vite.config.ts 把 /api 代理到 Worker
```

运行两个开发进程前，确认本地 D1/R2 模拟环境及 `.dev.vars` 已配置。不要把 `.dev.vars`、`node_modules/`、`dist/`、`.wrangler/`、真实照片、个人密钥或数据库备份加入 Git。

现在有本地 Worker HTTP E2E 与 Chromium 浏览器 E2E 的 CI 门禁；CI 全绿后触发自动 Cloudflare 发布。**不要把本地模拟通过表述成真实 iPhone Safari、微信扫码或生产 Cloudflare 端到端验收通过。**

## 4. 代码修改规则

- 延续项目当前 **React + TS + Hono + 原生 CSS** 体系；未经批准不引入 Tailwind、shadcn、外部状态管理、第二个后端或数据库。
- 改一条业务流程时检查对应的 API、数据结构、错误码和前端反馈。前端不添加「看得见但不可用」的按钮。
- 通用无业务组件 `Logo / Notice / Field / Primary / Card / Pager` 位于 `src/components/ui.tsx`；先复用它们，再考虑添加新原语。业务组件仍集中于 `src/App.tsx`，可按边界渐进拆分，但不要为了小修复重写整个页面。
- API 涉及用户数据的操作继续强制认证；状态变更请求不得绕过 `sameOrigin` 校验。错误区分 `401`（未登录）、`403`（Origin）、网络暂时不可达；不要将网络中断误判为需要重新初始化。
- D1 是用户、宝宝、成长记录、里程碑、媒体索引及加密配置的事实来源。结构修改必须提交新的 `migrations/` SQL，并考虑已部署数据库的兼容性；**禁止删表、清库、重建资源来“修复”迁移**。
- R2 保存媒体对象；读取仍经登录后的 Worker 代理。上传保持分片、并发上限、重试与失败取消逻辑；不要把视频全量读进 Worker 或为方便直接公开 R2 bucket。移动 Safari 需覆盖 HEIC/MOV、慢网和取消后的状态。
- 新增或修改按宝宝区分的 AI / 记录功能时，始终检查 `babyId` 上下文，避免不同宝宝的记录混在一起。AI 不得编造来源于家庭数据库的记录；明确区分建议和真实记录。
- 微信 iLink 集成是不稳定的第三方协议。启停、重绑、去重、轮询游标、失败回滚需保持一致；不要声称扫码成功意味着消息收发已真实验证。
- 变动只含文档时不必触碰 Cloudflare 资源，也不应做看似无关的 UI 或依赖升级。

## 5. UI / UX 质量约定

设计原则是 **「安静、温暖、易记录」**，详细尺度见 `docs/design-system.md`。FlareMo 值得借鉴的是**设计约束和验收机制**，而不是复制 Ember 渐变、全部组件或 CSS 变量。

- 优先沿用现有 `.card`、`.primary`、`.secondary`、`.field`、`.nav-link`、`.mobile-nav` 等类；新 CSS token 先统一定义，不要散落新的魔法色值。
- 新增中文可读文案字号 **至少 12px**；目前遗留的 10–11px 文案作为后续清理项，不继续扩大。
- 新触控控件争取至少 **44 × 44 CSS px**，焦点必须可见。对比度目标：普通正文至少 4.5:1，较大文字或 UI 图形至少 3:1，必要时调整颜色而不是降低字号。
- 重点检查宽度 **320px、375px、768px 和桌面**，关注底部安全区、相册、长文件名、初始化表单和软键盘遮挡。
- 尊重 `prefers-reduced-motion`；加载、上传、保存、失败都应有可理解的状态，不滥用 toast、持续动画和装饰性渐变。
- 新增 UI 文案统一使用「成长记录 / 成长瞬间 / 家庭相册 / 微信操作」，不随意改名。宝宝健康信息不做未经验证的医学诊断。

## 6. 密钥、隐私与安全

- 初始化密钥已取消，公开空实例存在管理员被抢先注册风险。部署后应立即初始化，或使用 Cloudflare Access 限制访问。不得覆盖已有管理员账号。

生产只需要 `SESSION_SECRET`、`DATA_KEY` 分别独立生成；`DATA_KEY` 是已保存 OpenRouter 和微信凭据的加密密钥，错误轮换会导致密文无法解密。**不读取、索取、回显、记录或轮换已有生产密钥**；不得将其复制到 PR、Issue、聊天、日志或代码。

不要将真实宝宝姓名、生日、照片、病史、家庭会话、微信凭据和 OpenRouter Key 放入测试样本或日志。测试采用合成资料；调试报告只保留脱敏错误码与必要复现步骤。

生产变更需要**部署者明确授权**。当前已批准的是 **main 的完整 CI 全绿后自动发布已有 Cloudflare Worker**，不会自动创建 D1/R2 或轮换 Secret；除此之外，只读验证 ≠ 可以创建 D1/R2；`npm run provision:remote`、远端 D1 migration、`wrangler deploy`、Secret 更新或正式 GitHub Actions 发布都不在默认授权内。尤其不要直接执行 `npm run deploy` 作为“纯检查”，它会部署到 Cloudflare。完整操作遵循 `docs/agent-deploy.md`。

## 7. Git 与验证流程

- 默认从最新 `main` 新建短分支，提交小而聚焦的 PR；不要未经明确请求强推或直接合并。**注意：合并到 main 现在会触发完整 CI，成功后自动发布生产。** 合并前必须确认迁移兼容性、备份与发布风险，不要手动绕过 CI 触发生产部署。
- **已有 PR 的后续任务**优先更新该 PR 分支，修改前检查是否已合并或是否出现并行变更；若已合并，另开新 PR。
- 如有冲突，先保留最新 `main` 的既有功能、测试与迁移，再选择性整合另一侧改动。禁止用“全部接受一边”掩盖丢失功能。
- UI 修改：至少跑 `npm run check`、`npm run build`，并提供桌面/手机关键场景目检结果；无法目检则写“未验证”。
- API、上传或数据库修改：加上适用的测试（当前 `npm run test:unit`），必要时新增定向用例；真实 Cloudflare / R2 只能在获得授权后检查。
- 单纯文档修改：校验链接、实际文件、命令与现有脚本是否一致。可使用现有 CI，但无需部署。
- PR 描述至少包含：变更摘要、影响的数据/接口、验证命令与结果、未验证项、部署/迁移风险。
- 不要为了获得绿色 CI 删除失败测试、关掉类型检查或弱化认证。

## 8. 交付与文档入口

- `README.md`：功能、部署入口与现状
- `docs/design-system.md`：视觉 token、排版、响应式、文案与验收原则
- `docs/DEPLOY.md`：面向用户的一键部署与初始化
- `docs/github-action-deploy.md`：GitHub Actions 受控部署步骤
- `docs/agent-deploy.md`：Agent 部署 Runbook（**部署动作以此为准**）
- `docs/MIGRATION.md`：旧 MyBaby 迁移评估与验收边界
- `.github/workflows/ci.yml`：实际 CI 检查内容

最终回复区分**已修改 / 已提交 / PR 已创建 / CI 已通过 / 已部署 / 已真实验收**，不要把这些状态混为一谈。

## 9. 相册上传和派生缩略图

- 每条 `media_uploads` 的 `fingerprint` 是用于重选文件后识别续传会话的首尾采样摘要，不代表完整文件 SHA-256；只能在文件名、大小、MIME 与指纹均匹配时复用分片。
- 自动失败不得删除可恢复的 R2 multipart；只有用户明确点击「取消上传」才调用 `/api/upload/:id/cancel`。原文件确认保存后再独立上传缩略图，派生文件上传失败不回滚原图。
- JPEG 缩略图存储于私有 R2，读取必须继续经受保护的 Worker；禁止为了缓存直接打开公开 bucket 或 CDN。移动端视频列表不得自动预加载视频元数据；原文件下载始终返回完整原图。
- D1 迁移应增量且先于新 Worker 发布；旧图片需安全回退原图，旧未完成上传允许清理。

## 10. 旧照片与上传过期回收

- 旧照片缩略图只允许管理员在相册主动触发；旧原文件经私有 API 加载，浏览器以 10 条为上限的小批次处理，失败/大文件跳过，原图不能修改。
- Cron 每天 UTC 19:00 执行，针对连续 14 天无成功分片活动的会话，以最多 30 条为一批检查。R2 存在完整对象时优先补记 D1；R2 不存在时可中止未完成 multipart 并删掉会话。检查失败保留记录，绝不能盲删可能已经完成的媒体。
- WebKit Linux 测试是 Safari 引擎兼容性测试，**不构成真实 iPhone Safari 验收**。真实设备若未执行，必须如实标识。


## 微信工具安全边界

- 禁止重新新增网页 AI 助手或 `/api/chat` 作为主入口；OpenRouter 只生成工具名称及参数，真实读写必须通过白名单 Harness。
- 每条指令最多执行一个操作。变更必须显式指明目标宝宝和记录日期或编号；目标不唯一、记录已删除、缺少修改或删除意图应拒绝执行。
- 模型无 SQL、R2 密钥、管理员会话等工具权限。消息来自绑定微信的单聊账户；不可跨宝宝写入。不返回私有媒体的匿名链接。
- 微信删除均应采用 30 天回收站；更新与删除应使用精确记录 ID，移动端网络重试不允许重复新增。


## 微信照片接入

- `src/wechat-media.mjs` 独立实现官方 CDN 域名白名单、AES-128-ECB 解密、50 MiB 下载上限及视频 R2 Multipart、格式签名识别、R2/D1 入库和幂等恢复；`src/wechat.ts` 只负责绑定微信消息路由。
- 不直接把 CDN URL 当相册地址，禁止开放公共 R2、删除原始媒体、日志输出解密密钥或 CDN 完整查询参数。
- 图片和视频消息不发给 OpenRouter 识图；多宝宝必须在图片附文明确宝宝或配置持久化默认宝宝，缺少目标时拒绝入库。
- CDN 协议不稳定；真实微信图片仍需现场发送验收，不得将模拟解密/Worker E2E 通过表述成 iOS 微信实测成功。


## 指令模型容错与多轮边界

- `src/openrouter-retry.mjs` 的重试只覆盖模型调用，不可重复执行写入工具；429/503 尊重短 `Retry-After`，长时间退避告知用户。
- `src/wechat-memory.mjs` 仅在已绑定微信的一对一 Durable Object 会话里缓存 4 轮文本、20 分钟 TTL；不能跨账号/绑定凭据复用，不能让模型从历史回复编造未被用户授权的删除操作。
- `src/wechat-media.mjs` 处理图片/视频最大 50 MiB；大文件必须采用分片上传，不可 Buffer.concat 完整视频、不可公开 R2 对象。
