import type {Env} from './types';
import type {WechatBaby} from './wechat-harness.mjs';
type RecordKind='growth'|'milestones'|'media'|'baby';
type ToolCall={type:'function';function:{name:string;arguments:string};id?:string};
type PlanOptions={messageId:string;text:string;groundedText?:string;at?:number;thread?:any;stepOffset?:number;referenceScope?:MessageReferenceScope;encryptReply?:(value:string)=>Promise<string>;decryptReply?:(value:string)=>Promise<string>};
// Bounded tool execution and scenario state. No free-form SQL or arbitrary model actions.
import {runWechatTool,wechatTools} from './wechat-harness.mjs';
import {guardAction,MUTATING_ACTIONS,isCancel,isUndo} from './wechat-policy.mjs';
import {recordQuery} from './wechat-memory.mjs';
import {validateReferenceMutation,captureMessageReferences,type MessageReferenceScope} from './wechat-context-snapshot.ts';
import {auditChange,operationSnapshot,undoOperation} from './wechat-operations.mjs';
const KINDS:Record<string,RecordKind|null>={create_growth:'growth',update_growth:'growth',delete_growth:'growth',list_growth:'growth',
 create_milestone:'milestones',update_milestone:'milestones',delete_milestone:'milestones',list_milestones:'milestones',
 update_media:'media',delete_media:'media',list_media:'media',update_recent_media:'media',update_baby:'baby',restore_trash:null};
