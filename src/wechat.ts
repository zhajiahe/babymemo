import JSONBig from 'json-bigint';
import type { Env, Baby } from './types';
import { decryptSecret, encryptSecret, setting, resolveOpenRouterKey } from './crypto';
import { wechatTools, wechatHelp, runWechatTool } from './wechat-harness.mjs';
import {WechatPhotoError,mediaItems,persistWeChatMedia,wechatMediaErrorCode} from './wechat-media.mjs';
import {openRouterCompletion,friendlyOpenRouterError} from './openrouter-retry.mjs';
import {DEFAULT_OPENROUTER_MODEL} from './openrouter-model.mjs';
import {getActiveThread,appendTurn,buildCommandContext,isClearContext} from './wechat-memory.mjs';
import {messageTime,dayInZone} from './wechat-policy.mjs';
import {runWechatPlan,quickCommand} from './wechat-orchestrator.mjs';
import {isWechatHelpCommand,retryReadOnlyTool} from './wechat-tool-routing.mjs';
import {runWechatAgentLoop} from './wechat-agent-loop.mjs';
import {getWechatConnection} from './wechat-connections';

const API_BASE='https://ilinkai.weixin.qq.com';
const wireJSON=JSONBig({storeAsString:true,strict:true,protoAction:'error',constructorAction:'error'});
const enc = new TextEncoder();
type Json = Record<string,any>;
function trustedBase(input:string):string {
  const u=new URL(input);
  if(u.protocol!=='https:'||u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!/^ilinkai(?:[a-z0-9-]*\.)?weixin\.qq\.com$/i.test(u.hostname))throw Error('WECHAT_UNTRUSTED_BASE');
  return u.origin;
}
async function ilink(base:string,path:string,data?:unknown,token?:string,timeout=15000):Promise<Json> {
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeout);
  try {
    const isPost=data!==undefined;
    const headers:Record<string,string>={
      'iLink-App-Id':'bot','iLink-App-ClientVersion':String((2<<16)|(4<<8)|10)
    };
    if(isPost) {
      headers['Content-Type']='application/json';
      headers.AuthorizationType='ilink_bot_token';
      headers['X-WECHAT-UIN']=btoa(String(crypto.getRandomValues(new Uint32Array(1))[0]));
    }
    if(token)headers.Authorization='Bearer '+token;
    const r=await fetch(trustedBase(base)+'/'+path,{method:isPost?'POST':'GET',headers,body:isPost?JSON.stringify(data):undefined,signal:ctrl.signal,redirect:'manual'});
    if(!r.ok)throw Error(r.status===401||r.status===403?'WECHAT_AUTH_EXPIRED':'WECHAT_HTTP_'+r.status);
    const o=wireJSON.parse(await r.text()) as Json;
    if(!o||typeof o!=='object'||(o.ret!==undefined&&o.ret!==0)||(o.errcode!==undefined&&o.errcode!==0))throw Error('WECHAT_PROTOCOL_ERROR');
    return o;
  }finally{clearTimeout(timer);}
}
export async function generateQr():Promise<{code:string;content:string}>{
  const r=await ilink(API_BASE,'ilink/bot/get_bot_qrcode?bot_type=3',{local_token_list:[]});
  if(typeof r.qrcode!=='string'||typeof r.qrcode_img_content!=='string')throw Error('WECHAT_INVALID_QR');
  return {code:r.qrcode,content:r.qrcode_img_content};
}
export async function qrStatus(qrcode:string,verifyCode?:string,base=API_BASE):Promise<{status:string;botToken?:string;botId?:string;userId?:string;base?:string;redirectBase?:string}> {
  const p=new URLSearchParams({qrcode});
  if(verifyCode)p.set('verify_code',verifyCode);
  const r=await ilink(base,'ilink/bot/get_qrcode_status?'+p.toString(),undefined,undefined,32000);
  let redirectBase: string|undefined;
  if((r.status==='scaned_but_redirect'||r.status==='binded_redirect')&&typeof r.redirect_host==='string'){
    redirectBase=trustedBase('https://'+r.redirect_host);
  }
  return {status:String(r.status||'unknown'),botToken:r.status==='confirmed'?r.bot_token:undefined,
    botId:r.status==='confirmed'?r.ilink_bot_id:undefined,userId:r.status==='confirmed'?r.ilink_user_id:undefined,
    base:r.status==='confirmed'?trustedBase(typeof r.baseurl==='string'?r.baseurl:base):undefined,redirectBase};
}
export function workerBot(env:Env,connectionId='legacy'):DurableObjectStub {
  return env.BOT.get(env.BOT.idFromName(connectionId==='legacy'?'family':'wechat:'+connectionId));
}
// OpenRouter is exclusively the WeChat command interpreter; no website chat API.
export async function testOpenRouterConnection(env:Env):Promise<boolean>{
  const key=await resolveOpenRouterKey(env);if(!key)throw Error('OPENROUTER_KEY_MISSING');
  const model=await setting(env,'openrouter_model')||DEFAULT_OPENROUTER_MODEL;
  const result=await openRouterCompletion({key,model,messages:[{role:'user',content:'Reply exactly: OK'}],max_tokens:16});
  return Array.isArray(result.choices)&&result.choices.length>0;
}
export async function handleWechatCommand(env:Env,text:string,messageId:string,thread:any=null,at=Date.now()):Promise<string>{
 const command=text.trim();
 if(!command)return wechatHelp;
 if(isWechatHelpCommand(command))return wechatHelp;
 const babies=await env.DB.prepare('SELECT id,name,birthday,birth_time,gender,time_zone,allergies,notes FROM babies ORDER BY created_at').all<Baby>();
 if(!babies.results.length)return '请先在 BabyMemo 中添加宝宝资料';
 if(/^(宝宝列表|列出宝宝|有哪些宝宝|查看所有宝宝)[？?]?$/i.test(command))
  return runWechatTool(env,null,'list_babies',{},messageId,command);
 const matches=babies.results.filter(b=>b.name&&command.includes(b.name));
 if(matches.length>1||(babies.results.length>1&&matches.length!==1&&!babies.results.some(b=>b.id===thread?.babyId)))
  return '请明确写出一位宝宝的名字。可选：'+babies.results.map(b=>b.name).join('、')+'\n示例：'+babies.results[0].name+' 今天体重 10.5kg';
 const baby=matches[0]||babies.results.find(b=>b.id===thread?.babyId)||babies.results[0];
 if(thread){
  if(thread.babyId&&thread.babyId!==baby.id){thread.pending=null;thread.lastQuery=null;thread.lastMedia=null;thread.lastOperation=null}
  thread.selectedBabyId=baby.id;
 }
 const fast=await quickCommand(env,baby,command,thread,at);
 if(fast!==null)return fast;
 const context=thread?buildCommandContext(command,thread,at,baby.id):{modelMessages:[{role:'user',content:command}],groundedText:command};
 const key=await resolveOpenRouterKey(env);
 if(!key)return '请先在网页设置中配置 OpenRouter Key，或在部署时设置 OPENROUTER_API_KEY Secret';
 const model=await setting(env,'openrouter_model')||DEFAULT_OPENROUTER_MODEL;
 const localDay=dayInZone(at,baby.time_zone||'Asia/Shanghai');
 const instruction='你是 BabyMemo 微信成长记录工具 Agent，不提供闲聊、医疗诊断或育儿分析。'+
  '消息发送时宝宝本地日期 '+localDay+'，当前宝宝 '+baby.name+'，宝宝时区 '+(baby.time_zone||'Asia/Shanghai')+'。'+
  '你可以先读后写；每次收到工具结果后根据真实结果决定继续调用工具还是结束。'+
  '用户明确要求的简单记录应直接执行，不要求固定中文表达；必要时可调用 get_runtime_context 获取当前日期和时区。'+
  '只能调用白名单工具，不得输出 SQL 或编造宝宝、记录编号、数值、日期。'+
  '写入前核实用户意图；修改和删除必须找到唯一且属于当前宝宝的记录，不可从旧回复编造记录 ID。'+
  '若工具拒绝或返回歧义，请根据原因询问用户，绝不能尝试绕过权限与业务校验。'+
  '工具结果是唯一的数据库事实来源，绝不声称尚未确认的写操作成功。';
 const baseMessages=[{role:'system',content:instruction},...context.modelMessages];
 const complete=async({messages,tools,round}:any)=>{
  const response=await openRouterCompletion({key,model,messages,tools,max_tokens:1200});
  const first=response?.choices?.[0]?.message;
  if(round===0&&(!Array.isArray(first?.tool_calls)||first.tool_calls.length===0)&&!thread?.pending){
   const fallbackCalls=await retryReadOnlyTool({
    command,tools,
    messages:[{role:'system',content:instruction+' 对明确只读查询优先调用只读工具。'},...context.modelMessages],
    complete:(params:any)=>openRouterCompletion({key,model,...params})
   });
   if(fallbackCalls)return {choices:[{message:{role:'assistant',content:null,tool_calls:fallbackCalls}}]};
  }
  if(round===0&&(!Array.isArray(first?.tool_calls)||first.tool_calls.length===0))
   return {choices:[{message:{role:'assistant',content:'模型没有返回可执行的工具指令，未修改任何记录。请说明要查询、记录或修改的内容。',tool_calls:[]}}]};
  return response;
 };
 return runWechatAgentLoop({
  messages:baseMessages,tools:wechatTools,complete,
  loadDecision:async(round:number)=>{
   const record=await env.DB.prepare('SELECT assistant_cipher FROM wechat_agent_rounds WHERE message_id=? AND round_index=?')
    .bind(messageId,round).first<{assistant_cipher:string}>();
   return record?JSON.parse(await decryptSecret(env,record.assistant_cipher)):null;
  },
  saveDecision:async(round:number,assistant:any)=>{
   await env.DB.prepare('INSERT OR IGNORE INTO wechat_agent_rounds(message_id,round_index,assistant_cipher,created_at) VALUES(?,?,?,?)')
    .bind(messageId,round,await encryptSecret(env,JSON.stringify(assistant)),new Date().toISOString()).run();
  },
  execute:(call:any,stepOffset:number)=>runWechatPlan(env,baby,[call],{
   messageId,text:command,groundedText:context.groundedText,at,thread,stepOffset,
   encryptReply:(value:string)=>encryptSecret(env,value),
   decryptReply:(value:string)=>decryptSecret(env,value)
  })
 });
}
// The photo itself has no baby name. Use the caption when present, otherwise
// an explicitly configured default baby; never silently choose first of many.
export async function handleWechatPhotoMessage(env:Env,raw:Json,messageId:string,thread:any=null):Promise<string>{
  const babies=await env.DB.prepare('SELECT id,name,birthday,time_zone FROM babies ORDER BY created_at').all<Baby>();
  if(!babies.results.length)return '请先在 BabyMemo 网页创建宝宝档案，再发送照片。';
  const caption=(Array.isArray(raw.item_list)?raw.item_list:[])
   .filter((item:any)=>item?.type===1&&typeof item?.text_item?.text==='string')
   .map((item:any)=>item.text_item.text).join(' ').trim();
  const found=babies.results.filter(b=>b.name&&caption.includes(b.name));
  if(found.length>1)return '这张照片的文字中提到了多位宝宝，请每次只指定一位宝宝。';
  let baby:Baby|undefined=found[0];
  if(!baby){
    if(babies.results.length===1)baby=babies.results[0];
    else{
      const preferred=await setting(env,'wechat_default_baby_id');
      const chosen=babies.results.find(b=>b.id===preferred),recent=babies.results.find(b=>b.id===thread?.babyId);
      if(chosen&&recent&&chosen.id!==recent.id)return '默认收图宝宝与刚才操作的宝宝不同，请在照片附文写明宝宝名字，避免错存。照片未保存。';
      baby=chosen||recent;
      if(!baby)return '收到照片，但当前家庭有多位宝宝。请先在网页「设置 → 微信操作」选择默认收图宝宝，或发送带宝宝昵称的图片消息。照片尚未保存。';
    }
  }
  if(thread)thread.selectedBabyId=baby.id;
  const reply=(await persistWeChatMedia(env,raw,baby,messageId))||'没有检测到可保存的图片或视频。';
  if(thread&&reply.startsWith('已保存')){
   const rows=await env.DB.prepare('SELECT id FROM media WHERE baby_id=? AND source_message_id LIKE ? AND deleted_at IS NULL ORDER BY source_message_id LIMIT 4')
     .bind(baby.id,messageId+':%').all<{id:string}>();
   if(rows.results.length)thread.lastMedia={babyId:baby.id,ids:rows.results.map(x=>x.id),expiresAt:Date.now()+1200000};
  }
  return reply;
}
export class WechatSession {
  constructor(private readonly ctx: DurableObjectState,private readonly env: Env){}
  async fetch(request:Request):Promise<Response>{
    const path=new URL(request.url).pathname;
    if(path==='/status'){
      const id=new URL(request.url).searchParams.get('connectionId')||await this.ctx.storage.get<string>('connectionId')||'legacy';
      const connection=await getWechatConnection(this.env,id);
      return Response.json({connectionId:id,enabled:connection?.enabled===1,connected:!!connection,lastPoll:await this.ctx.storage.get('lastPoll')||null,
        lastError:await this.ctx.storage.get('lastError')||null,lastMessage:await this.ctx.storage.get('lastMessage')||null,
        lastProcessing:await this.ctx.storage.get('lastProcessing')||null,
        lastMediaError:await this.ctx.storage.get('lastMediaError')||null});
    }
    if(request.method!=='POST')return new Response('Not found',{status:404});
    if(path==='/start'){
      const data=await request.json().catch(()=>({})) as {connectionId?:unknown};
      const id=typeof data.connectionId==='string'?data.connectionId:'legacy';
      if(!/^(legacy|[0-9a-f-]{36})$/.test(id)||!await getWechatConnection(this.env,id))return Response.json({error:'WECHAT_CONNECTION_NOT_FOUND'},{status:404});
      await this.ctx.storage.put('connectionId',id);
      await this.ctx.storage.put('lastError',null);
      await this.ctx.storage.setAlarm(Date.now()+1000);
      return Response.json({ok:true});
    }
    if(path==='/pause'){
      await this.ctx.storage.deleteAlarm();
      return Response.json({ok:true});
    }
    if(path==='/reset'){
      await this.ctx.storage.deleteAlarm();
      await Promise.all(['cursor','lastPoll','lastError','lastMessage','lastProcessing','lastMediaError','conversation'].map(key=>this.ctx.storage.delete(key)));
      return Response.json({ok:true});
    }
    return new Response('Not found',{status:404});
  }
  async alarm():Promise<void>{
    // Each account is polled by its own Durable Object with its own cursor,
    // conversation state and alarm. The migrated account retains the old DO id.
    const connectionId=await this.ctx.storage.get<string>('connectionId')||'legacy';
    const connection=await getWechatConnection(this.env,connectionId);
    if(!connection||connection.enabled!==1)return;
    const tokenEncrypted=connection.token_cipher;
    const botId=connection.bot_id,userId=connection.user_id;
    const base=connection.base_url||API_BASE;
    if(!tokenEncrypted||!botId||!userId)return;
    let delay=2500;
    try{
      const token=await decryptSecret(this.env,tokenEncrypted);
      const cursor=(await this.ctx.storage.get<string>('cursor'))||'';
      const cached=await this.ctx.storage.get<any>('conversation');
      if(cached?.expiresAt&&cached.expiresAt<=Date.now())await this.ctx.storage.delete('conversation');
      const response=await ilink(base,'ilink/bot/getupdates',{get_updates_buf:cursor,base_info:{channel_version:'2.4.10',bot_agent:'BabyMemo/0.1'}},token,45000);
      await this.ctx.storage.put('lastPoll',new Date().toISOString());
      await this.ctx.storage.put('lastError',null);
      for(const raw of (Array.isArray(response.msgs)?response.msgs:[])){
        if(!raw||raw.message_type!==1||(raw.message_state!==undefined&&raw.message_state!==0&&raw.message_state!==2)||raw.group_id||raw.from_user_id!==userId||raw.to_user_id&&raw.to_user_id!==botId)continue;
        if(!Array.isArray(raw.item_list))continue;
        const text=raw.item_list.filter((i:any)=>i?.type===1&&typeof i?.text_item?.text==='string').map((i:any)=>i.text_item.text).join('\n').trim();
        const msgid=String(raw.message_id||raw.msg_id||'');
        const hasMedia=mediaItems(raw).length>0;
         const processingStarted=Date.now();
        if((!text&&!hasMedia)||!msgid||text.length>3000)continue;
        const unique=botId+':'+msgid;
        await this.env.DB.prepare("INSERT OR IGNORE INTO wechat_messages(message_id,state,created_at) VALUES(?,'processing',?)").bind(unique,new Date().toISOString()).run();
        const row=await this.env.DB.prepare('SELECT state,reply_text,client_id,photo_attempts FROM wechat_messages WHERE message_id=?').bind(unique)
          .first<{state:string;reply_text:string|null;client_id:string|null;photo_attempts:number}>();
        if(row?.state==='done')continue;
        const thread=getActiveThread(await this.ctx.storage.get('conversation'),botId,userId);
        const clear=!hasMedia&&isClearContext(text);
        let reply=row?.reply_text?await decryptSecret(this.env,row.reply_text):'';
        if(!reply){
          try{
            if(clear)reply='已清除本次微信会话的短期上下文和宝宝选择。';
            else if(hasMedia){
              reply=await handleWechatPhotoMessage(this.env,raw,unique,thread);
              if(reply.startsWith('已保存')||reply.startsWith('这些照片或视频已经保存过'))await this.ctx.storage.delete('lastMediaError');
              if(reply.startsWith('已保存')&&/记(?:录|下)|里程碑|成长瞬间/.test(text)){
               const follow=await handleWechatCommand(this.env,text,unique+':caption',thread,messageTime(raw));
               reply+='\n'+follow;
              }
            }else reply=await handleWechatCommand(this.env,text,unique,thread,messageTime(raw));
          }catch(e){
            if(hasMedia)await this.ctx.storage.put('lastMediaError',{
              code:wechatMediaErrorCode(e),attempt:(row?.photo_attempts||0)+1,at:new Date().toISOString()
            });
            // Protocol-invalid or expired photos can be acknowledged with a helpful
            // error. Network/R2/D1 failures are retried with the original cursor.
            if(hasMedia&&!(e instanceof WechatPhotoError)){
              const attempts=(row?.photo_attempts||0)+1;
              await this.env.DB.prepare('UPDATE wechat_messages SET photo_attempts=? WHERE message_id=?').bind(attempts,unique).run();
              if(attempts<3)throw e; // keep upstream cursor for bounded retry
              reply='图片或视频下载/入库多次失败，请检查相册内是否已有部分媒体，然后重新发送尚未保存的内容。';
            }else reply=e instanceof WechatPhotoError?e.message:(friendlyOpenRouterError(e)||'暂时无法处理，请稍后再发送一次。');
          }
        }
        // Save a deterministic response and client ID before sending. Replayed batches
        // reuse both and cannot create duplicate growth rows for the same message.
        const clientId=row?.client_id||crypto.randomUUID();
        await this.env.DB.prepare("UPDATE wechat_messages SET state='processed',reply_text=?,client_id=? WHERE message_id=?")
          .bind(await encryptSecret(this.env,reply.slice(0,1800)),clientId,unique).run();
        // Persist operational context before transport acknowledgement; replay reuses it.
        if(clear)await this.ctx.storage.delete('conversation');
        else if(thread.selectedBabyId||thread.babyId){
          const next=appendTurn(thread,hasMedia?'[微信图片或视频]':text,reply,thread.selectedBabyId||thread.babyId);
          await this.ctx.storage.put('conversation',next);
        }
        await ilink(base,'ilink/bot/sendmessage',{msg:{from_user_id:'',to_user_id:userId,client_id:clientId,message_type:2,message_state:2,context_token:raw.context_token,item_list:[{type:1,text_item:{text:reply.slice(0,1800)}}]},base_info:{channel_version:'2.4.10',bot_agent:'BabyMemo/0.1'}},token);
        await this.env.DB.prepare("UPDATE wechat_messages SET state='done' WHERE message_id=?").bind(unique).run();
        await this.ctx.storage.put('lastMessage',new Date().toISOString());
        await this.ctx.storage.put('lastProcessing',{kind:hasMedia?'media':'text',durationMs:Date.now()-processingStarted,at:new Date().toISOString()});
      }
      // Acknowledgement advances only after all supported messages are durable.
      if(typeof response.get_updates_buf==='string')await this.ctx.storage.put('cursor',response.get_updates_buf);
    }catch(e){
      const code=e instanceof Error&&/^WECHAT_[A-Z_0-9]+$/.test(e.message)?e.message:'POLL_OR_NETWORK_ERROR';
      await this.ctx.storage.put('lastError',code);
      delay=30000;
      if(code==='WECHAT_AUTH_EXPIRED'){
        await this.env.DB.prepare('UPDATE wechat_connections SET enabled=0,updated_at=? WHERE id=?').bind(new Date().toISOString(),connectionId).run();
        await this.ctx.storage.deleteAlarm();
        return;
      }
    }finally{
      if((await getWechatConnection(this.env,connectionId))?.enabled===1)await this.ctx.storage.setAlarm(Date.now()+delay);
    }
  }
}
