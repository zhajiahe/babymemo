# BabyMemo 工程规范

本文件是**日常代码质量约束**。生产权限、隐私红线以及 Agent 的工作方式详见 [AGENTS.md](AGENTS.md)；设计规范详见 [docs/design-system.md](docs/design-system.md)，部署步骤详见 [docs/github-action-deploy.md](docs/github-action-deploy.md)。不在本文件复制部署命令或凭据。

## 目录职责

| 路径 | 责任 | 原则 |
| --- | --- | --- |
| `src/App.tsx` | 入口、视图选择、跨页面数据状态 | 不新增大型业务逻辑；按宝宝 `id` 隔离局部组件状态 |
| `src/features/` | 成长、相册、设置 | 处理 UI 交互、加载、重试和错误反馈 |
| `src/worker.ts` | Hono HTTP API / Cloudflare bindings | 认证、权限、数据库参数化访问；不得返回密钥明文 |
| `src/auth.ts`、`src/crypto.ts` | 会话签名、凭据加密和读取 | 不在客户端、日志中传播 Secret |
| `src/wechat*.mjs`、`src/wechat.ts` | 受限工具、媒体处理、微信会话 | 模型选择与实际写入分离；去重和宝宝目标校验 |
| `migrations/` | D1 结构演进 | 新增前向迁移；不可改写已发布迁移的含义 |
| `scripts/` | 测试、部署与离线维护 | 明确区分只读、干跑和真实远端操作 |

## 代码约定

1. **状态范围最小化**：以 `baby.id` 分隔草稿、相册预览和设置表单；异步返回要检查请求对应的宝宝与视图。用户切换宝宝后不能显示上一个宝宝的待保存表单。
2. **明确失败语义**：网络请求必须捕获异常并反馈。用户操作失败时不能静默声称成功；写入类操作只能在确认服务器成功后清除草稿或跳转。避免未处理 Promise。
3. **类型与输入验证**：TypeScript 尽量使用具体返回类型，API 入口校验对象、日期、MIME、数值边界；D1 全部使用参数化 SQL。不要让模型输出直接变成未验证的写入参数。
4. **资源与幂等性**：异步任务取消时清理计时器、对象 URL 和上传句柄；R2 multipart 创建失败或 D1 提交中断要可重试或显式回收。微信和网页双入口都需有重复提交测试。
5. **性能**：照片网格优先私有缩略图和懒加载；视频仅在主动预览时读取；列表有界分页；避免为一次切换触发全部 D1 查询或在内存中全量载入大视频。
6. **视觉与可访问性**：正文不小于设计规范的最低字号，触控目标至少 44 × 44 CSS px；在 320、375、390、768px 测试，支持 reduced motion、键盘和正确的 loading/empty/error 状态。
7. **审查粒度**：功能与其测试一起修改；无关格式变更不应覆盖安全相关的 diff。一次 PR 的描述必须列出变更、风险、CI 结果和真机验收缺口。

## 提交门槛

```bash
npm run check
npm run test:unit
npm run build
npm run test:e2e
```

推送后等待 GitHub Actions 的本地 Worker、Chromium 和 WebKit 全绿，再考虑合并到 `main`。检查代码和文档时不能停用失败的用例来获得绿色结果。

`scripts/docs-quality.test.mjs` 在单元测试中检查 README、AGENTS 和 docs 下 Markdown 的仓库内相对链接。目录改名、文件移动或新增文档链接时必须同时更新链接。

## 文档信息架构

- `README.md`：产品能力与主要入口，避免把每个变更日志追加为新章节。
- `docs/DEPLOY.md`：自托管管理员的首次安装与升级概览。
- `docs/github-action-deploy.md`：GitHub Actions Secrets、配置和故障排查的权威操作源。
- `docs/agent-deploy.md`：Agent 生产权限与分步操作。
- `docs/e2e-testing.md`：开发者如何重现自动化；[QA 回归矩阵](docs/qa-regression-matrix.md)记录具体风险覆盖。
- `docs/BACKUP.md` 与 `docs/MIGRATION.md`：维护者的数据安全边界。
- `docs/qa-e2e-report-2026-10-12.md`：历史报告，仅作当日证据，不作为当前功能清单。

修复旧文档时必须**删去已失效的操作步骤**，而不是在文末追加一段与旧内容相矛盾的新说明。
