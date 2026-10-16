import type {Env} from './types';
import type {WechatBaby} from './wechat-tool-schema.ts';
import {auditChange,operationSnapshot,snapshotChanges} from './wechat-operations.mjs';
import {mediaCapabilities,explainMediaCapabilities} from './wechat-capabilities.mjs';
export type Kind='growth'|'milestones'|'media';
export type DbRow=Record<string,any>&{id:string;day:string;baby_id:string};
export type ToolOptions={at?:number;thread?:any;messageId?:string};
export const validDate=(x:unknown)=>{
 if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;
 const d=new Date(x+'T00:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===x;
};
export const cleanText=(x:unknown,max:number)=>typeof x==='string'?x.trim().slice(0,max):null;
const value=(x:unknown,min:number,max:number)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
export const short=(x:string)=>x.slice(0,8);
export const tableForKind:Record<Kind,string>={growth:'growth_records',milestones:'milestones',media:'media'};
export const labelForKind:Record<Kind,string>={growth:'成长测量',milestones:'成长事件',media:'相册内容'};
export const maxLimit=(args:Record<string,any>)=>Number.isInteger(args.limit)?Math.min(10,Math.max(1,args.limit)):5;
export const listLine=(kind:Kind,r:DbRow)=>{
 const bits=kind==='growth'?[r.weight!=null?'体重 '+r.weight+' kg':'',r.height!=null?'身高 '+r.height+' cm':'',r.head_circumference!=null?'头围 '+r.head_circumference+' cm':'',r.notes||'']:
 kind==='milestones'?[r.title||'',r.description||'']:[r.upload_state==='processing'?'正在保存':r.upload_state==='failed'?'保存失败':r.mime||'',r.description||''];
 return short(r.id)+' · '+r.day+' · '+bits.filter(Boolean).join('，')+(kind==='media'?'；'+explainMediaCapabilities(r):'');
};
export async function findTarget(env:Env,babyId:string,kind:Kind,args:Record<string,any>,deleted=false):Promise<DbRow>{
 const table=tableForKind[kind];
 if(!table)throw Error('不支持的记录种类');
 const status=deleted?'IS NOT NULL':'IS NULL';
 if(args.id!==undefined){
   if(typeof args.id!=='string'||!/^[0-9a-f-]{8,36}$/i.test(args.id))throw Error('记录编号至少为前 8 位，请先查询');
   const rows=await env.DB.prepare('SELECT * FROM '+table+' WHERE baby_id=? AND deleted_at '+status+' AND id LIKE ? LIMIT 2').bind(babyId,args.id+'%').all<DbRow>();
   if(rows.results.length!==1)throw Error(rows.results.length?'编号不唯一，请发送完整记录编号':'找不到该编号，请先查询');
   return rows.results[0];
 }
 if(args.day!==undefined){
   if(!validDate(args.day))throw Error('请提供准确的公历日期');
   const rows=await env.DB.prepare('SELECT * FROM '+table+' WHERE baby_id=? AND deleted_at '+status+' AND day=? ORDER BY created_at DESC LIMIT 2').bind(babyId,args.day).all<DbRow>();
   if(rows.results.length!==1)throw Error(rows.results.length?'这一天有多条记录，请先查询后提供记录编号':'该日期没有相应记录');
   return rows.results[0];
 }
 throw Error('请指定记录日期或查询后使用记录编号');
}
export async function listItems(env:Env,baby:WechatBaby,kind:Kind,args:Record<string,any>){
 const table=tableForKind[kind];
 if(kind==='media'&&args.id!==undefined){
  if(typeof args.id!=='string'||!/^[0-9a-f-]{8,36}$/i.test(args.id))return '相册编号格式不正确，请提供至少前 8 位编号';
  const rows=await env.DB.prepare('SELECT * FROM media WHERE baby_id=? AND deleted_at IS NULL AND id LIKE ? LIMIT 2')
   .bind(baby.id,args.id+'%').all<DbRow>();
  if(rows.results.length!==1)return rows.results.length?'编号不唯一，请使用完整编号':'这位宝宝的相册中没有该编号的媒体记录';
  const r=rows.results[0];
  return baby.name+' 的相册记录：'+r.id+' · '+r.day+' · '+(r.mime||'未知类型')+' · '+String(r.title||'').slice(0,120)+
   ' · 状态：'+(r.upload_state||'ready')+(r.description?' · 描述：'+String(r.description).slice(0,400):'')+' · '+explainMediaCapabilities(r);
 }
 const clauses=['baby_id=?','deleted_at IS NULL'],params=[baby.id];
 if(args.day!==undefined){if(!validDate(args.day))return '请提供有效日期';clauses.push('day=?');params.push(args.day)}
 if(args.title!==undefined&&kind==='media'){const name=cleanText(args.title,60);if(!name)return '请提供照片或视频名称';clauses.push('title LIKE ?');params.push('%'+name+'%')}
 const rows=await env.DB.prepare('SELECT * FROM '+table+' WHERE '+clauses.join(' AND ')+' ORDER BY day DESC,created_at DESC LIMIT ?').bind(...params,maxLimit(args)).all<DbRow>();
 return rows.results.length?baby.name+' 的'+labelForKind[kind]+'：\n'+rows.results.map(x=>listLine(kind,x)).join('\n'):'暂时没有符合条件的'+labelForKind[kind]+'。';
}
export async function update(env:Env,kind:Kind,record:DbRow,changes:Record<string,any>,options:ToolOptions={}){
 const table=tableForKind[kind],names=Object.keys(changes);
 if(!names.length)return '请明确需要修改的内容';
 const stmt=env.DB.prepare('UPDATE '+table+' SET '+names.map(x=>x+'=?').join(',')+
  ' WHERE id=? AND baby_id=? AND deleted_at IS NULL '+(kind==='media'?"AND COALESCE(upload_state,'ready') IN ('processing','ready') AND purge_token IS NULL ":'')+'AND '+names.map(x=>x+' IS ?').join(' AND '))
  .bind(...names.map(x=>changes[x]),record.id,record.baby_id,...names.map(x=>record[x]??null));
 if(typeof env.DB.batch!=='function'){
  const r=await stmt.run();return r.meta.changes?'已更新'+labelForKind[kind]+'（编号 '+short(record.id)+'）。':'记录已发生变化';
 }
 const opId=await auditChange(env,{sourceId:options.messageId,babyId:record.baby_id,kind,recordId:record.id,
   action:'update',before:operationSnapshot(kind,record),after:snapshotChanges(kind,record,changes),statement:stmt});
 if(opId&&options.thread)options.thread.lastOperation={babyId:record.baby_id,opId,expiresAt:(options.at||Date.now())+1200000};
 return opId?'已更新'+labelForKind[kind]+'（编号 '+short(record.id)+'）。':'记录已发生变化，请重新查询';
}
export function measurement(args:Record<string,any>):Record<string,any>{
 const fields:[string,string,number,number][]=[['weight','weight',0.1,150],['height','height',10,250],['headCircumference','head_circumference',10,100]];
 const changes:Record<string,any>={};
 for(const [input,db,min,max] of fields){
  if(args[input]===undefined)continue;
  if(!value(args[input],min,max))throw Error('测量值或单位不合法，请重新确认');
  changes[db]=args[input];
 }
 if(args.notes!==undefined){const txt=cleanText(args.notes,1500);if(txt===null)throw Error('备注格式错误');changes.notes=txt}
 return changes;
}
