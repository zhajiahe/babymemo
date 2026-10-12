import JSONBig from 'json-bigint';
import type { Env, Baby } from './types';
import { decryptSecret, encryptSecret, setting } from './crypto';
import { wechatTools, wechatHelp, runWechatTool } from './wechat-harness.mjs';
import {WechatPhotoError,photoItems,persistWeChatPhotos} from './wechat-media.mjs';

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
export function workerBot(env:Env):DurableObjectStub {
  return env.BOT.get(env.BOT.idFromName('family'));
}
// OpenRouter is exclusively the WeChat command interpreter; no website chat API.
export async function testOpenRouterConnection(env:Env):Promise<boolean>{
  const encrypted=await setting(env,'openrouter_key');if(!encrypted)throw Error('OPENROUTER_KEY_MISSING');
  const model=await setting(env,'openrouter_model')||'openai/gpt-4.1-mini';
  const key=await decryptSecret(env,encrypted);
  const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key,'HTTP-Referer':'https://github.com/zhajiahe/babymemo','X-Title':'BabyMemo WeChat Operations'},
    redirect:'manual',signal:AbortSignal.timeout(25000),
    body:JSON.stringify({model,messages:[{role:'user',content:'Reply exactly: OK'}],temperature:0,max_tokens:16})
  });
  if(!res.ok){await res.body?.cancel();throw Error('OPENROUTER_HTTP_'+res.status);}
  const result=await res.json() as Json;
  return Array.isArray(result.choices)&&result.choices.length>0;
}
export async function handleWechatCommand(env:Env,text:string,messageId:string):Promise<string>{
  const command=text.trim();
  if(!command)return wechatHelp;
  if(/^(帮助|使用说明|菜单|help|你能做什么|有什么功能)[？?!！]?$/i.test(command))return wechatHelp;
  const babies=await env.DB.prepare('SELECT id,name,birthday,gender,time_zone,allergies,notes FROM babies ORDER BY created_at').all<Baby>();
  if(!babies.results.length)return '请先在 BabyMemo 中添加宝宝资料';
  if(/^(宝宝列表|列出宝宝|有哪些宝宝|查看所有宝宝)[？?]?$/i.test(command))return runWechatTool(env,null,'list_babies',{},messageId,command);
  const matches=babies.results.filter(b=>b.name && command.includes(b.name));
  if(matches.length>1||(babies.results.length>1&&matches.length!==1))
    return '请明确写出一位宝宝的名字。可选：'+babies.results.map(b=>b.name).join('、')+'\n示例：'+babies.results[0].name+' 今天体重 10.5kg';
  const baby=matches[0]||babies.results[0];
  const encrypted=await setting(env,'openrouter_key');
  if(!encrypted)return '请先在网页设置中配置微信操作所需的 OpenRouter Key';
  const model=await setting(env,'openrouter_model')||'openai/gpt-4.1-mini';
  const key=await decryptSecret(env,encrypted);
  const localDay=new Date().toLocaleDateString('sv-SE',{timeZone:baby.time_zone||'Asia/Shanghai'});
  const instruction='你是 BabyMemo 微信操作入口的工具路由器，不是聊天/育儿分析助手。'+
    '当前本地日期 '+localDay+'，目标宝宝 '+baby.name+'。根据绑定用户指令，每次仅选择一个最匹配的工具调用。'+
    '只提取用户明确说出的字段。必要参数不清楚时不要编造日期、测量值或目标记录；不确定就不调用工具。'+
    '修改和删除已有记录必须指定完整日期或查询结果的记录编号；同日可能有多条，具体由工具执行时判定。'+
    '只能使用提供的功能工具，绝不输出 SQL。不要回答育儿诊断、医学分析或与家庭记录无关的问答。';
  const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key,
      'HTTP-Referer':'https://github.com/zhajiahe/babymemo','X-Title':'BabyMemo WeChat Operations'},
    redirect:'manual',signal:AbortSignal.timeout(25000),
    body:JSON.stringify({model,messages:[{role:'system',content:instruction},{role:'user',content:command.slice(0,3000)}],
      tools:wechatTools,tool_choice:'auto',temperature:0,max_tokens:450})
  });
  if(!res.ok){await res.body?.cancel();throw Error('OPENROUTER_HTTP_'+res.status);}
  const response=await res.json() as Json;
  const calls=response?.choices?.[0]?.message?.tool_calls;
  if(!Array.isArray(calls)||calls.length===0)return '没能确定具体操作。请提供明确的宝宝、日期与动作。\n\n'+wechatHelp;
  if(calls.length!==1)return '请一次只操作一条记录，其他操作请分开发送';
  const call=calls[0];
  if(call?.type!=='function'||typeof call.function?.name!=='string'||typeof call.function?.arguments!=='string')return '无法识别指令参数，请再说一遍';
  if(!wechatTools.some(x=>x.function.name===call.function.name))return '不支持这项微信操作';
  let args:Record<string,unknown>;
  try{args=JSON.parse(call.function.arguments) as Record<string,unknown>}catch{return '无法解析指令参数，请再说一遍'}
  return await runWechatTool(env,baby,call.function.name,args,messageId,command);
}
// The photo itself has no baby name. Use the caption when present, otherwise
// an explicitly configured default baby; never silently choose first of many.
export async function handleWechatPhotoMessage(env:Env,raw:Json,messageId:string):Promise<string>{
  const babies=await env.DB.prepare('SELECT id,name,birthday,time_zone FROM babies ORDER BY created_at').all<Baby>();
  if(!babies.results.length)return '请先在 BabyMemo 网页创建宝宝档案，再发送照片。';
  const caption=(Array.isArray(raw.item_list)?raw.item_list:[])
   .filter((item:any)=>item?.type===1&&typeof item?.text_item?.text==='string')
   .map((item:any)=>item.text_item.text).join(' ').trim();
  const found=babies.results.filter(b=>b.name&&caption.includes(b.name));
  if(found.length>1)return '这张照片的文字中提到了多位宝宝，请每次只指定一位宝宝。';
  let baby=found[0];
  if(!baby){
    if(babies.results.length===1)baby=babies.results[0];
    else{
      const preferred=await setting(env,'wechat_default_baby_id');
      baby=babies.results.find(b=>b.id===preferred);
      if(!baby)return '收到照片，但当前家庭有多位宝宝。请先在网页「设置 → 微信操作」选择默认收图宝宝，或发送带宝宝昵称的图片消息。照片尚未保存。';
    }
  }
  return (await persistWeChatPhotos(env,raw,baby,messageId))||'没有检测到可保存的照片。';
}
export class WechatSession {
  constructor(private readonly ctx: DurableObjectState,private readonly env: Env){}
  async fetch(request:Request):Promise<Response>{
    const path=new URL(request.url).pathname;
    if(path==='/status'){
      return Response.json({enabled:await setting(this.env,'wechat_enabled')==='true',connected:!!await setting(this.env,'wechat_token'),lastPoll:await this.ctx.storage.get('lastPoll')||null,
        lastError:await this.ctx.storage.get('lastError')||null,lastMessage:await this.ctx.storage.get('lastMessage')||null});
    }
    if(request.method!=='POST')return new Response('Not found',{status:404});
    if(path==='/start'){
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
      await Promise.all(['cursor','lastPoll','lastError','lastMessage'].map(key=>this.ctx.storage.delete(key)));
      return Response.json({ok:true});
    }
    return new Response('Not found',{status:404});
  }
  async alarm():Promise<void>{
    if(await setting(this.env,'wechat_enabled')!=='true')return;
    const tokenEncrypted=await setting(this.env,'wechat_token');
    const botId=await setting(this.env,'wechat_bot_id'),userId=await setting(this.env,'wechat_user_id');
    const base=await setting(this.env,'wechat_base')||API_BASE;
    if(!tokenEncrypted||!botId||!userId)return;
    let delay=2500;
    try{
      const token=await decryptSecret(this.env,tokenEncrypted);
      const cursor=(await this.ctx.storage.get<string>('cursor'))||'';
      const response=await ilink(base,'ilink/bot/getupdates',{get_updates_buf:cursor,base_info:{channel_version:'2.4.10',bot_agent:'BabyMemo/0.1'}},token,45000);
      await this.ctx.storage.put('lastPoll',new Date().toISOString());
      await this.ctx.storage.put('lastError',null);
      for(const raw of (Array.isArray(response.msgs)?response.msgs:[])){
        if(!raw||raw.message_type!==1||(raw.message_state!==undefined&&raw.message_state!==0&&raw.message_state!==2)||raw.group_id||raw.from_user_id!==userId||raw.to_user_id&&raw.to_user_id!==botId||!raw.context_token)continue;
        if(!Array.isArray(raw.item_list))continue;
        const text=raw.item_list.filter((i:any)=>i?.type===1&&typeof i?.text_item?.text==='string').map((i:any)=>i.text_item.text).join('\n').trim();
        const msgid=String(raw.message_id||'');
        const hasPhotos=photoItems(raw).length>0;
        if((!text&&!hasPhotos)||!msgid||text.length>3000)continue;
        const unique=botId+':'+msgid;
        await this.env.DB.prepare("INSERT OR IGNORE INTO wechat_messages(message_id,state,created_at) VALUES(?,'processing',?)").bind(unique,new Date().toISOString()).run();
        const row=await this.env.DB.prepare('SELECT state,reply_text,client_id FROM wechat_messages WHERE message_id=?').bind(unique)
          .first<{state:string;reply_text:string|null;client_id:string|null}>();
        if(row?.state==='done')continue;
        let reply=row?.reply_text?await decryptSecret(this.env,row.reply_text):'';
        if(!reply){
          try{
            reply=hasPhotos?await handleWechatPhotoMessage(this.env,raw,unique):await handleWechatCommand(this.env,text,unique);
          }catch(e){
            // Protocol-invalid or expired photos can be acknowledged with a helpful
            // error. Network/R2/D1 failures are retried with the original cursor.
            if(hasPhotos&&!(e instanceof WechatPhotoError))throw e;
            reply=e instanceof WechatPhotoError?e.message:'暂时无法处理，请稍后再发送一次。';
          }
        }
        // Save a deterministic response and client ID before sending. Replayed batches
        // reuse both and cannot create duplicate growth rows for the same message.
        const clientId=row?.client_id||crypto.randomUUID();
        await this.env.DB.prepare("UPDATE wechat_messages SET state='processed',reply_text=?,client_id=? WHERE message_id=?")
          .bind(await encryptSecret(this.env,reply.slice(0,1800)),clientId,unique).run();
        await ilink(base,'ilink/bot/sendmessage',{msg:{from_user_id:'',to_user_id:userId,client_id:clientId,message_type:2,message_state:2,context_token:raw.context_token,item_list:[{type:1,text_item:{text:reply.slice(0,1800)}}]},base_info:{channel_version:'2.4.10',bot_agent:'BabyMemo/0.1'}},token);
        await this.env.DB.prepare("UPDATE wechat_messages SET state='done' WHERE message_id=?").bind(unique).run();
        await this.ctx.storage.put('lastMessage',new Date().toISOString());
      }
      // Acknowledgement advances only after all supported messages are durable.
      if(typeof response.get_updates_buf==='string')await this.ctx.storage.put('cursor',response.get_updates_buf);
    }catch(e){
      const code=e instanceof Error&&/^WECHAT_[A-Z_0-9]+$/.test(e.message)?e.message:'POLL_OR_NETWORK_ERROR';
      await this.ctx.storage.put('lastError',code);
      delay=30000;
      if(code==='WECHAT_AUTH_EXPIRED'){
        await this.env.DB.prepare("INSERT INTO app_settings(name,value,updated_at) VALUES('wechat_enabled','false',?) ON CONFLICT(name) DO UPDATE SET value='false',updated_at=excluded.updated_at").bind(new Date().toISOString()).run();
        await this.ctx.storage.deleteAlarm();
        return;
      }
    }finally{
      if(await setting(this.env,'wechat_enabled')==='true')await this.ctx.storage.setAlarm(Date.now()+delay);
    }
  }
}
