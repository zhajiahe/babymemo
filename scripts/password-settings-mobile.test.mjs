import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('returning family owner needs only one secret, keeping rate limiting and Secure sessions',()=>{
 const auth=src('src/auth.ts'),app=src('src/App.tsx'),worker=src('src/worker.ts');
 assert.match(auth,/login\(c:Ctx,password:string\)/);
 assert.doesNotMatch(auth,/constantEqual\(existing.name,name\)/);
 assert.match(auth,/auth_attempts/);
 assert.match(auth,/applySession\(c,existing.session_version\)/);
 assert.match(auth,/HttpOnly; Secure; SameSite=Lax/);
 assert.match(worker,/const ok=await login\(c,v.password\)/);
 assert.match(app,/mode==='setup'&&<Field label="管理员登录名"/);
 assert.match(app,/mode==='setup'\?form:\{password:form.password\}/);
});
test('mobile settings use full-width grouped categories and accessible back navigation',()=>{
 const settings=src('src/features/settings/Settings.tsx'),css=src('src/editorial.css');
 assert.match(settings,/settings-mobile-back/);
 assert.match(settings,/setMobileDetail\(false\)/);
 assert.match(settings,/setMobileDetail\(true\)/);
 assert.match(css,/\.settings-layout\.mobile-detail \.settings-main\{display:block\}/);
 assert.match(css,/min-height:67px/);
 assert.match(css,/\.settings-mobile-back/);
});
test('video repair runs on authenticated visible pages and retains original on failures',()=>{
 const app=src('src/App.tsx'),worker=src('src/worker.ts'),repair=src('src/auto-video-covers.ts');
 assert.match(app,/repairMissingVideoCovers\(videoCoverBabies.split/);
 assert.match(repair,/document.visibilityState!=='visible'/);
 assert.match(repair,/thumbnail-backfill\?type=video/);
 assert.match(repair,/createRemoteVideoThumbnail\(item.id\)/);
 assert.match(repair,/babymemo:thumbnail-repaired/);
 assert.match(worker,/type!=='image'&&type!=='all'&&type!=='video'/);
});
