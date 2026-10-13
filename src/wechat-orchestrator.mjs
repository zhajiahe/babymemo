// Bounded tool execution and scenario state. No free-form SQL or arbitrary model actions.
import {runWechatTool,wechatTools} from './wechat-harness.mjs';
import {guardAction,MUTATING_ACTIONS,explicitDay,isCancel,isUndo,isFollowup} from './wechat-policy.mjs';
import {recordQuery,setPending} from './wechat-memory.mjs';
import {auditChange,operationSnapshot,undoOperation} from './wechat-operations.mjs';
const KINDS={create_growth:'growth',update_growth:'growth',delete_growth:'growth',list_growth:'growth',
 create_milestone:'milestones',update_milestone:'milestones',delete_milestone:'milestones',list_milestones:'milestones',
 update_media:'media',delete_media:'media',list_media:'media',update_recent_media:'media',update_baby:'baby',restore_trash:null};
const TABLES={growth:'growth_records',milestones:'milestones',media:'media',baby:'babies'};
const MUTATION_OK=/^(已保存|已更新|已将|已恢复)/;
const bounded=(t,n)=>String(t||'').slice(0,n);
const idFromReply=s=>[...String(s).matchAll(/^([a-f0-9]{8}) · /gim)].map(x=>x[1]);
async function recordFor(env,kind,babyId,args){
 const table=TABLES[kind];if(!table)return null;
 const column=kind==='baby'?'id':'baby_id';
 const where=args?.id&&kind!=='baby'?' AND id LIKE ?':args?.day&&kind!=='baby'?' AND day=?':'';
 if(kind!=='baby'&&!where)return null;
 const bind=[babyId,...(where?[args.id?args.id+'%':args.day]:[])];
 const rows=await env.DB.prepare('SELECT * FROM '+table+' WHERE '+column+'=?'+where+' LIMIT 2').bind(...bind).all();
 return rows.results.length===1?rows.results[0]:null;
}
async function createdBySource(env,kind,babyId,sourceId){
 if(!['growth','milestones'].includes(kind))return null;
 return env.DB.prepare('SELECT * FROM '+TABLES[kind]+' WHERE baby_id=? AND source_message_id=? LIMIT 1').bind(babyId,sourceId).first();
}
function pendingActionFromText(text){
 if(/(?:记录|记一下|记下|记个).{0,12}(?:体重|身高|头围)/.test(text))return 'create_growth';
 if(/(?:记录|记一下|记下|记个).{0,12}(?:里程碑|成长瞬间|成长事件)/.test(text))return 'create_milestone';
 return null;
}
export async function runWechatPlan(env,baby,calls,{messageId,text,groundedText=text,at=Date.now(),thread=null,encryptReply=async x=>x,decryptReply=async x=>x}){
 if(!Array.isArray(calls)||!calls.length)return '没有需要执行的工具';
 if(calls.length>4)return '一次最多处理 4 项操作，请分开发送';
 const names=new Set(wechatTools.map(t=>t.function.name)),results=[];
 for(let i=0;i<calls.length;i++){
  const call=calls[i];
  if(call?.type!=='function'||!names.has(call.function?.name)||typeof call.function.arguments!=='string')
   return [...results,'出现不受支持的工具操作，剩余操作未执行。'].join('\n');
  const action=call.function.name,kind=KINDS[action]||null,sourceId=messageId+':step:'+i;
  let args;try{args=JSON.parse(call.function.arguments)}catch{return [...results,'模型参数不是合法 JSON，后续操作未执行。'].join('\n')}
  if(!args||typeof args!=='object'||Array.isArray(args))return [...results,'模型参数格式不正确，后续操作未执行。'].join('\n');
  // Claims and results are always scoped by the server-selected baby, not a model babyId.
  const cached=await env.DB.prepare('SELECT reply FROM wechat_tool_steps WHERE source_message_id=? AND baby_id=? LIMIT 1')
    .bind(sourceId,baby.id).first();
  if(cached){results.push(await decryptReply(cached.reply));continue}
  // A transaction can commit before the message reply/step journal is persisted.
  // Do not replay an old edit over a newer record state after such a crash.
  if(['update_baby','update_growth','update_milestone','update_media','delete_growth','delete_milestone','delete_media','restore_trash','update_recent_media'].includes(action)){
   const prior=await env.DB.prepare('SELECT id FROM wechat_operation_log WHERE baby_id=? AND (source_message_id=? OR source_message_id LIKE ?) LIMIT 1')
     .bind(baby.id,sourceId,sourceId+':media:%').first();
   if(prior){
    const recovered='此前已成功提交此操作（操作编号 '+prior.id.slice(0,8)+'），已跳过重复执行。';
    results.push(recovered);
    await env.DB.prepare('INSERT OR IGNORE INTO wechat_tool_steps(source_message_id,baby_id,action,reply,created_at) VALUES(?,?,?,?,?)')
     .bind(sourceId,baby.id,action,await encryptReply(recovered),new Date().toISOString()).run();
    continue;
   }
  }
  if(MUTATING_ACTIONS.has(action)){
   const denied=guardAction(action,args,groundedText,baby,at);
   if(denied){results.push(denied);break}
  }
  // A preceding query does not authorise writing to another baby or another type.
  if(args.id&&thread?.lastQuery&&groundedText.includes('记录编号')&&
     (thread.lastQuery.babyId!==baby.id||kind!==thread.lastQuery.kind||!thread.lastQuery.ids.some(id=>id===args.id||id.startsWith(args.id))))
   {results.push('上次查询编号不属于当前宝宝或记录类型，未修改。');break}
  const before=MUTATING_ACTIONS.has(action)&&kind?await recordFor(env,kind,baby.id,args):null;
  // A second, different WeChat message may still be a duplicate business operation.
  if(action==='create_growth'&&!/再记一次|再测一次|重新测量|又测了/.test(groundedText)){
   const previous=await env.DB.prepare('SELECT * FROM growth_records WHERE baby_id=? AND day=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 3').bind(baby.id,args.day).all();
   const recent=previous.results.some(x=>
     Date.parse(x.created_at)>Date.now()-300000 &&
     ['weight','height','headCircumference'].every(k=>args[k]===undefined||Number(args[k])===Number(x[k==='headCircumference'?'head_circumference':k])) &&
     ['weight','height','headCircumference'].some(k=>args[k]!==undefined));
   if(recent){results.push('最近五分钟已有相同测量，可能重复。确实重新测量请说“再记一次”，目前未新增。');break}
  }
  const reply=await runWechatTool(env,baby,action,args,sourceId,groundedText,{thread,at});
  results.push(reply);
  const success=MUTATION_OK.test(reply);
  if(MUTATING_ACTIONS.has(action)&&!success){
   if(thread&&/(?:请|需要|明确|日期|编号|不合法)/.test(reply))
    setPending(thread,baby.id,action,groundedText,args,at);
   break;
  }
  if(action==='list_growth'||action==='list_milestones'||action==='list_media'||action==='search_records'){
   const qkind=action==='search_records'?args.kind:kind;
   if(thread&&qkind)recordQuery(thread,baby.id,qkind,idFromReply(reply),at);
  }
  if(success&&kind&&thread){
   const after=action.startsWith('create_')?await createdBySource(env,kind,baby.id,sourceId):
     action==='update_recent_media'?null:await recordFor(env,kind,baby.id,before?{id:before.id}:args);
   if(after){
    const atomicAudit=new Set(['update_baby','update_growth','update_milestone','update_media','delete_growth','delete_milestone','delete_media','restore_trash']);
    let opId;
    if(atomicAudit.has(action)){
     const existing=await env.DB.prepare('SELECT id FROM wechat_operation_log WHERE source_message_id=? AND baby_id=? LIMIT 1')
       .bind(sourceId,baby.id).first();
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
export async function quickCommand(env,baby,text,thread,at=Date.now()){
 if(isCancel(text)){
  if(!thread?.pending)return '当前没有待完成的任务；已提交的记录如需撤销请发送“撤销”。';
  thread.pending=null;return '已取消尚未完成的任务，未写入记录。';
 }
 if(isUndo(text)){
  const op=thread?.lastOperation;
  if(!op||op.babyId!==baby.id||op.expiresAt<=at)return '没有有效的最近操作可以撤销';
  if(Array.isArray(op.opIds)){
   const messages=[];
   for(const id of op.opIds)messages.push(await undoOperation(env,baby.id,id));
   if(messages.every(x=>x.startsWith('已撤销')))thread.lastOperation=null;
   return messages.join('\n');
  }
  const reply=await undoOperation(env,baby.id,op.opId);
  if(reply.startsWith('已撤销'))thread.lastOperation=null;
  return reply;
 }
 if(thread&&!thread.pending&&pendingActionFromText(text)&&!/\d+(?:\.\d+)?\s*(?:kg|公斤|斤|cm|厘米|g|克)/i.test(text)){
  setPending(thread,baby.id,pendingActionFromText(text),text,{},at);
  return '需要补充具体数值、单位和日期。你可以继续发“10.5 公斤，昨天”。';
 }
 return null;
}
