# Cloudflare domestic ingress IP experiment (2026-10-19)

This is **not a production cutover**. User-reported China 4G access to the existing BabyMemo domain used `colo=AMS`. On that path, ENAM was faster than APAC on a synthetic D1/R2 benchmark. An alternative entry IP may change the Cloudflare ingress network path, but has not been shown to improve latency.

## Independent probe hostnames

| Host | Cloudflare official range candidate | Proxy |
| --- | --- | --- |
| bm-speed.20250530.space | ordinary Workers Custom Domain baseline | proxied |
| bm-opt-ctl.20250530.space | Worker Route with AAAA 100:: placeholder | proxied |
| bm-opt-a.20250530.space | 104.16.132.229 | DNS only |
| bm-opt-b.20250530.space | 188.114.96.3 | DNS only |
| bm-opt-c.20250530.space | 162.159.140.3 | DNS only |

All `bm-opt-*` routes call existing `babymemo-region-probe` Worker serving **only synthetic benchmark endpoints**. No BabyMemo login, photos, private APIs, account records or production hostnames are exposed through these routes.

These three fixed IPv4 addresses are drawn from Cloudflare's published IP ranges at https://www.cloudflare.com/ips-v4. They are **candidates**, not verified optimal addresses. There is no operator-specific routing or IP auto-update.

## Test method

1. CI checks DNS and public HTTPS/TLS for each candidate and requests `/probe/d1/enam`, `/probe/d1/apac`, and `/cdn-cgi/trace`; it does not request personal data.
2. On a China mainland **4G/5G** network, turn off VPN/proxies/private relay and open `https://bm-opt-a.20250530.space/cdn-cgi/trace`, then b and c. Record **only** `colo` and `http` (do not share `ip`).
3. If HTTPS works, run the synthetic `/` benchmark on each and report latency, fails, and colo. Compare against `https://bm-speed.20250530.space/`.
4. Repeat on Wi-Fi and, when practical, from China Telecom, Unicom, and Mobile and different times of day. Reject unreliable candidates rather than optimising a single fortunate sample.
5. Evaluate the full production HTTP flows only in isolated test resources: cookies, upload, Range requests, WeChat webhooks and API behaviour. None are safe to test on a public synthetic route.

**Important support caveat:** Cloudflare officially documents Workers Routes on proxied (orange cloud) records. DNS-only fixed Cloudflare IP plus Route is a community technique and may fail or change behaviour without notice. HTTPS certificate validation and data-plane Worker dispatch must be tested; DNS resolution alone is not success.

**Rollback:** Delete the three `bm-opt-{a,b,c}` and `bm-opt-ctl` Workers Routes and DNS records. No production routes, DNS records or storage bindings are changed.

## References
- https://developers.cloudflare.com/workers/configuration/routing/routes/
- https://www.cloudflare.com/ips-v4
- https://github.com/XIU2/CloudflareSpeedTest
