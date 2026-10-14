import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const filters=source('src/components/RecordFilters.tsx');
const app=source('src/App.tsx');
const chart=source('src/features/growth/RecordView.tsx');
const album=source('src/features/album/Album.tsx');
const settings=source('src/features/settings/Settings.tsx');
const css=source('src/editorial.css');

test('mobile filters collapse and date inputs fit one constrained column',()=>{
 assert.match(filters,/aria-expanded=\{expanded\}/);
 assert.match(filters,/className="record-filter-fields"/);
 assert.match(css,/\.record-filter-fields \{ grid-template-columns:1fr; \}/);
 assert.match(css,/input\[type="date"\].*min-width:0/);
 assert.match(filters,/onChange\(draft\)/);
 assert.match(filters,/onChange\(emptyFilters\)/);
});

test('home and album prioritize photos and visibly identify videos',()=>{
 assert.match(app,/className="home-quick-add"/);
 assert.match(css,/\.home-photo-cover \{ aspect-ratio:16\/10; \}/);
 assert.match(app,/home-video-badge/);
 assert.match(album,/video-play-badge/);
 assert.match(album,/thumbnail_ready/);
});

test('growth chart supports tapping and keyboard selection',()=>{
 assert.match(chart,/setSelectedId\(p.id\)/);
 assert.match(chart,/role="button" tabIndex=\{0\}/);
 assert.match(chart,/aria-live="polite"/);
 assert.match(chart,/growth-latest/);
 assert.match(css,/\.growth-svg text \{ font-size:13px; \}/);
});

test('WeChat administration favors status with progressively disclosed controls',()=>{
 assert.ok(settings.indexOf('className="wechat-row"')<settings.indexOf('className="wechat-photo-setting"'));
 assert.match(settings,/className="wechat-member-more"/);
 assert.match(settings,/微信 AI 模型/);
 assert.match(settings,/当前生效/);
 assert.match(settings,/模型接口未检测/);
 assert.match(settings,/最近确认运行/);
 assert.ok(settings.indexOf('const [runStatuses,setRunStatuses]')<settings.indexOf('const checkedWechat='),'status summary must run after useState initialization');
 assert.match(settings,/modelDirty\|\|testingModel/);
 assert.match(settings,/if\(!result.ok\|\|result.provider!==savedProvider\)/);
 assert.match(settings,/role="status" aria-live="polite"/);
 assert.match(settings,/OpenRouter · 自定义模型/);
 assert.match(settings,/微信指令示例与使用说明/);
});
