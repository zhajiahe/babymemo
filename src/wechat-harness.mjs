// BabyMemo's WeChat capability registry. The model chooses one tool, never writes SQL.
// Execution uses validated parameters, the paired account's baby and private D1 only.
const str={type:'string'};
const day={type:'string',description:'真实公历日期 YYYY-MM-DD'};
const number=(unit,max)=>({type:'number',description:unit+'（必须是用户明确给出的数值）',exclusiveMinimum:0,maximum:max});
const selector={id:{type:'string',description:'查询结果中的记录编号，至少前 8 位'},day:{type:'string',description:'唯一匹配记录的日期 YYYY-MM-DD；同日多条时需要记录编号'}};
const tool=(name,description,properties={},required=[])=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
import {guardAction,validDay,explicitDay,dayInZone} from './wechat-policy.mjs';
import {auditChange,operationSnapshot,snapshotChanges} from './wechat-operations.mjs';
export const wechatTools=[
 tool('get_runtime_context','读取消息发出时的可信时间、宝宝时区和目标宝宝；只有需要消歧时才调用'),
 tool('list_babies','列出这个家庭已经创建的宝宝'),
 tool('get_baby','读取当前宝宝的生日、昵称、过敏等档案；用户问“多大了/几个月/几岁”等时，按消息本地日期计算年龄，不要直接复述档案'),
 tool('update_baby','修改宝宝档案，只根据用户明确说出的字段修改',{name:str,allergies:str,notes:str,birthday:day,birthTime:{type:'string',description:'出生时间 HH:mm'}}),
 tool('list_growth','查询成长测量，结果中含记录编号',{day,limit:{type:'integer',minimum:1,maximum:10}}),
 tool('create_growth','新增一条体重/身高/头围测量，必须有用户明确提供的数值和单位',{day,weight:number('kg',150),height:number('cm',250),headCircumference:number('cm',100),notes:str},['day']),
 tool('update_growth','更正已有测量，只修改用户明确要求变动的字段',{...selector,weight:number('kg',150),height:number('cm',250),headCircumference:number('cm',100),notes:str}),
 tool('delete_growth','把唯一一条测量移入 30 天回收站，必须有删除意图且有明确目标',selector),
 tool('list_milestones','查询成长事件，结果中含记录编号',{day,limit:{type:'integer',minimum:1,maximum:10}}),
 tool('create_milestone','新增一条成长事件',{day,title:str,description:str},['day','title']),
 tool('update_milestone','修改某条成长事件标题/描述/日期',{...selector,newDay:day,title:str,description:str}),
 tool('delete_milestone','把唯一一条成长事件移入 30 天回收站，必须有删除意图',selector),
 tool('list_media','列出相册里的照片和视频（仅元数据），支持日期筛选',{day,limit:{type:'integer',minimum:1,maximum:10}}),
 tool('update_media','修改相册内容的拍摄日期',{...selector,newDay:day}),
 tool('delete_media','把一项相册内容移入 30 天回收站，必须有删除意图',selector),
 tool('list_trash','查看当前宝宝的回收站',{kind:{type:'string',enum:['growth','milestones','media']}}),
 tool('restore_trash','从回收站中恢复一项内容',{kind:{type:'string',enum:['growth','milestones','media']},...selector},['kind']),
 tool('search_records','按关键词和日期范围查询记录',{kind:{type:'string',enum:['growth','milestones','media']},startDay:day,endDay:day,keyword:str,limit:{type:'integer',minimum:1,maximum:10}},['kind']),
 tool('growth_summary','汇总区间内体重身高头围',{startDay:day,endDay:day},['startDay','endDay']),
 tool('update_recent_media','更正刚发送的一批照片或视频日期',{newDay:day},['newDay'])
];
export const wechatHelp='BabyMemo 微信操作\n可以直接发送：\n· 小好今天体重 10.5 kg，身高 80 cm\n· 查小好最近五次体重\n· 小好今天会走路了\n· 查小好的里程碑 / 相册\n· 把小好 10 月 1 日的体重改成 10.2 kg\n· 删除小好 10 月 1 日的成长记录\n· 查看小好的回收站 / 恢复编号 12345678\n· 直接发送照片或视频 → 自动存入私有相册（单个 50 MiB 上限）\n· 查询后说“把第一条改成……”可连续操作；发送“清除上下文”重置记忆（多宝宝请先设置默认收图宝宝）\n同一天有多条时，先查询记录并使用回复里的编号。删除后可在 30 天内恢复。支持绑定微信的私聊文字与照片。';
const validDate=x=>{
 if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;
 const d=new Date(x+'T00:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===x;
};
const cleanText=(x,max)=>typeof x==='string'?x.trim().slice(0,max):null;
const value=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const pad=(x)=>x==null?'':String(x);
const short=x=>x.slice(0,8);
const tableForKind={growth:'growth_records',milestones:'milestones',media:'media'};
const labelForKind={growth:'成长测量',milestones:'成长事件',media:'相册内容'};
const dateText=(x)=>x.day;
const maxLimit=(args)=>Number.isInteger(args.limit)?Math.min(10,Math.max(1,args.limit)):5;
const listLine=(kind,r)=>{
 const bits=kind==='growth'?[r.weight!=null?'体重 '+r.weight+' kg':'',r.height!=null?'身高 '+r.height+' cm':'',r.head_circumference!=null?'头围 '+r.head_circumference+' cm':'',r.notes||'']:
 kind==='milestones'?[r.title||'',r.description||'']:[r.mime||''];
 return short(r.id)+' · '+r.day+' · '+bits.filter(Boolean).join('，');
};
function groundedTarget(args,text,baby,at=Date.now()){
 if(typeof text!=='string')return false;
 if(args.id!==undefined)return typeof args.id==='string'&&text.toLowerCase().includes(args.id.slice(0,8).toLowerCase());
 if(!validDate(args.day))return false;
 const [year,month,day]=args.day.split('-').map(Number);
 const full=new RegExp(year+'\\s*[-/年.]\\s*0?'+month+'\\s*[-/月.]\\s*0?'+day+'\\s*日?');
 const partial=new RegExp('(?:^|\\D)0?'+month+'\\s*月\\s*0?'+day+'\\s*日?');
 if(full.test(text)||partial.test(text)||text.includes(args.day))return true;
 const tz=baby.time_zone||'Asia/Shanghai';
 let current;
 current=dayInZone(at,tz)
 const dt=new Date(current+'T00:00:00Z');
 for(const [expression,offset] of [['今天',0],['今日',0],['昨天',-1],['昨日',-1],['前天',-2]]){
  if(!text.includes(expression))continue;
  const date=new Date(dt.getTime()+offset*86400000).toISOString().slice(0,10);
  if(date===args.day)return true;
 }
 return false;
}
async function findTarget(env,babyId,kind,args,deleted=false){
 const table=tableForKind[kind];
 if(!table)throw Error('不支持的记录种类');
 const status=deleted?'IS NOT NULL':'IS NULL';
 if(args.id!==undefined){
   if(typeof args.id!=='string'||!/^[0-9a-f-]{8,36}$/i.test(args.id))throw Error('记录编号至少为前 8 位，请先查询');
   const rows=await env.DB.prepare('SELECT * FROM '+table+' WHERE baby_id=? AND deleted_at '+status+' AND id LIKE ? LIMIT 2').bind(babyId,args.id+'%').all();
   if(rows.results.length!==1)throw Error(rows.results.length?'编号不唯一，请发送完整记录编号':'找不到该编号，请先查询');
   return rows.results[0];
 }
 if(args.day!==undefined){
   if(!validDate(args.day))throw Error('请提供准确的公历日期');
   const rows=await env.DB.prepare('SELECT * FROM '+table+' WHERE baby_id=? AND deleted_at '+status+' AND day=? ORDER BY created_at DESC LIMIT 2').bind(babyId,args.day).all();
   if(rows.results.length!==1)throw Error(rows.results.length?'这一天有多条记录，请先查询后提供记录编号':'该日期没有相应记录');
   return rows.results[0];
 }
 throw Error('请指定记录日期或查询后使用记录编号');
}
async function listItems(env,baby,kind,args){
 const table=tableForKind[kind];
 const clauses=['baby_id=?','deleted_at IS NULL'],params=[baby.id];
 if(args.day!==undefined){if(!validDate(args.day))return '请提供有效日期';clauses.push('day=?');params.push(args.day)}
 if(args.title!==undefined&&kind==='media'){const name=cleanText(args.title,60);if(!name)return '请提供照片或视频名称';clauses.push('title LIKE ?');params.push('%'+name+'%')}
 const rows=await env.DB.prepare('SELECT * FROM '+table+' WHERE '+clauses.join(' AND ')+' ORDER BY day DESC,created_at DESC LIMIT ?').bind(...params,maxLimit(args)).all();
 return rows.results.length?baby.name+' 的'+labelForKind[kind]+'：\n'+rows.results.map(x=>listLine(kind,x)).join('\n'):'暂时没有符合条件的'+labelForKind[kind]+'。';
}
async function update(env,kind,record,changes,options={}){
 const table=tableForKind[kind],names=Object.keys(changes);
 if(!names.length)return '请明确需要修改的内容';
 const stmt=env.DB.prepare('UPDATE '+table+' SET '+names.map(x=>x+'=?').join(',')+
  ' WHERE id=? AND baby_id=? AND deleted_at IS NULL AND '+names.map(x=>x+' IS ?').join(' AND '))
  .bind(...names.map(x=>changes[x]),record.id,record.baby_id,...names.map(x=>record[x]??null));
 if(typeof env.DB.batch!=='function'){
  const r=await stmt.run();return r.meta.changes?'已更新'+labelForKind[kind]+'（编号 '+short(record.id)+'）。':'记录已发生变化';
 }
 const opId=await auditChange(env,{sourceId:options.messageId,babyId:record.baby_id,kind,recordId:record.id,
   action:'update',before:operationSnapshot(kind,record),after:snapshotChanges(kind,record,changes),statement:stmt});
 if(opId&&options.thread)options.thread.lastOperation={babyId:record.baby_id,opId,expiresAt:(options.at||Date.now())+1200000};
 return opId?'已更新'+labelForKind[kind]+'（编号 '+short(record.id)+'）。':'记录已发生变化，请重新查询';
}
function measurement(args){
 const fields=[['weight','weight',0.1,150],['height','height',10,250],['headCircumference','head_circumference',10,100]];
 const changes={};
 for(const [input,db,min,max] of fields){
  if(args[input]===undefined)continue;
  if(!value(args[input],min,max))throw Error('测量值或单位不合法，请重新确认');
  changes[db]=args[input];
 }
 if(args.notes!==undefined){const txt=cleanText(args.notes,1500);if(txt===null)throw Error('备注格式错误');changes.notes=txt}
 return changes;
}
export async function runWechatTool(env,baby,action,args={},messageId='',originalText='',options={}){
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
   const r=await env.DB.prepare('SELECT name,birthday FROM babies ORDER BY created_at LIMIT 30').all();
   return '家庭宝宝：\n'+r.results.map(x=>x.name+'（'+x.birthday+'）').join('\n');
  }
  if(!baby)return '请先在 BabyMemo 中建立宝宝档案';
  if(action==='get_baby')return baby.name+' 的档案：生日 '+baby.birthday+(baby.birth_time?' '+baby.birth_time:'（出生时间未填写）')+'，过敏和注意事项：'+(baby.allergies||'未填写')+'，备注：'+(baby.notes||'无');
  if(action==='update_baby'){
   if(!/修改|更正|更改|更新|设置|改成|改为|改一下|记为|添加过敏|补充过敏/.test(originalText))return '请明确说明“修改宝宝资料”，防止误操作';
   const changes={};
   if(args.name!==undefined){const name=cleanText(args.name,80);if(!name)throw Error('昵称不能为空');changes.name=name}
   if(args.allergies!==undefined){if(typeof args.allergies!=='string'||args.allergies.length>2000)throw Error('过敏备注最长 2000 字');
    changes.allergies=/补充过敏|添加过敏|增加过敏/.test(originalText)?[...new Set([...(baby.allergies||'').split(/[，,、;；]+/),args.allergies].map(x=>x.trim()).filter(Boolean))].join('，'):args.allergies;
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
   const unsafe=guardAction(action,args,originalText,baby,at);if(unsafe)return unsafe;
   const id=crypto.randomUUID(),when=new Date().toISOString();
   await env.DB.prepare('INSERT OR IGNORE INTO growth_records(id,baby_id,day,weight,height,head_circumference,notes,created_at,source_message_id) VALUES(?,?,?,?,?,?,?,?,?)')
   .bind(id,baby.id,args.day,changes.weight??null,changes.height??null,changes.head_circumference??null,changes.notes||'来自微信',when,messageId||null).run();
   const found=messageId?await env.DB.prepare('SELECT * FROM growth_records WHERE source_message_id=? AND baby_id=?').bind(messageId,baby.id).first():null;
   return '已保存 '+baby.name+' 的成长测量：'+(found?listLine('growth',found):args.day+'（'+short(id)+'）');
  }
  if(action==='create_milestone'){
   if(!validDate(args.day))throw Error('请给出有效日期');
   const title=cleanText(args.title,120);
   if(!title||typeof args.title!=='string'||args.title.length>120)throw Error('请提供 120 字以内的事件标题');
   const description=args.description===undefined?'':cleanText(args.description,2000);
   const id=crypto.randomUUID(),when=new Date().toISOString();
   await env.DB.prepare('INSERT OR IGNORE INTO milestones(id,baby_id,day,title,description,created_at,source_message_id) VALUES(?,?,?,?,?,?,?)')
   .bind(id,baby.id,args.day,title,description,when,messageId||null).run();
   const found=messageId?await env.DB.prepare('SELECT * FROM milestones WHERE source_message_id=? AND baby_id=?').bind(messageId,baby.id).first():null;
   return '已保存成长事件：'+(found?listLine('milestones',found):title+'（'+args.day+'）');
  }
  for(const kind of ['growth','milestones','media']){
   if(action==='update_'+(kind==='milestones'?'milestone':kind)){
    if(!/修改|更正|更改|更新|改成|改为|改一下|设为|标记/.test(originalText))return '请明确说明修改操作';
    if(args.id===undefined&&args.day===undefined)return '请指定记录日期或编号，避免改错记录';
    if(!groundedTarget(args,originalText,baby,at))return '请在消息中明确指出要修改的日期或记录编号，避免改错记录';
    const unsafe=guardAction(action,args,originalText,baby,at);if(unsafe)return unsafe;
    const row=await findTarget(env,baby.id,kind,args);
    const changes={};
    if(kind==='growth')Object.assign(changes,measurement(args));
    else if(kind==='milestones'){
     if(args.title!==undefined){const title=cleanText(args.title,120);if(!title||args.title.length>120)throw Error('事件标题不能为空或过长');changes.title=title}
     if(args.description!==undefined){if(typeof args.description!=='string'||args.description.length>3000)throw Error('事件描述不能超过 3000 字');changes.description=args.description}
    }else{
     if(args.title!==undefined){const title=cleanText(args.title,200);if(!title)throw Error('媒体名称不能为空');changes.title=title}
     
    }
    if(args.newDay!==undefined){if(!validDate(args.newDay))throw Error('新日期不正确');changes.day=args.newDay}
    return await update(env,kind,row,changes,{messageId,thread:options.thread,at});
   }
   if(action==='delete_'+(kind==='milestones'?'milestone':kind)){
    if(!/删除|删掉|移入回收站|移到回收站/.test(originalText))return '请明确说“删除”并指定日期或编号';
    if(!groundedTarget(args,originalText,baby,at))return '请在消息中写明需要删除的日期或记录编号，避免误删';
    const unsafe=guardAction(action,args,originalText,baby,at);if(unsafe)return unsafe;
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
   const kinds=args.kind?[args.kind]:['growth','milestones','media'],sections=[];
   for(const kind of kinds){const table=tableForKind[kind];if(!table)throw Error('回收站类型不正确');
    const rows=await env.DB.prepare('SELECT * FROM '+table+' WHERE baby_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 10').bind(baby.id).all();
    if(rows.results.length)sections.push('回收站 · '+labelForKind[kind]+'：\n'+rows.results.map(x=>listLine(kind,x)).join('\n'));
   }
   return sections.join('\n')||'回收站暂无内容';
  }
  if(action==='search_records'){
   const kind=args.kind,table=tableForKind[kind];if(!table)return '请指定查询的记录类型';
   if(args.startDay&&!validDay(args.startDay)||args.endDay&&!validDay(args.endDay)||
     args.startDay&&args.endDay&&args.startDay>args.endDay)return '查询日期范围不合法';
   const cols=kind==='growth'?'notes':kind==='milestones'?"title||' '||description":'title';
   const clauses=['baby_id=?','deleted_at IS NULL'],values=[baby.id];
   if(args.startDay){clauses.push('day>=?');values.push(args.startDay)}
   if(args.endDay){clauses.push('day<=?');values.push(args.endDay)}
   if(args.keyword!==undefined){
    const word=cleanText(args.keyword,80);if(!word)return '请输入要查找的关键词';
    clauses.push('('+cols+') LIKE ?');values.push('%'+word.replace(/[%_]/g,'')+'%');
   }
   const rows=await env.DB.prepare('SELECT * FROM '+table+' WHERE '+clauses.join(' AND ')+' ORDER BY day DESC,created_at DESC LIMIT ?')
    .bind(...values,maxLimit(args)).all();
   return rows.results.length?baby.name+' 的查询结果：\n'+rows.results.map(x=>listLine(kind,x)).join('\n'):'没有找到符合条件的记录';
  }
  if(action==='growth_summary'){
   if(!validDay(args.startDay)||!validDay(args.endDay)||args.startDay>args.endDay)return '请指定有效日期范围';
   const rows=await env.DB.prepare('SELECT day,weight,height,head_circumference FROM growth_records WHERE baby_id=? AND deleted_at IS NULL AND day>=? AND day<=? ORDER BY day ASC,created_at ASC LIMIT 500')
    .bind(baby.id,args.startDay,args.endDay).all();
   if(!rows.results.length)return '这段时间还没有测量记录';
   const metric=(name,unit)=>{const xs=rows.results.filter(x=>typeof x[name]==='number');
     return xs.length?name+'：'+xs[0][name]+unit+' → '+xs.at(-1)[name]+unit+'，变化 '+Number((xs.at(-1)[name]-xs[0][name]).toFixed(2))+unit:'';};
   return baby.name+' '+args.startDay+' 至 '+args.endDay+'，共 '+rows.results.length+' 条测量\n'+
    [metric('weight','kg'),metric('height','cm'),metric('head_circumference','cm')].filter(Boolean).join('\n');
  }
  if(action==='update_recent_media'){
   const batch=options.thread?.lastMedia;
   if(!batch||batch.babyId!==baby.id||batch.expiresAt<=at||!Array.isArray(batch.ids))return '没有可确认的最近照片批次';
   if(!/照片|图片|视频|这几张|刚才/.test(originalText)||!validDay(args.newDay)||
      explicitDay(originalText,at,baby.time_zone)!==args.newDay)return '请明确指定刚发送的照片和新日期';
   const statements=[],opIds=[];
   for(let i=0;i<Math.min(4,batch.ids.length);i++){
    const id=batch.ids[i];
    const previous=await env.DB.prepare('SELECT * FROM media WHERE id=? AND baby_id=? AND deleted_at IS NULL LIMIT 1').bind(id,baby.id).first();
    if(!previous)throw Error('最近照片批次包含无效或已删除记录，请重新查询');
    const opId=crypto.randomUUID();opIds.push(opId);
    statements.push(env.DB.prepare('UPDATE media SET day=? WHERE id=? AND baby_id=? AND deleted_at IS NULL AND day=?')
      .bind(args.newDay,id,baby.id,previous.day));
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO wechat_operation_log(id,source_message_id,baby_id,kind,record_id,action,before_json,after_json,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()>0')
      .bind(opId,messageId+':media:'+i,baby.id,'media',id,'update_recent_media',
       JSON.stringify(operationSnapshot('media',previous)),JSON.stringify(snapshotChanges('media',previous,{day:args.newDay})),new Date().toISOString()));
   }
   const results=await env.DB.batch(statements);
   const changed=results.reduce((n,r,i)=>n+(i%2===0?(r.meta?.changes||0):0),0),committed=[];
   for(let i=0;i<Math.min(4,batch.ids.length);i++){
    const log=await env.DB.prepare('SELECT id FROM wechat_operation_log WHERE source_message_id=? AND baby_id=? LIMIT 1')
      .bind(messageId+':media:'+i,baby.id).first();
    if(log)committed.push(log.id);
   }
   if(options.thread&&committed.length)options.thread.lastOperation={babyId:baby.id,opIds:committed,expiresAt:at+1200000};
   return '已更新最近 '+changed+'/'+opIds.length+' 项照片或视频日期。'+(changed<opIds.length?'部分记录同时发生变更，请重新查询核对。':'');
  }
  if(action==='restore_trash'){
   if(!/恢复|还原|找回/.test(originalText))return '请明确说“恢复”并指定记录编号';
   if(!tableForKind[args.kind])throw Error('请说明恢复的是测量、事件或相册');
   if(!groundedTarget(args,originalText,baby,at))return '请在消息中写明恢复记录的日期或编号';
   const unsafe=guardAction(action,args,originalText,baby,at);if(unsafe)return unsafe;
   const row=await findTarget(env,baby.id,args.kind,args,true);
   const stmt=env.DB.prepare('UPDATE '+tableForKind[args.kind]+' SET deleted_at=NULL WHERE id=? AND baby_id=? AND deleted_at IS NOT NULL').bind(row.id,baby.id);
   if(typeof env.DB.batch!=='function'){
    const changed=await stmt.run();return changed.meta.changes?'已恢复 '+labelForKind[args.kind]+'（编号 '+short(row.id)+'）。':'该记录无法恢复';
   }
   const opId=await auditChange(env,{sourceId:messageId,babyId:baby.id,kind:args.kind,recordId:row.id,action:'restore',
    before:operationSnapshot(args.kind,row),after:snapshotChanges(args.kind,row,{deleted_at:null}),statement:stmt});
   if(opId&&options.thread)options.thread.lastOperation={babyId:baby.id,opId,expiresAt:at+1200000};
   return opId?'已恢复 '+labelForKind[args.kind]+'（编号 '+short(row.id)+'）。':'该记录无法恢复';
  }
  return wechatHelp;
 }catch(err){
  return err instanceof Error?err.message:'指令执行失败，请重新查询';
 }
}
