# Cloudflare 国内访问加速（可选）

BabyMemo 默认通过 Cloudflare Workers 自定义域名接入。中国大陆不同运营商可能被 Anycast 分配到较远节点；**入口 IP 优选**可以改善某条线路的访问体验，但不保证固定进入东京或持续更快。大部分自托管用户无需启用。

> 本项目目前在 `baby.20250530.space` 采用社区实验性方案：Cloudflare 官方 IPv4 地址 + 灰云 DNS + Workers Route。这不是 Cloudflare 正式保证的标准接入方式。任何改动前先测试、备份当前 DNS / Route / Custom Domain 配置并备好回滚。

## 当前生产配置

| 项目 | 配置 |
| --- | --- |
| 访问域名 | `baby.20250530.space` |
| Cloudflare DNS | 灰云（DNS only）`A 172.64.229.191`，TTL 120 秒 |
| Worker Route | `baby.20250530.space/*` → 原 `babymemo` Worker |
| 预发布检查入口 | `bm-jp-canary.20250530.space`（同 IP，同 Worker；非独立数据环境） |
| 存储与微信 | 保持原 ENAM D1 `babymemo`、R2 `babymemo-media`、DO / 微信连接及 Worker Secrets |
| 证书 | Cloudflare 现有 Universal SSL 泛域名证书，变更后必须单独检查有效性 |

**只是网络入口切换**，不是应用、数据、照片或微信服务迁移。当前 Worker 仍保留相同身份验证和私有 R2 权限；不要在测试入口披露登录凭据。

## 验证是否值得优选

1. 在目标中国大陆运营商的手机网络上，打开正式域名的 `/cdn-cgi/trace`，记录 `colo`、`http`；无需分享 `ip`。Cloudflare 节点不是物理位置，`colo` 也可能因线路、时间变化。
2. **先新建隔离测试子域名**并绑定只读合成测速 Worker；候选 IP 必须属于 [Cloudflare 官方 IP 段](https://www.cloudflare.com/ips-v4)。不要直接使用第三方反代 IP 处理家庭媒体。
3. 将原入口与候选入口在相同网络、不同时段对照：API 端到端延迟、2 MiB 合成媒体完整下载、HTTP Range（206 / `Content-Range`）、失败率与尾部延迟。少量样本的 P90 往往只是最大值，不能视为长期稳定性证明。
4. 仅当媒体、API、错误率长期优于原入口，并且 HTTPS、登录 Cookie、上传与续传、私有媒体、视频拖动播放及微信行为验证通过，才考虑切换正式域名。

历史实验及自动化校验见 [PR #113](https://github.com/zhajiahe/babymemo/pull/113) 和 [入口迁移 PR #114](https://github.com/zhajiahe/babymemo/pull/114)。其中 JP-1 候选曾在单条大陆移动网络上明显快于原入口，但也出现过超时；**优选效果不适用于所有用户或时段**。

## 正式入口运维

当前正式域名已经由 Workers **Custom Domain** 改成 **DNS-only A + Worker Route**，不是两种配置并存。更新 Worker 代码仍使用正常的 GitHub Actions / Wrangler 发布流程，不应重建 D1 / R2，也不应覆盖当前 DNS / Route；升级后必须重新检查路由。

上线或变更后的最小检查：

- `baby.20250530.space` 的 A 记录仍是 `172.64.229.191`、DNS only，且 `baby.20250530.space/*` 仍指向 `babymemo`。
- 生产 HTTPS 证书有效；`GET /api/health` 为 200；主页 JS/CSS 可加载。
- **未登录** `GET /api/state` / `GET /api/media` 返回 401；跨站 Origin 请求被拒绝。不要为了加速关闭鉴权、CORS 或 CSRF。
- 真机确认登录、照片浏览、视频 Range、上传与微信连接正常。海外 CI 无法证明大陆运营商的实际网速。
- 现有只读公网检查脚本：`node scripts/check-jp-ingress-canary.mjs`（针对本项目生产域名，勿在其他家庭实例照搬）；[GitHub Actions 执行记录](https://github.com/zhajiahe/babymemo/actions/runs/39337057309)。

## 故障回滚（恢复 Cloudflare 默认入口）

出现大量 403、证书问题、连接超时、微信/媒体功能异常，或者自动部署导致路由消失时，**只恢复入口配置**：

1. 在 Cloudflare 控制台核对账号与 `20250530.space` Zone，保留 `babymemo` Worker、Secrets、DO、D1、R2、微信配置。
2. 删除 `baby.20250530.space/*` 的 **Worker Route**（不要误删 `bm-jp-canary` 路由）。
3. 删除 `baby.20250530.space` 的灰云 `A 172.64.229.191`（不要删除其他域名的 DNS）。
4. 重新给现有 `babymemo` Worker 绑定 **Custom Domain `baby.20250530.space`**，由 Cloudflare 自动恢复橙云占位 DNS（此前为 `AAAA 100::`）和证书路由。
5. 检查 `/api/health`、未登录 401、正式 HTTPS 首页；在大陆手机网络下验证登录和媒体。DNS 缓存可能需要等待 TTL 刷新。

切勿将 D1/R2 迁移或重建当成网络加速回滚手段。Cloudflare 官方标准路线参考：[Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) 与 [Workers Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)。
