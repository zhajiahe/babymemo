// BabyMemo's WeChat capability registry. The model chooses one tool, never writes SQL.
// Execution uses validated parameters, the paired account's baby and private D1 only.
const str={type:'string'};
const day={type:'string',description:'真实公历日期 YYYY-MM-DD'};
const number=(unit,max)=>({type:'number',description:unit+'（必须是用户明确给出的数值）',exclusiveMinimum:0,maximum:max});
const selector={id:{type:'string',description:'查询结果中的记录编号，至少前 8 位'},day:{type:'string',description:'唯一匹配记录的日期 YYYY-MM-DD；同日多条时需要记录编号'}};
const tool=(name,description,properties={},required=[])=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
export const wechatTools=[
 tool('list_babies','列出这个家庭已经创建的宝宝'),
 tool('get_baby','读取当前宝宝的生日、昵称、过敏等档案'),
 tool('update_baby','修改宝宝档案，只根据用户明确说出的字段修改',{name:str,allergies:str,notes:str,birthday:day}),
 tool('list_growth','查询成长测量，结果中含记录编号',{day,limit:{type:'integer',minimum:1,maximum:10}}),
 tool('create_growth','新增一条体重/身高/头围测量，必须有用户明确提供的数值和单位',{day,weight:number('kg',150),height:number('cm',250),headCircumference:number('cm',100),notes:str},['day']),
 tool('update_growth','更正已有测量，只修改用户明确要求变动的字段',{...selector,weight:number('kg',150),height:number('cm',250),headCircumference:number('cm',100),notes:str}),
 tool('delete_growth','把唯一一条测量移入 30 天回收站，必须有删除意图且有明确目标',selector),
 tool('list_milestones','查询成长事件，结果中含记录编号',{day,limit:{type:'integer',minimum:1,maximum:10}}),
 tool('create_milestone','新增一条成长事件',{day,title:str,description:str},['day','title']),
 tool('update_milestone','修改某条成长事件标题/描述/日期',{...selector,newDay:day,title:str,description:str}),
 tool('delete_milestone','把唯一一条成长事件移入 30 天回收站，必须有删除意图',selector),
 tool('list_media','列出相册里的照片和视频（仅元数据），支持日期和名称筛选',{day,title:str,limit:{type:'integer',minimum:1,maximum:10}}),
 tool('update_media','重命名/修改日期/收藏一项相册内容',{...selector,title:str,newDay:day,favorite:{type:'boolean'}}),
 tool('delete_media','把一项相册内容移入 30 天回收站，必须有删除意图',selector),
 tool('list_trash','查看当前宝宝的回收站',{kind:{type:'string',enum:['growth','milestones','media']}}),
 tool('restore_trash','从回收站中恢复一项内容',{kind:{type:'string',enum:['growth','milestones','media']},...selector},['kind'])
];
export const wechatHelp='BabyMemo 微信操作\n可以直接发送：\n· 小好今天体重 10.5 kg，身高 80 cm\n· 查小好最近五次体重\n· 小好今天会走路了\n· 查小好的里程碑 / 相册\n· 把小好 10 月 1 日的体重改成 10.2 kg\n· 删除小好 10 月 1 日的成长记录\n· 查看小好的回收站 / 恢复编号 12345678\n同一天有多条时，先查询记录并使用回复里的编号。删除后可在 30 天内恢复。当前支持绑定微信的私聊文字操作。';
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
 kind==='milestones'?[r.title||'',r.description||'']:[r.title||'',r.mime||'',r.favorite?'已收藏':''];
 return short(r.id)+' · '+r.day+' · '+bits.filter(Boolean).join('，');
};
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
async function update(env,kind,record,changes){
 const table=tableForKind[kind];
 const names=Object.keys(changes);if(!names.length)return '请明确需要修改的内容';
 const result=await env.DB.prepare('UPDATE '+table+' SET '+names.map(x=>x+'=?').join(',')+' WHERE id=? AND deleted_at IS NULL')
 .bind(...names.map(x=>changes[x]),record.id).run();
 return result.meta.changes?'已更新'+labelForKind[kind]+'（编号 '+short(record.id)+'）。':'记录已失效，请重新查询';
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
export async function runWechatTool(env,baby,action,args={},messageId='',originalText=''){
 try{
  if(!args||typeof args!=='object'||Array.isArray(args))return '指令参数不正确，请换一种说法';
  if(action==='list_babies'){
   const r=await env.DB.prepare('SELECT name,birthday FROM babies ORDER BY created_at LIMIT 30').all();
   return '家庭宝宝：\n'+r.results.map(x=>x.name+'（'+x.birthday+'）').join('\n');
  }
  if(!baby)return '请先在 BabyMemo 中建立宝宝档案';
  if(action==='get_baby')return baby.name+' 的档案：生日 '+baby.birthday+'，过敏和注意事项：'+(baby.allergies||'未填写')+'，备注：'+(baby.notes||'无');
  if(action==='update_baby'){
   if(!/修改|更正|更改|更新|设置|改成|改为|改一下|记为|添加过敏|补充过敏/.test(originalText))return '请明确说明“修改宝宝资料”，防止误操作';
   const changes={};
   if(args.name!==undefined){const name=cleanText(args.name,80);if(!name)throw Error('昵称不能为空');changes.name=name}
   if(args.allergies!==undefined){if(typeof args.allergies!=='string'||args.allergies.length>2000)throw Error('过敏备注最长 2000 字');changes.allergies=args.allergies}
   if(args.notes!==undefined){if(typeof args.notes!=='string'||args.notes.length>4000)throw Error('备注最长 4000 字');changes.notes=args.notes}
   if(args.birthday!==undefined){if(!validDate(args.birthday))throw Error('生日日期不正确');changes.birthday=args.birthday}
   if(!Object.keys(changes).length)return '请说明要修改的字段';
   await env.DB.prepare('UPDATE babies SET '+Object.keys(changes).map(x=>x+'=?').join(',')+' WHERE id=?').bind(...Object.values(changes),baby.id).run();
   return '已更新 '+baby.name+' 的宝宝档案。';
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
    if(!/修改|更正|更改|更新|改成|改为|改一下|设为|标记|收藏|取消收藏/.test(originalText))return '请明确说明修改操作';
    const row=await findTarget(env,baby.id,kind,args);
    const changes={};
    if(kind==='growth')Object.assign(changes,measurement(args));
    else if(kind==='milestones'){
     if(args.title!==undefined){const title=cleanText(args.title,120);if(!title||args.title.length>120)throw Error('事件标题不能为空或过长');changes.title=title}
     if(args.description!==undefined){if(typeof args.description!=='string'||args.description.length>3000)throw Error('事件描述不能超过 3000 字');changes.description=args.description}
    }else{
     if(args.title!==undefined){const title=cleanText(args.title,200);if(!title)throw Error('媒体名称不能为空');changes.title=title}
     if(args.favorite!==undefined){if(typeof args.favorite!=='boolean')throw Error('收藏状态必须为是或否');changes.favorite=args.favorite?1:0}
    }
    if(args.newDay!==undefined){if(!validDate(args.newDay))throw Error('新日期不正确');changes.day=args.newDay}
    return await update(env,kind,row,changes);
   }
   if(action==='delete_'+(kind==='milestones'?'milestone':kind)){
    if(!/删除|删掉|移入回收站|移到回收站/.test(originalText))return '请明确说“删除”并指定日期或编号';
    const row=await findTarget(env,baby.id,kind,args);
    const changed=await env.DB.prepare('UPDATE '+tableForKind[kind]+' SET deleted_at=? WHERE id=? AND baby_id=? AND deleted_at IS NULL')
     .bind(new Date().toISOString(),row.id,baby.id).run();
    return changed.meta.changes?'已将 '+labelForKind[kind]+'（'+short(row.id)+'）移入回收站，30 天内可恢复。':'未删除：记录已发生变化';
   }
  }
  if(action==='list_trash'){
   const kind=args.kind||'growth';const table=tableForKind[kind];if(!table)throw Error('回收站类型不正确');
   const rows=await env.DB.prepare('SELECT * FROM '+table+' WHERE baby_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 10').bind(baby.id).all();
   return rows.results.length?'回收站 · '+labelForKind[kind]+'：\n'+rows.results.map(x=>listLine(kind,x)).join('\n'):'没有这类已删除记录';
  }
  if(action==='restore_trash'){
   if(!/恢复|还原|找回/.test(originalText))return '请明确说“恢复”并指定记录编号';
   if(!tableForKind[args.kind])throw Error('请说明恢复的是测量、事件或相册');
   const row=await findTarget(env,baby.id,args.kind,args,true);
   const change=await env.DB.prepare('UPDATE '+tableForKind[args.kind]+' SET deleted_at=NULL WHERE id=? AND baby_id=? AND deleted_at IS NOT NULL').bind(row.id,baby.id).run();
   return change.meta.changes?'已恢复 '+labelForKind[args.kind]+'（'+short(row.id)+'）。':'该记录无法恢复';
  }
  return wechatHelp;
 }catch(err){
  return err instanceof Error?err.message:'指令执行失败，请重新查询';
 }
}
