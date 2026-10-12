#!/usr/bin/env node
/**
 * Real HTTP end-to-end tests against a disposable local Cloudflare Worker.
 *
 * Uses Wrangler local D1/R2/DO bindings. Never connects to a production
 * account, deploys code, deletes real data or needs production secrets.
 * Test secrets, D1/R2 files and Wrangler processes are temporary and removed.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'babymemo-e2e-'));
const wrangler = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
const envFile = join(root, '.dev.vars');
let worker, serverLog = '', started = false;
let port, base, sessionCookie = '', createdVars = false;

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const value = address.port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
function runCli(args) {
  const result = spawnSync(wrangler, args, {
    cwd: root,
    encoding: 'utf8',
    env: {...process.env, CI: 'true', BROWSER: 'none'},
    timeout: 90000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw Error('Local Wrangler command failed: '+args.join(' ')+'\n'+(result.stderr || result.stdout || String(result.error)).slice(-4500));
  }
}
async function boot() {
  if(existsSync(envFile))throw Error('Refusing to overwrite existing .dev.vars; use a clean isolated checkout');
  writeFileSync(envFile,
    'SESSION_SECRET='+randomBytes(32).toString('hex')+'\n'+
    'DATA_KEY='+randomBytes(32).toString('hex')+'\n',
    {mode:0o600});
  createdVars = true;
  port = await freePort();
  base = 'http://127.0.0.1:' + port;
  runCli(['d1','migrations','apply','DB','--local','--persist-to',dir]);
  worker = spawn(wrangler, ['dev','--local','--test-scheduled','--port',String(port),'--ip','127.0.0.1','--persist-to',dir],{
    cwd:root,
    env:{...process.env,CI:'true',BROWSER:'none'},
    stdio:['ignore','pipe','pipe'],
  });
  const collect = chunk => { serverLog = (serverLog + chunk.toString()).slice(-10000); };
  worker.stdout.on('data', collect);worker.stderr.on('data', collect);
  for (let i=0;i<120;i++) {
    if (worker.exitCode !== null) throw Error('Wrangler dev exited unexpectedly:\n'+serverLog);
    try {
      const response = await fetch(base+'/api/health',{signal:AbortSignal.timeout(1200)});
      if(response.ok && (await response.json()).ok===true){started=true;return;}
    }catch{}
    await delay(250);
  }
  throw Error('Wrangler dev did not become ready:\n'+serverLog);
}
async function request(path,{method='GET',body,headers={},anonymous=false}={}) {
  const requestHeaders = {
    ...(method!=='GET'&&method!=='HEAD'?{'Origin':base}:{}),
    ...(!anonymous && sessionCookie?{'Cookie':sessionCookie}:{}),
    ...(body!==undefined && !(body instanceof Uint8Array)?{'Content-Type':'application/json'}:{}),
    ...headers,
  };
  const data = body === undefined?undefined:(body instanceof Uint8Array?body:JSON.stringify(body));
  return fetch(base+path,{method,headers:requestHeaders,body:data,signal:AbortSignal.timeout(25000)});
}
async function json(path, options={}) {
  const response = await request(path,options);
  let data; try{data=await response.json()}catch{data={}};
  return {status:response.status,headers:response.headers,data};
}
async function step(title,operation){
  await operation();
  console.log('PASS '+title);
}
async function e2e() {
  console.log('E2E target: disposable local Wrangler Worker (never production)');
  await step('health and fresh setup status',async()=>{
    const health=await json('/api/health');assert.equal(health.status,200);assert.equal(health.data.ok,true);
    const init=await json('/api/bootstrap/status');assert.equal(init.status,200);
    assert.equal(init.data.initialized,false);
    assert.equal(init.data.sessionConfigured,true);
    assert.equal(init.data.encryptionConfigured,true);
    assert.equal('bootstrapConfigured' in init.data,false);
  });
  await step('anonymous access denied, cross-origin mutations rejected',async()=>{
    const state=await json('/api/state',{anonymous:true});
    assert.equal(state.status,401);
    const invalid=await json('/api/bootstrap',{method:'POST',anonymous:true,body:{},headers:{Origin:'https://other.example'}});
    assert.equal(invalid.status,403);
    assert.equal(invalid.data.error,'ORIGIN_REJECTED');
  });
  let babyId;
  await step('one-time first-owner setup without a bootstrap key',async()=>{
    const input={familyName:'E2E Test Home',ownerName:'Tester',password:'123456',
      babyName:'Test Baby',birthday:'2024-01-01',gender:'girl',timeZone:'Asia/Shanghai',allergies:''};
    const tooShort=await json('/api/bootstrap',{method:'POST',body:{...input,password:'12345'},anonymous:true});
    assert.equal(tooShort.status,400);
    assert.equal(tooShort.data.error,'INVALID_SETUP_INPUT');
    const first=await json('/api/bootstrap',{method:'POST',body:input,anonymous:true});
    assert.equal(first.status,201,JSON.stringify(first.data));
    babyId=first.data.babyId;
    assert.match(babyId,/^[\w-]{16,}$/);
    sessionCookie=first.headers.get('set-cookie')?.split(';')[0]??'';
    assert.match(sessionCookie,/^babymemo_session=/);
    const another=await json('/api/bootstrap',{method:'POST',body:input,anonymous:true});
    assert.equal(another.status,400);
    assert.equal(another.data.error,'ALREADY_INITIALIZED');
    const state=await json('/api/state');
    assert.equal(state.status,200);
    assert.equal(state.data.babies[0].id,babyId);
  });
  await step('logout, invalid login, valid login, protected state',async()=>{
    const out=await json('/api/logout',{method:'POST',body:{}});
    assert.equal(out.status,200);
    sessionCookie='';
    assert.equal((await json('/api/state',{anonymous:true})).status,401);
    assert.equal((await json('/api/login',{method:'POST',body:{name:'Tester',password:'wrong'},anonymous:true})).status,401);
    const login=await json('/api/login',{method:'POST',body:{name:'Tester',password:'123456'},anonymous:true});
    assert.equal(login.status,200,JSON.stringify(login.data));
    sessionCookie=login.headers.get('set-cookie')?.split(';')[0]??'';
    assert.match(sessionCookie,/^babymemo_session=/);
    assert.equal((await json('/api/state')).status,200);
  });
  await step('growth measurement create, list, and delete',async()=>{
    const created=await json('/api/records/growth',{method:'POST',body:{
      babyId,day:'2026-01-15',weight:10.2,height:75,headCircumference:46,notes:'local test'
    }});
    assert.equal(created.status,201,JSON.stringify(created.data));
    const list=await json('/api/records/growth?babyId='+babyId+'&page=0');
    assert.equal(list.status,200);
    assert.equal(list.data.items[0].weight,10.2);
    assert.equal((await json('/api/records/growth/'+created.data.id,{method:'DELETE'})).status,200);
    assert.equal((await json('/api/records/growth?babyId='+babyId)).data.items.length,0);
  });
  await step('milestone create, list, and delete',async()=>{
    const created=await json('/api/records/milestones',{method:'POST',
      body:{babyId,day:'2026-01-15',title:'First smile',description:'E2E only'}});
    assert.equal(created.status,201,JSON.stringify(created.data));
    const list=await json('/api/records/milestones?babyId='+babyId);
    assert.equal(list.status,200);assert.equal(list.data.items[0].title,'First smile');
    assert.equal((await json('/api/records/milestones/'+created.data.id,{method:'DELETE'})).status,200);
  });
  await step('encrypted OpenRouter config without contacting external service',async()=>{
    const saved=await json('/api/settings/openrouter',{method:'POST',
      body:{model:'openai/gpt-4.1-mini',apiKey:'sk-or-local-fake-key-never-sent'}});
    assert.equal(saved.status,200,JSON.stringify(saved.data));
    const state=await json('/api/state');
    assert.equal(state.data.openrouter.configured,true);
    assert.equal(JSON.stringify(state.data).includes('sk-or-local-fake'),false);
  });
  let mediaId,original;
  await step('image multipart start and pending incomplete uploads',async()=>{
    original=Uint8Array.from([255,216,255,224,1,2,3,4,5,255,217]);
    const pending=await json('/api/upload/start',{method:'POST',body:{
      babyId,day:'2026-01-15',title:'family-photo.jpg',mime:'image/jpeg',size:original.length,
      fingerprint:'a'.repeat(64)
    }});
    assert.equal(pending.status,201,JSON.stringify(pending.data));
    mediaId=pending.data.id;
    assert.equal(pending.data.chunkSize,8388608);
    let list=await json('/api/upload/pending?babyId='+babyId);
    assert.equal(list.data.items.length,1);
    assert.deepEqual(list.data.items[0].completedParts,[]);
    const bad=await json('/api/upload/'+mediaId+'/part/1',{method:'PUT',body:original.slice(0,5),
      headers:{'Content-Type':'application/octet-stream'}});
    assert.equal(bad.status,413);
    const part=await json('/api/upload/'+mediaId+'/part/1',{method:'PUT',body:original,
      headers:{'Content-Type':'application/octet-stream'}});
    assert.equal(part.status,200,JSON.stringify(part.data));
    list=await json('/api/upload/pending?babyId='+babyId);
    assert.deepEqual(list.data.items[0].completedParts,[1]);
    const finished=await json('/api/upload/'+mediaId+'/finish',{method:'POST',body:{}});
    assert.equal(finished.status,201,JSON.stringify(finished.data));
    assert.equal(finished.data.completed,true);
    const repeated=await json('/api/upload/'+mediaId+'/finish',{method:'POST',body:{}});
    assert.equal(repeated.status,200,JSON.stringify(repeated.data));
    assert.equal(repeated.data.alreadyCompleted,true);
    assert.equal((await json('/api/upload/pending?babyId='+babyId)).data.items.length,0);
    const missing=await json('/api/media/thumbnail-backfill?babyId='+babyId);
    assert.equal(missing.status,200);
    assert.equal(missing.data.items.some(x=>x.id===mediaId),true);
    const once=await json('/api/media?babyId='+babyId);
    assert.equal(once.data.items.filter(x=>x.id===mediaId).length,1);
  });
  await step('private original media, byte ranges, safe download header',async()=>{
    const missing=await json('/api/media/'+mediaId+'/content',{anonymous:true});
    assert.equal(missing.status,401);
    const originalResponse=await request('/api/media/'+mediaId+'/content');
    assert.equal(originalResponse.status,200);
    assert.deepEqual(new Uint8Array(await originalResponse.arrayBuffer()),original);
    const part=await request('/api/media/'+mediaId+'/content',{headers:{Range:'bytes=0-3'}});
    assert.equal(part.status,206);
    assert.deepEqual(new Uint8Array(await part.arrayBuffer()),original.slice(0,4));
    assert.match(part.headers.get('content-range')||'',/^bytes 0-3\/11$/);
    const download=await request('/api/media/'+mediaId+'/content?download=1');
    assert.equal(download.status,200);
    assert.match(download.headers.get('content-disposition')||'',/^attachment;/);
    await download.arrayBuffer();
  });
  await step('thumbnail fallback, secure JPEG upload, metadata edit',async()=>{
    const fallback=await request('/api/media/'+mediaId+'/thumbnail');
    assert.equal(fallback.status,200);
    assert.deepEqual(new Uint8Array(await fallback.arrayBuffer()),original);
    const invalid=await json('/api/media/'+mediaId+'/thumbnail',{method:'PUT',
      body:Uint8Array.from([1,2,3,4]),headers:{'Content-Type':'image/png'}});
    assert.equal(invalid.status,415);
    const thumb=Uint8Array.from([255,216,255,217]);
    const uploaded=await json('/api/media/'+mediaId+'/thumbnail',{method:'PUT',body:thumb,
      headers:{'Content-Type':'image/jpeg'}});
    assert.equal(uploaded.status,200,JSON.stringify(uploaded.data));
    const derivative=await request('/api/media/'+mediaId+'/thumbnail');
    assert.equal(derivative.status,200);
    assert.equal(derivative.headers.get('content-type'),'image/jpeg');
    assert.deepEqual(new Uint8Array(await derivative.arrayBuffer()),thumb);
    const completedBackfill=await json('/api/media/thumbnail-backfill?babyId='+babyId);
    assert.equal(completedBackfill.data.items.some(x=>x.id===mediaId),false);
    const mediaRow=await json('/api/media?babyId='+babyId);
    assert.equal(mediaRow.data.items.find(x=>x.id===mediaId).thumbnail_ready,1);
    const edited=await json('/api/media/'+mediaId,{method:'PATCH',body:{title:'Edited photo',day:'2026-02-01'}});
    assert.equal(edited.status,200);
    const list=await json('/api/media?babyId='+babyId);
    assert.equal(list.data.items[0].title,'Edited photo');
    assert.equal(list.data.items[0].day,'2026-02-01');
  });
  await step('media deletion removes original and thumbnail',async()=>{
    assert.equal((await json('/api/media/'+mediaId,{method:'DELETE'})).status,200);
    assert.equal((await json('/api/media/'+mediaId+'/content')).status,404);
    assert.equal((await json('/api/media/'+mediaId+'/thumbnail')).status,404);
  });
  await step('two-part 8MiB+ upload resumes the saved multipart state',async()=>{
    const chunkSize=8388608;
    const size=chunkSize+37;
    const file=new Uint8Array(size);
    file.fill(31);
    file[0]=0;file[1]=0;file[size-1]=99;
    const created=await json('/api/upload/start',{method:'POST',body:{
      babyId,day:'2026-01-15',title:'two-parts.mp4',mime:'video/mp4',size,
      fingerprint:'c'.repeat(64)
    }});
    assert.equal(created.status,201,JSON.stringify(created.data));
    const id=created.data.id;
    const first=await json('/api/upload/'+id+'/part/1',{method:'PUT',
      body:file.subarray(0,chunkSize),headers:{'Content-Type':'application/octet-stream'}});
    assert.equal(first.status,200,JSON.stringify(first.data));
    // Simulate fresh requests after an interrupted/reloaded client.
    const resume=await json('/api/upload/pending?babyId='+babyId);
    const item=resume.data.items.find(x=>x.id===id);
    assert.ok(item,'Resumable upload visible after first part');
    assert.deepEqual(item.completedParts,[1]);
    assert.equal(item.fingerprint,'c'.repeat(64));
    const second=await json('/api/upload/'+id+'/part/2',{method:'PUT',
      body:file.subarray(chunkSize),headers:{'Content-Type':'application/octet-stream'}});
    assert.equal(second.status,200,JSON.stringify(second.data));
    const finish=await json('/api/upload/'+id+'/finish',{method:'POST',body:{}});
    assert.equal(finish.status,201,JSON.stringify(finish.data));
    const range=await request('/api/media/'+id+'/content',{
      headers:{Range:'bytes='+chunkSize+'-'+(size-1)}
    });
    assert.equal(range.status,206);
    assert.deepEqual(new Uint8Array(await range.arrayBuffer()),file.subarray(chunkSize));
    assert.equal((await json('/api/upload/pending?babyId='+babyId)).data.items.some(x=>x.id===id),false);
    const repeated=await json('/api/upload/'+id+'/finish',{method:'POST',body:{}});
    assert.equal(repeated.status,200,JSON.stringify(repeated.data));
    assert.equal(repeated.data.alreadyCompleted,true);
    assert.equal((await json('/api/media/'+id,{method:'DELETE'})).status,200);
  });
  await step('cancel a recoverable multipart session',async()=>{
    const created=await json('/api/upload/start',{method:'POST',body:{
      babyId,day:'2026-01-15',title:'abandoned.mov',mime:'video/quicktime',size:23,
      fingerprint:'b'.repeat(64)
    }});
    assert.equal(created.status,201);
    assert.equal((await json('/api/upload/'+created.data.id+'/cancel',{method:'POST',body:{}})).status,200);
    assert.equal((await json('/api/upload/pending?babyId='+babyId)).data.items.length,0);
  });
  await step('scheduled cleanup handler accepts Cloudflare local Cron trigger',async()=>{
    const response=await request('/cdn-cgi/local/scheduled?format=json',{anonymous:true});
    assert.equal(response.status,200,await response.text());
  });
  console.log('All isolated Worker E2E assertions passed.');
}
// Browser E2E runs in Chromium (including mobile viewport emulation), not
// Safari. A separate CI job injects the pinned playwright-core test dependency.
async function browserE2e(){
  const {chromium,webkit}=await import('playwright-core');
  const useWebKit=process.env.BROWSER_ENGINE==='webkit';
  const engine=useWebKit?webkit:chromium;
  const {mkdirSync}=await import('node:fs');
  const evidence=join(root,'e2e-artifacts');
  mkdirSync(evidence,{recursive:true});
  const browser=await engine.launch(useWebKit?{headless:true}:{channel:'chrome',headless:true,args:['--no-sandbox']});
  const errors=[];
  try{
    const context=await browser.newContext({viewport:{width:1280,height:860},...(useWebKit?{isMobile:true,hasTouch:true,deviceScaleFactor:2}:{})});
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    if(useWebKit){
      // Safari/WebKit does not store Secure cookies on plain HTTP loopback.
      // Test-only response adaptation: production Worker keeps HttpOnly; Secure.
      await page.route('**/api/login',async route=>{
        const response=await route.fetch();
        const headers={...response.headers()};
        if(headers['set-cookie'])headers['set-cookie']=headers['set-cookie'].replace(/;\s*Secure(?=;|$)/ig,'');
        await route.fulfill({response,headers});
      });
    }
    let simulateFailure=useWebKit;
    if(useWebKit){
      await page.route('**/api/upload/**/part/**',async route=>{
        if(simulateFailure){simulateFailure=false;await route.abort('failed');return;}
        await delay(350); // throttle each multipart part on a simulated slow link
        await route.continue();
      });
    }
    await step((useWebKit?'WebKit':'Chromium')+': sign in through rendered React login form',async()=>{
      await page.goto(base+'/',{waitUntil:'domcontentloaded'});
      await page.locator('input[autocomplete="username"]').fill('Tester');
      await page.locator('input[autocomplete="current-password"]').fill('123456');
      const loginResponse=page.waitForResponse(r=>r.url().endsWith('/api/login')&&r.request().method()==='POST');
      await page.getByRole('button',{name:/登录我的空间/}).click();
      assert.equal((await loginResponse).status(),200);
      if(useWebKit){
        // Linux WebKit doesn't accept Secure cookies from loopback HTTP.
        // The server keeps HttpOnly + Secure; seed an isolated test session
        // after verifying /api/login worked, then load the authenticated UI.
        const token=sessionCookie.slice('babymemo_session='.length);
        assert.ok(token,'Expected authenticated isolated HTTP fixture');
        await context.addCookies([{name:'babymemo_session',value:token,url:base,
          httpOnly:true,secure:false,sameSite:'Lax'}]);
        await page.reload({waitUntil:'domcontentloaded'});
      }
      await page.getByRole('heading',{name:'每一刻，都很珍贵'}).waitFor({timeout:20000});
      await page.screenshot({path:join(evidence,'desktop-overview.png'),fullPage:true});
    });
    await step((useWebKit?'WebKit':'Chromium')+': bulk backfill of an existing private photo',async()=>{
      // Generate a browser-native PNG so WebKit and Chromium decode the same valid fixture.
      const pngBase64=await page.evaluate(()=>{
        const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#cc5544';ctx.fillRect(0,0,16,16);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      const png=Buffer.from(pngBase64,'base64');
      const upload=await json('/api/upload/start',{method:'POST',body:{
        babyId:(await json('/api/state')).data.babies[0].id,
        day:'2025-04-15',title:'legacy-photo.png',mime:'image/png',size:png.length,fingerprint:'f'.repeat(64)
      }});
      assert.equal(upload.status,201,JSON.stringify(upload.data));
      const part=await json('/api/upload/'+upload.data.id+'/part/1',{method:'PUT',
        body:new Uint8Array(png),headers:{'Content-Type':'application/octet-stream'}});
      assert.equal(part.status,200,JSON.stringify(part.data));
      assert.equal((await json('/api/upload/'+upload.data.id+'/finish',{method:'POST',body:{}})).status,201);
      await page.locator('.sidebar .nav-link').filter({hasText:'家庭相册'}).click();
      await page.locator('.thumbnail-backfill').waitFor({state:'visible',timeout:15000});
      await page.getByRole('button',{name:'开始补全'}).click();
      // Wait for the request loop to finish, not for the panel to disappear.
      await page.getByRole('button',{name:'开始补全'}).waitFor({state:'visible',timeout:30000});
      const state=await json('/api/media/thumbnail-backfill?babyId='+(await json('/api/state')).data.babies[0].id);
      assert.equal(state.data.items.some(item=>item.id===upload.data.id),false);
    });
    await step((useWebKit?'WebKit slow network':'Chromium')+': gallery image upload and private preview',async()=>{
      await page.locator('.sidebar .nav-link').filter({hasText:'家庭相册'}).click();
      await page.getByRole('heading',{name:'家庭相册'}).waitFor();
      // A tiny valid PNG; user photos and R2 production storage are untouched.
      const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ln0AAAAASUVORK5CYII=','base64');
      await page.locator('input[type="file"]').setInputFiles({
        name:'browser-e2e.png',mimeType:'image/png',buffer:png
      });
      await page.locator('.photo-preview').first().waitFor({state:'visible',timeout:30000});
      await page.locator('.photo-preview').first().click();
      await page.getByRole('dialog',{name:'相册预览'}).waitFor();
      const img=page.locator('.media-viewer-stage img');
      await img.waitFor();
      await page.waitForFunction(()=>document.querySelector('.media-viewer-stage img')?.naturalWidth > 0);
      await page.screenshot({path:join(evidence,'desktop-album-viewer.png'),fullPage:false});
    });
    await step((useWebKit?'WebKit':'Chromium')+': gallery metadata edit and delete',async()=>{
      await page.locator('.media-viewer-edit input').first().fill('Browser E2E photo');
      await page.locator('.media-viewer-edit input[type="date"]').fill('2026-02-01');
      await page.getByRole('button',{name:/保存信息/}).click();
      await page.getByText('照片信息已更新').waitFor({timeout:15000});
      await page.getByRole('button',{name:'关闭预览'}).click();
      const editedCard=page.locator('.photo-item').filter({hasText:'Browser E2E photo'});
      await editedCard.waitFor({state:'visible',timeout:15000});
      page.once('dialog',dialog=>void dialog.accept());
      await editedCard.locator('.photo-caption .icon-btn').click();
      await editedCard.waitFor({state:'detached',timeout:15000});
    });
    await step((useWebKit?'WebKit':'Chromium')+': 390px mobile navigation and horizontal overflow',async()=>{
      await page.setViewportSize({width:390,height:844});
      await page.locator('.mobile-nav button[aria-label="成长曲线"]').click();
      await page.getByRole('heading',{name:'成长记录'}).waitFor();
      const overflow=await page.evaluate(()=>({
        screen:window.innerWidth,scroll:document.documentElement.scrollWidth
      }));
      assert.ok(overflow.scroll<=overflow.screen+1,'mobile horizontal overflow '+JSON.stringify(overflow));
      await page.screenshot({path:join(evidence,'mobile-growth.png'),fullPage:true});
      await page.locator('.mobile-nav button[aria-label="家庭相册"]').click();
      await page.getByRole('heading',{name:'家庭相册'}).waitFor();
      await page.screenshot({path:join(evidence,'mobile-album.png'),fullPage:true});
    });
    assert.deepEqual(errors,[],'Uncaught browser exceptions');
    console.log('All '+(useWebKit?'WebKit Safari-engine':'Chromium')+' browser tests passed.');
    await context.close();
  }finally{
    await browser.close();
  }
}

try {
  await boot();
  await e2e();
  if(process.env.BROWSER_E2E==='1')await browserE2e();
} catch (error) {
  console.error('E2E FAILED: '+(error instanceof Error?error.stack:error));
  if (!started) console.error('Wrangler output:\n'+serverLog);
  process.exitCode=1;
} finally {
  if(worker && worker.exitCode===null)worker.kill('SIGTERM');
  await delay(200);
  if(createdVars)rmSync(envFile,{force:true});
  rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
