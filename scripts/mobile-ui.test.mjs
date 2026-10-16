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

test('album filter, add and view switch share a single responsive toolbar',()=>{
 assert.match(album,/className="album-controls" role="group" aria-label="相册操作"/);
 assert.ok(album.indexOf('<RecordFilterBar value={filters}')<album.indexOf('className="album-add-btn"'));
 assert.ok(album.indexOf('className="album-add-btn"')<album.indexOf('<SegmentedControl className="album-view-switch"'));
 assert.match(album,/aria-label={showUploader\?'收起上传':'添加照片或视频'}/);
 assert.match(filters,/aria-label="筛选记录"/);
 assert.match(css,/\.album-controls \{ display:grid;/);
 assert.match(css,/\.album-controls \.record-filter-shell \{ display:contents; \}/);
 assert.match(css,/\.album-controls \.record-filters \{ grid-column:1 \/ -1; grid-row:2;/);
 assert.match(css,/\.album-controls \.album-view-switch button \{ flex:1 1 0;/);
});
test('home and album prioritize photos and visibly identify videos',()=>{
 assert.match(app,/className="home-quick-add"/);
 assert.match(css,/\.home-photo-cover \{ aspect-ratio:16\/9; \}/);
 assert.match(app,/home-video-badge/);
 assert.match(album,/video-play-badge/);
 assert.match(album,/thumbnail_ready/);
});

test('shared native modal gives album upload, baby create, and record edit correct task semantics',()=>{
 const ui=source('src/components/ui.tsx'),settings=source('src/features/settings/Settings.tsx'),growth=source('src/features/growth/RecordView.tsx');
 assert.match(ui,/export function ModalDialog/);
 assert.match(ui,/dialog\.showModal\(\)/);
 assert.match(ui,/onCancel=\{event=>\{event\.preventDefault\(\);if\(!busy\)onClose\(\)\}\}/);
 assert.match(ui,/aria-labelledby=\{titleId\}/);
 assert.match(album,/<ModalDialog open=\{showUploader\}/);
 assert.match(album,/busy=\{uploading\}/);
 assert.match(album,/if\(!failedFiles&&!results\.some/);
 assert.match(settings,/<ModalDialog open=\{showNewBaby\}/);
 assert.match(settings,/busy=\{creatingBaby\}/);
 assert.match(growth,/<ModalDialog open=\{!!editing&&editorOpen\}/);
 assert.match(growth,/setEditorOpen\(true\)/);
 assert.match(growth,/setEditorOpen\(false\)/);
 assert.match(growth,/继续编辑/);
 assert.match(css,/\.bm-modal::backdrop/);
 assert.match(css,/safe-area-inset-bottom/);
});
test('growth add record has its own modal and edit drafts survive switching records',()=>{
 assert.match(chart,/新增成长记录<\/Button>/);
 assert.match(chart,/open={kind==='growth'&&!editing&&createOpen}/);
 assert.match(chart,/title="新增成长记录"/);
 assert.match(chart,/if\(editing\.id!==item\.id\)notify/);
 assert.match(chart,/localStorage\.setItem\(draftKey,JSON\.stringify\(form\)\)/);
 assert.match(chart,/editing\?readDraft\(draftKey,baby\.time_zone\)/);
 assert.match(css,/\.record-create-toolbar \{ display:flex/);
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
