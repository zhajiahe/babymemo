# Cloudflare 国内访问加速（可选）

Cloudflare Workers 默认采用 Anycast。不同运营商可能被路由到距离较远的边缘节点。部分社区会尝试 **Cloudflare 优选 IP + DNS only + Workers Route**；这不是 Cloudflare 官方承诺支持的稳定部署方式，也不保证长期提速。

本文仅提供自托管实例可复用的操作原则，**不收录任何真实家庭实例的域名、IP、资源 ID、测试日志或部署配置**。

## 适用条件

先使用正常的 Workers Custom Domain。确有跨境访问性能问题，再在**独立、使用合成数据的测试环境**验证优选方案。候选 IP 必须来自 [Cloudflare 官方 IP 地址段](https://www.cloudflare.com/ips-v4)，不能使用不可信的第三方反向代理接触家庭照片或登录 Cookie。

在同一客户端网络、不同时段、不同运营商进行对照：API 延迟、适当大小的合成媒体下载、视频 HTTP Range（`206` 与 `Content-Range`）、请求失败率，以及尾部延迟。观察 `/cdn-cgi/trace` 的 `colo` 字段即可，不需要保存或分享其 `ip` 字段。地理标记不等于实际网络延迟；固定 IP 也不会固定机房。

## 仅供测试的配置结构

```text
您的测试子域名（不是正式家庭域名）
  DNS only A → 从 Cloudflare 官方网段筛选并验证的候选 IP
  Worker Route → 单独的、仅提供合成数据的测试 Worker

您的正式家庭域名
  → 保持当前稳定的 Workers Custom Domain
```

先确认候选入口能完成 TLS 握手、Worker 调用、静态资源访问，并且在多次测试中明显优于基准。**绝不以公开生产数据或密码进行测速。** 使用独立测试数据验证 Cookie、安全头、跨站 Origin 拦截、上传、私有媒体权限与视频分段读取。微信回调使用模拟消息和测试凭据，勿连接真实微信账号。

## 生产切换和回滚原则

如管理员明确选择实验性生产入口，需先保存原 DNS、Workers Route、Custom Domain、证书与 Worker 绑定配置，再进行切换。**不要同时绑定冲突的 Custom Domain 和同名 Worker Route。** 切换后立刻检查 TLS、首页资源、`GET /api/health`、未登录私有 API 的 `401` 响应、跨站请求拦截以及经授权的正常功能。

出现异常时，停止优选实验，仅撤销该正式域名的 DNS-only A 及对应 Worker Route，重新为**原 Worker**绑定原 Custom Domain；随后验证 HTTPS 和所有核心流程。**D1、R2、Durable Objects、微信连接、Secrets 都不是入口加速或回滚时应修改的对象。**

此方法适合能够接受额外维护与潜在中断风险的自托管管理员；一般部署继续使用官方的 [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) 和 [Workers Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)。
