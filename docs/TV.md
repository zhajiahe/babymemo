# BabyMemo TV（Android TV / CleanYourTV）

TV 是现有 Cloudflare Workers、私有 R2 和 D1 数据的**只读展示端**，不建立第二份家庭数据。

## 使用

1. 合并本功能后按照现有流程部署 Worker（必须执行新增 D1 migration），打开 `https://<你的域名>/tv` 先验证相册界面。
2. 在 GitHub Actions 的 **BabyMemo TV APK** 工作流中运行 `workflow_dispatch`，下载构建产物 `babymemo-tv-test-apk`，其中包含 `app-debug.apk`。目前是**测试 APK**，CI Debug 签名不稳定，升级时可能需要先卸载旧版。
3. 使用电脑或 ADB 环境连接电视并执行 `adb install -r app-debug.apk`。
4. CleanYourTV 首页会发现 **BabyMemo** 模块卡片；按照提示选择 **Show**，或者从“Module cards”中启用。
5. 打开 BabyMemo TV，使用已登录的手机扫描屏幕二维码，确认配对。电视拿到单独的只读凭证，不接触家庭密码。

也可以在未安装 APK 前，使用电视浏览器访问 `/tv`，但遥控器按键兼容性以实际 WebView 为准。

## 安全边界

- 电视凭证仅允许读取 TV 基本档案与家庭照片/视频（含原件、缩略图）；禁止增删改、导出、设置及微信操作。
- 10 分钟有效的随机配对码，在已登录的手机上确认后只能被配对电视一次性领取。配对请求有 IP 限速。
- 凭证存储于 Secure / HttpOnly / SameSite Cookie，只在 `/api` 路径发送，可通过手机访问 `/tv/activate` 撤销；凭证最长有效 90 天，家庭会话版本变化时失效。
- Android 应用只访问固定 HTTPS BabyMemo 域名、不允许加载混合内容、不申请文件权限、不含追踪和广告。
- 家庭相册可能包含隐私照片，不要将安装包、日志或访问凭证与家庭数据捆绑公开。

## 兼容性与构建

- Android TV **8.0（API 26）及更新**；建议系统 WebView 可用并更新。
- 原生外壳：Java + Android WebView，JDK 17 / Android SDK 34 / Gradle 8.7；代码在 `tv-android/`。
- 在 `tv-android/` 下执行 `gradle :app:assembleDebug`；WebView 入口配置于 `app/build.gradle` 的 `TV_URL`。
- 当前使用固定站点 `https://babymemo.zhajiahe1994.workers.dev/tv`，如果更换域名，要修改 `TV_URL` 并重新打包。
- 正式长期安装应配置**固定私有签名密钥**并发布 Release APK；不要把私钥提交到仓库。首次验证阶段优先使用 Actions 调试 APK。
- 电视返回键关闭全屏故事；方向键左右切换，空格键暂停/恢复轮播（部分遥控器映射不同）。
- 模块卡片协议遵循 `cleanyourtv/docs/specs/card.md`，其展示需在 CleanYourTV 上人工批准。

## 验收重点

- 配对前不应访问任何真实家庭数据；错误码、过期码或重放都无法越权。
- TV Cookie 无法对记录执行 POST/PATCH/DELETE，也不能查询家庭完整状态或档案导出。
- 授权后可以浏览照片故事、播放支持的 MP4 视频并进行 Range 请求；断线、媒体未就绪、有多个宝宝都能正确处理。
- 手机撤销授权或修改会话版本后，旧电视不能继续请求新的媒体内容。
- 小米设备的 Android TV WebView/视频编解码器与遥控器映射需要真机验证，CI 构建并不能替代真机验收。
