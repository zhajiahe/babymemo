import {handleWechatCommand,handleWechatPhotoMessage,WechatSession} from '../../src/wechat';
import {encryptSecret,decryptSecret,setSetting} from '../../src/crypto';
import {getActiveThread} from '../../src/wechat-memory.mjs';
import {createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
const baby={id:'synthetic-baby',name:'测试宝宝',birthday:'2024-01-01',time_zone:'Asia/Shanghai'};
const key=Buffer.from('000102030405060708090a0b0c0d0e0f','hex');
const jpeg=Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,1,255,217]);
const actualFetch=globalThis.fetch;
function fakeContext(saved=new Map<string,any>()){
 let serial=Promise.resolve();
 const storage:any={get:async(k:string)=>structuredClone(saved.get(k)),put:async(k:string,v:any)=>{saved.set(k,structuredClone(v))},delete:async(k:string)=>saved.delete(k),setAlarm:async(value:number)=>saved.set('alarmAt',value),deleteAlarm:async()=>saved.delete('alarmAt')};
 storage.transaction=(fn:any)=>{const next=serial.then(()=>fn(storage));serial=next.catch(()=>{});return next};
 return {storage};
}
export default {async fetch(request:Request,env:any){
 const at=Date.now();
 const originalDB=env.DB;
 const input:any=await request.json();
 env.DATA_KEY='a'.repeat(64);env.OPENROUTER_API_KEY='sk-or-local-synthetic-never-sent';
 if(input.mode==='crypto'){
  try{const iv=input.emptyIV?Buffer.alloc(0):null;const cipher=createCipheriv('aes-128-ecb',key,iv);const b=Buffer.concat([cipher.update(jpeg),cipher.final()]);const d=createDecipheriv('aes-128-ecb',key,iv);const back=Buffer.concat([d.update(b),d.final()]);return Response.json({ok:back.equals(Buffer.from(jpeg)),sha:createHash('sha256').update(back).digest('hex')})}catch(e:any){return Response.json({ok:false,error:e.message})}
 }
 await env.DB.prepare('INSERT OR IGNORE INTO babies(id,name,birthday,gender,time_zone,created_at) VALUES(?,?,?,?,?,?)').bind(baby.id,baby.name,baby.birthday,'girl',baby.time_zone,new Date().toISOString()).run();
 let models=0,downloads=0;const sent:any[]=[],modelMessages:any[]=[];const contexts=new Map<string,{session:WechatSession;store:Map<string,any>}>();
 let inbound=input.messages||[],releaseMedia:any,mediaStarted:any;
 const mediaGate=new Promise<void>(resolve=>releaseMedia=resolve),beganMedia=new Promise<void>(resolve=>mediaStarted=resolve);
 env.BOT={idFromName:(name:string)=>name,get:(id:string)=>{
  if(!contexts.has(id)){const store=new Map<string,any>(Object.entries(id==='wechat-media:legacy'?input.mediaStorage||{}:{}));contexts.set(id,{store,session:new WechatSession(fakeContext(store) as any,env)})}
  return {fetch:(url:any,init?:any)=>contexts.get(id)!.session.fetch(new Request(url,init))};
 }};
 let finalSendAttempts=0;
 globalThis.fetch=async(url:any,init:any)=>{
  const u=String(url);
  if(u.startsWith('https://openrouter.ai/')){models++;modelMessages.push(JSON.parse(init.body).messages);return Response.json(input.responses?.[models-1]||{choices:[{message:{tool_calls:[]}}]})}
  if(u.startsWith('https://novac2c.cdn.weixin.qq.com/')){downloads++;if(input.holdMedia){mediaStarted();await mediaGate}if(new URL(u).pathname!=='/c2c/download'||input.cdnStatus)return new Response('',{status:input.cdnStatus||502});const bytes=input.encryptedBase64?Buffer.from(input.encryptedBase64,'base64'):Uint8Array.from(input.encrypted||[]);return new Response(new ReadableStream({start(controller){for(let offset=0;offset<bytes.length;offset+=32768)controller.enqueue(bytes.subarray(offset,offset+32768));controller.close()}}))}
  if(u.includes('/ilink/bot/getupdates')){
   const auth=init?.headers?.Authorization;
   const second=auth==='Bearer synthetic-token-2';
   return Response.json({ret:0,msgs:second?(input.messagesB||[]):(input.messagesA||inbound),get_updates_buf:second?'cursor-two':'cursor-one'});
  }
  if(u.includes('/ilink/bot/sendmessage')){const body=JSON.parse(init.body);sent.push(body);if(body.msg.client_id.startsWith('media-')){finalSendAttempts++;if(input.failFinalSendOnce&&finalSendAttempts===1)return new Response('',{status:503})}if(input.failSendOnce&&sent.length===1)return new Response('',{status:503});return Response.json({ret:0})}
  throw Error('UNEXPECTED_EXTERNAL_CALL');
 };
 try{
  let reply='',status:any=null;
  if(input.failIndexOnce){const db=env.DB;let failed=false;env.DB={prepare(sql:string){const statement=db.prepare(sql);return new Proxy(statement,{get(target,key){if(key==='bind')return (...values:any[])=>{const bound=target.bind(...values);return new Proxy(bound,{get(t,k){if(k==='run')return async()=>{if(!failed&&sql.startsWith('INSERT OR IGNORE INTO media')){failed=true;throw Error('SYNTHETIC_D1_FAILURE')}return t.run()};const value=(t as any)[k];return typeof value==='function'?value.bind(t):value}})};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value}})}}}
  if(input.mode==='text')reply=await handleWechatCommand(env,input.text,input.id,getActiveThread(null,'synthetic-bot','synthetic-user',at),at);
  else if(input.mode==='media')reply=await handleWechatPhotoMessage(env,input.raw,input.id);
  else if(input.mode==='multi'){
   const rows=[
    {id:'11111111-1111-4111-8111-111111111111',bot:'synthetic-bot',user:'synthetic-user',token:'synthetic-token'},
    {id:'22222222-2222-4222-8222-222222222222',bot:'synthetic-bot-2',user:'synthetic-user-2',token:'synthetic-token-2'}
   ];
   const contexts:any[]=[];
   for(const row of rows){
    await env.DB.prepare('INSERT OR REPLACE INTO wechat_connections(id,label,bot_id,user_id,token_cipher,base_url,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)')
     .bind(row.id,row.user,row.bot,row.user,await encryptSecret(env,row.token),'https://ilinkai.weixin.qq.com',new Date().toISOString(),new Date().toISOString()).run();
    const store=new Map<string,unknown>();
    const ctx:any=fakeContext(store);
    const session=new WechatSession(ctx,env);
    await session.fetch(new Request('https://bot.internal/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({connectionId:row.id})}));
    contexts.push({session,store});
   }
   await contexts[0].session.alarm();await contexts[1].session.alarm();
   status={firstCursor:contexts[0].store.get('cursor'),secondCursor:contexts[1].store.get('cursor'),
    firstConnection:contexts[0].store.get('connectionId'),secondConnection:contexts[1].store.get('connectionId')};
   // One account can be paused without disturbing the other account.
   await env.DB.prepare('UPDATE wechat_connections SET enabled=0 WHERE id=?').bind(rows[1].id).run();
   const sentBefore=sent.length;await contexts[1].session.alarm();
   status.pausedAccountSentNothing=sentBefore===sent.length;
   reply='MULTI_OK';
  }
  else if(input.mode==='alarm'){
   await setSetting(env,'wechat_enabled','true');await setSetting(env,'wechat_bot_id','synthetic-bot');await setSetting(env,'wechat_user_id','synthetic-user');await setSetting(env,'wechat_token',await encryptSecret(env,'synthetic-token'));
   await env.DB.prepare('INSERT OR REPLACE INTO wechat_connections(id,label,bot_id,user_id,token_cipher,base_url,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)')
     .bind('legacy','测试成员','synthetic-bot','synthetic-user',await encryptSecret(env,'synthetic-token'),'https://ilinkai.weixin.qq.com',new Date().toISOString(),new Date().toISOString()).run();
   const saved=new Map<string,any>(Object.entries(input.storage||{}));const ctx:any=fakeContext(saved);
   const bot=new WechatSession(ctx,env);contexts.set('family',{session:bot,store:saved});
   if(input.holdMedia){
    await bot.alarm();const beforeDownloads=downloads;
    if(input.addSecondBabyBeforeConsume){
     await env.DB.prepare('INSERT OR IGNORE INTO babies(id,name,birthday,gender,time_zone,created_at) VALUES(?,?,?,?,?,?)').bind('synthetic-baby-two','另一个宝宝','2024-02-01','girl','Asia/Shanghai',new Date().toISOString()).run();
     await setSetting(env,'wechat_default_baby_id','synthetic-baby-two');
    }
    const consumer=contexts.get('wechat-media:legacy')!;const saving=consumer.session.alarm();await beganMedia;
    inbound=input.followupMessages||[];const started=Date.now();await bot.alarm();
    saved.set('textWhileSaving',{beforeDownloads,elapsedMs:Date.now()-started,replies:sent.map(x=>x.msg.item_list[0].text_item.text)});
    if(input.resetDuringMedia)await bot.fetch(new Request('https://bot.internal/reset',{method:'POST'}));
    releaseMedia();await saving;
   }else{
    const realNow=Date.now;
    try{for(let n=0;n<(input.alarms||1);n++){
     Date.now=()=>at+n*30001;await bot.alarm();
     if(n===0&&input.followupMessages)inbound=input.followupMessages;
     const consumer=contexts.get('wechat-media:legacy');if(consumer)await consumer.session.alarm();
    }}finally{Date.now=realNow}
   }
   status={...Object.fromEntries(saved),...await (await bot.fetch(new Request('https://bot.internal/status'))).json()};delete status.conversation;delete status.mediaResult;
   reply=sent.at(-1)?.msg?.item_list?.[0]?.text_item?.text||'';
  }
  const growth=await env.DB.prepare('SELECT id,baby_id,day,weight,height,source_message_id FROM growth_records').all();
  const media=await env.DB.prepare('SELECT id,baby_id,day,size,mime,source_message_id FROM media').all();
  const messages=await env.DB.prepare('SELECT message_id,state,photo_attempts FROM wechat_messages').all();
  const rounds=input.id?await env.DB.prepare('SELECT round_index FROM wechat_agent_rounds WHERE message_id=? ORDER BY round_index').bind(input.id).all():{results:[]};
  let originalMatches=null;if(media.results.length){const row=media.results.at(-1);const obj=await env.MEDIA.get('private/'+row.baby_id+'/'+row.id);if(obj){const bytes=Buffer.from(await obj.arrayBuffer());originalMatches=input.expectedSHA256?createHash('sha256').update(bytes).digest('hex')===input.expectedSHA256:bytes.equals(Buffer.from(input.expectedPlain||jpeg));}}
  const mediaStorage=Object.fromEntries(contexts.get('wechat-media:legacy')?.store||[]);
  return Response.json({reply,models,modelMessages,rounds:rounds.results,downloads,sent:sent.length,sentTo:sent.map(x=>x.msg.to_user_id),clientIds:sent.map(x=>x.msg.client_id),finalClientIds:sent.filter(x=>x.msg.client_id.startsWith('media-')).map(x=>x.msg.client_id),status,mediaStorage,growth:growth.results,media:media.results,messages:messages.results,originalMatches});
 }catch(e:any){return Response.json({error:e.message,models})}finally{globalThis.fetch=actualFetch;env.DB=originalDB}
}};
