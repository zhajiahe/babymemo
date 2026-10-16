import type {Env} from './types';
import type {WechatBaby} from './wechat-tool-schema.ts';
import type {Kind,DbRow,ToolOptions} from './wechat-harness-helpers.ts';
import {wechatHelp,wechatTools} from './wechat-tool-schema.ts';
export {wechatHelp,wechatTools} from './wechat-tool-schema.ts';
export type {WechatBaby} from './wechat-tool-schema.ts';
import {validDate,cleanText,short,tableForKind,labelForKind,maxLimit,listLine,findTarget,listItems,update,measurement} from './wechat-harness-helpers.ts';
import {guardAction,validDay,dayInZone} from './wechat-policy.mjs';
import {ageOnDay} from './wechat-answer.mjs';
import {retentionCutoff} from './media-retention.mjs';
import {mediaCapabilities} from './wechat-capabilities.ts';
import {auditChange,operationSnapshot,snapshotChanges} from './wechat-operations.mjs';
export async function runWechatTool(env:Env,baby:WechatBaby|null,action:string,args:Record<string,any>={},messageId='',originalText='',options:ToolOptions={}){
 const at=options.at||Date.now();
 try{
  if(!args||typeof args!=='object'||Array.isArray(args))return '指令参数不正确，请换一种说法';
  if(action==='get_runtime_context'){
   const zone=baby?.time_zone||'Asia/Shanghai';
   const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));
   return JSON.stringify({currentTimestamp:new Date().toISOString(),messageTimestamp:new Date(at).toISOString(),
    messageLocalDay:dayInZone(at,zone),localDay:dayInZone(Date.now(),zone),
    messageLocalTime:parts,timeZone:zone,targetBaby:baby?.name||null});
  }
  if(action==='list_babies'){
   const r=await env.DB.prepare('SELECT name,birthday FROM babies WHERE archived_at IS NULL ORDER BY created_at LIMIT 30').all<DbRow>();
   return '家庭宝宝：\n'+r.results.map(x=>x.name+'（'+x.birthday+'）').join('\n');
  }
  if(!baby)return '请先在 BabyMemo 中建立宝宝档案';
  if(action==='get_baby'){
   const age=ageOnDay(baby.birthday,dayInZone(at,baby.time_zone||'Asia/Shanghai'));
   const ageInfo=age?'，截至消息当天年龄 '+age.years+'岁'+age.months+'个月'+age.remainderDays+'天，出生'+age.days+'天':'';
   return baby.name+' 的档案：生日 '+baby.birthday+(baby.birth_time?' '+baby.birth_time:'（出生时间未填写）')+
    ageInfo+'，过敏和注意事项：'+(baby.allergies||'未填写')+'，备注：'+(baby.notes||'无');
  }
  if(action==='update_baby'){
   const changes:Record<string,any>={};
   if(args.name!==undefined){const name=cleanText(args.name,80);if(!name)throw Error('昵称不能为空');changes.name=name}
   if(args.allergies!==undefined){if(typeof args.allergies!=='string'||args.allergies.length>2000)throw Error('过敏备注最长 2000 字');
    changes.allergies=args.allergies;
   }
   if(args.notes!==undefined){if(typeof args.notes!=='string'||args.notes.length>4000)throw Error('备注最长 4000 字');changes.notes=args.notes}
   if(args.birthday!==undefined){if(!validDate(args.birthday))throw Error('生日日期不正确');changes.birthday=args.birthday}
    if(args.birthTime!==undefined){if(typeof args.birthTime!=='string'||args.birthTime!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(args.birthTime))throw Error('出生时间应为 HH:mm');changes.birth_time=args.birthTime}
   if(!Object.keys(changes).length)return '请说明要修改的字段';
   const keys=Object.keys(changes),stmt=env.DB.prepare('UPDATE babies SET '+keys.map(x=>x+'=?').join(',')+
    ' WHERE id=? AND '+keys.map(x=>x+' IS ?').join(' AND ')).bind(...Object.values(changes),baby.id,...keys.map(x=>baby[x]??null));
   if(typeof env.DB.batch!=='function'){await stmt.run();return '已更新 '+baby.name+' 的宝宝档案。'}
   const opId=await auditChange(env,{sourceId:messageId,babyId:baby.id,kind:'baby',recordId:baby.id,
    action:'update',before:operationSnapshot('baby',baby),after:snapshotChanges('baby',baby,changes),statement:stmt});
   if(opId&&options.thread)options.thread.lastOperation={babyId:baby.id,opId,expiresAt:at+1200000};
   return opId?'已更新 '+baby.name+' 的宝宝档案。':'宝宝资料发生变化，请重新查询';
  }
  if(action==='list_growth'||action==='list_milestones'||action==='list_media'){
   return await listItems(env,baby,action==='list_growth'?'growth':action==='list_milestones'?'milestones':'media',args);
  }
  if(action==='create_growth'){
   if(!validDate(args.day))throw Error('请给出有效日期');
   const changes=measurement(args);
   if(!['weight','height','head_circumference'].some(x=>x in changes))throw Error('请明确体重、身高或头围数值');
   const id=crypto.randomUUID(),when=new Date().toISOString();
   await env.DB.prepare('INSERT OR IGNORE INTO growth_records(id,baby_id,day,weight,height,head_circumference,notes,created_at,source_message_id) VALUES(?,?,?,?,?,?,?,?,?)')
   .bind(id,baby.id,args.day,changes.weight??null,changes.height??null,changes.head_circumference??null,changes.notes||'来自微信',when,messageId||null).run();
   const found=messageId?await env.DB.prepare('SELECT * FROM growth_records WHERE source_message_id=? AND baby_id=?').bind(messageId,baby.id).first():null;
   return '已保存 '+baby.name+' 的成长测量：'+(found?listLine('growth',found as DbRow):args.day+'（'+short(id)+'）');
  }
  if(action==='create_milestone'){
   const unsafe=guardAction(action,args,originalText,baby,at);if(unsafe)return unsafe;
   if(!validDate(args.day))throw Error('请给出有效日期');
   const title=cleanText(args.title,120);
   if(!title||typeof args.title!=='string'||args.title.length>120)throw Error('请提供 120 字以内的事件标题');
   const description=args.description===undefined?'':cleanText(args.description,2000);
   const id=crypto.randomUUID(),when=new Date().toISOString();
   await env.DB.prepare('INSERT OR IGNORE INTO milestones(id,baby_id,day,title,description,created_at,source_message_id) VALUES(?,?,?,?,?,?,?)')
   .bind(id,baby.id,args.day,title,description,when,messageId||null).run();
   const found=messageId?await env.DB.prepare('SELECT * FROM milestones WHERE source_message_id=? AND baby_id=?').bind(messageId,baby.id).first():null;
   return '已保存成长事件：'+(found?listLine('milestones',found as DbRow):title+'（'+args.day+'）');
  }
  for(const kind of ['growth','milestones','media'] as const){
   if(action==='update_'+(kind==='milestones'?'milestone':kind)){
    if(args.id===undefined&&args.day===undefined)return '请指定记录日期或编号，避免改错记录';
    const row=await findTarget(env,baby.id,kind,args);
     if(kind==='media'&&!mediaCapabilities(row).editDescription)return '该媒体当前不可编辑（'+mediaCapabilities(row).reason+'），请核对上传状态。';
    const changes:Record<string,any>={};
    if(kind==='growth')Object.assign(changes,measurement(args));
    else if(kind==='milestones'){
     if(args.title!==undefined){const title=cleanText(args.title,120);if(!title||args.title.length>120)throw Error('事件标题不能为空或过长');changes.title=title}
     if(args.description!==undefined){if(typeof args.description!=='string'||args.description.length>3000)throw Error('事件描述不能超过 3000 字');changes.description=args.description}
    }else{
     if(args.description!==undefined){if(typeof args.description!=='string'||args.description.length>1000)throw Error('媒体描述不能超过 1000 字');changes.description=args.description.trim()}
    }
    if(args.newDay!==undefined){if(!validDate(args.newDay))throw Error('新日期不正确');changes.day=args.newDay}
    return await update(env,kind,row,changes,{messageId,thread:options.thread,at});
   }
   if(action==='delete_'+(kind==='milestones'?'milestone':kind)){
    const row=await findTarget(env,baby.id,kind,args);
    const deletedAt=new Date().toISOString();
    const stmt=env.DB.prepare('UPDATE '+tableForKind[kind]+' SET deleted_at=? WHERE id=? AND baby_id=? AND deleted_at IS NULL')
     .bind(deletedAt,row.id,baby.id);
    if(typeof env.DB.batch!=='function'){
     const changed=await stmt.run();
     return changed.meta.changes?'已将 '+labelForKind[kind]+'（编号 '+short(row.id)+'）移入回收站，30 天内可恢复。':'未删除：记录已发生变化';
    }
    const opId=await auditChange(env,{sourceId:messageId,babyId:baby.id,kind,recordId:row.id,action:'delete',
     before:operationSnapshot(kind,row),after:snapshotChanges(kind,row,{deleted_at:deletedAt}),statement:stmt});
    if(opId&&options.thread)options.thread.lastOperation={babyId:baby.id,opId,expiresAt:at+1200000};
    return opId?'已将 '+labelForKind[kind]+'（编号 '+short(row.id)+'）移入回收站，30 天内可恢复。':'未删除：记录已发生变化';
   }
  }
  if(action==='list_trash'){
   const kinds:Kind[]=args.kind?[args.kind as Kind]:['growth','milestones','media'],sections:string[]=[];
   for(const kind of kinds){const table=tableForKind[kind];if(!table)throw Error('回收站类型不正确');
    const rows=await env.DB.prepare('SELECT * FROM '+table+' WHERE baby_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 10').bind(baby.id).all<DbRow>();
    if(rows.results.length)sections.push('回收站 · '+labelForKind[kind]+'：\n'+rows.results.map(x=>listLine(kind,x)).join('\n'));
   }
   return sections.join('\n')||'回收站暂无内容';
  }
  if(action==='search_records'){
   const kind=args.kind as Kind,table=tableForKind[kind];if(!table)return '请指定查询的记录类型';
   if(args.startDay&&!validDay(args.startDay)||args.endDay&&!validDay(args.endDay)||
     args.startDay&&args.endDay&&args.startDay>args.endDay)return '查询日期范围不合法';
   const cols=kind==='growth'?'notes':"title||' '||description";
   const clauses=['baby_id=?','deleted_at IS NULL'],values=[baby.id];
   if(args.startDay){clauses.push('day>=?');values.push(args.startDay)}
   if(args.endDay){clauses.push('day<=?');values.push(args.endDay)}
   if(args.keyword!==undefined){
    const word=cleanText(args.keyword,80);if(!word)return '请输入要查找的关键词';
    clauses.push('('+cols+') LIKE ?');values.push('%'+word.replace(/[%_]/g,'')+'%');
   }
   const rows=await env.DB.prepare('SELECT * FROM '+table+' WHERE '+clauses.join(' AND ')+' ORDER BY day DESC,created_at DESC LIMIT ?')
    .bind(...values,maxLimit(args)).all<DbRow>();
   return rows.results.length?baby.name+' 的查询结果：\n'+rows.results.map(x=>listLine(kind,x)).join('\n'):'没有找到符合条件的记录';
  }
  if(action==='growth_summary'){
   if(!validDay(args.startDay)||!validDay(args.endDay)||args.startDay>args.endDay)return '请指定有效日期范围';
   const rows=await env.DB.prepare('SELECT day,weight,height,head_circumference FROM growth_records WHERE baby_id=? AND deleted_at IS NULL AND day>=? AND day<=? ORDER BY day ASC,created_at ASC LIMIT 500')
    .bind(baby.id,args.startDay,args.endDay).all<DbRow>();
   if(!rows.results.length)return '这段时间还没有测量记录';
   const metric=(name:string,unit:string)=>{const xs=rows.results.filter(x=>typeof x[name]==='number');
     return xs.length?name+'：'+xs[0][name]+unit+' → '+xs.at(-1)![name]+unit+'，变化 '+Number((xs.at(-1)![name]-xs[0][name]).toFixed(2))+unit:'';};
   return baby.name+' '+args.startDay+' 至 '+args.endDay+'，共 '+rows.results.length+' 条测量\n'+
    [metric('weight','kg'),metric('height','cm'),metric('head_circumference','cm')].filter(Boolean).join('\n');
  }
  if(action==='update_recent_media'){
   const batch=options.thread?.lastMedia;
   if(!batch||batch.babyId!==baby.id||batch.expiresAt<=at||!Array.isArray(batch.ids))return '没有可确认的最近照片批次';
   const changes:Record<string,any>={};
   if(args.newDay!==undefined){if(!validDay(args.newDay))return '请提供有效的新日期';changes.day=args.newDay}
   if(args.description!==undefined){
    if(typeof args.description!=='string'||args.description.length>1000)return '媒体描述不能超过 1000 字';
    changes.description=args.description.trim();
   }
   const names=Object.keys(changes);
   if(!names.length)return '请说明要修改的新日期或描述';
   const statements:D1PreparedStatement[]=[],opIds:string[]=[];
   for(let i=0;i<Math.min(4,batch.ids.length);i++){
    const id=batch.ids[i];
    const previous=await env.DB.prepare('SELECT * FROM media WHERE id=? AND baby_id=? AND deleted_at IS NULL LIMIT 1').bind(id,baby.id).first<DbRow>();
    if(!previous)throw Error('最近照片批次包含无效或已删除记录，请重新查询');
     if(!mediaCapabilities(previous).editDescription)throw Error('最近的媒体当前不可编辑（'+mediaCapabilities(previous).reason+'）。');
    const opId=crypto.randomUUID();opIds.push(opId);
    statements.push(env.DB.prepare('UPDATE media SET '+names.map(k=>k+'=?').join(',')+' WHERE id=? AND baby_id=? AND deleted_at IS NULL AND COALESCE(upload_state,\'ready\') IN (\'processing\',\'ready\') AND purge_token IS NULL AND '+names.map(k=>k+' IS ?').join(' AND '))
      .bind(...names.map(k=>changes[k]),id,baby.id,...names.map(k=>previous[k]??null)));
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO wechat_operation_log(id,source_message_id,baby_id,kind,record_id,action,before_json,after_json,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()>0')
      .bind(opId,messageId+':media:'+i,baby.id,'media',id,names.includes('day')?'update_recent_media_day':'update_recent_media',
       JSON.stringify(operationSnapshot('media',previous)),JSON.stringify(snapshotChanges('media',previous,changes)),new Date().toISOString()));
   }
   const results=await env.DB.batch(statements);
   const changed=results.reduce((n,r,i)=>n+(i%2===0?(r.meta?.changes||0):0),0),committed:string[]=[];
   for(let i=0;i<Math.min(4,batch.ids.length);i++){
    const log=await env.DB.prepare('SELECT id FROM wechat_operation_log WHERE source_message_id=? AND baby_id=? LIMIT 1')
      .bind(messageId+':media:'+i,baby.id).first<DbRow>();
    if(log)committed.push(log.id);
   }
   if(options.thread&&committed.length)options.thread.lastOperation={babyId:baby.id,opIds:committed,expiresAt:at+1200000};
   return '已更新最近 '+changed+'/'+opIds.length+' 项照片或视频信息。'+(changed<opIds.length?'部分记录同时发生变更，请重新查询核对。':'');
  }
  if(action==='restore_trash'){
   if(!tableForKind[args.kind as Kind])throw Error('请说明恢复的是测量、事件或相册');
   const unsafe=guardAction(action,args,originalText,baby,at);if(unsafe)return unsafe;
   const row=await findTarget(env,baby.id,args.kind,args,true);
   if(row.deleted_at<retentionCutoff()||args.kind==='media'&&row.purge_token)return '恢复期限已过或文件正在清理，未恢复';
   const stmt=env.DB.prepare('UPDATE '+tableForKind[args.kind as Kind]+' SET deleted_at=NULL WHERE id=? AND baby_id=? AND deleted_at IS NOT NULL AND deleted_at>=?'+(args.kind==='media'?' AND purge_token IS NULL':''))
    .bind(row.id,baby.id,retentionCutoff());
   if(typeof env.DB.batch!=='function'){
    const changed=await stmt.run();return changed.meta.changes?'已恢复 '+labelForKind[args.kind as Kind]+'（编号 '+short(row.id)+'）。':'该记录无法恢复';
   }
   const opId=await auditChange(env,{sourceId:messageId,babyId:baby.id,kind:args.kind,recordId:row.id,action:'restore',
    before:operationSnapshot(args.kind,row),after:snapshotChanges(args.kind,row,{deleted_at:null}),statement:stmt});
   if(opId&&options.thread)options.thread.lastOperation={babyId:baby.id,opId,expiresAt:at+1200000};
   return opId?'已恢复 '+labelForKind[args.kind as Kind]+'（编号 '+short(row.id)+'）。':'该记录无法恢复';
  }
  return wechatHelp;
 }catch(err){
  return err instanceof Error?err.message:'指令执行失败，请重新查询';
 }
}
