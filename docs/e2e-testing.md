# 隔离环境端到端测试

`npm run test:e2e` 启动一次性的本地 Wrangler Worker（Cloudflare D1/R2/DO 模拟），使用随机生成的测试密钥和临时数据库，不调用远端 Cloudflare 账号、不读取线上家人数据、不部署代码。

在 GitHub Actions 的 **Local Worker E2E** job 中依次执行 `npm install`、`npm run build` 和 `npm run test:e2e`。测试真实的 HTTP 路由与 Worker/R2/D1 交互，覆盖：首次初始化、登录/登出、同源限制、成长记录/里程碑 CRUD、OpenRouter Key 的服务端保存（不外发）、媒体分片、续传状态、原图与 Range、缩略图回退/派生上传、媒体编辑/下载/删除及中止上传。

无法替代的项目仍需另外验收：真实 iPhone Safari/Android 浏览器上传与滚动、大文件和弱网真实性能、Cloudflare 线上 D1/R2 权限与资源限额、国内运营商网络、OpenRouter 外部调用、微信扫码与第三方轮询、实际 HEIC/HEVC 播放。**此脚本不应直接指向线上域名**。

本测试运行时在仓库目录暂时写入 `.dev.vars`（只含随机临时密钥，受 `.gitignore` 保护），退出即清理。请勿在拥有真实 `.dev.vars` 的本地开发目录直接运行，以免覆盖本地密钥；CI 使用全新工作目录。

## Chromium 浏览器验收（GitHub CI）

CI 另设 **Browser E2E (Chromium)**，安装固定版本的 Playwright Core，在 GitHub Runner 已安装的 Chrome Stable 中操作 React 真实页面，验证：桌面网页登录、图片上传/预览、文件信息编辑/删除、390px 移动视口导航、横向溢出；自动将桌面/移动截图上传为 `babymemo-e2e-screenshots` 工件。

这是 **Chromium 的移动视口模拟**，不能等同真实 iOS Safari。由于不连接生产数据，使用的是随机测试密钥和虚构的测试宝宝资料。API 链路测试仍可通过 `npm run test:e2e` 单独运行；只有设置 `BROWSER_E2E=1` 且安装 `playwright-core` 后才运行浏览器部分。


## PR #21 回归范围（待合并）

- 真实隔离 Worker E2E：软删除与回收站恢复、按名称/收藏查询、成长历史 API、缩略图 ETag 与 304、家庭资料导出权限、修改密码后的会话撤销。
- Chromium 与 WebKit：移动端相册上传、改名、软删除、图片预览、已完成分片恢复；对 WebKit 注入分片请求失败和模拟弱网。
- 静态测试随着组件拆分迁至 `src/features` 路径；`scripts/media-date.test.mjs` 检查 JPEG EXIF 读取。
- **仍缺**：实体 iPhone Safari、真实 HEIC/MOV 解码、微信授权稳定性、真实 Cloudflare D1+R2 备份恢复演练，以及长期弱网/大流量压力测试。


### 微信工具 Harness 单元测试

`scripts/wechat-harness.test.mjs` 使用模拟 D1 校验工具注册、宝宝 ID 限定、查询结果包含记录编号、日期合法性、目标唯一性，以及缺少用户明确删除/修改意图时不执行数据库变更。真实 iLink + OpenRouter 仍须真号验收。
