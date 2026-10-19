# APAC shadow migration

This operation prepares **separate, private Cloudflare resources**. It does not switch the production DB/R2 bindings.

- Source D1: `babymemo` (ENAM); destination D1: `babymemo-apac` (APAC).
- Source R2: `babymemo-media` (ENAM); destination R2: `babymemo-media-apac` (APAC).
- The new D1 schema and its 23 non-internal tables were copied and all 1,004 source rows compared field by field on 2026-10-19. Writes continuing in production will create drift; this is a **snapshot**, not an always-current replica.
- R2 transfer runs in an isolated Cloudflare Worker, activated only by a one-time, private GitHub Actions release. It streams original bytes directly between private buckets; CI sees only counts. R2 reads/writes remain inside the Cloudflare account.
- The workflow on a successful main CI run matching `[apac-shadow-copy]` creates a short-lived secret, deploys the isolated Worker, copies media, verifies sizes, MIME/cache metadata, comparable checksums and leading/trailing byte samples, then disables the Worker subdomain.
- The copy progress is stored in the shadow D1 `apac_media_copy_progress` table. It is rerunnable; no source objects are deleted.
- **No automatic production cutover.** Before cutover: measure from actual mainland China networks, preserve an independent D1 and R2 backup, halt mutating traffic (including WeChat intake and report writes), perform an exact incremental sync with all rows/objects/relationships verified, swap both bindings atomically via the deployment pipeline, smoke-test, and preserve ENAM rollback copies.
- Disable the temporary Worker public subdomain even on failure and never log request headers, R2 keys, photos, or family information.
