# BabyMemo 工程规范

本文件只记录代码协作规则。安全红线见 [AGENTS.md](AGENTS.md)，设计见 [设计规范](docs/design-system.md)，生产操作见 [部署指南](docs/github-action-deploy.md)。

## 代码位置

| 路径 | 职责 |
| --- | --- |
| `src/App.tsx`、`src/features/` | 视图及交互；草稿、异步响应按 babyId 隔离 |
| `src/worker.ts`、`src/auth.ts`、`src/crypto.ts` | API、授权、签名及加密 |
| `src/wechat*.ts` / `src/wechat*.mjs` | 微信收发、工具、记忆、媒体与 ReAct |
| `migrations/` | 只能增加前向兼容 D1 迁移 |
| `scripts/` | 测试、显式云端运维与故障恢复 |

## 修改原则

- 每次写入先验证权限、输入、宝宝范围与唯一目标；模型输出永远不是数据库授权。
- 异步提交须有错误反馈、冲突提示与稳定幂等键；失败不报成功，不丢草稿。
- 媒体采用私有缩略图、懒加载、有界并发与续传；不在内存一次加载全部视频。
- UI 保持键盘操作、焦点、reduced motion、移动 safe area 和 loading/empty/error 状态。
- 功能与测试同 PR；避免跨模块重格式化，不能为通过 CI 禁用用例。

## 验证与记录

`npm run verify` = 类型检查 + Node 单测 + 构建；`npm run test:e2e` = 隔离本地 Worker/D1/R2；浏览器及 Linux WebKit 在 [Check BabyMemo](https://github.com/zhajiahe/babymemo/actions/workflows/ci.yml) 中执行。真实 iPhone、iLink、收费模型、云端恢复需另行人工验收，不能从绿色 CI 推断通过。

文档只保留**当前规则、步骤、边界与索引**。历史测试结果链接 Actions / PR，不复刻表格或按日期追加更新记录。README 是唯一文档目录；修改、合并或删除文档时同步修复引用，并运行 `node --test scripts/docs-quality.test.mjs`。

外部模型现场测试仅能手动触发，必须使用合成数据、明确确认及独立密钥，绝不加入普通 PR/`main` 自动 CI。
