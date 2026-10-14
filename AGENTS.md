# BabyMemo · Coding Agent 约束

适用于 Codex、Pi、Claude Code 等自动化编码工具。**先检查最新分支与 PR，再做最小变更；只报告真正执行和验证过的结果。** 本文件只规定跨模块安全边界，不重复业务实现和部署手册。

## 产品和架构

BabyMemo 是单家庭管理员的私密成长记录应用。网页及微信 iLink 均可管理成长测量、里程碑、照片/视频与宝宝资料；**不增加公开注册、第二套认证、独立网页 AI 聊天或医学诊断助手**。

- UI：React + TypeScript + Vite；`src/App.tsx`、`src/features/`、`src/components/`。设计标准见 [docs/design-system.md](docs/design-system.md)。
- API：Hono/Cloudflare Workers，`src/worker.ts`，认证与加密分别见 `src/auth.ts`、`src/crypto.ts`。
- 数据：D1 `DB`（业务事实）、私有 R2 `MEDIA`（原件和缩略图）、DO `BOT`（微信状态/媒体任务）；前向迁移放在 `migrations/`。
- AI：默认 Workers AI，OpenRouter 为可选模型提供方；模型只选择白名单工具，**不能直连 SQL、获得 R2/认证密钥或绕过执行器**。微信 Harness 见 [实施说明](docs/wechat-harness-implementation.md) 与 [测试计划](docs/wechat-harness-test-plan.md)。
- 旧 MyBaby 的 Vercel/Neon/R2 与本项目隔离；未经明确授权不得读取、清理、迁移或覆盖其数据，详见 [迁移计划](docs/MIGRATION.md)。

## 修改前检查

检查最新 `main`、开放 PR、当前分支和工作区。已有相关 PR 时优先增量修改；遇到冲突保留双方有效功能、迁移和测试，不强推或直接整侧覆盖。不要用大规模格式化掩盖业务 diff，也不要为文档任务触碰生产 Cloudflare。

| 工作 | 事实来源 |
| --- | --- |
| UI / 响应式 | [设计系统](docs/design-system.md)、`src/styles.css`、`src/editorial.css` |
| API / 数据库 | `src/worker.ts`、`src/types.ts`、`migrations/` |
| 相册/媒体 | `src/features/album/Album.tsx`、`src/media-upload.ts`、[上传性能](docs/media-upload-performance.md) |
| 微信 Harness、媒体队列、轮询 | `src/wechat*.ts` 及兼容入口、[Harness 实施](docs/wechat-harness-implementation.md)、[iLink ADR](docs/wechat-transport-architecture.md) |
| 部署 | [Agent 部署边界](docs/agent-deploy.md)、[GitHub Actions](docs/github-action-deploy.md) |
| 测试 | [QA 矩阵](docs/qa-regression-matrix.md)、[Harness 测试](docs/wechat-harness-test-plan.md) |

## 不可突破的安全和一致性约束

1. **认证和隔离**：私有 API 必须授权；写请求维持同源/Origin 保护和参数校验。所有宝宝操作使用服务端决定的 `babyId`、记录所有权和唯一目标，不因模型自然语言猜测跨宝宝写入。
2. **D1/R2**：只增加前向迁移，禁止为修复冲突删除、重建、清空生产 D1/R2。原件始终留在私有 R2、经受保护的 Worker 读取；不可开放存储桶或发布持久匿名媒体 URL。上传、R2 最终提交、D1 回执和恢复必须有重试/幂等边界。
3. **微信工具**：ReAct 决策在执行前持久保存；工具调用只允许白名单，保留成员、宝宝和消息代次校验。更新/删除必须指向明确且唯一的记录；拒绝未经确认的批量/越权写入。模型理解对话，服务端验证日期、数值、ID、权限与操作成功事实，不可以提示词代替业务校验。
4. **微信媒体**：仅可信 CDN 与 AES 加密引用；单项 50 MiB，单消息最多 4 项；大视频按有界内存和 R2 分片处理，任务先持久化再确认接收，暂停和重绑不得泄漏旧上下文。照片 EXIF 按受限 R2 范围读取；绝不通过公开链接存放原图。
5. **离线**：按宝宝隔离草稿/队列；IndexedDB 持久化、联网时稳定 ID 重试；版本冲突不静默覆盖。Service Worker 仅缓存公共外壳及当前已授权设备的私有媒体；登出清除缓存，不缓存凭据。
6. **Secrets 和隐私**：绝不请求、展示、复制或轮换真实 `SESSION_SECRET`、`DATA_KEY`、模型 Key、微信 Token、Cookie、真实家庭照片或聊天。测试与公开 Demo 只用虚构数据；日志不记录媒体 URL、加密参数和用户标识。
7. **生产授权**：`main` 全部 CI 通过后的自动部署是既有流程；其他远端 provision、迁移、部署和 Secret 变更均须部署者明确授权，按 [Agent Runbook](docs/agent-deploy.md) 操作。**`npm run deploy` 会修改远端资源，绝不能用于检查。**

## 质量与交付

Node.js 22+，使用 npm：

```bash
npm install --no-audit --no-fund
npm run check
npm run test:unit
npm run build
npm run test:e2e
```

`npm run verify` 汇总类型、单测和构建。修改 UI 时验证 320/375/390/768px、键盘与触控最小 44px、可见焦点、错误与加载反馈、`prefers-reduced-motion`；不要虚构真实 iPhone Safari 验收。涉及 API、媒体、微信或数据库时补有界、失败、幂等和多宝宝场景；不要删除失败测试、关闭类型门禁或弱化认证来取得绿色 CI。手动收费模型/真实微信用例不得进入普通自动 CI。

文档维护须同步修复引用和失效步骤，以 `scripts/docs-quality.test.mjs` 为链接检查入口。权威架构、测试与部署文档由 [README 文档导航](README.md) 统一索引；尽量不在 AGENTS 复制运行手册。

提交与回复须区分 **代码已改、PR 已创建、CI 通过、main 已合并、云端已部署、真实设备已验收**，未验证必须明确说明。
