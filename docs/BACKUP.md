# BabyMemo 数据备份与恢复

本流程专供所有者操作。**本 PR 不运行任何线上备份或恢复。**
记录 JSON（设置 → 导出）不包含媒体原件，因此不能单独用作灾备。

## 受保护的完整备份

先在具有 Cloudflare 访问权限的安全设备配置 Wrangler，并从已批准的环境运行：

```sh
npm install
node scripts/family-backup.mjs export .backup-private/backup-2026-10-12
node scripts/family-backup.mjs verify .backup-private/backup-2026-10-12
```

备份输出数据库 SQL、所引用的 R2 原文件、缩略图和 SHA-256 清单。
备份目录必须位于仓库下的 `.backup-private/`，Git 忽略此目录。
数据库备份还包含**加密的 OpenRouter/微信令牌、家庭资料和登录哈希**，应加密离线保存且勿上传 GitHub、公开云盘或 CI Artifact。
`DATA_KEY` 不包含在数据库备份中；所有者须安全地单独保管原来的 `DATA_KEY`，否则加密配置无法恢复。

## 隔离环境验证

```sh
node scripts/family-backup.mjs stage-local .backup-private/backup-2026-10-12
```

该命令会在备份目录中创建临时的本地 D1 + R2 环境，不触碰生产环境。
完成后应启动隔离 Worker，验证照片/视频 Range、宝宝切换、登录和历史记录。
导入成功不代表验证了真实 iOS Safari 解码能力。

## 恢复至全新的 Cloudflare 环境（明确授权）

先**人工创建并确认**全新的空 D1 和空 R2 bucket，其名称必须不同于生产的 `babymemo` 和 `babymemo-media`。
再运行：

```sh
node scripts/family-backup.mjs restore-new-remote .backup-private/backup-2026-10-12 NEW_D1 NEW_R2 RESTORE_TO_NEW_ENVIRONMENT
```

程序会拒绝原生产资源名称，拒绝非空 D1，先复制经过校验的媒体，再导入数据库。工具**不能验证 R2 目标桶完全为空**，必须人工保证；不要用现有共享桶。
如果 R2 中途失败，停止流程，检查目标环境，不可改指向生产环境重试。
恢复完成后，需配置原有加密 DATA_KEY、新 SESSION_SECRET，并检查账号密码、媒体、成长数据、微信授权是否需重新绑定。

## 限制与安全边界

- D1 导出与 R2 对象获取并非跨服务事务级快照。生产有人写入时，应安排暂时停止写入的备份窗口或二次校验。
- 仅备份当前 D1 中有引用的已完成媒体对象。未完成 multipart 由 14 天清理任务维护，不包含其中。
- 本脚本不上传到外部备份供应商，也不自动定时执行。可由所有者在受保护的 CI/主机上定期运行并使用端到端加密存储。
- 新环境恢复还需对比行数、文件数、SHA-256，模拟从零恢复后才可宣称容灾验收。
- 请始终保留旧 MyBaby 的源数据，直至其独立迁移 PR 完成确认。
