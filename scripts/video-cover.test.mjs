import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const upload=source('src/media-upload.ts');
const album=source('src/features/album/Album.tsx');
const viewer=source('src/components/MediaViewer.tsx');
const worker=source('src/worker.ts');
const css=source('src/editorial.css');

test('poster encoding requires a decoded frame and respects 512 KiB',()=>{
 assert.match(upload,/export async function createVideoFrameThumbnail/);
 assert.match(upload,/video\.readyState<2/);
 assert.match(upload,/!video\.videoWidth\|\|!video\.videoHeight/);
 assert.match(upload,/Math\.min\(1,512\/Math\.max\(video\.videoWidth,video\.videoHeight\)\)/);
 assert.match(upload,/jpeg\.size>524288/);
 assert.match(upload,/return jpeg&&jpeg\.size<=524288\?jpeg:null/);
});
test('automatic video thumbnails wait for decoded frame, retain safe first-frame fallback',()=>{
 assert.match(upload,/video\.preload='auto'/);
 assert.match(upload,/video\.onloadeddata/);
 assert.match(upload,/VIDEO_FRAME_TIMEOUT/);
 assert.match(upload,/The already-decoded first frame is a useful fallback/);
 assert.match(upload,/return createVideoFrameThumbnail\(video\)/);
 assert.match(upload,/URL\.revokeObjectURL\(objectUrl\)/);
});
test('missing video poster can be repaired from current video frame or an image',()=>{
 assert.match(viewer,/createVideoFrameThumbnail\(videoRef\.current\)/);
 assert.match(viewer,/createAlbumThumbnail\(file\)/);
 assert.match(viewer,/将当前视频画面设为封面/);
 assert.match(viewer,/选择封面照片/);
 assert.match(viewer,/accept="image\/jpeg,image\/png,image\/webp"/);
 assert.match(viewer,/method:'PUT',body:thumb,headers:\{'Content-Type':'image\/jpeg'\}/);
 assert.match(viewer,/onThumbnailSaved\(id,saved\.updated_at\)/);
 assert.match(album,/mediaEdited\(id,\{thumbnail_ready:1,\.\.\.\(updatedAt/);
 assert.match(album,/onThumbnailSaved=/);
 assert.match(source('src/features/growth/RecordView.tsx'),/onThumbnailSaved=/);
 assert.match(css,/\.media-cover-picker:focus-within/);
});
test('thumbnail failures report error instead of success and originals remain untouched',()=>{
 assert.match(album,/if\(!thumb\)\{/);
 assert.match(album,/report\('thumbnail',file\.size,previewStarted,'error'\)/);
 assert.match(album,/自动封面生成失败/);
 assert.match(worker,/app\.put\('\/api\/media\/:id\/thumbnail'/);
 assert.match(worker,/await c\.env\.MEDIA\.put\(thumbKey\(id\),data/);
 assert.match(worker,/UPDATE media SET thumbnail_ready=1,updated_at=\? WHERE id=\?/);
 assert.doesNotMatch(viewer,/\/api\/upload\/direct|\/api\/upload\/start/);
});
