import {handleWechatCommand,handleWechatPhotoMessage,WechatSession} from '../../src/wechat';
import {encryptSecret,decryptSecret,setSetting} from '../../src/crypto';
import {createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
const baby={id:'synthetic-baby',name:'测试宝宝',birthday:'2024-01-01',time_zone:'Asia/Shanghai'};
const key=Buffer.from('000102030405060708090a0b0c0d0e0f','hex');
const jpeg=Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,1,255,217]);
const actualFetch=globalThis.fetch;
export default {async fetch(request:Request,env:any){
 const at=Date.now();
 const input:any=await request.json();
 env.DATA_KEY='a'.repeat(64);env.OPENROUTER_API_KEY='sk-or-local-synthetic-never-sent';
 if(input.mode==='crypto'){
  try{const iv=input.emptyIV?Buffer.alloc(0):null;const cipher=createCipheriv('aes-128-ecb',key,iv);const b=Buffer.concat([cipher.update(jpeg),cipher.final()]);const d=createDecipheriv('aes-128-ecb',key,iv);const back=Buffer.concat([d.update(b),d.final()]);return Response.json({ok:back.equals(Buffer.from(jpeg)),sha:createHash('sha256').update(back).digest('hex')})}catch(e:any){return Response.json({ok:false,error:e.message})}
 }
 await env.DB.prepare('INSERT OR IGNORE INTO babies(id,name,birthday,gender,time_zone,created_at) VALUES(?,?,?,?,?,?)').bind(baby.id,baby.name,baby.birthday,'girl',baby.time_zone,new Date().toISOString()).run();
 let models=0,downloads=0;const sent:any[]=[];
 globalThis.fetch=async(url:any,init:any)=>{
  const u=String(url);
  if(u.startsWith('https://openrouter.ai/')){models++;return Response.json(input.responses?.[models-1]||{choices:[{message:{tool_calls:[]}}]})}
  if(u.startsWith('https://novac2c.cdn.weixin.qq.com/')){downloads++;const bytes=input.encryptedBase64?Buffer.from(input.encryptedBase64,'base64'):Uint8Array.from(input.encrypted||[]);return new Response(new ReadableStream({start(controller){for(let offset=0;offset<bytes.length;offset+=32768)controller.enqueue(bytes.subarray(offset,offset+32768));controller.close()}}))}
  if(u.includes('/ilink/bot/getupdates'))return Response.json({ret:0,msgs:input.messages||[],get_updates_buf:'synthetic-cursor'});
  if(u.includes('/ilink/bot/sendmessage')){sent.push(JSON.parse(init.body));if(input.failSendOnce&&sent.length===1)return new Response('',{status:503});return Response.json({ret:0})}
  throw Error('UNEXPECTED_EXTERNAL_CALL');
 };
 try{
  let reply='',status:any=null;
  if(input.failIndexOnce){const db=env.DB;let failed=false;env.DB={prepare(sql:string){const statement=db.prepare(sql);return new Proxy(statement,{get(target,key){if(key==='bind')return (...values:any[])=>{const bound=target.bind(...values);return new Proxy(bound,{get(t,k){if(k==='run')return async()=>{if(!failed&&sql.startsWith('INSERT OR IGNORE INTO media')){failed=true;throw Error('SYNTHETIC_D1_FAILURE')}return t.run()};const value=(t as any)[k];return typeof value==='function'?value.bind(t):value}})};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value}})}}}
  if(input.mode==='text')reply=await handleWechatCommand(env,input.text,input.id,null,at);
  else if(input.mode==='media')reply=await handleWechatPhotoMessage(env,input.raw,input.id);
  else if(input.mode==='alarm'){
   await setSetting(env,'wechat_enabled','true');await setSetting(env,'wechat_bot_id','synthetic-bot');await setSetting(env,'wechat_user_id','synthetic-user');await setSetting(env,'wechat_token',await encryptSecret(env,'synthetic-token'));
   await env.DB.prepare('INSERT OR REPLACE INTO wechat_connections(id,label,bot_id,user_id,token_cipher,base_url,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)')
     .bind('legacy','测试成员','synthetic-bot','synthetic-user',await encryptSecret(env,'synthetic-token'),'https://ilinkai.weixin.qq.com',new Date().toISOString(),new Date().toISOString()).run();
   const saved=new Map(Object.entries(input.storage||{}));const ctx:any={storage:{get:async(k:string)=>saved.get(k),put:async(k:string,v:any)=>{saved.set(k,v)},delete:async(k:string)=>saved.delete(k),setAlarm:async()=>{},deleteAlarm:async()=>{}}};
   const bot=new WechatSession(ctx,env);for(let n=0;n<(input.alarms||1);n++)await bot.alarm();
   status=Object.fromEntries(saved);delete status.conversation;
   reply=sent.at(-1)?.msg?.item_list?.[0]?.text_item?.text||'';
  }
  const growth=await env.DB.prepare('SELECT id,baby_id,day,weight,height,source_message_id FROM growth_records').all();
  const media=await env.DB.prepare('SELECT id,baby_id,size,mime,source_message_id FROM media').all();
  const messages=await env.DB.prepare('SELECT message_id,state,photo_attempts FROM wechat_messages').all();
  let originalMatches=null;if(media.results.length){const row=media.results.at(-1);const obj=await env.MEDIA.get('private/'+row.baby_id+'/'+row.id);if(obj){const bytes=Buffer.from(await obj.arrayBuffer());originalMatches=input.expectedSHA256?createHash('sha256').update(bytes).digest('hex')===input.expectedSHA256:bytes.equals(Buffer.from(input.expectedPlain||jpeg));}}
  return Response.json({reply,models,downloads,sent:sent.length,clientIds:sent.map(x=>x.msg.client_id),status,growth:growth.results,media:media.results,messages:messages.results,originalMatches});
 }catch(e:any){return Response.json({error:e.message,models})}finally{globalThis.fetch=actualFetch}
}};
