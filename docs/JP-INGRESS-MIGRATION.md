# BabyMemo JP-1 ingress migration — 2026-10-20

**Purpose:** change only China mainland access ingress toward tested JP-1 Cloudflare IPv4 **172.64.229.191**. This is NOT a D1/R2 migration. The production URL, family database and media buckets MUST remain unchanged until safe cutover. Cloudflare's official Workers Routes documentation calls for proxied DNS; the DNS-only route is an experimental community technique, not a guaranteed Cloudflare contract.

## Tested synthetic network evidence

- Fourth round, same mainland mobile connection: auto ingress AMS 2MiB median 1802ms, Range256KiB median 1644ms, 0/8 failure.
- JP-1 NRT: 2MiB median 751ms, Range256KiB median 412ms, 0/8 failure. The reported 2MiB "P90" 2124ms is the largest of only four samples.
- SG-2 SIN: 2MiB median 5527ms, Range256KiB 1079ms, 0/8 failure.
- On prior rounds JP-1 had one 7.5s timeout; do not infer reliable long-term operation from these small samples.

## Current canary — production stays on old hostname

DNS-only A record `bm-jp-canary.20250530.space -> 172.64.229.191`, TTL 120 seconds. Worker Route `bm-jp-canary.20250530.space/* -> babymemo`. The Worker has the SAME underlying production bindings; users still need authentication, and the canary must not be used to upload family media until verified.

No D1/R2/DO secrets were copied or changed. Only the new DNS record and zone-level route were created. Public CI checks the health endpoint, anonymous unauthorized access, origin-CSRF denial and static assets, without using a password or fetching private family data. The canary is **not a disposable data environment**: only safe unauthenticated probes are permitted here.

## Pre-cutover requirements

1. Pass public smoke, require same-owner manual iPhone Safari check for HTTPS/TLS, working UI, no redirects/mixed content and CF colo NRT from mainland mobile network.
2. Confirm login, sessions, logout and upload/Range behavior in a disposable environment — existing local E2E tests are not a substitute for JP ingress network behavior. Do not make synthetic writes to production.
3. Verify WeChat: bot callback / pairing / polling must remain attached to original Worker and domain as appropriate, with no second polling process or Durable Object instance. If only DNS+Route changes, preserve the single Worker service.
4. Prepare DNS/custom-domain switch carefully: Cloudflare Custom Domain currently manages `baby.20250530.space` with proxied AAAA `100::`. To change it to fixed DNS-only A, the managed Custom Domain might have to be removed first; validate APIs and certificate behavior. This carries real outage and rollback risk. Do NOT perform this until above checks pass.
5. Confirm new original-domain-route's browser cookies and authentication remain host-only, Cloudflare universal TLS certificate is presented and enabled in the zone, plus IPv6 behaviour. Check cellular access from at least two times of day.
6. Rollback: remove experimental Worker Route/DNS and restore the original Custom Domain if a cutover has happened; preserve former DNS configuration and always verify `/api/health` and `/api/state`.

## Explicit exclusions

No ENAM-to-APAC D1 or R2 migration, no real family data duplication, no main-domain switch, no WeChat account changes, no untrusted third-party reverse proxy, no automatic production DNS update.

## Production cutover record — 2026-10-20

The user confirmed that the JP-1 canary loaded quickly on their mainland phone. We then switched the **production domain only** to the fixed Cloudflare JP-1 IP. Application Worker, ENAM D1/R2, secrets, Durable Objects and WeChat workflows are unchanged.

### Cloudflare production state verified via API

- DNS: baby.20250530.space -> A 172.64.229.191, DNS-only, TTL 120.
- Worker Route: baby.20250530.space/* -> babymemo.
- The previous managed Custom Domain on baby.20250530.space was detached. Its original proxied placeholder was AAAA 100::.
- Production D1 id stays 1ab91d42-ce54-49aa-bfc9-3e38eb058a73; R2 bucket stays babymemo-media.
- Active Universal SSL certificate covers *.20250530.space.
- Independent JP-1 canary remains reachable for comparison and emergency fallback.

First attempt: Cloudflare rejected a DNS comment exceeding 100 characters (HTTP 400 / 9313); the orchestrator restored Custom Domain and removed the temporary Route successfully. Second attempt with a short comment completed and API verification passed.

### Post-switch external smoke

- GitHub Actions https://github.com/zhajiahe/babymemo/actions/runs/39337057309 : **21/21 passed**.
- Public production DNS resolves exactly to 172.64.229.191; HTTPS health 200; homepage 200; Javascript bundles 200.
- Anonymous private API requests return 401 and cross-site login POST returns 403; no production login or write was attempted.
- The CI runner is outside China and does not confirm client-side mainland latency; have the user check the permanent hostname on the same mobile network.

### Rollback if any client-side issue appears

1. Leave the production Worker, D1, R2 and WeChat settings untouched.
2. Delete only Worker Route baby.20250530.space/* (not the canary).
3. Delete only DNS-only A record on baby.20250530.space pointing at 172.64.229.191.
4. Reattach Custom Domain baby.20250530.space to Worker babymemo in zone 20250530.space, restoring managed proxied AAAA 100::.
5. Verify active TLS and 200 /api/health, 401 unauthenticated /api/state, then user Safari.

Important: fixed DNS-only Cloudflare IP plus Worker Route is a community technique, not a guaranteed official setup. Revalidate after any Worker deploy. Full authenticated Safari, album, video, upload, and WeChat checks remain for the owner; all automated tests are safe read-only.
