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

`npm run verify` = 类型检查 + Node 单测 + 构建；`npm run test:e2e` = 隔离本地 Worker/D1/R2；浏览器及 Linux WebKit 在 [Check BabyMemo](https://github.com/zhajiahe/babymemo/actions/workflows/ci.yml) 中执行。真实 iPhone、iLink、云端恢复仍需人工验收；CI 的 OpenRouter 30 题为合成任务与模拟工具响应，不代表真实微信/生产数据路径验收。

**面向使用者**的说明只写现在能操作和观察到的功能。**面向维护者**的说明只保留仍然生效的部署、架构、安全与验证入口。不维护已移除功能、过期方案、实验经过或测试成绩的现行文档；需要追溯时使用 Git 历史、PR 和 Actions。README 只展示用户入口与必要的维护者链接。删除文档时修复全部引用，并运行 `node --test scripts/docs-quality.test.mjs`。

目标为 `main` 的仓库所有者 PR 自动执行 30 题 OpenRouter 合成数据基准测试（`Harness OpenRouter / 30 Cases`），使用独立 `harness-benchmark` 环境的低额度专用 Key；30 题完整执行、安全关键错误为零、通过率至少 80%，账单和逐题轨迹留 Actions Artifact。其余真实模型、微信或生产数据测试保持手动。合并限制必须通过 GitHub Rulesets 将此状态检查设置为 Required。
