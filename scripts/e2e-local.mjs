#!/usr/bin/env node
/**
 * Real HTTP end-to-end tests against a disposable local Cloudflare Worker.
 *
 * Uses Wrangler local D1/R2/DO bindings. Never connects to a production
 * account, deploys code, deletes real data or needs production secrets.
 * Test secrets, D1/R2 files and Wrangler processes are temporary and removed.
 */
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {exifJpeg} from './fixtures/media-exif.mjs';

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'babymemo-e2e-'));
const wrangler = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
const envFile = join(dir, '.dev.vars');
const testConfig=join(dir,'wrangler.json');
const localEnv={...process.env,CI:'true',BROWSER:'none',WRANGLER_SEND_METRICS:'false',XDG_CONFIG_HOME:join(dir,'config')};
let worker, serverLog = '', started = false;
let port, base, sessionCookie = '', createdVars = false, sessionSecret = '';

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
  const result = spawnSync(wrangler, [...args,'--config',testConfig], {
    cwd: root,
    encoding: 'utf8',
    env: localEnv,
    timeout: 90000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw Error('Local Wrangler command failed: '+args.join(' ')+'\n'+(result.stderr || result.stdout || String(result.error)).slice(-4500));
  }
}
async function boot() {
  writeFileSync(testConfig,JSON.stringify({name:'babymemo-isolated-e2e',main:join(root,'src/worker.ts'),compatibility_date:'2026-10-12',assets:{directory:join(root,'dist'),binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/api/*','/demo','/demo/','/demo/mobile','/demo/mobile/']},d1_databases:[{binding:'DB',database_name:'synthetic-db',database_id:'00000000-0000-0000-0000-000000000001',migrations_dir:join(root,'migrations')}],r2_buckets:[{binding:'MEDIA',bucket_name:'synthetic-media'}],durable_objects:{bindings:[{name:'BOT',class_name:'WechatSession'}]},migrations:[{tag:'v1',new_sqlite_classes:['WechatSession']}],triggers:{crons:['0 19 * * *']}}));
  sessionSecret = randomBytes(32).toString('hex');
  writeFileSync(envFile,
    'SESSION_SECRET='+sessionSecret+'\n'+
    'DATA_KEY='+randomBytes(32).toString('hex')+'\n'+
    (process.env.E2E_DEPLOY_KEY==='1'?'OPENROUTER_API_KEY=sk-or-e2e-deployment-key-never-sent'+'\n':''),
    {mode:0o600});
  createdVars = true;
  port = await freePort();
  base = 'http://127.0.0.1:' + port;
  runCli(['d1','migrations','apply','DB','--local','--persist-to',dir]);
  worker = spawn(wrangler, ['dev','--local','--config',testConfig,'--test-scheduled','--port',String(port),'--ip','127.0.0.1','--persist-to',dir],{
    cwd:root,
    env:localEnv,
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
function signedTestSession(expiresAt, version=1) {
  // Produces a real signed token matching the pre-change 7-day cookie format.
  const payload=Buffer.from(JSON.stringify({v:version,exp:expiresAt,n:'legacy-e2e-fixture'})).toString('base64url');
  const signature=createHmac('sha256',sessionSecret).update(payload).digest('base64url');
  return 'babymemo_session='+payload+'.'+signature;
}
async function step(title,operation){
  await operation();
  console.log('PASS '+title);
}
async function e2e() {
  console.log('E2E target: disposable local Wrangler Worker (never production)');
  await step('public demo serves the built React product preview, without signing in',async()=>{
    const response=await fetch(base+'/demo.html');
    assert.equal(response.status,200);
    const html=await response.text();
    assert.match(html,/<title>产品体验/);
    assert.match(html,/assets\/demo-[^"]+\.js/,'Vite must compile a standalone React demo entry');
    const live=await fetch(base+'/demo',{redirect:'manual'});
    assert.equal(live.status,302,'/demo must redirect to real demo, not SPA login');
    assert.equal(live.headers.get('location'),'/demo.html');
    const mobile=await fetch(base+'/demo-mobile.html');
    assert.equal(mobile.status,200,'mobile demo must be a separate build entry');
    const mobileHtml=await mobile.text();
    assert.match(mobileHtml,/<title>移动端体验/);
    assert.match(mobileHtml,/assets\/mobileDemo-[^"]+\.js/);
    const mobileLink=await fetch(base+'/demo/mobile',{redirect:'manual'});
    assert.equal(mobileLink.status,302,'/demo/mobile must not hit SPA fallback');
    assert.equal(mobileLink.headers.get('location'),'/demo-mobile.html');
    const main=await fetch(base+'/');
    assert.equal(main.status,200,'Demo must not replace the private app');
  });
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
  let babyId,secondBabyId;
  await step('one-time first-owner setup without a bootstrap key',async()=>{
    const input={familyName:'E2E Test Home',ownerName:'Tester',password:'123456',
      babyName:'Test Baby',birthday:'2024-01-01',gender:'girl',timeZone:'Asia/Shanghai',allergies:''};
    const tooShort=await json('/api/bootstrap',{method:'POST',body:{...input,password:'12345'},anonymous:true});
    assert.equal(tooShort.status,400);
    assert.equal(tooShort.data.error,'INVALID_SETUP_INPUT');
    assert.equal((await json('/api/bootstrap',{method:'POST',body:{...input,birthday:'2026-02-31'},anonymous:true})).status,400);
    assert.equal((await json('/api/bootstrap',{method:'POST',body:{...input,timeZone:'Mars/Nowhere'},anonymous:true})).status,400);
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
    assert.match(login.headers.get('set-cookie')??'',/Max-Age=15552000/);
    assert.match(login.headers.get('set-cookie')??'',/HttpOnly; Secure; SameSite=Lax/);
    assert.equal((await json('/api/state')).status,200);
  });
  await step('old 7-day sessions upgrade once to renewable 180-day cookies',async()=>{
    sessionCookie=signedTestSession(Date.now()+7*86400000);
    const initial=await json('/api/state');
    assert.equal(initial.status,200);
    const updated=initial.headers.get('set-cookie')??'';
    assert.match(updated,/^babymemo_session=/);
    assert.match(updated,/Max-Age=15552000/);
    assert.match(updated,/HttpOnly; Secure; SameSite=Lax/);
    sessionCookie=updated.split(';')[0];
    const afterRefresh=await json('/api/state');
    assert.equal(afterRefresh.status,200);
    assert.equal(afterRefresh.headers.get('set-cookie'),null,'Do not rotate cookies on every request');
  });
  await step('expired, wrong-version, future-dated and tampered sessions are rejected',async()=>{
    const saved=sessionCookie;
    for(const invalid of [
      signedTestSession(Date.now()-1000),
      signedTestSession(Date.now()+86400000,2),
      signedTestSession(Date.now()+181*86400000),
      saved.slice(0,-1)+(saved.endsWith('a')?'b':'a')
    ]){
      sessionCookie=invalid;
      assert.equal((await json('/api/state')).status,401);
    }
    sessionCookie=saved;
    assert.equal((await json('/api/state')).status,200);
  });
  await step('authenticated additional baby can be created without losing the first',async()=>{
    const unauthorized=await json('/api/babies',{method:'POST',body:{name:'Public',birthday:'2025-05-05',gender:'other'},anonymous:true});
    assert.equal(unauthorized.status,401);
    const invalid=await json('/api/babies',{method:'POST',body:{name:'',birthday:'2025-05-05',gender:'other'}});
    assert.equal(invalid.status,400);
    const invalidZone=await json('/api/babies',{method:'POST',body:{name:'Bad TZ',birthday:'2025-05-05',gender:'girl',timeZone:'Mars/Nowhere'}});
    assert.equal(invalidZone.status,400);
    const created=await json('/api/babies',{method:'POST',body:{
      name:'Second Baby',birthday:'2025-05-05',gender:'boy',timeZone:'Asia/Shanghai',allergies:''
    }});
    assert.equal(created.status,201,JSON.stringify(created.data));
    const babies=(await json('/api/state')).data.babies;
    assert.equal(babies.length,2);
    assert.equal(babies[0].id,babyId,'Original baby ID must remain unchanged');
    assert.equal(babies[1].id,created.data.id);
    secondBabyId=created.data.id;
    const firstGrowth=await json('/api/records/growth?babyId='+babyId);
    const secondGrowth=await json('/api/records/growth?babyId='+created.data.id);
    assert.equal(firstGrowth.status,200);
    assert.equal(secondGrowth.status,200);
    assert.deepEqual(firstGrowth.data.items,[]);
    assert.deepEqual(secondGrowth.data.items,[]);
  });
  await step('birth time stays optional and updates reject invalid clock values',async()=>{
    const before=(await json('/api/state')).data.babies;
    const baby=before[0];
    assert.equal(baby.birth_time,'');
    const saved=await json('/api/babies/'+baby.id,{method:'PATCH',body:{
      name:baby.name,birthday:baby.birthday,birthTime:'08:45',allergies:baby.allergies,notes:baby.notes
    }});
    assert.equal(saved.status,200);
    const after=(await json('/api/state')).data.babies;
    assert.equal(after.length,before.length);
    assert.equal(after.find(item=>item.id===baby.id)?.birth_time,'08:45');
    const bad=await json('/api/babies/'+baby.id,{method:'PATCH',body:{
      name:baby.name,birthday:baby.birthday,birthTime:'25:61',allergies:baby.allergies,notes:baby.notes
    }});
    assert.equal(bad.status,400);
    assert.equal((await json('/api/state')).data.babies.find(item=>item.id===baby.id)?.birth_time,'08:45');
  });
  await step('concurrent record creation is idempotent and baby-scoped',async()=>{
    const requestId='e1000000-0000-4000-8000-000000000001';
    const payload={babyId,requestId,day:'2026-08-01',weight:11.2,notes:'race regression'};
    const [a,b]=await Promise.all([
      json('/api/records/growth',{method:'POST',body:payload}),
      json('/api/records/growth',{method:'POST',body:payload})
    ]);
    assert.ok([200,201].includes(a.status),JSON.stringify(a.data));
    assert.ok([200,201].includes(b.status),JSON.stringify(b.data));
    assert.equal(a.data.id,b.data.id,'lost responses must not create duplicate rows');
    const firstBaby=(await json('/api/records/growth?babyId='+babyId)).data.items;
    const secondBaby=(await json('/api/records/growth?babyId='+secondBabyId)).data.items;
    assert.equal(firstBaby.filter(x=>x.id===a.data.id).length,1);
    assert.equal(secondBaby.some(x=>x.id===a.data.id),false);
    const conflict=await json('/api/records/growth',{method:'POST',body:{...payload,babyId:secondBabyId}});
    assert.equal(conflict.status,409,'the same client request ID cannot write to another baby');
    assert.equal((await json('/api/records/growth/'+a.data.id,{method:'DELETE'})).status,200);
  });
  await step('cross-baby milestone CRUD and metadata are isolated',async()=>{
    const created=await json('/api/records/milestones',{method:'POST',body:{
      babyId:secondBabyId,day:'2026-08-02',title:'Baby B milestone',description:'not baby A'
    }});
    assert.equal(created.status,201,JSON.stringify(created.data));
    assert.equal((await json('/api/records/milestones?babyId='+babyId)).data.items.some(x=>x.id===created.data.id),false);
    assert.equal((await json('/api/records/milestones?babyId='+secondBabyId)).data.items.some(x=>x.id===created.data.id),true);
    assert.equal((await json('/api/records/milestones/'+created.data.id,{method:'DELETE'})).status,200);
    assert.equal((await json('/api/records/milestones?babyId='+secondBabyId)).data.items.some(x=>x.id===created.data.id),false);
    assert.equal((await json('/api/trash/milestones/'+created.data.id+'/restore',{method:'POST',body:{}})).status,200);
    assert.equal((await json('/api/records/milestones?babyId='+secondBabyId)).data.items.some(x=>x.id===created.data.id),true);
  });
  await step('write endpoints reject cross-origin requests even with a valid session',async()=>{
    const attack=await json('/api/records/milestones',{method:'POST',
      headers:{Origin:'https://attacker.invalid'},body:{babyId,day:'2026-08-01',title:'CSRF'}});
    assert.equal(attack.status,403);
    assert.equal(attack.data.error,'ORIGIN_REJECTED');
    assert.equal((await json('/api/records/milestones?babyId='+babyId)).data.items.some(x=>x.title==='CSRF'),false);
  });
  await step('growth measurement create, list, and delete',async()=>{
    const created=await json('/api/records/growth',{method:'POST',body:{
      babyId,day:'2026-01-15',weight:10.2,height:75,headCircumference:46,notes:'local test'
    }});
    assert.equal(created.status,201,JSON.stringify(created.data));
    const list=await json('/api/records/growth?babyId='+babyId+'&page=0');
    assert.equal(list.status,200);
    assert.equal(list.data.items[0].weight,10.2);
    const state=await json('/api/state');
    assert.equal(state.data.countsByBaby[babyId].growth,1);
    assert.equal(state.data.countsByBaby[secondBabyId]?.growth??0,0,'Other baby must not inherit first growth totals');
    assert.equal((await json('/api/records/growth/'+created.data.id,{method:'DELETE'})).status,200);
    assert.equal((await json('/api/records/growth?babyId='+babyId)).data.items.length,0);
    assert.ok((await json('/api/trash')).data.growth.some(x=>x.id===created.data.id));
    assert.equal((await json('/api/trash/growth/'+created.data.id+'/restore',{method:'POST',body:{}})).status,200);
    assert.ok((await json('/api/growth/history?babyId='+babyId)).data.items.some(x=>x.id===created.data.id));
    assert.equal((await json('/api/records/growth/'+created.data.id,{method:'DELETE'})).status,200);
  });
  await step('milestone create, list, and delete',async()=>{
    const created=await json('/api/records/milestones',{method:'POST',
      body:{babyId,day:'2026-01-15',title:'First smile',description:'E2E only'}});
    assert.equal(created.status,201,JSON.stringify(created.data));
    const list=await json('/api/records/milestones?babyId='+babyId);
    assert.equal(list.status,200);assert.equal(list.data.items[0].title,'First smile');
    assert.equal((await json('/api/records/milestones/'+created.data.id,{method:'DELETE'})).status,200);
    assert.equal((await json('/api/trash/milestones/'+created.data.id+'/restore',{method:'POST',body:{}})).status,200);
  });
  await step('encrypted OpenRouter config without contacting external service',async()=>{
    const deployed=process.env.E2E_DEPLOY_KEY==='1';
    const before=(await json('/api/state')).data.openrouter;
    assert.equal(before.configured,deployed);
    assert.equal(before.managedByDeployment,deployed);
    const keyAttempt=await json('/api/settings/openrouter',{method:'POST',body:{model:'openai/gpt-4.1-mini',apiKey:'sk-or-local-fake-key-never-sent'}});
    if(deployed){
      assert.equal(keyAttempt.status,409);
      assert.equal(keyAttempt.data.error,'OPENROUTER_MANAGED_BY_DEPLOYMENT');
      assert.equal((await json('/api/settings/openrouter',{method:'POST',body:{model:'openai/gpt-4.1-mini'}})).status,200);
      const state=await json('/api/state');
      assert.equal(state.data.openrouter.configured,true);
      assert.equal(state.data.openrouter.managedByDeployment,true);
      assert.equal(JSON.stringify(state.data).includes('sk-or-e2e'),false);
      return;
    }
    assert.equal(keyAttempt.status,200);
    const saved=await json('/api/settings/openrouter',{method:'POST',body:{model:'openai/gpt-4.1-mini'}});
    assert.equal(saved.status,200,JSON.stringify(saved.data));
    const state=await json('/api/state');
    assert.equal(state.data.openrouter.configured,true);
    assert.equal(state.data.openrouter.managedByDeployment,false);
    assert.equal(JSON.stringify(state.data).includes('sk-or-local-fake'),false);
  });
  await step('browser upload performance metric endpoint is authenticated and excludes user identifiers',async()=>{
    const metric={stage:'client',size:1048576,durationMs:1200,status:'ok'};
    assert.equal((await json('/api/upload/metrics',{method:'POST',anonymous:true,body:metric})).status,401);
    assert.equal((await json('/api/upload/metrics',{method:'POST',body:metric,headers:{Origin:'https://attacker.invalid'}})).status,403);
    assert.equal((await json('/api/upload/metrics',{method:'POST',body:{...metric,stage:'filename'}})).status,400);
    assert.equal((await json('/api/upload/metrics',{method:'POST',body:{...metric,durationMs:Infinity}})).status,400);
    assert.equal((await json('/api/upload/metrics',{method:'POST',body:metric})).status,200);
  });
  await step('direct photo fast path is private, idempotent and does not create multipart sessions',async()=>{
    const id='2f0e90a1-bb1a-4f3f-8090-99f26a000001';
    const sample=Uint8Array.from([255,216,255,224,0,16,74,70,73,70,73,255,217]);
    const headers={'Content-Type':'image/jpeg','x-baby-id':babyId,'x-upload-day':'2026-01-12',
     'x-upload-title':encodeURIComponent('小照片.jpg'),'x-upload-description':encodeURIComponent('第一次看到小猫')};
    assert.equal((await json('/api/upload/direct/'+id,{method:'PUT',body:sample,headers,anonymous:true})).status,401);
    assert.equal((await json('/api/upload/direct/'+id,{method:'PUT',body:sample,headers:{...headers,Origin:'https://attacker.invalid'}})).status,403);
    assert.equal((await json('/api/upload/direct/'+id,{method:'PUT',body:sample,headers:{...headers,'Content-Type':'text/html'}})).status,400);
    const first=await json('/api/upload/direct/'+id,{method:'PUT',body:sample,headers});
    assert.equal(first.status,201,JSON.stringify(first.data));
    const repeat=await json('/api/upload/direct/'+id,{method:'PUT',body:sample,headers});
    assert.equal(repeat.status,200);assert.equal(repeat.data.alreadyCompleted,true);
    const conflict=await json('/api/upload/direct/'+id,{method:'PUT',body:Uint8Array.from([...sample,1]),headers});
    assert.equal(conflict.status,409);
    const read=await request('/api/media/'+id+'/content');
    assert.equal(read.status,200);assert.deepEqual(new Uint8Array(await read.arrayBuffer()),sample);
    const list=await json('/api/media?babyId='+babyId);
    assert.equal(list.data.items.filter(item=>item.id===id).length,1);
    assert.equal(list.data.items.find(item=>item.id===id).description,'第一次看到小猫');
    const pending=await json('/api/upload/pending?babyId='+babyId);
    assert.equal(pending.data.items.some(item=>item.id===id),false);
    assert.equal((await json('/api/media/'+id,{method:'DELETE'})).status,200);
  });
  let mediaId,original;
  await step('image multipart start and pending incomplete uploads',async()=>{
    original=Uint8Array.from([255,216,255,224,1,2,3,4,5,255,217]);
    const pending=await json('/api/upload/start',{method:'POST',body:{
      babyId,day:'2026-01-15',title:'family-photo.jpg',description:'周末一起玩耍',mime:'image/jpeg',size:original.length,
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
    assert.equal(list.data.items[0].description,'周末一起玩耍');
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
    assert.equal(once.data.items.find(x=>x.id===mediaId).description,'周末一起玩耍');
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
    const edited=await json('/api/media/'+mediaId,{method:'PATCH',body:{title:'Edited photo',day:'2026-02-01',description:'春游第一天'}});
    assert.equal(edited.status,200);
    const list=await json('/api/media?babyId='+babyId);
    assert.equal(list.data.items[0].title,'Edited photo');
    assert.equal(list.data.items[0].day,'2026-02-01');
    assert.equal(list.data.items[0].description,'春游第一天');
    assert.ok((await json('/api/media?babyId='+babyId+'&q='+encodeURIComponent('春游'))).data.items.some(x=>x.id===mediaId));
    assert.equal((await json('/api/media/'+mediaId,{method:'PATCH',body:{day:'2026-02-01',description:'x'.repeat(1001)}})).status,400);
    assert.equal((await json('/api/media/'+mediaId,{method:'PATCH',body:{day:'2026-02-01',description:''}})).status,200);
    assert.equal((await json('/api/media?babyId='+babyId)).data.items[0].description,'');
    assert.equal((await json('/api/media/'+mediaId+'/favorite',{method:'POST',body:{favorite:true}})).status,404);
    assert.ok((await json('/api/media?babyId='+babyId+'&q=Edited')).data.items.some(x=>x.id===mediaId));
    assert.equal((await json('/api/media?babyId='+babyId+'&q=missing')).data.items.length,0);
    const etag=(await request('/api/media/'+mediaId+'/thumbnail')).headers.get('etag');
    assert.ok(etag);
    assert.equal((await request('/api/media/'+mediaId+'/thumbnail',{headers:{'If-None-Match':etag}})).status,304);
  });
  await step('media deletion hides originals and supports recovery',async()=>{
    assert.equal((await json('/api/media/'+mediaId,{method:'DELETE'})).status,200);
    assert.equal((await json('/api/media/'+mediaId+'/content')).status,404);
    assert.equal((await json('/api/media/'+mediaId+'/thumbnail')).status,404);
    assert.ok((await json('/api/trash')).data.media.some(x=>x.id===mediaId));
    assert.equal((await json('/api/trash/media/'+mediaId+'/restore',{method:'POST',body:{}})).status,200);
    assert.equal((await json('/api/media/'+mediaId+'/content')).status,200);
    assert.equal((await json('/api/media/'+mediaId,{method:'DELETE'})).status,200);
  });
  await step('two-part 8MiB+ upload resumes the saved multipart state',async()=>{
    const chunkSize=8388608;
    const size=chunkSize+37;
    const file=new Uint8Array(size);
    file.fill(31);
    file[0]=0;file[1]=0;file[size-1]=99;
    const created=await json('/api/upload/start',{method:'POST',body:{
      babyId,day:'2026-01-15',title:'two-parts.mp4',description:'周末在湖边跑步',mime:'video/mp4',size,
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
    assert.equal((await json('/api/media?babyId='+babyId)).data.items.find(x=>x.id===id).description,'周末在湖边跑步');
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
  await step('record writes are idempotent after lost HTTP response',async()=>{
    const requestId='c3843867-bf72-46e8-bc23-9936f60fc902';
    const payload={babyId,day:'2026-02-02',weight:10.1,requestId};
    const first=await json('/api/records/growth',{method:'POST',body:payload});
    const retry=await json('/api/records/growth',{method:'POST',body:payload});
    assert.equal(first.status,201);assert.equal(retry.status,200);
    assert.equal(retry.data.id,first.data.id);
    assert.equal((await json('/api/growth/history?babyId='+babyId)).data.items.filter(x=>x.id===first.data.id).length,1);
    const eventPayload={babyId,day:'2026-02-02',title:'Idempotent milestone',requestId:'c3843867-bf72-46e8-bc23-9936f60fc903'};
    const created=await json('/api/records/milestones',{method:'POST',body:eventPayload});
    const again=await json('/api/records/milestones',{method:'POST',body:eventPayload});
    assert.equal(created.status,201);assert.equal(again.status,200);assert.equal(again.data.id,created.data.id);
  });
  await step('media validation rejects invalid MIME, oversize and bad multipart parts',async()=>{
    const invalid=await json('/api/upload/start',{method:'POST',body:{
      babyId,day:'2026-08-05',title:'script.svg',mime:'image/svg+xml',size:200
    }});
    assert.equal(invalid.status,400);
    const huge=await json('/api/upload/start',{method:'POST',body:{
      babyId,day:'2026-08-05',title:'oversize.mov',mime:'video/quicktime',size:209715201
    }});
    assert.equal(huge.status,400);
    const start=await json('/api/upload/start',{method:'POST',body:{
      babyId:secondBabyId,day:'2026-08-05',title:'video.mp4',mime:'video/mp4',size:32
    }});
    assert.equal(start.status,201,JSON.stringify(start.data));
    const id=start.data.id;
    const badPart=await json('/api/upload/'+id+'/part/1',{method:'PUT',body:new Uint8Array(31),
      headers:{'Content-Type':'application/octet-stream'}});
    assert.equal(badPart.status,413);
    const missingPart=await json('/api/upload/'+id+'/finish',{method:'POST',body:{}});
    assert.equal(missingPart.status,400);
    assert.equal(missingPart.data.error,'UPLOAD_INCOMPLETE');
    const video=Uint8Array.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,109,112,52,50,
      0,0,0,0,0,0,0,0,0,0,0,0]);
    assert.equal((await json('/api/upload/'+id+'/part/1',{method:'PUT',body:video,
      headers:{'Content-Type':'application/octet-stream'}})).status,200);
    assert.ok([200,201].includes((await json('/api/upload/'+id+'/finish',{method:'POST',body:{}})).status));
    const range=await request('/api/media/'+id+'/content',{headers:{Range:'bytes=4-11'}});
    assert.equal(range.status,206);
    assert.equal(range.headers.get('content-range'),'bytes 4-11/32');
    assert.deepEqual(new Uint8Array(await range.arrayBuffer()),video.slice(4,12));
    const listing=(await json('/api/media?babyId='+secondBabyId)).data.items;
    assert.ok(listing.some(x=>x.id===id&&x.mime==='video/mp4'));
    assert.equal((await json('/api/media?babyId='+babyId)).data.items.some(x=>x.id===id),false);
    const saved=sessionCookie;sessionCookie='';
    try{
      assert.equal((await request('/api/media/'+id+'/content')).status,401);
      assert.equal((await request('/api/media/'+id+'/thumbnail')).status,401);
    }finally{sessionCookie=saved}
    assert.equal((await json('/api/media/'+id,{method:'DELETE'})).status,200);
    assert.equal((await request('/api/media/'+id+'/content')).status,404);
    assert.equal((await json('/api/trash/media/'+id+'/restore',{method:'POST',body:{}})).status,200);
    assert.equal((await request('/api/media/'+id+'/content')).status,200);
  });
  await step('records export protects private data',async()=>{
    assert.equal((await json('/api/export/records',{anonymous:true})).status,401);
    const v=await json('/api/export/records');assert.equal(v.status,200);
    assert.equal(v.data.schema,'babymemo-family-export-v2');
    assert.equal(JSON.stringify(v.data).includes('sk-or-local-fake'),false);
  });
  await step('web editing is authenticated, baby-scoped, versioned and retry-safe',async()=>{
    const created=await json('/api/records/growth',{method:'POST',body:{babyId,day:'2026-10-12',weight:10.1,notes:'web-edit-fixture',requestId:crypto.randomUUID()}});
    assert.equal(created.status,201);const id=created.data.id;
    const before=await json('/api/records/growth/'+id);assert.equal(before.status,200);
    const requestId=crypto.randomUUID(),payload={babyId,day:'2026-10-12',weight:10.2,height:null,headCircumference:null,notes:'web-edited',expectedUpdatedAt:before.data.updated_at};
    const request={method:'PATCH',headers:{'X-Request-Id':requestId},body:payload};
    assert.equal((await json('/api/records/growth/'+id,{...request,anonymous:true})).status,401);
    assert.equal((await json('/api/records/growth/'+id,{...request,body:{...payload,babyId:secondBabyId}})).status,404);
    assert.equal((await json('/api/records/growth/'+id,request)).status,200);
    const changed=await json('/api/records/growth/'+id);assert.equal(changed.data.weight,10.2);assert.notEqual(changed.data.updated_at,before.data.updated_at);
    assert.equal((await json('/api/records/growth/'+id,{method:'PATCH',body:{...payload,weight:10.3}})).status,409);
    assert.equal((await json('/api/records/growth/'+id,{method:'PATCH',body:{...payload,weight:10.4,expectedUpdatedAt:changed.data.updated_at}})).status,200);
    assert.equal((await json('/api/records/growth/'+id,request)).status,200);
    assert.equal((await json('/api/records/growth/'+id)).data.weight,10.4,'lost-response replay must preserve a later edit');
    assert.equal((await json('/api/records/growth/'+id,{...request,body:{...payload,weight:10.8}})).status,409);
    const filtered=await json('/api/records/growth?babyId='+babyId+'&q=web-edited&startDay=2026-10-12&endDay=2026-10-12');assert.equal(filtered.data.items.length,1);
    const deletion={method:'DELETE',headers:{'X-Request-Id':crypto.randomUUID()},body:{babyId}};
    assert.equal((await json('/api/records/growth/'+id,deletion)).status,200);
    assert.equal((await json('/api/trash/growth/'+id+'/restore',{method:'POST',body:{}})).status,200);
    assert.equal((await json('/api/records/growth/'+id,deletion)).status,200);
    assert.equal((await json('/api/records/growth/'+id)).status,200,'delete replay must not delete a restored row');
  });
  await step('full baby editing, private avatar, archiving and complete ZIP export',async()=>{
    const created=await json('/api/babies',{method:'POST',headers:{'X-Request-Id':crypto.randomUUID()},body:{name:'Export Fixture',birthday:'2025-02-02',birthTime:'12:34',gender:'girl',timeZone:'Asia/Shanghai',allergies:''}});
    assert.equal(created.status,201);const id=created.data.id;
    const profile=(await json('/api/state')).data.babies.find(b=>b.id===id);
    assert.equal((await json('/api/babies/'+id,{method:'PATCH',body:{name:profile.name,birthday:profile.birthday,birthTime:'13:45',gender:'boy',timeZone:'Asia/Tokyo',allergies:'花生',notes:'full profile fixture',expectedUpdatedAt:profile.updated_at}})).status,200);
    const avatarId=crypto.randomUUID(),avatarPath='/api/babies/'+id+'/avatar',avatar=Uint8Array.from([255,216,255,224,0,16,255,217]);
    assert.equal((await request(avatarPath,{method:'PUT',body:avatar,headers:{'Content-Type':'image/jpeg','X-Avatar-Id':avatarId}})).status,200);
    assert.equal((await request(avatarPath,{anonymous:true})).status,401);
    assert.deepEqual(new Uint8Array(await (await request(avatarPath)).arrayBuffer()),avatar);
    assert.equal((await request(avatarPath,{method:'PUT',body:avatar,headers:{'Content-Type':'image/jpeg','X-Avatar-Id':avatarId}})).status,200);
    const moment=await json('/api/records/milestones',{method:'POST',body:{babyId:secondBabyId,day:'2026-10-12',title:'Export relation fixture',description:''}});
    const linkedMedia=(await json('/api/media?babyId='+secondBabyId)).data.items[0];
    assert.match(moment.data.id,/^[a-f0-9-]{36}$/i);assert.match(linkedMedia.id,/^[a-f0-9-]{36}$/i);
    runCli(['d1','execute','DB','--local','--persist-to',dir,'--command',"INSERT INTO milestone_media(milestone_id,media_id) VALUES('"+moment.data.id+"','"+linkedMedia.id+"')"]);
    const metadata=await json('/api/export/records');assert.equal(metadata.data.babies.find(b=>b.id===id).birth_time,'13:45');assert.ok(metadata.data.milestoneMedia.some(link=>link.milestone_id===moment.data.id&&link.media_id===linkedMedia.id));
    assert.equal((await json('/api/records/milestones?babyId='+secondBabyId)).data.items.find(row=>row.id===moment.data.id).media[0].id,linkedMedia.id);
    assert.equal((await request('/api/export/full',{anonymous:true})).status,401);
    const full=await request('/api/export/full');assert.equal(full.status,200);assert.match(full.headers.get('content-type'),/application\/zip/);
    const archive=join(dir,'synthetic-family.zip');writeFileSync(archive,new Uint8Array(await full.arrayBuffer()));
    const verified=spawnSync('python3',['-c',"import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; data=json.loads(z.read('records.json')); assert 'milestoneMedia' in data; assert any(b['birth_time']=='13:45' and b['allergies']=='花生' for b in data['babies']); assert any(n.startswith('avatars/') for n in z.namelist()); assert any(n.startswith('media/') for n in z.namelist()); print('FULL_EXPORT_OK')",archive],{encoding:'utf8'});
    assert.equal(verified.status,0,verified.stderr);
    const currentAvatarProfile=(await json('/api/state')).data.babies.find(b=>b.id===id);
    assert.equal((await request(avatarPath,{method:'PUT',body:avatar,headers:{'Content-Type':'image/jpeg','X-Expected-Version':profile.updated_at}})).status,409,'stale avatar must not overwrite a new profile');
    const removeAvatar={method:'DELETE',headers:{'X-Request-Id':crypto.randomUUID()},body:{expectedUpdatedAt:currentAvatarProfile.updated_at}};
    const removedAvatar=await json(avatarPath,removeAvatar);assert.equal(removedAvatar.status,200);
    assert.equal((await request(avatarPath,{method:'PUT',body:avatar,headers:{'Content-Type':'image/jpeg','X-Expected-Version':removedAvatar.data.updated_at}})).status,200);
    assert.equal((await json(avatarPath,removeAvatar)).status,200);
    assert.equal((await request(avatarPath)).status,200,'delete retry must preserve a replacement avatar');
    assert.equal((await json('/api/babies/'+id,{method:'DELETE',body:{}})).status,200);assert.equal((await json('/api/state')).data.babies.some(b=>b.id===id),false);
    assert.equal((await json('/api/babies/archived/list')).data.items.some(b=>b.id===id),true);
    assert.equal((await json('/api/babies/'+id+'/restore',{method:'POST',body:{}})).status,200);
    assert.equal((await request(avatarPath)).status,200);
    assert.equal((await json('/api/babies/'+id,{method:'DELETE',body:{}})).status,200);
  });
  await step('WeChat photo default baby is private, validated and changeable',async()=>{
    assert.equal((await json('/api/settings/wechat/default-baby',{method:'POST',anonymous:true,body:{babyId:secondBabyId}})).status,401);
    assert.equal((await json('/api/settings/wechat/default-baby',{method:'POST',body:{babyId:'unknown-baby'}})).status,404);
    assert.equal((await json('/api/settings/wechat/default-baby',{method:'POST',body:{babyId:secondBabyId}})).status,200);
    assert.equal((await json('/api/state')).data.wechat.defaultBabyId,secondBabyId);
    assert.equal((await json('/api/settings/wechat/default-baby',{method:'POST',body:{babyId:''}})).status,200);
    assert.equal((await json('/api/state')).data.wechat.defaultBabyId,'');
  });
  await step('WeChat member management rejects unauthenticated, invalid and missing accounts',async()=>{
    const connections=(await json('/api/state')).data.wechat.connections;
    assert.ok(Array.isArray(connections));assert.equal(connections.length,0);
    assert.equal((await json('/api/settings/wechat/qr',{method:'POST',body:{label:''}})).status,400);
    assert.equal((await json('/api/settings/wechat/qr/status',{method:'POST',body:{pairingId:'not-a-uuid'}})).status,400);
    const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    assert.equal((await json('/api/settings/wechat/connections/'+id+'/start',{method:'POST',body:{}})).status,404);
    assert.equal((await json('/api/settings/wechat/connections/'+id+'/status')).status,404);
    assert.equal((await json('/api/settings/wechat/connections/'+id,{method:'DELETE'})).status,404);
    assert.equal((await json('/api/settings/wechat/connections/'+id+'/start',{method:'POST',anonymous:true,body:{}})).status,401);
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
  const browser=await engine.launch(useWebKit?{headless:true}:{...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH}:{channel:'chrome'}),headless:true,args:['--no-sandbox']});
  const errors=[];
  try{
    const context=await browser.newContext({viewport:{width:1280,height:860},...(useWebKit?{isMobile:true,hasTouch:true,deviceScaleFactor:2}:{})});
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await step((useWebKit?'WebKit':'Chromium')+': public interactive preview is read-only and mobile friendly',async()=>{
      const preview=await context.newPage();
      const requests=[];
      preview.on('pageerror',error=>errors.push('demo: '+error.message));
      await preview.route('**/api/**',route=>{requests.push(route.request().url());return route.abort();});
      // UI checks must not depend on a third-party image service being reachable in CI.
      await preview.route('https://images.unsplash.com/**',route=>route.abort());
      try{
        await preview.goto(base+'/demo.html',{waitUntil:'domcontentloaded'});
        await preview.getByRole('heading',{name:'小星星'}).waitFor({timeout:20000});
        await preview.locator('.home-photo-cover').waitFor();
        await preview.getByText('追着泡泡跑的下午').waitFor();
        await preview.screenshot({path:join(evidence,'demo-desktop.png'),fullPage:true});
        await preview.getByRole('button',{name:/查看相册/}).click();
        await preview.locator('.photo-story').first().waitFor();
        assert.ok(await preview.locator('.photo-story').count()>1);
        const mode=preview.getByRole('group',{name:'相册浏览方式'});
        assert.equal(await mode.getByRole('button',{name:'故事'}).getAttribute('aria-pressed'),'true');
        await preview.getByRole('button',{name:'照片墙'}).click();
        assert.equal(await mode.getByRole('button',{name:'照片墙'}).getAttribute('aria-pressed'),'true');
        await preview.locator('.photo-item').first().waitFor();
        await preview.locator('.photo-item .photo-preview').first().click();
        await preview.getByRole('dialog',{name:'照片故事'}).waitFor();
        await preview.getByRole('button',{name:'下一张'}).click();
        await preview.keyboard.press('Escape');
        await preview.getByRole('dialog',{name:'照片故事'}).waitFor({state:'hidden'});
        await preview.locator('.photo-item .photo-preview').first().click();
        await preview.getByRole('button',{name:'关闭照片详情'}).click();
        for(const width of [320,375,390,768,1280]){
          await preview.setViewportSize({width,height:812});
          const overflow=await preview.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
          assert.equal(overflow,false,'Demo horizontal overflow at '+width);
          if(width===320||width===390||width===1280){
            await preview.screenshot({path:join(evidence,'design-system-demo-album-'+width+'.png'),fullPage:true});
          }
        }
        await preview.setViewportSize({width:375,height:812});
        await preview.locator('.mobile-nav').getByRole('button',{name:'成长'}).click();
        await preview.getByRole('heading',{name:'成长记录'}).waitFor();
        await preview.locator('.growth-svg').waitFor();
        await preview.screenshot({path:join(evidence,'demo-mobile.png'),fullPage:true});
        assert.deepEqual(requests,[],'Preview must never call the private family API');
      }finally{await preview.close();}
    });
    await step((useWebKit?'WebKit':'Chromium')+': dedicated mobile demo remains interactive in phone and desktop views',async()=>{
      const preview=await context.newPage(),requests=[];
      preview.on('pageerror',error=>errors.push('mobile demo: '+error.message));
      await preview.route('**/api/**',route=>{requests.push(route.request().url());return route.abort()});
      await preview.route('https://images.unsplash.com/**',route=>route.abort());
      try{
        await preview.goto(base+'/demo/mobile',{waitUntil:'domcontentloaded'});
        const frame=preview.frameLocator('iframe[title="BabyMemo 移动端交互演示"]');
        await frame.getByRole('heading',{name:'小星星'}).waitFor();
        await frame.getByRole('button',{name:/查看相册/}).click();
        await frame.getByRole('button',{name:'照片墙'}).click();
        await frame.locator('.photo-item').first().click();
        await frame.getByRole('dialog',{name:'照片故事'}).waitFor();
        await frame.getByRole('button',{name:'关闭照片详情'}).click();
        await preview.screenshot({path:join(evidence,'mobile-demo-desktop-frame.png'),fullPage:true});
        await preview.setViewportSize({width:390,height:844});
        await preview.reload({waitUntil:'domcontentloaded'});
        await preview.getByRole('heading',{name:'小星星'}).waitFor();
        assert.equal(await preview.locator('iframe').count(),0,'Phone should use direct React Demo, not a nested iframe');
        await preview.locator('.mobile-nav').getByRole('button',{name:'相册'}).click();
        await preview.getByRole('button',{name:'照片墙'}).click();
        await preview.locator('.photo-item').first().waitFor();
        assert.equal(await preview.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'mobile demo must not overflow at 390px');
        await preview.screenshot({path:join(evidence,'mobile-demo-phone.png'),fullPage:true});
        assert.deepEqual(requests,[],'Demo must never call private API');
      }finally{await preview.close()}
    });
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
      await page.getByRole('heading',{name:'Test Baby'}).waitFor({timeout:20000});
      const imageAssets=await page.evaluate(async()=>{
        return Promise.all(['/icon-512.png','/icon-192.png','/apple-touch-icon.png','/favicon-32.png'].map(async path=>{
          const image=new Image();image.src=path;await image.decode();return [image.naturalWidth,image.naturalHeight];
        }));
      });
      assert.deepEqual(imageAssets,[[512,512],[192,192],[180,180],[32,32]],'PWA icons must decode in a real browser');
      assert.equal((await page.locator('.topbar .space-name').textContent())?.trim(),'E2E Test Home');
      assert.equal((await page.locator('.sidebar .side-space-name').textContent())?.trim(),'E2E Test Home');
      await page.screenshot({path:join(evidence,'desktop-overview.png'),fullPage:true});
    });
    await step((useWebKit?'WebKit':'Chromium')+': page reload and new tab reuse the same login',async()=>{
      // Local HTTP browser cookie metadata differs from production HTTPS.
      // The Worker HTTP test asserts persistent Max-Age and security flags;
      // this browser test verifies that reload/new tab actually remain signed in.
      await page.reload({waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{name:'Test Baby'}).waitFor({timeout:20000});
      assert.equal(await page.locator('input[autocomplete="current-password"]').count(),0);
      const another=await context.newPage();
      try{
        await another.goto(base+'/',{waitUntil:'domcontentloaded'});
        await another.getByRole('heading',{name:'Test Baby'}).waitFor({timeout:20000});
        assert.equal(await another.locator('input[autocomplete="current-password"]').count(),0);
      }finally{await another.close();}
    });
    await step((useWebKit?'WebKit':'Chromium')+': add baby through Settings and switch back',async()=>{
      await page.locator('.sidebar .nav-link').filter({hasText:'设置'}).click();
      await page.getByRole('heading',{name:'设置'}).waitFor();
      await page.getByRole('button',{name:'新增宝宝'}).click();
      const create=page.locator('.baby-create-form');
      await create.getByLabel('宝宝名字').fill('Browser New Baby');
      await create.getByLabel('出生日期').fill('2025-06-06');
      await create.getByLabel('性别').selectOption('girl');
      await create.getByRole('button',{name:/创建并切换到新宝宝/}).click();
      await page.getByRole('heading',{name:'Browser New Baby'}).waitFor({timeout:15000}).catch(async error=>{console.error('Synthetic new-baby failure view: '+(await page.locator('body').innerText()).slice(0,4000));await page.screenshot({path:join(evidence,'new-baby-failure.png'),fullPage:true});throw error});
      assert.equal(await page.locator('.page-heading select[aria-label="选择宝宝"]').count(),0);
      await page.locator('.sidebar .nav-link').filter({hasText:'设置'}).click();
      const picker=page.locator('.settings-baby-switch select[aria-label="选择宝宝"]');
      await picker.waitFor();
      const options=await picker.locator('option').allTextContents();
      assert.ok(options.includes('Test Baby'));
      assert.ok(options.includes('Second Baby'));
      assert.ok(options.includes('Browser New Baby'));
      assert.equal(await picker.locator('option:checked').textContent(),'Browser New Baby');
      await picker.selectOption({label:'Test Baby'});
      assert.equal(await picker.locator('option:checked').textContent(),'Test Baby');
    });
    await step((useWebKit?'WebKit':'Chromium')+': gallery is photo-first; maintenance is out of product',async()=>{
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
      await page.locator('.sidebar .nav-link').filter({hasText:'相册'}).click();
      await page.locator('.photo-preview').first().waitFor({state:'visible',timeout:15000});
      assert.equal(await page.locator('.thumbnail-backfill').count(),0);
      assert.equal(await page.locator('.upload-card').count(),0);
      const state=await json('/api/media/thumbnail-backfill?babyId='+(await json('/api/state')).data.babies[0].id);
      assert.equal(state.data.items.some(item=>item.id===upload.data.id),true);
    });
    await step((useWebKit?'WebKit slow network':'Chromium')+': gallery image upload and private preview',async()=>{
      await page.locator('.sidebar .nav-link').filter({hasText:'相册'}).click();
      await page.getByRole('heading',{name:'相册'}).waitFor();
      // A tiny valid PNG; user photos and R2 production storage are untouched.
      const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ln0AAAAASUVORK5CYII=','base64');
      await page.getByRole('button',{name:'添加照片或视频'}).click();
      await page.getByLabel('描述（可选，本次选择的照片或视频共用）').fill('浏览器上传的描述');
      await page.locator('input[type="file"]').setInputFiles({
        name:'browser-e2e.png',mimeType:'image/png',buffer:png
      });
      await page.locator('.photo-story-text').filter({hasText:'浏览器上传的描述'}).first().waitFor({state:'visible',timeout:30000});
      await page.getByRole('button',{name:'照片墙'}).click();
      assert.equal(await page.locator('.photo-stories').count(),0);
      await page.getByRole('button',{name:'故事'}).click();
      await page.locator('.photo-story').filter({hasText:'浏览器上传的描述'}).first().getByRole('button',{name:/预览/}).click();
      await page.getByRole('dialog',{name:'相册预览'}).waitFor();
      const img=page.locator('.media-viewer-stage img');
      assert.equal(await page.getByRole('button',{name:'收藏'}).count(),0);
      assert.equal(await page.getByText('仅看收藏').count(),0);
      await img.waitFor();
      await page.waitForFunction(()=>document.querySelector('.media-viewer-stage img')?.naturalWidth > 0);
      await page.locator('.media-story-body').filter({hasText:'浏览器上传的描述'}).waitFor();
      assert.equal(await page.locator('.media-viewer-edit').isVisible(),false);
      await page.getByRole('button',{name:'编辑故事'}).click();
      assert.equal(await page.getByLabel('照片或视频描述').inputValue(),'浏览器上传的描述');
      await page.screenshot({path:join(evidence,'desktop-album-viewer.png'),fullPage:false});
    });
    await step((useWebKit?'WebKit':'Chromium')+': gallery metadata edit and delete',async()=>{
            await page.locator('.media-viewer-edit input[type="date"]').fill('2026-02-01');
      await page.getByLabel('照片或视频描述').fill('浏览器编辑后的描述');
      await page.getByRole('button',{name:/保存信息/}).click();
      await page.getByText('照片信息已更新').waitFor({timeout:15000});
      const source=await page.locator('.media-viewer-stage img').getAttribute('src');
      const deletedId=source?.match(/\/api\/media\/([^/]+)\/content/)?.[1];
      assert.ok(deletedId,'viewer must point to real saved media');
      const updated=await json('/api/media?babyId='+(await json('/api/state')).data.babies[0].id);
      assert.equal(updated.data.items.find(item=>item.id===deletedId)?.description,'浏览器编辑后的描述');
      page.once('dialog',dialog=>void dialog.accept());
      await page.getByRole('button',{name:'移入回收站'}).click();
      await page.getByRole('dialog',{name:'相册预览'}).waitFor({state:'hidden',timeout:15000});
      await page.getByText('已移入回收站，可在设置中恢复').waitFor({timeout:15000});
      const remaining=await json('/api/media?babyId='+(await json('/api/state')).data.babies[0].id);
      assert.equal(remaining.data.items.some(item=>item.id===deletedId),false,'deleted media must not appear in the authenticated list');

    });
    await step((useWebKit?'WebKit':'Chromium')+': 390px mobile navigation and horizontal overflow',async()=>{
      await page.setViewportSize({width:390,height:844});
      await page.locator('.mobile-nav button[aria-label="成长"]').click();
      await page.getByRole('heading',{name:'成长记录'}).waitFor();
      const overflow=await page.evaluate(()=>({
        screen:window.innerWidth,scroll:document.documentElement.scrollWidth
      }));
      assert.ok(overflow.scroll<=overflow.screen+1,'mobile horizontal overflow '+JSON.stringify(overflow));
      await page.screenshot({path:join(evidence,'mobile-growth.png'),fullPage:true});
      await page.locator('.mobile-nav button[aria-label="相册"]').click();
      await page.getByRole('heading',{name:'相册'}).waitFor();
      assert.equal(await page.locator('.upload-card').count(),0);
      await page.screenshot({path:join(evidence,'mobile-album.png'),fullPage:true});
    });
    await step((useWebKit?'WebKit':'Chromium')+': expanded filters stay inside narrow Safari viewports',async()=>{
      for(const width of [320,375,390,430]){
        await page.setViewportSize({width,height:844});
        for(const nav of ['成长','相册']){
          await page.locator('.mobile-nav button[aria-label="'+nav+'"]').click();
          const toggle=page.locator('.record-filter-toggle');
          await toggle.click();
          assert.equal(await toggle.getAttribute('aria-expanded'),'true','filter panel failed to expand');
          const measure=await page.locator('.record-filter-fields input[type="date"]').evaluateAll(inputs=>
            inputs.map(input=>{const r=input.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width}}));
          assert.equal(measure.length,2,'both date filters remain available');
          for(const input of measure)assert.ok(input.left>=-1&&input.right<=width+1,'Date input overflow '+width+'px '+nav+': '+JSON.stringify(input));
          const overflow=await page.evaluate(()=>document.documentElement.scrollWidth);
          assert.ok(overflow<=width+1,'Expanded filter overflow at '+width+'px '+nav+': '+overflow);
          await toggle.click();
        }
      }
      await page.setViewportSize({width:390,height:844});
    });
    await step((useWebKit?'WebKit':'Chromium')+': four responsive widths across primary views',async()=>{
      // Browser viewports prove layout contracts, not physical iPhone behavior.
      const cases=[320,375,390,768],views=[
        ['首页','Test Baby'],
        ['成长','成长记录'],
        ['相册','相册'],
        ['设置','设置']
      ];
      for(const width of cases){
        await page.setViewportSize({width,height:844});
        for(const [nav,heading] of views){
          await page.locator('.mobile-nav button[aria-label="'+nav+'"]').click();
          await page.getByRole('heading',{name:heading,exact:true}).waitFor({timeout:12000});
          const result=await page.evaluate(()=>({
            width:window.innerWidth,html:document.documentElement.scrollWidth,
            body:document.body.scrollWidth
          }));
          assert.ok(Math.max(result.html,result.body)<=result.width+1,
            'Horizontal overflow on '+width+'px '+nav+': '+JSON.stringify(result));
          assert.equal(await page.locator('.topbar .space-name').isVisible(),true,'family name hidden at '+width+'px');
          assert.equal((await page.locator('.topbar .space-name').textContent())?.trim(),'E2E Test Home');
          assert.equal(await page.locator('.page-heading select[aria-label="选择宝宝"]').count(),0);
          if(width===320||width===768)await page.screenshot({
            path:join(evidence,'responsive-'+width+'-'+nav+'.png'),fullPage:true
          });
        }
        const tap=await page.locator('.mobile-nav button').first().evaluate(el=>{
          const box=el.getBoundingClientRect();return {width:box.width,height:box.height};
        });
        assert.ok(tap.width>=44&&tap.height>=44,
          'Mobile tab hit area must be 44px or larger '+JSON.stringify(tap));
      }
      await page.setViewportSize({width:390,height:844});
    });
    await step((useWebKit?'WebKit':'Chromium')+': draft persistence and multi-baby separation',async()=>{
      // Moments are intentionally not a mobile tab in the new photo-first layout.
      const openMoments=async()=>{
        await page.locator('.mobile-nav button[aria-label="首页"]').click();
        await page.getByRole('button',{name:'记录新瞬间'}).click();
        await page.getByRole('heading',{name:'成长瞬间',exact:true}).waitFor();
      };
      await openMoments();
      const input=page.locator('input[placeholder*="第一次独立走路"]');
      await page.locator('.mobile-nav button[aria-label="设置"]').click();
      const picker=page.locator('.settings-baby-switch select[aria-label="选择宝宝"]');
      await picker.selectOption({label:'Test Baby'});
      await openMoments();
      await input.fill('只属于宝宝A的临时草稿');
      await page.locator('.mobile-nav button[aria-label="成长"]').click();
      await openMoments();
      await page.waitForFunction(()=>document.querySelector('input[placeholder*="第一次独立走路"]')?.value==='只属于宝宝A的临时草稿');
      await page.locator('.mobile-nav button[aria-label="设置"]').click();
      await picker.selectOption({label:'Second Baby'});
      await openMoments();
      await page.waitForFunction(()=>document.querySelector('input[placeholder*="第一次独立走路"]')?.value==='');
      await page.locator('.mobile-nav button[aria-label="设置"]').click();
      await picker.selectOption({label:'Test Baby'});
      await openMoments();
      await page.waitForFunction(()=>document.querySelector('input[placeholder*="第一次独立走路"]')?.value==='只属于宝宝A的临时草稿');
      const fontSize=await input.evaluate(el=>Number.parseFloat(getComputedStyle(el).fontSize));
      assert.ok(fontSize>=16,'Mobile Safari text input should not trigger focus zoom');
    });
    await step((useWebKit?'WebKit':'Chromium')+': reduced motion and accessible gallery dialog',async()=>{
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.locator('.mobile-nav button[aria-label="相册"]').click();
      await page.getByRole('heading',{name:'相册'}).waitFor();
      const preview=page.locator('.photo-preview').first();
      await preview.waitFor({timeout:12000});
      await preview.click();
      const dialog=page.getByRole('dialog',{name:'相册预览'});
      await dialog.waitFor();
      const measure=await dialog.evaluate(el=>{
        const rect=el.getBoundingClientRect();
        return {left:rect.left,right:rect.right,viewport:innerWidth,top:rect.top};
      });
      assert.ok(measure.left>=-1&&measure.right<=measure.viewport+1,
        'Media dialog must fit mobile width '+JSON.stringify(measure));
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'detached'});
      const transition=await preview.evaluate(el=>getComputedStyle(el).transitionDuration);
      assert.ok(transition.split(',').every(x=>Number.parseFloat(x)===0),
        'Reduced motion should suppress preview animations: '+transition);
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.screenshot({path:join(evidence,'mobile-album-post-regression.png'),fullPage:true});
    });
    await step((useWebKit?'WebKit':'Chromium')+': original photo EXIF drives the saved date while preserving bytes',async()=>{
      await page.locator('.mobile-nav button[aria-label="相册"]').click();
      const encoded=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);return canvas.toDataURL('image/jpeg').split(',')[1]});
      const image=Buffer.from(encoded,'base64');const original=Buffer.concat([image.subarray(0,2),Buffer.from(exifJpeg().subarray(2,76)),image.subarray(2)]);
      const open=page.getByRole('button',{name:'添加照片或视频',exact:true}).first();await open.click();
      const finished=page.waitForResponse(r=>r.ok()&&(
        /\/api\/upload\/direct\/[^/]+$/.test(r.url())&&r.request().method()==='PUT'||
        /\/api\/upload\/[^/]+\/finish$/.test(r.url())&&r.request().method()==='POST'));
      await page.locator('input[type="file"]').setInputFiles({name:'capture-date-original.jpg',mimeType:'image/jpeg',buffer:original});await finished;
      const state=await page.evaluate(async()=>{const state=await(await fetch('/api/state')).json();const media=await(await fetch('/api/media?babyId='+state.babies[0].id)).json();return {state,media}});
      const saved=state.media.items.find(x=>x.title==='capture-date-original.jpg');assert.ok(saved);assert.equal(saved.day,'2020-09-03');
      const bytes=await(await fetch(base+'/api/media/'+saved.id+'/content',{headers:{Cookie:sessionCookie}})).arrayBuffer();assert.ok(Buffer.from(bytes).equals(original));
    });
    await step((useWebKit?'WebKit':'Chromium')+': family-facing WeChat status across mobile and desktop widths',async()=>{
      // This UI fixture mocks HTTP; isolate it from Service Worker interception.
      // The real application/browser flow keeps Service Workers enabled.
      const statusContext=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',...(useWebKit?{isMobile:true,hasTouch:true,deviceScaleFactor:2}:{})});
      await statusContext.addCookies(await context.cookies());const page=await statusContext.newPage();
      try{
      const stamp=new Date().toISOString();const members=[{id:'status-normal',label:'测试爸爸',enabled:true},{id:'status-saving',label:'测试妈妈',enabled:true},{id:'status-expired',label:'测试外婆',enabled:false},{id:'status-paused',label:'测试爷爷',enabled:false}];
      const statuses=Object.fromEntries(members.map(member=>[member.id,{connectionId:member.id,connected:true,enabled:member.enabled,lastPoll:stamp,lastMessage:stamp,lastError:member.id==='status-expired'?'WECHAT_AUTH_EXPIRED':null,media:{pending:member.id==='status-saving'?2:0,saving:member.id==='status-saving',retrying:false,lastError:null,lastCompleted:null}}]));
      await page.route('**/api/state',async route=>{const response=await route.fetch();const data=await response.json();data.wechat.connections=members.map(member=>({...member,createdAt:stamp,updatedAt:stamp}));await route.fulfill({response,json:data})});
      await page.route('**/api/settings/wechat/connections/*/status',async route=>{const id=new URL(route.request().url()).pathname.split('/').at(-2);await route.fulfill({json:statuses[id]})});
      await page.goto(base+'/',{waitUntil:'domcontentloaded'});await page.locator('.sidebar .nav-link').filter({hasText:'设置'}).click();await page.getByText('运行正常',{exact:true}).waitFor();
      for(const label of ['媒体保存中','需要重新绑定','已暂停'])assert.equal(await page.getByText(label,{exact:true}).isVisible(),true);
      assert.equal(await page.locator('.status-json').count(),0);
      for(const width of [320,375,768,1280]){await page.setViewportSize({width,height:900});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,'WeChat status overflow at '+width);if(width===320||width===1280)await page.screenshot({path:join(evidence,'wechat-status-'+width+'.png'),fullPage:true})}
      const details=page.locator('.wechat-member-row').filter({hasText:'测试妈妈'});await details.getByRole('button',{name:'状态',exact:true}).click();assert.match(await page.locator('.wechat-status-details').textContent(),/2 条/);
      statuses['status-saving'].media={pending:0,saving:false,retrying:false,lastError:{code:'WECHAT_CDN_HTTP_503',attempt:3,at:stamp},lastCompleted:null};
      await details.getByRole('button',{name:'状态',exact:true}).click();await page.getByText('部分媒体保存失败',{exact:true}).waitFor();
      await page.unroute('**/api/state');await page.unroute('**/api/settings/wechat/connections/*/status');
      }finally{await statusContext.close()}
    });
    if(!useWebKit){const {browserWebManagement}=await import('./browser-web-management.mjs');await browserWebManagement({page,context,base,evidence,step}).catch(async error=>{console.error('Synthetic shell cache: '+JSON.stringify(await page.evaluate(async()=>{const keys=await caches.keys();return Promise.all(keys.filter(k=>k.startsWith('babymemo-shell')).map(async key=>{const cache=await caches.open(key),shell=await cache.match('/index.html');return{key,shell:!!shell,redirected:shell?.redirected,urls:(await cache.keys()).map(r=>new URL(r.url).pathname)}}))})));console.error('Synthetic web-management failure view: '+(await page.locator('body').innerText()).slice(0,5000));await page.screenshot({path:join(evidence,'web-management-failure.png'),fullPage:true});throw error})}
    await step((useWebKit?'WebKit':'Chromium')+': one-click cover repair checkpoint and pause',async()=>{
      await page.setViewportSize({width:390,height:844});
      await page.locator('.mobile-nav button[aria-label="设置"]').click();
      const section=page.locator('.thumbnail-repair-card');
      // Intercept the browser fetch itself: service workers can bypass Playwright
      // route interception, making a fast empty scan detach the Pause button.
      // Keep the scan pending until the pause checkpoint is verified.
      await page.evaluate(()=>{
        const original=window.fetch.bind(window);
        window.__thumbnailRepairFetch=original;
        window.fetch=(input,init)=>{
          if(String(typeof input==='string'?input:input?.url||'').includes('/api/media/thumbnail-backfill'))
            return new Promise(()=>{});
          return original(input,init);
        };
      });
      try{
        await section.getByRole('button',{name:'一键后台修复全部封面'}).click();
        await section.getByText('正在后台修复').waitFor();
        const checkpoint=await page.evaluate(()=>JSON.parse(localStorage.getItem('babymemo-thumbnail-repair-v1')||'null'));
        assert.equal(checkpoint.phase,'running');
        assert.ok(checkpoint.babyIds.length>=1);
        await section.getByRole('button',{name:'暂停修复'}).click();
        await section.getByText('任务已暂停').waitFor();
      }finally{
        await page.evaluate(()=>{
          if(window.__thumbnailRepairFetch)window.fetch=window.__thumbnailRepairFetch;
          delete window.__thumbnailRepairFetch;
        });
      }
      await page.reload();
      await section.getByRole('button',{name:'继续修复缺失封面'}).waitFor();
      const response=await page.evaluate(async()=>{
        const state=await(await fetch('/api/state')).json();
        return (await fetch('/api/media/thumbnail-backfill?type=all&babyId='+encodeURIComponent(state.babies[0].id))).status;
      });
      assert.equal(response,200,'all media backfill must be authenticated');
      await page.screenshot({path:join(evidence,'mobile-thumbnail-repair.png'),fullPage:true});
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
  await step('password change revokes all sessions',async()=>{
    const result=await json('/api/settings/password',{method:'POST',body:{currentPassword:'123456',newPassword:'longer-new-password'}});
    assert.equal(result.status,200,JSON.stringify(result.data));
    assert.equal((await json('/api/state')).status,401);
    assert.equal((await json('/api/login',{method:'POST',anonymous:true,body:{name:'Tester',password:'123456'}})).status,401);
    assert.equal((await json('/api/login',{method:'POST',anonymous:true,body:{name:'Tester',password:'longer-new-password'}})).status,200);
  });
} catch (error) {
  console.error('E2E FAILED: '+(error instanceof Error?error.stack:error));
  // Always surface local runtime failures, including crashes after the health probe.
  if(error instanceof Error&&error.cause)console.error('Underlying cause: '+String(error.cause));
  console.error('Wrangler output:\n'+serverLog);
  process.exitCode=1;
} finally {
  if(worker && worker.exitCode===null)worker.kill('SIGTERM');
  await delay(200);
  if(createdVars)rmSync(envFile,{force:true});
  rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
