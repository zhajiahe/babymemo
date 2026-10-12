import JSONBig from 'json-bigint';
import type { Env, Baby } from './types';
import { decryptSecret, setting } from './crypto';

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
export async function askOpenRouter(env:Env,message:string,baby?:Baby|null,test=false):Promise<string> {
  const encrypted=await setting(env,'openrouter_key');
  if(!encrypted)throw Error('OPENROUTER_KEY_MISSING');
  const key=await decryptSecret(env,encrypted);
  const model=await setting(env,'openrouter_model')||'openai/gpt-4.1-mini';
  const context=baby?'宝宝姓名：'+baby.name+'，生日：'+baby.birthday+'，已知过敏信息：'+baby.allergies+'。':'';
  const instruction='你是 BabyMemo 家庭成长记录助手。回答要简明、温和、准确；没有记录的事情不能编造。对医学症状只提供一般信息，不做诊断。不要假装已经保存了任何记录。';
  const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key,'HTTP-Referer':'https://github.com/zhajiahe/babymemo','X-Title':'BabyMemo'},
    redirect:'manual',signal:AbortSignal.timeout(25000),
    body:JSON.stringify({model,messages:[{role:'system',content:instruction+(test?'':context)},{role:'user',content:message}],max_tokens:400,temperature:0.2})
  });
  if(!res.ok){await res.body?.cancel();throw Error('OPENROUTER_HTTP_'+res.status);}
  const data=await res.json() as Json;
  const answer=data?.choices?.[0]?.message?.content;
  if(typeof answer!=='string'||!answer.trim())throw Error('OPENROUTER_EMPTY_RESPONSE');
  return answer.slice(0,1800);
}
async function handleMessage(env:Env,text:string):Promise<string> {
  const baby=await env.DB.prepare('SELECT id,name,birthday,gender,time_zone,allergies,notes FROM babies ORDER BY created_at LIMIT 1').first<Baby>();
  if(!baby)return '请先在 BabyMemo 中完成宝宝信息设置。';
  const encrypted=await setting(env,'openrouter_key');
  if(!encrypted)return '请先在 BabyMemo 的设置中配置 OpenRouter。';
  const model=await setting(env,'openrouter_model')||'openai/gpt-4.1-mini';
  const key=await decryptSecret(env,encrypted);
  const system='你是 BabyMemo 家庭成长助手。今天是 '+new Date().toISOString().slice(0,10)+'，宝宝：'+baby.name+'，出生日期：'+baby.birthday+'。'+
    '你可以查询或记录成长数据。只有用户明确表达测量及单位时才调用记录工具；不确定时间/单位时先追问，不能捏造。'+
    '体重统一 kg，身高/头围 cm，斤换算为0.5kg。工具一次最多一个。没有成功调用工具不能声称已保存。不提供医学诊断，不泄漏私有记录。';
  const tools=[
    {type:'function',function:{name:'create_growth_record',description:'将用户明确提供的一次测量写入成长记录',parameters:{type:'object',properties:{
      day:{type:'string',description:'YYYY-MM-DD'},weight:{type:'number',description:'单位 kg'},height:{type:'number',description:'cm'},headCircumference:{type:'number',description:'cm'}
    },required:['day'],additionalProperties:false}}},
    {type:'function',function:{name:'create_milestone',description:'将用户明确描述的成长事件写入里程碑',parameters:{type:'object',properties:{
      day:{type:'string',description:'YYYY-MM-DD'},title:{type:'string'},description:{type:'string'}
    },required:['day','title'],additionalProperties:false}}}
  ];
  const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+key,'HTTP-Referer':'https://github.com/zhajiahe/babymemo','X-Title':'BabyMemo'},
    redirect:'manual',signal:AbortSignal.timeout(25000),
    body:JSON.stringify({model,messages:[{role:'system',content:system},{role:'user',content:text.slice(0,3000)}],tools,tool_choice:'auto',temperature:0,max_tokens:600})
  });
  if(!res.ok){await res.body?.cancel();throw Error('OPENROUTER_HTTP_'+res.status);}
  const result=await res.json() as Json;
  const msg=result?.choices?.[0]?.message;
  if(!msg)throw Error('INVALID_OPENROUTER_REPLY');
  if(!Array.isArray(msg.tool_calls)||msg.tool_calls.length===0)return typeof msg.content==='string'?msg.content.slice(0,1800):'请再说得具体一些。';
  if(msg.tool_calls.length!==1) return '请每次只记录一项内容，我会逐条帮你保存。';
  const call=msg.tool_calls[0];
  if(call?.type!=='function'||typeof call.function?.arguments!=='string')throw Error('BAD_TOOL_CALL');
  const args=JSON.parse(call.function.arguments) as Json;
  if(typeof args.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(args.day))return '请告诉我记录的准确日期。';
  const id=crypto.randomUUID(),when=new Date().toISOString();
  if(call.function.name==='create_growth_record'){
    const values=[args.weight,args.height,args.headCircumference];
    if(values.every(v=>v===undefined)||!values.every((v,i)=>v===undefined||(typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=[100,250,100][i])))return '请确认测量数据和单位后再告诉我。';
    await env.DB.prepare('INSERT INTO growth_records(id,baby_id,day,weight,height,head_circumference,notes,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(id,baby.id,args.day,args.weight??null,args.height??null,args.headCircumference??null,'来自微信',when).run();
    return '已记录 '+baby.name+' 的成长测量（'+args.day+'）。';
  }
  if(call.function.name==='create_milestone'&&typeof args.title==='string'&&args.title.trim()&&args.title.length<=120){
    await env.DB.prepare('INSERT INTO milestones(id,baby_id,day,title,description,created_at) VALUES(?,?,?,?,?,?)')
      .bind(id,baby.id,args.day,args.title.trim(),String(args.description||'').slice(0,2000),when).run();
    return '已保存里程碑：'+args.title.trim()+'（'+args.day+'）。';
  }
  return '这条消息暂不支持自动记录，请换一种更明确的说法。';
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
      if(typeof response.get_updates_buf==='string')await this.ctx.storage.put('cursor',response.get_updates_buf);
      await this.ctx.storage.put('lastPoll',new Date().toISOString());
      await this.ctx.storage.put('lastError',null);
      for(const raw of (Array.isArray(response.msgs)?response.msgs:[]).slice(0,8)){
        if(!raw||raw.message_type!==1||(raw.message_state!==undefined&&raw.message_state!==0&&raw.message_state!==2)||raw.group_id||raw.from_user_id!==userId||raw.to_user_id&&raw.to_user_id!==botId||!raw.context_token)continue;
        if(!Array.isArray(raw.item_list))continue;
        const text=raw.item_list.filter((i:any)=>i?.type===1&&typeof i?.text_item?.text==='string').map((i:any)=>i.text_item.text).join('\n').trim();
        const msgid=String(raw.message_id||'');
        if(!text||!msgid||text.length>3000)continue;
        const unique=botId+':'+msgid;
        const inserted=await this.env.DB.prepare("INSERT OR IGNORE INTO wechat_messages(message_id,state,created_at) VALUES(?,'processing',?)").bind(unique,new Date().toISOString()).run();
        if(!inserted.meta.changes)continue;
        let reply='';
        try{reply=await handleMessage(this.env,text);}
        catch {reply='暂时无法处理，请稍后再发送一次。';}
        try{
          await ilink(base,'ilink/bot/sendmessage',{msg:{from_user_id:'',to_user_id:userId,client_id:crypto.randomUUID(),message_type:2,message_state:2,context_token:raw.context_token,item_list:[{type:1,text_item:{text:reply.slice(0,1800)}}]},base_info:{channel_version:'2.4.10',bot_agent:'BabyMemo/0.1'}},token);
          await this.env.DB.prepare("UPDATE wechat_messages SET state='done' WHERE message_id=?").bind(unique).run();
          await this.ctx.storage.put('lastMessage',new Date().toISOString());
        }catch{await this.env.DB.prepare("UPDATE wechat_messages SET state='unknown' WHERE message_id=?").bind(unique).run();}
      }
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
