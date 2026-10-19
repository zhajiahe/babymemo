# Cloudflare APAC shadow evaluation

**Current production continues to use ENAM D1/R2. This branch does not change production bindings, domains, secrets or cron triggers.**

## Resources
- D1 `babymemo-apac` and R2 `babymemo-media-apac` are confirmed located in **APAC**.
- Initial snapshot: 23 application tables, 1,004 rows checked field by field, 24 indexes and 11 triggers copied. `_cf_KV` is an internal D1 table and is not included in the snapshot. The copied database is **not** an immediately usable primary; sessions/authentication and Durable Object state must be accounted for before any cutover.
- Initial R2 transfer: 522 objects (~994 MB) copied and verified. A second incremental pass is required when new photos or messages arrive. Counts/checksums can change while production remains writable.

## Implementation
- Migration runs through a dedicated **Cloudflare Queue** (`babymemo-apac-copy`), with an isolated consumer Worker. This avoids the account's Free-plan Cron Trigger ceiling (5/5).
- Queue messages are *only* `copy` or `verify`; no family data or object keys leave Cloudflare via the queue.
- Objects stream directly from the private ENAM R2 binding to a private APAC R2 binding. The source is never modified.
- The APAC D1 tables `apac_media_copy_progress` and `apac_copy_verification` store cursor and count progress. The copy can be restarted by resetting **only** its progress counters then enqueueing `{"task":"copy"}`, followed by `verify` automatically.
- Validation compares keys and sizes, MIME/cache/custom metadata, comparable stored checksums where present, or leading/trailing 8 KiB byte samples otherwise. **Do not describe the latter as a full-file checksum.**
- The worker has **no fetch handler** and `workers_dev` is disabled. The queue consumer is intentionally disabled/removed after completion when no further migration is planned.

## Before production migration
1. Collect actual China Mainland measurements using China Telecom/Unicom/Mobile on a public non-personal-health `/api/health` endpoint, comparing stable hourly latency percentiles and application media loads. No test may disclose a private photo, token, or family data.
2. Back up the live D1 and R2 using independently restorable snapshots. Do not treat the APAC shadow as the only backup.
3. Identify Durable Objects, D1 internal session state, scheduled tasks, family reports, active upload sessions and WeChat bot write paths. Establish a **maintenance write freeze**, not just a browser read-only mode.
4. Apply and verify final **D1 incremental changes**, including updates and deletions, and R2 object additions/updates/deletes; perform full-dataset audit during the freeze.
5. Test all authenticated flows, media Range streaming, WeChat intake, backups, background tasks, secret compatibility and rollback on a nonproduction app with shadow bindings.
6. Only then consider an atomic production binding change; preserve ENAM resources as rollback and watch mainland latency plus errors.

There is no evidence of actual mainland latency improvement yet. No automatic cutover or automatic production deployment is included in this PR.
