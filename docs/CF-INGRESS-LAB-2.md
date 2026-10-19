# Cloudflare ingress lab · round 2

This is an **isolated experiment**. It does not alter `baby.20250530.space`, the production Worker, D1/R2 bindings, authentication or WeChat callbacks.

## Background

The mobile user reported `colo=AMS` / `LHR` on the default route. A first-round DNS-only Cloudflare IP plus Worker Route experiment showed B (`188.114.96.3`) working via AMS/LHR, C via FRA, A responding HTTP 403. Neither B nor C showed a convincing media performance improvement.

## Second-round candidates

As of 2026-10-19, `LancelotRar/best-cf-ips` scanned shortlist marks the first three as Singapore (SG), fourth as Japan (JP), and last two as US. **These tags are untrusted hints only; the real edge `colo` must be measured from the target user's network**.

| Test host | Fixed IPv4 | Community label |
| --- | --- | --- |
| bm-lab-s1.20250530.space | 104.18.36.27 | SG |
| bm-lab-s2.20250530.space | 104.18.41.37 | SG |
| bm-lab-s3.20250530.space | 172.64.156.80 | SG |
| bm-lab-j1.20250530.space | 172.64.229.191 | JP |
| bm-lab-u1.20250530.space | 104.19.228.197 | US |
| bm-lab-u2.20250530.space | 104.16.166.147 | US |

All six addresses were checked against https://www.cloudflare.com/ips-v4; **this only establishes ownership of the address block**, not suitability or absence of 403 errors.

A separate Worker `babymemo-ip-lab` is bound to ENAM and APAC D1/R2, but it exposes only synthetic `SELECT 1` and a 31-byte test object. There are no personal-data or authentication endpoints. A custom domain `bm-ip-lab.20250530.space` serves a phone-optimized dashboard; the gray-cloud fixed-IP DNS-only Worker Routes expose the same `/probe` code, with narrow CORS to the dashboard origin. Existing `bm-opt-b` remains available as a previous-round reference.

## Validation and selection

- Public GitHub Actions runner checks DNS, HTTPS, Worker dispatch, CORS and `/cdn-cgi/trace`; it is **not** a Chinese carrier latency test.
- Phone test: use China mainland cellular network without VPN/proxy, visit https://bm-ip-lab.20250530.space/ and press the run button. The page alternates the order of hosts over three rounds and compares medians and failures. It does not submit results to our servers; the user can copy them.
- Compare ENAM client D1/R2 time and failure rates against **the dashboard's baseline**, in the same run and on the same network. Consider candidates only if median improvement exceeds 15%, all samples work, and at least two sessions/time periods reproduce the result.
- Still require an independent real-size image/video benchmark, TLS/SNI/WeChat callback/login/private media correctness, HTTP/3 behaviour and rollback drill before touching production.
- Community fixed Cloudflare IP methods may breach Cloudflare terms / routing policies or stop working; do not auto-sync a production DNS record or distribute proprietary data over third-party IPs.

## Cleanup

Delete only the six `bm-lab-*` DNS records and routes, the `bm-ip-lab` custom domain, and `babymemo-ip-lab` Worker. Preserve the actual BabyMemo production resources. No background jobs, cron or Secrets are installed.

Sources: https://github.com/LancelotRar/best-cf-ips/blob/main/best-cf-ip-scanned-top50.txt, https://www.cloudflare.com/ips-v4, https://developers.cloudflare.com/workers/configuration/routing/routes/

## Synthetic media test
Each run also transfers a dedicated 262,144-byte ASCII test object from the ENAM R2 bucket and verifies the exact returned length; it is not a family video/photo. The benchmark weights client media time twice as heavily as the D1 and small-R2 operations when highlighting a candidate. Server-side backend time is available only as a diagnostic, never substitutes for client time. The previous round's B route now also uses the same isolated `babymemo-ip-lab` worker so that the benchmark has consistent scoped CORS. A later test will be required for multi-megabyte video Range reads and upload performance.

## Fourth-round photo-size and video Range experiment

The user reported third-round China cellular results (2026-10-19):
baseline LHR D1 477ms / R2 498ms / 256KB 1533ms / media P90 1859ms (0/18 failed);
JP-1 NRT D1 312ms / R2 340ms / 256KB 555ms / media P90 623ms (0/18);
SG-2 SIN D1 544ms / R2 592ms / 256KB 1014ms (0/18);
US-1 LAX media 2002ms (0/18), a deterioration from earlier 904ms.

**JP-1 leads on median and tail latency in the third round**, but one JP request failed in the second round (combined 1/27). No production change until replicated and full-size video and photo delivery compatibility is proven.

Page https://bm-ip-lab.20250530.space/?media=1 tests baseline, JP-1, and SG-2 only. Four passes of 2MiB full GET and 256KiB byte-range GET with Range request header (24 requests, ~27MiB traffic), reporting full transfer median, P90, Range median, failure count and colo. The file is deterministic synthetic data under R2 `__benchmark__/photo-2m-v1.bin`, not a family file. Reads have no-store and per-request unique query parameters. Only ENAM production-region R2 is queried; APAC remains a separate candidate not cut over. No family login/cookie or private media endpoint is exposed.

Range: the server must return 206, exactly 262,144 bytes, and `Content-Range: bytes 0-262143/2097152`. CORS is narrowly limited to the `bm-ip-lab` origin; OPTIONS preflight allows GET with Range. A simulated 2MiB payload is not a complete video-seeking or playback proof; later test actual codec and multirange support on isolated authorized application preview resources.

Decision criteria: repeated independent times (evening + different time) on the same carrier with zero or negligible failures, meaningful media p90 advantage, and login/WeChat/HTTP3/upload/Range preview verification. Do not repoint the production domain before these checks.
