# 数据备份与恢复

设置页的家庭 ZIP/JSON 导出是**用户资料导出**，不包含管理员登录哈希、部署 Secrets；不等于能直接恢复运行环境。见 [离线和导出](web-management-offline.md)。操作者灾备需单独备份 D1 与私有 R2。

## 在安全终端执行

```sh
node scripts/family-backup.mjs export .backup-private/backup
node scripts/family-backup.mjs verify .backup-private/backup
node scripts/family-backup.mjs stage-local .backup-private/backup
```

`export` 含 SQL、被引用的原始媒体/缩略图及 SHA-256 清单；`stage-local` 仅在隔离本地 D1/R2 中演练。备份可能包含加密微信/模型凭据、家庭数据及登录哈希，必须离线加密保存；**`DATA_KEY` 不在备份中，需独立安全保管**。`.backup-private/` 已被 Git 忽略，不能上传 GitHub 或 CI Artifact。

## 恢复到全新环境（需明确授权）

人工确认目标是**全新的空 D1 和空 R2**，并且名称不同于线上正式资源：

```sh
node scripts/family-backup.mjs restore-new-remote .backup-private/backup NEW_D1 NEW_R2 RESTORE_TO_NEW_ENVIRONMENT
```

工具会检查目标 D1 为空及媒体清单，但**不能证明目标 R2 桶为空**；操作者必须核对。恢复后验证行数、SHA、登录、媒体字节/Range、宝宝归属与微信重新绑定需求；配置原有 `DATA_KEY` 和独立新 `SESSION_SECRET`。

**局限**：D1 导出与 R2 拷贝不是原子快照，写入中的实例需要暂停写入窗口或额外一致性校验。不可恢复到当前生产同名资源，不可因失败删除原资源。整个过程不自动定时执行。
