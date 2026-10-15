# BabyMemo · Coding Agent 约束

适用 Codex / Pi / Claude Code 等代理。开始前检查最新 `main`、开放 PR、分支与工作区；先读 [README](README.md) 和 [工程规范](ENGINEERING.md)。**只报告实际完成的代码、测试、合并与部署状态。**

## 不可突破的边界

1. **私密家庭产品**：单管理员、多宝宝；不引入公开注册、独立网页 AI 聊天、医疗诊断或不必要的新基础设施。
2. **授权隔离**：Worker API 必须校验登录、同源、记录所有权和宝宝归属。模型只能选择白名单工具，不能操作 SQL、存储密钥或绕过写入校验。具体微信机制见 [Harness](docs/wechat-harness-implementation.md)。
3. **数据安全**：D1 只允许前向迁移；不得删除、重建或清空生产 D1/R2。原图保存在私有 R2，上传与写入必须可安全重试、精确恢复。
4. **微信一致性**：按连接/宝宝隔离，先持久化可重放的决策再执行工具；修改/删除必须唯一指向有效记录，拒绝越权或含糊的破坏性操作。媒体来源受限；重绑不能执行旧上下文。
5. **离线同步**：离线队列、草稿与缓存按宝宝隔离；服务端版本冲突不得被悄悄覆盖，登出清理私有本机数据。
6. **隐私与密钥**：不得索取或回显真实家庭资料、照片、微信 Token、Cookie、`SESSION_SECRET`、`DATA_KEY` 或模型 Key。测试、公开 Demo 和 CI 仅用虚构数据。
7. **生产权限**：`main` 全部 CI 成功后的自动部署是既有授权流程；除此之外的云端创建、迁移、发布、恢复、Secret 更改都要单独获授权。[Agent Runbook](docs/agent-deploy.md) 是操作入口。**`npm run deploy` 不是检查命令。** 旧 MyBaby 资源一律不触碰，详见 [迁移计划](docs/MIGRATION.md)。

## 交付门槛

执行 `npm run verify` 和相关 `npm run test:e2e`；修改 UI 时覆盖常见手机视口、44px 触控目标和可见状态；修改消息/媒体/数据库时补多宝宝、失败与幂等用例。禁止为绿灯删测试、弱化校验。真实收费模型、真实微信和生产数据演练仅手动进行。

部署、测试、设计分别以 [Actions](docs/github-action-deploy.md)、[QA](docs/qa-regression-matrix.md)、[设计规范](docs/design-system.md) 为准；不要把当日测试记录追加到本文件。
