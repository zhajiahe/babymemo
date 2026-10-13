#!/usr/bin/env node
// Local Worker runtime + real isolated D1/R2. All upstream responses and data
// are synthetic; no live iLink, OpenRouter, credentials or production writes.
import assert from 'node:assert/strict';
import {createCipheriv,createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'babymemo-wechat-worker-'));
const wrangler=join(root,'node_modules/wrangler/bin/wrangler.js');
const config=join(dir,'wrangler.json');
const state=join(dir,'state');
const key=Buffer.from('000102030405060708090a0b0c0d0e0f','hex');
const jpeg=Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1,255,217]);
let worker,log='',passed=0;
const env={...process.env,XDG_CONFIG_HOME:join(dir,'config'),WRANGLER_SEND_METRICS:'false',CI:'true',BROWSER:'none'};
const encrypt=bytes=>{const c=createCipheriv('aes-128-ecb',key,null);return Buffer.concat([c.update(bytes),c.final()]).toString('base64')};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const tool=(name,args)=>({choices:[{message:{tool_calls:[{id:'synthetic-call',type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]});
const noTools={choices:[{message:{content:'synthetic no-tool response'},finish_reason:'stop'}]};
const raw=(id,type=2)=>({message_id:id,from_user_id:'synthetic-user',to_user_id:'synthetic-bot',message_type:1,message_state:2,context_token:'synthetic-context',create_time_ms:Date.now(),item_list:[type===2?{type:2,image_item:{media:{encrypt_query_param:'synthetic',aes_key:key.toString('base64')}}}:{type:5,video_item:{media:{encrypt_query_param:'synthetic',aes_key:key.toString('base64')}}}]});
const textFrom=(id,from,to,text)=>({message_id:id,from_user_id:from,to_user_id:to,message_type:1,message_state:2,context_token:'synthetic-context',create_time_ms:Date.now(),item_list:[{type:1,text_item:{text}}]});
async function step(title,run){await run();passed++;console.log('PASS '+title)}
try{
 const server=createServer();await new Promise((res,rej)=>{server.once('error',rej);server.listen(0,'127.0.0.1',res)});const port=server.address().port;await new Promise(res=>server.close(res));
 writeFileSync(config,JSON.stringify({name:'babymemo-wechat-worker-e2e',main:resolve(root,'scripts/fixtures/wechat-worker.ts'),compatibility_date:'2026-10-12',d1_databases:[{binding:'DB',database_name:'synthetic-db',database_id:'00000000-0000-0000-0000-000000000001',migrations_dir:join(root,'migrations')}],r2_buckets:[{binding:'MEDIA',bucket_name:'synthetic-media'}]}));
 const migrations=spawnSync(process.execPath,[wrangler,'d1','migrations','apply','DB','--local','--config',config,'--persist-to',state],{env,cwd:root,encoding:'utf8',timeout:90000});
 if(migrations.status!==0)throw Error('LOCAL_MIGRATIONS_FAILED: '+(migrations.stderr||migrations.stdout).slice(-2000));
 worker=spawn(process.execPath,[wrangler,'dev','--local','--config',config,'--persist-to',state,'--ip','127.0.0.1','--port',String(port)],{env,cwd:root,stdio:['ignore','pipe','pipe']});
 worker.stdout.on('data',x=>{log=(log+x.toString()).slice(-12000)});worker.stderr.on('data',x=>{log=(log+x.toString()).slice(-12000)});
 const base='http://127.0.0.1:'+port;
 async function run(payload){const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});assert.equal(r.status,200);return r.json()}
 let ready=false;for(let i=0;i<120;i++){if(worker.exitCode!==null)throw Error('WORKER_EXITED: '+log);try{await run({mode:'crypto',emptyIV:true});ready=true;break}catch{}await delay(250)}if(!ready)throw Error('WORKER_NOT_READY: '+log);
 await step('Worker AES-ECB accepts empty IV and decrypts exact bytes',async()=>{const r=await run({mode:'crypto',emptyIV:true});assert.equal(r.ok,true);assert.equal(r.sha,sha(jpeg))});
 await step('greeting capability question returns menu without model calls or writes',async()=>{const r=await run({mode:'text',id:'greeting-help',text:'你好，你可以做什么',responses:[noTools]});assert.match(r.reply,/BabyMemo 微信操作/);assert.equal(r.models,0);assert.equal(r.growth.length,0);assert.equal(r.media.length,0)});
 await step('missing model tools refuses writes',async()=>{const r=await run({mode:'text',id:'missing-tools',text:'测试宝宝今天体重 10.5kg',responses:[noTools]});assert.match(r.reply,/模型没有返回可执行的工具指令/);assert.equal(r.growth.length,0)});
 await step('model tool -> policy -> local D1 write; replay does not duplicate',async()=>{const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});const payload={mode:'text',id:'create-weight',text:'测试宝宝今天体重 10.5kg',responses:[tool('create_growth',{day,weight:10.5})]};let r=await run(payload);assert.match(r.reply,/记录|保存/);assert.equal(r.growth.length,1);assert.equal(r.growth[0].weight,10.5);r=await run(payload);assert.equal(r.growth.length,1)});
 await step('read-only retry returns real D1 results after no-tool response',async()=>{const r=await run({mode:'text',id:'query-weight',text:'查询测试宝宝最近五条体重记录',responses:[noTools,tool('list_growth',{limit:5})]});assert.equal(r.models,2);assert.match(r.reply,/10\.5/);assert.equal(r.growth.length,1)});
 await step('negated delete cannot mutate local D1',async()=>{const r=await run({mode:'text',id:'negated-delete',text:'不要删除测试宝宝今天的体重',responses:[tool('delete_growth',{day:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})})]});assert.equal(r.growth.length,1);assert.doesNotMatch(r.reply,/已删除/)});
 await step('iLink photo -> AES -> local R2/D1 -> reply; duplicate ignored',async()=>{const r=await run({mode:'alarm',messages:[raw('photo-ok')],alarms:2,encryptedBase64:encrypt(jpeg),expectedSHA256:sha(jpeg)});assert.equal(r.error,undefined);assert.match(r.reply,/已保存.*1 张照片/);assert.equal(r.media.length,1);assert.equal(r.downloads,1);assert.equal(r.sent,1);assert.equal(r.originalMatches,true);assert.equal(r.messages.find(x=>x.message_id==='synthetic-bot:photo-ok').state,'done')});
 await step('9 MiB encrypted video streams through real R2 multipart',async()=>{const bytes=Buffer.alloc(9*1024*1024,1);bytes.writeUInt32BE(24,0);bytes.write('ftypisom',4);const r=await run({mode:'alarm',messages:[raw('video-ok',5)],encryptedBase64:encrypt(bytes),expectedSHA256:sha(bytes)});assert.equal(r.error,undefined);assert.match(r.reply,/已保存.*1 段视频/);assert.equal(r.media.length,2);assert.equal(r.originalMatches,true);assert.equal(r.media.find(x=>x.mime==='video/mp4').size,bytes.length)});
 await step('R2 commit survives failed D1 indexing; retry avoids CDN download',async()=>{const r=await run({mode:'alarm',messages:[raw('index-retry')],alarms:2,failIndexOnce:true,encryptedBase64:encrypt(jpeg),expectedSHA256:sha(jpeg)});assert.match(r.reply,/已保存/);assert.equal(r.media.length,3);assert.equal(r.downloads,1);assert.equal(r.originalMatches,true);assert.equal(r.messages.find(x=>x.message_id==='synthetic-bot:index-retry').photo_attempts,1)});
 await step('failed reply transport retries persisted response/client ID without re-import',async()=>{const r=await run({mode:'alarm',messages:[raw('send-retry')],alarms:2,failSendOnce:true,encryptedBase64:encrypt(jpeg),expectedSHA256:sha(jpeg)});assert.match(r.reply,/已保存/);assert.equal(r.media.length,4);assert.equal(r.downloads,1);assert.equal(r.sent,2);assert.equal(r.clientIds[0],r.clientIds[1]);assert.equal(r.originalMatches,true)});
 await step('CDN failures retain sanitized diagnostics through idle polling until media succeeds',async()=>{const failed=await run({mode:'alarm',messages:[raw('cdn-failed')],alarms:3,cdnStatus:503});assert.match(failed.reply,/图片或视频下载\/入库多次失败/);assert.equal(failed.media.length,4);assert.equal(failed.downloads,3);assert.deepEqual(Object.keys(failed.status.lastMediaError).sort(),['at','attempt','code']);assert.equal(failed.status.lastMediaError.code,'WECHAT_CDN_HTTP_503');assert.equal(failed.status.lastMediaError.attempt,3);const idle=await run({mode:'alarm',messages:[],storage:failed.status});assert.equal(idle.status.lastError,null);assert.deepEqual(idle.status.lastMediaError,failed.status.lastMediaError);const ok=await run({mode:'alarm',messages:[raw('cdn-recovered')],storage:idle.status,encryptedBase64:encrypt(jpeg),expectedSHA256:sha(jpeg)});assert.match(ok.reply,/已保存/);assert.equal(ok.media.length,5);assert.equal(ok.status.lastMediaError,undefined);assert.equal(ok.originalMatches,true)});
 await step('two WeChat accounts have independent cursors, sender filters and pause state',async()=>{
  const payload={mode:'multi',
   messagesA:[textFrom('same-message','synthetic-user','synthetic-bot','你好，你可以做什么'),textFrom('not-authorized','synthetic-user-2','synthetic-bot','你好，你可以做什么')],
   messagesB:[textFrom('same-message','synthetic-user-2','synthetic-bot-2','你好，你可以做什么')]};
  const r=await run(payload);
  assert.equal(r.error,undefined);
  assert.equal(r.sent,2);
  assert.deepEqual(r.sentTo,['synthetic-user','synthetic-user-2']);
  assert.equal(r.status.firstCursor,'cursor-one');
  assert.equal(r.status.secondCursor,'cursor-two');
  assert.notEqual(r.status.firstConnection,r.status.secondConnection);
  assert.equal(r.status.pausedAccountSentNothing,true);
  assert.equal(r.messages.filter(x=>x.message_id==='synthetic-bot:same-message').length,1);
  assert.equal(r.messages.filter(x=>x.message_id==='synthetic-bot-2:same-message').length,1);
  assert.equal(r.messages.some(x=>x.message_id==='synthetic-bot:not-authorized'),false);
 });
 console.log(JSON.stringify({suite:'isolated WeChat Worker E2E',passed,failed:0,realExternalCalls:0,productionWrites:0}));
}catch(error){console.error(error);process.exitCode=1}
finally{
 if(worker&&worker.exitCode===null){worker.kill('SIGTERM');await Promise.race([new Promise(res=>worker.once('exit',res)),delay(5000)]);if(worker.exitCode===null)worker.kill('SIGKILL')}
 rmSync(dir,{recursive:true,force:true});
}
