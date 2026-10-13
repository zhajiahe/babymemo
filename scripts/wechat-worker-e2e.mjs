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
import {exifJpeg,exifHeic} from './fixtures/media-exif.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'babymemo-wechat-worker-'));
const wrangler=join(root,'node_modules/wrangler/bin/wrangler.js');
const config=join(dir,'wrangler.json');
const state=join(dir,'state');
const key=Buffer.from('000102030405060708090a0b0c0d0e0f','hex');
const jpeg=Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1,255,217]);
let worker,log='',passed=0;
let savedCaptionWeightRecordId='';
const env={...process.env,XDG_CONFIG_HOME:join(dir,'config'),WRANGLER_SEND_METRICS:'false',CI:'true',BROWSER:'none'};
const encrypt=bytes=>{const c=createCipheriv('aes-128-ecb',key,null);return Buffer.concat([c.update(bytes),c.final()]).toString('base64')};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const tool=(name,args)=>({choices:[{message:{tool_calls:[{id:'synthetic-'+name,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]});
const noTools={choices:[{message:{content:'synthetic no-tool response'},finish_reason:'stop'}]};
const stop={choices:[{message:{content:'操作已完成',tool_calls:[]},finish_reason:'stop'}]};
const natural=content=>({choices:[{message:{content,tool_calls:[]},finish_reason:'stop'}]});
let savedWeightRecordId='';
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
 await step('missing model tools refuses writes',async()=>{const r=await run({mode:'text',id:'missing-tools',text:'测试宝宝今天体重 10.5kg',responses:[noTools]});assert.equal(r.reply,'synthetic no-tool response');assert.equal(r.growth.length,0)});
 await step('model tool -> policy -> local D1 write; replay does not duplicate',async()=>{const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});const payload={mode:'text',id:'create-weight',text:'测试宝宝今天体重 10.5kg',responses:[tool('create_growth',{day,weight:10.5})]};let r=await run(payload);assert.match(r.reply,/记录|保存/);assert.equal(r.growth.length,1);assert.equal(r.growth[0].weight,10.5);r=await run(payload);assert.equal(r.growth.length,1);savedWeightRecordId=r.growth[0].id;assert.equal(r.models,0);assert.equal(r.rounds.length,2)});
 await step('ChatGPT-style: age question becomes a natural answer based on the verified profile tool',async()=>{
  const r=await run({mode:'text',id:'ai-age-final',text:'我儿多大了',
   responses:[tool('get_baby',{}),natural('测试宝宝现在两岁九个月啦，生日是2024年1月1日。')]});
  assert.equal(r.error,undefined);
  assert.equal(r.models,2);
  assert.equal(r.reply,'测试宝宝现在两岁九个月啦，生日是2024年1月1日。');
  assert.match(r.modelMessages[1].at(-1).content,/生日 2024-01-01/);
  assert.match(r.modelMessages[0][0].content,/根据生日和消息本地日期计算年龄/);
  assert.doesNotMatch(r.reply,/档案|过敏和注意事项/);
 });
 await step('ChatGPT-style: verified milestone write has a concise AI final, not its DB receipt',async()=>{
  const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  const r=await run({mode:'text',id:'ai-milestone-final',text:'测试宝宝今天第一次学会鼓掌了，帮我记下来',
   responses:[
    tool('create_milestone',{day,title:'第一次学会鼓掌',description:'今天第一次学会鼓掌'}),
    natural('记好啦！已经把测试宝宝今天第一次鼓掌的瞬间记进成长日记了。')
   ]});
  assert.equal(r.error,undefined);
  assert.equal(r.models,2);
  assert.match(r.reply,/记好啦/);
  assert.doesNotMatch(r.reply,/已保存成长事件|· \d{4}-\d{2}-\d{2}/);
  assert.equal(r.milestones.filter(m=>m.source_message_id==='ai-milestone-final:step:0').length,1);
  assert.match(r.modelMessages[1].at(-1).content,/已保存成长事件/);
 });
 await step('read-only retry returns real D1 results after no-tool response',async()=>{const r=await run({mode:'text',id:'query-weight',text:'查询测试宝宝最近五条体重记录',responses:[noTools,tool('list_growth',{limit:5})]});assert.equal(r.models,3);assert.match(r.reply,/10\.5/);assert.equal(r.growth.length,1)});
 await step('ReAct read -> write uses a real queried ID and tool observations',async()=>{
  const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  const r=await run({mode:'text',id:'react-correct',text:'把测试宝宝今天的体重更正为 10.2kg',
   responses:[tool('list_growth',{day}),tool('update_growth',{id:savedWeightRecordId.slice(0,8),weight:10.2}),stop]});
  assert.equal(r.error,undefined);
  assert.equal(r.growth.length,1);assert.equal(r.growth[0].weight,10.2);
  assert.equal(r.models,3);assert.equal(r.rounds.length,3);
  assert.equal(r.modelMessages[1].at(-1).role,'tool');
  assert.equal(r.modelMessages[2].at(-1).role,'tool');
  assert.match(r.reply,/已更新/);
 });
 await step('ReAct accepts colloquial 10.1号 date and approximate values',async()=>{
  const r=await run({mode:'text',id:'react-colloquial',text:'10.1号测试宝宝大概13.7kg',
   responses:[tool('create_growth',{day:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,4)+'-10-01',weight:13.7,notes:'估计值'}),stop]});
  assert.equal(r.error,undefined);assert.match(r.reply,/已保存/);
  assert.ok(r.growth.some(g=>g.weight===13.7&&g.day.endsWith('-10-01')));
 });
 await step('runtime context comes from Worker clock rather than model guesses',async()=>{
  const r=await run({mode:'text',id:'react-clock',text:'查询当前时间',
   responses:[tool('get_runtime_context',{}),natural('现在是下午，按宝宝所在时区 Asia/Shanghai 计算。')]});
  assert.equal(r.error,undefined);
  assert.match(r.reply,/现在是下午/);
  assert.doesNotMatch(r.reply,/currentTimestamp|localDay|timeZone|Asia\/Shanghai/);
  assert.equal(r.modelMessages[1].at(-1).role,'tool');
  assert.match(r.modelMessages[1].at(-1).content,/messageLocalDay|timeZone/);
  assert.equal(r.growth.length,2);
 });
 await step('diary date from 昨晚 stays grounded; internal clock JSON never appears in final message',async()=>{
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  const yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
  const note='测试宝宝昨晚半小时一醒，中间睡了三个小时，后来又半小时一醒';
  const natural=content=>({choices:[{message:{content,tool_calls:[]},finish_reason:'stop'}]});
  const r=await run({mode:'alarm',alarms:2,
   pollBatches:[
    [textFrom('json-diary-one','synthetic-user','synthetic-bot',note)],
    [textFrom('json-diary-two','synthetic-user','synthetic-bot','记下来')]
   ],
   responses:[
    natural('昨晚确实睡得不安稳，要我帮你记到日记吗？'),
    tool('get_runtime_context',{}),
    tool('create_milestone',{day:yesterday,title:'昨晚睡眠观察',description:'昨晚半小时一醒，中间睡了三个小时，后来又半小时一醒。'}),
    stop
   ]
  });
  assert.equal(r.error,undefined);
  assert.equal(r.models,4);
  assert.equal(r.replies.length,2);
  assert.equal(r.milestones.length,1);
  assert.equal(r.milestones[0].day,yesterday);
  assert.match(r.replies[1],/已保存成长事件/);
  assert.doesNotMatch(r.replies.join(' '),/currentTimestamp|messageTimestamp|timeZone|messageLocalDay|\{"current/);
  assert.match(r.modelMessages[1][0].content,new RegExp(yesterday)); // date in trusted instruction
  assert.equal(r.modelMessages[2].at(-1).role,'tool');
  assert.match(r.modelMessages[2].at(-1).content,/currentTimestamp/); // only the model sees JSON
 });
 await step('negated delete cannot mutate local D1',async()=>{const r=await run({mode:'text',id:'negated-delete',text:'不要删除测试宝宝今天的体重',responses:[tool('delete_growth',{day:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})})]});assert.equal(r.growth.length,2);assert.doesNotMatch(r.reply,/已删除/)});
 await step('four consecutive WeChat messages naturally respond, then save one consolidated diary milestone',async()=>{
  const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  const yesterday=new Date(Date.parse(day+'T12:00:00Z')-86400000).toISOString().slice(0,10);
  const messages=['测试宝宝昨晚半小时一醒','中间连续睡了三个小时','后来又半小时一醒','记下来'];
  const natural=content=>({choices:[{message:{content,tool_calls:[]},finish_reason:'stop'}]});
  const r=await run({
   mode:'alarm',
   alarms:4,
   pollBatches:messages.map((text,i)=>[textFrom('diary-turn-'+i,'synthetic-user','synthetic-bot',text)]),
   responses:[
    natural('听起来昨晚睡得很不安稳。想让我帮你记到日记里吗？'),
    natural('明白，中间有连续三个小时的睡眠。'),
    natural('后来又恢复了半小时一醒，确实是一段反复的夜醒。'),
    tool('create_milestone',{day:yesterday,title:'昨晚睡眠观察',description:'昨晚半小时一醒，中间连续睡了三个小时，随后又半小时一醒。'}),
    stop
   ]
  });
  assert.equal(r.error,undefined);
  assert.equal(r.models,5);
  assert.equal(r.replies.length,4);
  assert.match(r.replies[0],/想让我帮你记到日记里吗/);
  assert.match(r.replies[1],/连续三个小时/);
  assert.match(r.replies[2],/又恢复了半小时一醒/);
  assert.match(r.replies[3],/已保存成长事件/);
  const thisMessageMilestones=r.milestones.filter(x=>x.source_message_id?.includes('diary-turn-3:step:0'));
  assert.equal(thisMessageMilestones.length,1); // independent of prior test fixtures
  assert.equal(thisMessageMilestones[0].baby_id,'synthetic-baby');
  assert.equal(thisMessageMilestones[0].day,yesterday);
  assert.match(thisMessageMilestones[0].description,/半小时一醒.*三个小时.*半小时一醒/);
  const finalRequest=r.modelMessages[3];
  assert.deepEqual(finalRequest.filter(x=>x.role==='user').slice(0,3).map(x=>x.content),messages.slice(0,3));
  assert.match(finalRequest.at(-1).content,/create_milestone/);
  assert.match(finalRequest[0].content,/日记和里程碑是同一种成长事件/);
  assert.equal(r.modelMessages[4].at(-1).role,'tool');
  assert.equal(r.messages.filter(m=>m.message_id.startsWith('synthetic-bot:diary-turn-')&&m.state==='done').length,4);
 });
 await step('iLink photo -> durable acceptance -> AES -> local R2/D1 -> final reply; duplicate ignored',async()=>{const r=await run({mode:'alarm',messages:[raw('photo-ok')],alarms:2,encryptedBase64:encrypt(jpeg),expectedSHA256:sha(jpeg)});assert.equal(r.error,undefined);assert.match(r.reply,/已保存.*1 张照片/);assert.equal(r.media.length,1);assert.equal(r.downloads,1);assert.equal(r.sent,2);assert.equal(r.originalMatches,true);assert.equal(r.messages.find(x=>x.message_id==='synthetic-bot:photo-ok').state,'done')});
 await step('9 MiB encrypted video streams through real R2 multipart',async()=>{const bytes=Buffer.alloc(9*1024*1024,1);bytes.writeUInt32BE(24,0);bytes.write('ftypisom',4);const r=await run({mode:'alarm',messages:[raw('video-ok',5)],encryptedBase64:encrypt(bytes),expectedSHA256:sha(bytes)});assert.equal(r.error,undefined);assert.match(r.reply,/已保存.*1 段视频/);assert.equal(r.media.length,2);assert.equal(r.originalMatches,true);assert.equal(r.media.find(x=>x.mime==='video/mp4').size,bytes.length)});
 await step('R2 commit survives failed D1 indexing; retry avoids CDN download',async()=>{const r=await run({mode:'alarm',messages:[raw('index-retry')],alarms:2,failIndexOnce:true,encryptedBase64:encrypt(jpeg),expectedSHA256:sha(jpeg)});assert.match(r.reply,/已保存/);assert.equal(r.media.length,3);assert.equal(r.downloads,1);assert.equal(r.originalMatches,true);assert.equal(r.messages.find(x=>x.message_id==='synthetic-bot:index-retry').photo_attempts,1)});
 await step('failed final reply retries persisted response/client ID without re-import',async()=>{const r=await run({mode:'alarm',messages:[raw('send-retry')],alarms:2,failFinalSendOnce:true,encryptedBase64:encrypt(jpeg),expectedSHA256:sha(jpeg)});assert.match(r.reply,/已保存/);assert.equal(r.media.length,4);assert.equal(r.downloads,1);assert.equal(r.sent,3);assert.equal(r.finalClientIds.length,2);assert.equal(r.finalClientIds[0],r.finalClientIds[1]);assert.equal(r.originalMatches,true)});
 await step('CDN failures retain sanitized diagnostics through idle polling until media succeeds',async()=>{const failed=await run({mode:'alarm',messages:[raw('cdn-failed')],alarms:3,cdnStatus:503});assert.match(failed.reply,/图片或视频下载\/入库多次失败/);assert.equal(failed.media.length,4);assert.equal(failed.downloads,3);assert.deepEqual(Object.keys(failed.status.media.lastError).sort(),['at','attempt','code']);assert.equal(failed.status.media.lastError.code,'WECHAT_CDN_HTTP_503');assert.equal(failed.status.media.lastError.attempt,3);const idle=await run({mode:'alarm',messages:[],storage:failed.status,mediaStorage:failed.mediaStorage});assert.equal(idle.status.lastError,null);assert.deepEqual(idle.status.media.lastError,failed.status.media.lastError);const ok=await run({mode:'alarm',messages:[raw('cdn-recovered')],storage:idle.status,mediaStorage:idle.mediaStorage,encryptedBase64:encrypt(jpeg),expectedSHA256:sha(jpeg)});assert.match(ok.reply,/已保存/);assert.equal(ok.media.length,5);assert.equal(ok.status.media.lastError,null);assert.equal(ok.originalMatches,true)});
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
 await step('same-batch text and a later D1 query finish while a CDN stream remains blocked',async()=>{
  const r=await run({mode:'alarm',holdMedia:true,messages:[raw('slow-media'),textFrom('same-batch-help','synthetic-user','synthetic-bot','你好，你可以做什么')],followupMessages:[textFrom('query-while-saving','synthetic-user','synthetic-bot','查询测试宝宝最近五条体重记录')],responses:[tool('list_growth',{limit:5})],encryptedBase64:encrypt(jpeg),expectedSHA256:sha(jpeg)});
  assert.equal(r.error,undefined);assert.equal(r.status.textWhileSaving.beforeDownloads,0);assert.ok(r.status.textWhileSaving.elapsedMs<3000);assert.ok(r.status.textWhileSaving.replies.some(x=>/10\.2/.test(x)));assert.ok(r.status.textWhileSaving.replies.some(x=>/正在保存/.test(x)));assert.equal(r.media.length,6);assert.equal(r.downloads,1);assert.equal(r.originalMatches,true);assert.equal(r.status.media.pending,0);
 });
 await step('reset during a slow save suppresses stale caption writes and replies',async()=>{
  const media=raw('reset-in-flight');media.item_list.push({type:1,text_item:{text:'测试宝宝今天记录第一次走路里程碑'}});
  const r=await run({mode:'alarm',holdMedia:true,resetDuringMedia:true,messages:[media],encryptedBase64:encrypt(jpeg)});
  assert.equal(r.error,undefined);assert.equal(r.models,0);assert.equal(r.finalClientIds.length,0);assert.equal(r.status.media.pending,0);assert.equal(r.status.media.lastCompleted,null);
 });
 await step('queued media keeps its reception baby after defaults and text context change',async()=>{
  const r=await run({mode:'alarm',holdMedia:true,addSecondBabyBeforeConsume:true,messages:[raw('pinned-baby')],followupMessages:[textFrom('switch-baby','synthetic-user','synthetic-bot','查询另一个宝宝最近五条体重记录')],responses:[tool('list_growth',{limit:5})],encryptedBase64:encrypt(jpeg)});
  assert.equal(r.error,undefined);assert.equal(r.media.find(x=>x.source_message_id==='synthetic-bot:pinned-baby:image:0').baby_id,'synthetic-baby');assert.equal(r.status.media.pending,0);assert.doesNotMatch(JSON.stringify(r.mediaStorage),/synthetic-context|encrypt_query_param|synthetic-token/);
 });
 await step('JPEG capture date survives a failed D1 index and private R2 recovery',async()=>{
  const bytes=exifJpeg(),message=raw('capture-date-jpeg');message.item_list.push({type:1,text_item:{text:'测试宝宝'}});
  const r=await run({mode:'alarm',messages:[message],alarms:2,failIndexOnce:true,encryptedBase64:encrypt(bytes),expectedSHA256:sha(bytes)});
  assert.equal(r.error,undefined);assert.equal(r.media.find(x=>x.source_message_id==='synthetic-bot:capture-date-jpeg:image:0').day,'2020-09-03');assert.equal(r.downloads,1);assert.equal(r.originalMatches,true);
 });
 await step('HEIC capture date near the end of the original is read in the Worker runtime',async()=>{
  const bytes=exifHeic(),message=raw('capture-date-heic');message.item_list.push({type:1,text_item:{text:'测试宝宝'}});
  const r=await run({mode:'alarm',messages:[message],encryptedBase64:encrypt(bytes),expectedSHA256:sha(bytes)});
  assert.equal(r.error,undefined);assert.equal(r.media.find(x=>x.source_message_id==='synthetic-bot:capture-date-heic:image:0').day,'2020-09-03');assert.equal(r.originalMatches,true);
 });
 await step('a later text context cannot be overwritten by an older media caption operation',async()=>{
  const message=raw('caption-context-changed');message.item_list.push({type:1,text_item:{text:'测试宝宝今天记录第一次走路里程碑'}});
  const r=await run({mode:'alarm',holdMedia:true,messages:[message],followupMessages:[textFrom('newer-query','synthetic-user','synthetic-bot','查询测试宝宝最近五条体重记录')],responses:[tool('list_growth',{limit:5})],encryptedBase64:encrypt(jpeg)});
  assert.equal(r.error,undefined);assert.equal(r.models,2);assert.match(r.reply,/附文操作未执行/);
 });
 await step('an unchanged reception context executes the explicitly authorized caption after save',async()=>{
  const message=raw('caption-context-current');message.item_list.push({type:1,text_item:{text:'测试宝宝今天记录体重 11.5kg'}});
  const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  const r=await run({mode:'alarm',messages:[message],responses:[tool('create_growth',{day,weight:11.5})],encryptedBase64:encrypt(jpeg)});
  assert.equal(r.error,undefined);assert.equal(r.models,2,r.reply);assert.doesNotMatch(r.reply,/附文操作未执行/);assert.match(r.reply,/已保存/);
  const record=r.growth.find(x=>x.source_message_id==='synthetic-bot:caption-context-current:caption:step:0');assert.equal(record.weight,11.5);savedCaptionWeightRecordId=record.id;
 });
 await step('a media caption query publishes trusted IDs for the next text follow-up',async()=>{
  const message=raw('caption-query-reference-'+ 'a'.repeat(64)+'_%');message.item_list.push({type:1,text_item:{text:'测试宝宝查询今天成长记录'}});
  const r=await run({mode:'alarm',alarms:2,messages:[message],followupMessages:[textFrom('caption-query-followup','synthetic-user','synthetic-bot','修改第一条体重为12kg')],responses:[tool('list_growth',{day:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})}),stop,tool('update_growth',{id:savedCaptionWeightRecordId.slice(0,8),weight:12}),stop],encryptedBase64:encrypt(jpeg)});
  assert.equal(r.error,undefined);assert.equal(r.models,4,r.reply);assert.equal(r.growth.find(x=>x.id===savedCaptionWeightRecordId).weight,12,r.reply);
 });
 console.log(JSON.stringify({suite:'isolated WeChat Worker E2E',passed,failed:0,realExternalCalls:0,productionWrites:0}));
}catch(error){console.error(error);process.exitCode=1}
finally{
 if(worker&&worker.exitCode===null){worker.kill('SIGTERM');await Promise.race([new Promise(res=>worker.once('exit',res)),delay(5000)]);if(worker.exitCode===null)worker.kill('SIGKILL')}
 rmSync(dir,{recursive:true,force:true});
}
