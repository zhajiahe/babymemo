# Documentation retention audit (2026-10-14)

This is a **retention review**, not proof of zero inbound references. The README, engineering guide, deployment documentation, and QA matrix were cross-checked; dynamic references, external links, issue links and human runbooks may not appear in repository searches. No document is deleted solely because it is unlinked.

| Document | Decision | Reason / next action |
|---|---|---|
| BACKUP.md | Keep | Backup, recovery, and data-loss safeguards |
| DEPLOY.md | Keep | Canonical onboarding and initialization |
| MEDIA_MAINTENANCE.md | Keep | Historical thumbnail restoration procedure |
| MIGRATION.md | Keep | Legacy migration information; label historical when validated |
| agent-deploy.md | Keep | Agent production access and operational guardrails |
| ai-model-benchmark-and-quotas.md | Keep | Reproducible AI selection and quotas |
| brand/README.md | Merge candidate | Brand option history; cross-check current assets before merge into design-system |
| design-system.md | Keep | UI design constraints |
| e2e-testing.md | Merge candidate | Overlaps QA matrix; check unique commands and CI contracts |
| github-action-deploy.md | Keep | Deployment secret, schema, and workflow guidance |
| media-upload-performance.md | Keep | Upload instrumentation and Safari regression context |
| qa-e2e-report-2026-10-12.md | Archive candidate | Dated evidence; preserve as history or release artifact |
| qa-regression-matrix.md | Keep | Current test coverage and blind spots |
| web-management-offline.md | Keep | Offline behavior and conflict safeguards |
| wechat-do-budget.md | Merge candidate | Historic cost analysis; evaluate accuracy against current architecture |
| wechat-forwarding.md | Merge candidate | Historical forwarding design; verify current iLink model before removing |
| wechat-harness-implementation.md | Keep | Agent/harness architecture and safety constraints |
| wechat-harness-review.md | Keep | Known defects and follow-up work |
| wechat-harness-test-plan.md | Keep | Test design and high-risk cases |
| wechat-transport-architecture.md | Keep | Transport rationale and ADR decisions |
| workers-ai-qwen38-evaluation.md | Keep | Evaluation evidence; date and model caveats must remain explicit |

## Safe cleanup procedure
1. Compare candidate contents with canonical destinations; move unique current behavior and commands.
2. Run repository-wide internal-link and code-reference checks.
3. Retain historical evidence in version history or archive index before deletion.
4. Verify unit, Worker, browser and WebKit checks before merge. Never alter migrations, secrets or R2/D1 to slim documentation.

## Scope boundary
This audit identified candidate merges only. It has **not** established that the candidates are unused across issues, external links or operators' bookmarks, and thus this change does not delete them.
