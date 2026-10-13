import assert from 'node:assert/strict';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
export async function browserWebManagement({page,context,base,evidence,step}){
 const nav=async label=>{await page.locator('.sidebar .nav-link').filter({hasText:label}).click()};
 await page.setViewportSize({width:1280,height:900});await page.reload();await nav('设置');
 await page.locator('.settings-baby-switch select').selectOption({label:'Test Baby'});
 const babyId=await page.locator('.settings-baby-switch select').inputValue();
 const requestHeaders={Origin:base,Cookie:(await context.cookies()).map(cookie=>cookie.name+'='+cookie.value).join(';')};
 await step('Chromium: web growth and milestone create/edit/query with complete baby profile',async()=>{
  await nav('成长');await page.getByLabel('体重 · kg',{exact:true}).fill('11.55');await page.getByLabel('备注',{exact:true}).fill('web-ui-fixture');
  await page.getByRole('button',{name:'保存记录',exact:true}).click();await page.locator('.timeline-item').filter({hasText:'web-ui-fixture'}).waitFor();
  await page.locator('.timeline-item').filter({hasText:'web-ui-fixture'}).getByRole('button',{name:'编辑记录'}).click();
  await page.getByLabel('体重 · kg',{exact:true}).fill('12.25');await page.getByLabel('备注',{exact:true}).fill('web-ui-edited');await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.locator('.timeline-item').filter({hasText:'web-ui-edited'}).waitFor();assert.match(await page.locator('.timeline-item').filter({hasText:'web-ui-edited'}).textContent(),/12\.25kg/);
  await page.getByLabel('关键词',{exact:true}).fill('web-ui-edited');await page.getByRole('button',{name:'查询',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.timeline-item').length===1);
  await page.getByRole('button',{name:'清除筛选',exact:true}).click();
  await nav('瞬间');await page.getByLabel('事件标题',{exact:true}).fill('Web moment fixture');await page.getByLabel('故事内容',{exact:true}).fill('完整网页入口');await page.getByRole('button',{name:'保存记录',exact:true}).click();
  await page.locator('.timeline-item').filter({hasText:'Web moment fixture'}).getByRole('button',{name:'编辑记录'}).click();await page.getByLabel('事件标题',{exact:true}).fill('Web moment edited');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.locator('.timeline-item').filter({hasText:'Web moment edited'}).waitFor();
  await nav('设置');await page.getByLabel('过敏与注意事项',{exact:true}).fill('测试花生过敏');await page.getByLabel('档案备注',{exact:true}).fill('完整档案备注');await page.getByLabel('宝宝时区',{exact:true}).selectOption('Asia/Tokyo');const profileRefresh=page.waitForResponse(response=>response.url().endsWith('/api/state')&&response.ok());await page.getByRole('button',{name:'保存资料',exact:true}).click();
  await profileRefresh;await page.reload();assert.equal(await page.getByLabel('过敏与注意事项',{exact:true}).inputValue(),'测试花生过敏');assert.equal(await page.getByLabel('宝宝时区',{exact:true}).inputValue(),'Asia/Tokyo');
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const c=canvas.getContext('2d');c.fillStyle='#2165A8';c.fillRect(0,0,32,32);return canvas.toDataURL('image/png').split(',')[1]});
  await page.locator('.baby-avatar-control input[type="file"]').setInputFiles({name:'synthetic-avatar.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.waitForFunction(()=>document.querySelector('.baby-avatar-control img')?.naturalWidth===256);await page.waitForFunction(async id=>{const r=await fetch('/api/export/records');if(!r.ok)return false;const data=await r.json();return data.babies?.some(b=>b.id===id&&b.avatar_key&&!String(b.avatar_key).startsWith('pending:'))},babyId,{timeout:30000});
  await page.screenshot({path:join(evidence,'web-profile-avatar.png'),fullPage:true});
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:45000}),page.getByRole('button',{name:'下载完整家庭档案 ZIP',exact:true}).click()]);
  const archive=await download.path();assert.ok(archive,await download.failure());
  const verified=spawnSync('python3',['-c',"import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; data=json.loads(z.read('records.json')); assert any(b['allergies']=='测试花生过敏' for b in data['babies']); assert any(n.startswith('avatars/') for n in z.namelist()); assert any(n.startswith('media/') for n in z.namelist()); print('BROWSER_EXPORT_OK')",archive],{encoding:'utf8'});assert.equal(verified.status,0,verified.stderr);
 });
 await step('Chromium: home recent moments ignores history pagination',async()=>{
  const seed=await context.request.post(base+'/api/records/milestones',{headers:requestHeaders,data:{babyId,day:'2026-10-13',title:'Pagination newest',description:''}});assert.equal(seed.status(),201);
  for(let i=0;i<41;i++){const r=await context.request.post(base+'/api/records/milestones',{headers:requestHeaders,data:{babyId,day:'2025-01-01',title:'Pagination history '+i,description:''}});assert.equal(r.status(),201)}
  await nav('瞬间');await page.getByRole('button',{name:'下一页',exact:true}).click();await page.locator('.timeline-item').filter({hasText:'Pagination history'}).first().waitFor();
  await nav('首页');await page.locator('.home-event').filter({hasText:'Pagination newest'}).waitFor();
 });
 await step('Chromium: offline page reopen preserves drafts and synchronizes exactly one record',async()=>{
  await nav('成长');await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.getByLabel('体重 · kg',{exact:true}).fill('13.4');await page.getByLabel('备注',{exact:true}).fill('offline-reopen-fixture');
  await page.waitForFunction(id=>JSON.parse(localStorage.getItem('babymemo-draft-growth-'+id)||'{}').weight==='13.4',babyId);
  await context.setOffline(true);const reopened=await context.newPage();
  try{
   await reopened.goto(base+'/',{waitUntil:'domcontentloaded'});await reopened.getByRole('heading',{name:'成长记录',exact:true}).waitFor();assert.equal(await reopened.getByLabel('体重 · kg',{exact:true}).inputValue(),'13.4');assert.equal(await reopened.getByLabel('备注',{exact:true}).inputValue(),'offline-reopen-fixture');
   await reopened.getByRole('button',{name:'保存记录',exact:true}).click();await reopened.locator('.timeline-item').filter({hasText:'offline-reopen-fixture'}).waitFor();assert.match(await reopened.locator('.timeline-item').filter({hasText:'offline-reopen-fixture'}).textContent(),/待同步/);
   await reopened.reload();await reopened.locator('.timeline-item').filter({hasText:'offline-reopen-fixture'}).waitFor();await reopened.screenshot({path:join(evidence,'offline-pending-record.png'),fullPage:true});
   await context.setOffline(false);await reopened.waitForFunction(()=>!document.querySelector('.offline-status'),null,{timeout:30000});
   const r=await context.request.get(base+'/api/records/growth?babyId='+babyId+'&q=offline-reopen-fixture',{headers:requestHeaders});const data=await r.json();assert.equal(data.items.length,1);assert.equal(data.items[0].weight,13.4);
  }finally{await context.setOffline(false);await reopened.close()}
 });
 await step('Chromium: chained offline edits keep acknowledged versions and reject a concurrent server change',async()=>{
  await page.reload();await nav('成长');
  const row=page.locator('.timeline-item').filter({hasText:'web-ui-edited'});
  await row.getByRole('button',{name:'编辑记录'}).click();await context.setOffline(true);
  await page.getByLabel('备注',{exact:true}).fill('offline-chain-one');await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.locator('.timeline-item').filter({hasText:'offline-chain-one'}).getByRole('button',{name:'编辑记录'}).click();await page.getByLabel('备注',{exact:true}).fill('offline-chain-two');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.locator('.timeline-item').filter({hasText:'offline-chain-two'}).waitFor();await page.getByRole('button',{name:'保存记录',exact:true}).waitFor();
  await context.setOffline(false);await page.waitForFunction(()=>!document.querySelector('.offline-status'),null,{timeout:30000});
  const list=await context.request.get(base+'/api/records/growth?babyId='+babyId+'&q=offline-chain-two',{headers:requestHeaders});const target=(await list.json()).items[0];assert.ok(target);
  await page.locator('.timeline-item').filter({hasText:'offline-chain-two'}).getByRole('button',{name:'编辑记录'}).click();
  await context.setOffline(true);await page.getByLabel('备注',{exact:true}).fill('offline-conflict-preserved');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.locator('.timeline-item').filter({hasText:'offline-conflict-preserved'}).waitFor();await page.getByRole('button',{name:'保存记录',exact:true}).waitFor();
  // A different client changes D1 while the browser remains offline.
  const external=await fetch(base+'/api/records/growth/'+target.id,{method:'PATCH',headers:{...requestHeaders,'Content-Type':'application/json'},body:JSON.stringify({babyId,day:target.day,weight:14,height:null,headCircumference:null,notes:'server-conflict-wins',expectedUpdatedAt:target.updated_at})});assert.equal(external.status,200);
  await context.setOffline(false);await page.getByRole('button',{name:'查看待同步内容',exact:true}).click();await page.locator('.offline-jobs').getByText('记录已被其他设备修改。请重新载入后核对并编辑。',{exact:true}).waitFor();
  const authoritative=await context.request.get(base+'/api/records/growth/'+target.id,{headers:requestHeaders});assert.equal((await authoritative.json()).notes,'server-conflict-wins');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'保留草稿并移出队列',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.offline-status'));
  await nav('首页');await nav('成长');assert.equal(await page.getByLabel('备注',{exact:true}).inputValue(),'offline-conflict-preserved');
 });
 await step('Chromium: photo date drafts survive reopening and require review after a concurrent edit',async()=>{
  await nav('相册');await page.locator('.photo-preview').first().click();
  let dialog=page.getByRole('dialog',{name:'相册预览'});await dialog.waitFor();
  const mediaId=await dialog.locator('.media-viewer-stage img, .media-viewer-stage video').getAttribute('src').then(src=>src.split('/')[3]);
  await dialog.getByLabel('拍摄日期',{exact:true}).fill('2023-07-07');await dialog.getByRole('button',{name:'关闭预览',exact:true}).click();
  await page.reload();await page.locator('.photo-preview').first().click();dialog=page.getByRole('dialog',{name:'相册预览'});await dialog.waitFor();assert.equal(await dialog.getByLabel('拍摄日期',{exact:true}).inputValue(),'2023-07-07');
  const detail=await context.request.get(base+'/api/media/'+mediaId,{headers:requestHeaders});const previous=await detail.json();
  const external=await context.request.patch(base+'/api/media/'+mediaId,{headers:requestHeaders,data:{babyId,day:'2023-07-09',expectedUpdatedAt:previous.updated_at}});assert.equal(external.status(),200);
  await dialog.getByRole('button',{name:'保存信息',exact:true}).click();await dialog.getByText('记录已被其他设备修改。请重新载入后核对并编辑。',{exact:true}).waitFor();
  assert.equal(await dialog.getByLabel('拍摄日期',{exact:true}).inputValue(),'2023-07-07');page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'核对服务器版本（保留草稿）',exact:true}).click();await dialog.getByRole('button',{name:'核对服务器版本（保留草稿）',exact:true}).waitFor({state:'hidden'});
  await dialog.getByRole('button',{name:'保存信息',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.media-viewer-header strong')?.textContent==='2023-07-07');
  await dialog.getByLabel('拍摄日期',{exact:true}).fill('2023-07-08');await dialog.getByRole('button',{name:'保存信息',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.media-viewer-header strong')?.textContent==='2023-07-08');await dialog.getByRole('button',{name:'关闭预览',exact:true}).click();
 });
 await step('Chromium: offline original upload survives reload and logout clears private device data',async()=>{
  await nav('相册');await page.getByRole('button',{name:'添加照片或视频',exact:true}).first().click();await context.setOffline(true);
  await page.locator('input[type="file"]').setInputFiles({name:'offline-original-fixture.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,224,0,16,255,217])});
  await page.getByRole('button',{name:'查看待同步内容',exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'查看待同步内容',exact:true}).waitFor();
  await context.setOffline(false);await page.waitForFunction(()=>!document.querySelector('.offline-status'),null,{timeout:30000});
  const r=await context.request.get(base+'/api/media?babyId='+babyId,{headers:requestHeaders});const items=(await r.json()).items.filter(item=>item.title==='offline-original-fixture.jpg');assert.equal(items.length,1);
  const original=await context.request.get(base+'/api/media/'+items[0].id+'/content',{headers:requestHeaders});assert.deepEqual(await original.body(),Buffer.from([255,216,255,224,0,16,255,217]));
  await page.locator('.sidebar .nav-link').filter({hasText:'安全退出'}).click();await page.getByRole('heading',{name:'登录 BabyMemo',exact:true}).waitFor();
  assert.equal(await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('babymemo-device-v1');r.onsuccess=()=>resolve(r.result);r.onerror=reject});const jobs=await new Promise(resolve=>{const r=db.transaction('jobs').objectStore('jobs').count();r.onsuccess=()=>resolve(r.result)});db.close();return jobs}),0);
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('babymemo-draft-'))),false);
  await context.setOffline(true);assert.equal(await page.evaluate(async id=>(await fetch('/api/media/'+id+'/content')).status,items[0].id),401);await context.setOffline(false);
  await page.getByLabel('管理员登录名',{exact:true}).fill('Tester');await page.getByLabel('家庭密码',{exact:true}).fill('123456');await page.getByRole('button',{name:'登录我的空间',exact:true}).click();await page.locator('.sidebar').waitFor();
 });
 await page.reload();await page.setViewportSize({width:375,height:900});await page.screenshot({path:join(evidence,'web-management-mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
}
