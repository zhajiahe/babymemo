# BabyMemo 品牌资源 · Calm Editorial

当前正式视觉采用“守护与成长”的几何符号：一条保护性外弧与内部的小身影组成的统一标记，简洁、无爱心、星星与装饰渐变。颜色：背景 `#F5EAE0`、主笔画 `#845A46`、内层 `#C18D73`。

## 当前启用

- `public/brand/mark.svg`：侧边栏和登录页的品牌标识。
- `public/brand/wordmark.svg`：品牌字样与“家庭成长日记”的横向组合。
- `public/favicon.svg`、`public/favicon-32.png`、`public/favicon.ico`：浏览器标签、书签和旧浏览器兼容图标。
- `public/apple-touch-icon.png`：180×180，iOS 添加主屏幕用。
- `public/icon-192.png`、`public/icon-512.png`：Web App Manifest 中 192/512 图标，512 使用 maskable 安全区域。
- `public/site.webmanifest`、`index.html`：统一安装名称、主题色和资源引用。

上述资源属于同一套设计，不要只改 SVG 而忘记再生成 PNG/ICO。PNG 使用索引色与透明角，不包含用户照片、名字或其他隐私数据。

## 历史提案

`docs/brand/options/` 保留此前三套候选标识，仅供参考；它们都不是当前线上品牌资源。

## 验收

合并 PR 后可通过浏览器强制刷新、iOS 删除旧主屏幕快捷方式再重新添加，确认缓存之外的图标显示效果。无需迁移、修改 D1/R2 或轮换密钥。
