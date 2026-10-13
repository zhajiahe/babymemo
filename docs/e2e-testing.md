# BabyMemo 本地与 CI 端到端测试

本文件提供**复现命令**。每个风险场景的覆盖状态及人工验收边界统一维护在 [QA 回归测试矩阵](qa-regression-matrix.md)，不要在两个文件中维护互相冲突的检查清单。

## 环境

使用 Node.js 22+ 和本地 `wrangler`。脚本 `scripts/e2e-local.mjs` 会在系统临时目录创建隔离的 D1/R2/DO 数据，并生成临时 `.dev.vars`；结束后清理。不会调用远端 Cloudflare，也不使用生产家庭数据。

**如果项目目录已经有 `.dev.vars`，脚本将直接退出以避免覆盖已有密钥。** 本地测试优先在干净的工作区运行。

## 执行

```bash
npm install --no-audit --no-fund
npm run verify
npm run test:e2e
```

浏览器测试在安装相应 Playwright 依赖后运行：

```bash
BROWSER_E2E=1 npm run test:e2e
BROWSER_E2E=1 BROWSER_ENGINE=webkit npm run test:e2e
```

`E2E_DEPLOY_KEY=1 npm run test:e2e` 会启用只供隔离环境测试的假 `OPENROUTER_API_KEY`，验证配置优先级、隐藏凭据及网页不可覆盖的行为，不会请求真实 OpenRouter。

GitHub Actions 工作流 `.github/workflows/ci.yml` 执行四组检查：类型/单元测试与构建、本地 Worker HTTP E2E、Chromium、Linux WebKit（模拟网络故障）。截图存入 GitHub Actions Artifact，使用合成数据。

## 判读结果

- `PASS` 表示对应自动化断言在**当前测试环境**通过，不代表真实微信 API、物理 iPhone、生产流量或 Cloudflare 地域网络已完成验收。
- Linux WebKit 和 Chromium 移动视口不是 iOS Safari 真机；HEIC/HEVC、PWA 后台挂起、弱网续传及软键盘仍需真机检查。
- 生产数据备份需要独立验证一致性和恢复演练。离线备份校验测试只检查测试包完整性，并不下载或恢复家庭真实文件。
- OpenRouter 模型和 iLink 微信需要受控真实账号的单独测试，CI 不应访问用户的真实密钥。
