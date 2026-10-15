# 历史缩略图维护

**普通用户**优先在设置中点击「后台修复全部封面」：在已登录浏览器中分批处理照片和视频，关闭/冻结页面时暂停，重新进入可继续；不是独立云端转码任务。

以下脚本仅供维护者**一次性补旧图片缩略图**，不处理视频，不用于常规 CI/Cron/部署；先执行 [备份](BACKUP.md)。

```sh
npm install --no-save playwright@1.56.1
npx playwright install chromium
export BABYMEMO_URL=https://你的正式域名/
export BABYMEMO_USER=管理员用户名
read -r -s -p "家庭密码: " BABYMEMO_PASSWORD
export BABYMEMO_PASSWORD
node scripts/maintenance-thumbnail-backfill.mjs
```

默认 dry-run；多宝宝须设置 `BABYMEMO_BACKFILL_BABY_ID`。仅确认目标、备份及 dry-run 结果后执行：

```sh
BABYMEMO_BACKFILL_CONFIRM=YES node scripts/maintenance-thumbnail-backfill.mjs --apply
```

每批最多 100 张、默认 20；使用 `BABYMEMO_BACKFILL_AFTER` 续接返回的 `nextCursor`。只新增受保护的派生 JPEG，不修改原图；超大或浏览器不支持解码的原件保留回退。完成后在相册抽查封面、日期和原图。账号、密码与媒体资料不得写入代码、日志或 PR。