const TABLES:Record<RecordKind,string>={growth:'growth_records',milestones:'milestones',media:'media',baby:'babies'};
// A partial/zero batch update is not a fully successful mutation.
export function isCommittedMutationReply(action:string,reply:string){
 if(action==='update_recent_media'){
  const m=String(reply).match(/^已更新最近 (\d+)\/(\d+) 项/);
  return !!m&&Number(m[1])>0&&Number(m[1])===Number(m[2]);
 }
 return /^(已保存|已更新|已将|已恢复|此前已成功提交)/.test(String(reply));
}
async function recoverCachedStep(env:Env,thread:any,baby:WechatBaby,action:string,args:Record<string,any>,kind:RecordKind|null,sourceId:string,messageId:string,at:number,reply:string){
 if(!thread)return;
 if(['list_growth','list_milestones','list_media','search_records'].includes(action)){
  const queryKind=action==='search_records'?args.kind:kind;
  if(queryKind)recordQuery(thread,baby.id,queryKind,idFromReply(reply),at,messageId);
 }
 if(!MUTATING_ACTIONS.has(action)||!isCommittedMutationReply(action,reply))return;
 thread.pending=null;
 const sources=action==='update_recent_media'
  ? Array.from({length:4},(_,n)=>sourceId+':media:'+n)
  : [sourceId,sourceId+':audit'];
 const rows=await env.DB.prepare('SELECT id FROM wechat_operation_log WHERE baby_id=? AND source_message_id IN ('+
  sources.map(()=>'?').join(',')+') ORDER BY created_at')
  .bind(baby.id,...sources).all<{id:string}>();
 const opIds=rows.results.map(r=>r.id);
 if(opIds.length)thread.lastOperation={babyId:baby.id,
  ...(action==='update_recent_media'?{opIds}:{opId:opIds.at(-1)}),
  expiresAt:at+1200000};
}
const bounded=(t:unknown,n:number)=>String(t||'').slice(0,n);
const idFromReply=(s:string)=>[...String(s).matchAll(/^([a-f0-9]{8}) · /gim)].map(x=>x[1]);
async function recordFor(env:Env,kind:RecordKind,babyId:string,args:Record<string,any>):Promise<any|null>{
 const table=TABLES[kind];if(!table)return null;
 const column=kind==='baby'?'id':'baby_id';
 const where=args?.id&&kind!=='baby'?' AND id LIKE ?':args?.day&&kind!=='baby'?' AND day=?':'';
 if(kind!=='baby'&&!where)return null;
 const bind=[babyId,...(where?[args.id?args.id+'%':args.day]:[])];
 const rows=await env.DB.prepare('SELECT * FROM '+table+' WHERE '+column+'=?'+where+' LIMIT 2').bind(...bind).all();
 return rows.results.length===1?rows.results[0]:null;
}
async function createdBySource(env:Env,kind:RecordKind,babyId:string,sourceId:string):Promise<any|null>{
 if(!['growth','milestones'].includes(kind))return null;
 return env.DB.prepare('SELECT * FROM '+TABLES[kind]+' WHERE baby_id=? AND source_message_id=? LIMIT 1').bind(babyId,sourceId).first();
}
export async function runWechatPlan(env:Env,baby:WechatBaby,calls:ToolCall[],{messageId,text,groundedText=text,at=Date.now(),thread=null,stepOffset=0,referenceScope=captureMessageReferences(thread,at),encryptReply=async (x:string)=>x,decryptReply=async (x:string)=>x}:PlanOptions){
 if(!Array.isArray(calls)||!calls.length)return '没有需要执行的工具';
 if(calls.length>4)return '一次最多处理 4 项操作，请分开发送';
 const names=new Set(wechatTools.map(t=>t.function.name)),results:string[]=[];
 for(let i=0;i<calls.length;i++){
  const call=calls[i];
  if(call?.type!=='function'||!names.has(call.function?.name)||typeof call.function.arguments!=='string')
   return [...results,'出现不受支持的工具操作，剩余操作未执行。'].join('\n');
  const action=call.function.name,kind=KINDS[action]||null,sourceId=messageId+':step:'+(stepOffset+i);
  // Claims and results are always scoped by the server-selected baby, not a model babyId.
  let args;try{args=JSON.parse(call.function.arguments)}catch{return [...results,'模型参数不是合法 JSON，后续操作未执行。'].join('\n')}
  if(!args||typeof args!=='object'||Array.isArray(args))return [...results,'模型参数格式不正确，后续操作未执行。'].join('\n');
  const cached=await env.DB.prepare('SELECT reply FROM wechat_tool_steps WHERE source_message_id=? AND baby_id=? LIMIT 1')
    .bind(sourceId,baby.id).first<{reply:string}>();
  if(cached){
   const reply=await decryptReply(cached.reply);
   await recoverCachedStep(env,thread,baby,action,args,kind,sourceId,messageId,at,reply);
   results.push(reply);continue;
  }
  // A transaction can commit before the message reply/step journal is persisted.
  // Do not replay an old edit over a newer record state after such a crash.
  if(['update_baby','update_growth','update_milestone','update_media','delete_growth','delete_milestone','delete_media','restore_trash','update_recent_media'].includes(action)){
   // Media updates have at most four deterministic audit sources. Exact matching
   // also supports long iLink IDs and treats %/_ in those IDs literally.
   const prior=await env.DB.prepare('SELECT id FROM wechat_operation_log WHERE baby_id=? AND source_message_id IN (?,?,?,?,?) LIMIT 1')
     .bind(baby.id,sourceId,...Array.from({length:4},(_,n)=>sourceId+':media:'+n)).first<{id:string}>();
   if(prior){
    const recovered='此前已成功提交此操作（操作编号 '+prior.id.slice(0,8)+'），已跳过重复执行。';
    results.push(recovered);
    await env.DB.prepare('INSERT OR IGNORE INTO wechat_tool_steps(source_message_id,baby_id,action,reply,created_at) VALUES(?,?,?,?,?)')
     .bind(sourceId,baby.id,action,await encryptReply(recovered),new Date().toISOString()).run();
    continue;
   }
  }
  // Model selects operations using conversation context. Only clear refusal
  // in this incoming message is a hard stop; DB validates target and scope.
  const denied=guardAction(action,args,text,baby,at)||validateReferenceMutation({action,args,text,babyId:baby.id,messageId,scope:referenceScope,currentQuery:thread?.lastQuery,at:Date.now()});
  if(denied){results.push(denied);break}
  const before=MUTATING_ACTIONS.has(action)&&kind?await recordFor(env,kind,baby.id,args):null;
  // A second, different WeChat message may still be a duplicate business operation.
  if(action==='create_growth'&&!/再记一次|再测一次|重新测量|又测了/.test(groundedText)){
   const previous=await env.DB.prepare('SELECT * FROM growth_records WHERE baby_id=? AND day=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 3').bind(baby.id,args.day).all<Record<string,any>>();
   const recent=previous.results.some(x=>
     Date.parse(x.created_at)>Date.now()-300000 &&
     ['weight','height','headCircumference'].every(k=>args[k]===undefined||Number(args[k])===Number(x[k==='headCircumference'?'head_circumference':k])) &&
     ['weight','height','headCircumference'].some(k=>args[k]!==undefined));
   if(recent){results.push('最近五分钟已有相同测量，可能重复。确实重新测量请说“再记一次”，目前未新增。');break}
  }
  const reply=await runWechatTool(env,baby,action,args,sourceId,text,{thread,at});
  results.push(reply);
  const success=isCommittedMutationReply(action,reply);
  if(MUTATING_ACTIONS.has(action)&&!success)break;
  if(action==='list_growth'||action==='list_milestones'||action==='list_media'||action==='search_records'){
   const qkind=action==='search_records'?args.kind:kind;
   if(thread&&qkind)recordQuery(thread,baby.id,qkind,idFromReply(reply),at,messageId);
  }
  if(success&&kind&&thread){
   const after=action.startsWith('create_')?await createdBySource(env,kind,baby.id,sourceId):
     action==='update_recent_media'?null:await recordFor(env,kind,baby.id,before?{id:before.id}:args);
   if(after){
    const atomicAudit=new Set(['update_baby','update_growth','update_milestone','update_media','delete_growth','delete_milestone','delete_media','restore_trash']);
    let opId;
    if(atomicAudit.has(action)){
     const existing=await env.DB.prepare('SELECT id FROM wechat_operation_log WHERE source_message_id=? AND baby_id=? LIMIT 1')
       .bind(sourceId,baby.id).first<{reply:string;id?:string}>();
     opId=existing?.id||null;
    }else{
     opId=await auditChange(env,{sourceId:sourceId+':audit',babyId:baby.id,kind,recordId:after.id,action,
       before:operationSnapshot(kind,before),after:operationSnapshot(kind,after)});
    }
    if(opId)thread.lastOperation={babyId:baby.id,opId,expiresAt:at+1200000};
    if(action==='create_milestone'&&thread.lastMedia?.babyId===baby.id&&thread.lastMedia.expiresAt>at&&/照片|视频|图片|刚才发的/.test(groundedText)){
     let linked=0;
     for(const id of thread.lastMedia.ids.slice(0,4)){
      const x=await env.DB.prepare('INSERT OR IGNORE INTO milestone_media(milestone_id,media_id) SELECT ?,id FROM media WHERE id=? AND baby_id=? AND deleted_at IS NULL')
       .bind(after.id,id,baby.id).run();
      linked+=x.meta?.changes||0;
     }
     if(linked)results[results.length-1]+=' 已关联 '+linked+' 项刚发送的照片或视频。';
    }
   }
  }
  // Persist every executed step before the next step or the final WeChat reply.
  await env.DB.prepare('INSERT OR IGNORE INTO wechat_tool_steps(source_message_id,baby_id,action,reply,created_at) VALUES(?,?,?,?,?)')
   .bind(sourceId,baby.id,action,await encryptReply(bounded(results.at(-1),1500)),new Date().toISOString()).run();
  if(thread&&success)thread.pending=null;
 }
 return results.join('\n');
}
export async function quickCommand(env:Env,baby:WechatBaby,text:string,thread:any,at:number=Date.now()){
 if(isCancel(text)){
  if(!thread?.pending)return '当前没有待完成的任务；已提交的记录如需撤销请发送“撤销”。';
  thread.pending=null;return '已取消尚未完成的任务，未写入记录。';
 }
 if(isUndo(text)){
  const op=thread?.lastOperation;
  if(!op||op.babyId!==baby.id||op.expiresAt<=at)return '没有有效的最近操作可以撤销';
  if(Array.isArray(op.opIds)){
   const messages:string[]=[];
   for(const id of op.opIds)messages.push(await undoOperation(env,baby.id,id));
   if(messages.every(x=>x.startsWith('已撤销')))thread.lastOperation=null;
   return messages.join('\n');
  }
  const reply=await undoOperation(env,baby.id,op.opId);
  if(reply.startsWith('已撤销'))thread.lastOperation=null;
  return reply;
 }
 return null;
}
