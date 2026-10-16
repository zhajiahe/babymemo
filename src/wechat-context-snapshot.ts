/** Per-message trusted state; authoritative for facts, never an authorization token.
 * Model-facing state excludes media bytes, credentials, unrelated baby records.
 * Each tool observation should refresh it; writes must check D1 again.
 */
import type {Env} from './types';
import type {WechatBaby} from './wechat-tool-schema.ts';
import {mediaCapabilities} from './wechat-capabilities.mjs';
import type {ConversationMemo,ExpiringMemo} from './wechat-memory.mjs';

const TABLES:Record<string,string>={growth:'growth_records',milestones:'milestones',media:'media'};
const idsOf=(ref:ExpiringMemo|null|undefined)=>Array.isArray(ref?.ids)
 ?ref.ids.filter((id:unknown)=>typeof id==='string'&&/^[a-f0-9-]{8,36}$/i.test(id)).slice(0,10) as string[]:[];
type ReferenceState={valid:boolean;reason:string|null;sourceMessageId:string|null;babyId:string|null;kind:string|null;ids:string[];expiresAt:number|null};
export function referenceState(ref:ExpiringMemo|null|undefined,babyId:string,at:number):ReferenceState{
 const raw=ref as Record<string,any>|null|undefined;
 const state={valid:false,reason:'not_found',sourceMessageId:typeof raw?.sourceMessageId==='string'?raw.sourceMessageId:null,
  babyId:typeof raw?.babyId==='string'?raw.babyId:null,
  kind:typeof raw?.kind==='string'?raw.kind:null,ids:idsOf(ref),expiresAt:typeof raw?.expiresAt==='number'?raw.expiresAt:null};
 if(!raw)return state;
 if(state.babyId!==babyId)return {...state,reason:'baby_changed',ids:[]};
 if(!state.expiresAt||state.expiresAt<=at)return {...state,reason:'expired',ids:[]};
 if(!state.ids.length)return {...state,reason:'no_records'};
 return {...state,valid:true,reason:null};
}
export type MessageReferenceScope={
 query:ExpiringMemo|null;
 media:ExpiringMemo|null;
 invalidated:ExpiringMemo|null;
 at:number;
};
export function captureMessageReferences(thread:ConversationMemo|null|undefined,at:number):MessageReferenceScope{
 return {query:thread?.lastQuery?structuredClone(thread.lastQuery):null,
  media:thread?.lastMedia?structuredClone(thread.lastMedia):null,
  invalidated:thread?.invalidReferences?structuredClone(thread.invalidReferences):null,at};
}
const ordinal=(raw:string):number|null=>{
 const match=raw.match(/第([一二三四五六七八九十]|10|[1-9])条/);
 if(!match)return null;
 const n=Number(match[1]);
 return Number.isInteger(n)?n:'一二三四五六七八九十'.indexOf(match[1])+1;
};
/** An ordinal is bound to the query that existed at message start.
 * Explicit in-message "先查询...再改第一条" may bind to a query made in this message.
 * The operation must still have an explicit current user write instruction and a unique ID.
 */
export function validateReferenceMutation(input:{
 action:string;args:Record<string,any>;text:string;babyId:string;
 messageId:string;scope:MessageReferenceScope;currentQuery?:ExpiringMemo|null;at:number
}):string|null{
 const {action,args,text,babyId,messageId,scope,at}=input;
 if(!/^(update_|delete_|restore_)/.test(action))return null;
 const index=ordinal(text);
 const kind=action.includes('growth')?'growth':action.includes('milestone')?'milestones':action.includes('media')?'media':null;
 if(index!==null&&kind){
  const sameMessageQuery=!/(?:刚才|上次|前面)/.test(text)&&/先(?:查|查询|找)|查询(?:后|一下).*?(?:再|然后)/.test(text);
  const candidate=sameMessageQuery&&input.currentQuery?.sourceMessageId===messageId
   ?input.currentQuery:scope.query;
  const ref=referenceState(candidate,babyId,at);
  if(!ref.valid||ref.kind!==kind||index>ref.ids.length)
   return '“第'+index+'条”的原查询引用已失效或不属于当前宝宝，未修改记录；请重新明确目标。';
  const expected=ref.ids[index-1];
  if(typeof args.id!=='string'||!expected.startsWith(args.id)&&!args.id.startsWith(expected))
   return '修改目标与原查询第'+index+'条不一致，未执行；请使用该查询的记录编号。';
 }
 if(kind==='media'&&/刚才(?:那|这)?(?:张|个|批|些)?(?:照片|图片|视频)/.test(text)){
  const ref=referenceState(scope.media,babyId,at);
  if(!ref.valid)return '最近媒体引用已失效或不属于当前宝宝，未修改记录。';
  if(action==='update_media'||action==='delete_media'){
   if(ref.ids.length!==1||typeof args.id!=='string'||!ref.ids[0].startsWith(args.id)&&!args.id.startsWith(ref.ids[0]))
    return '最近媒体目标不唯一或编号不匹配，未修改记录。';
  }
 }
 return null;
}
async function presentReferences(env:Env,babyId:string,ref:ExpiringMemo|null|undefined,at:number){
 const base=referenceState(ref,babyId,at);
 if(!base.valid)return base;
 const table=TABLES[base.kind||''];
 if(!table)return {...base,valid:false,reason:'unknown_kind',ids:[]};
 const checked:string[]=[];
 for(const id of base.ids){
  const rows=await env.DB.prepare('SELECT id FROM '+table+' WHERE baby_id=? AND deleted_at IS NULL AND id LIKE ? LIMIT 2')
   .bind(babyId,id+'%').all<{id:string}>();
  if(rows.results.length!==1)return {...base,valid:false,reason:rows.results.length?'ambiguous_reference':'record_unavailable',ids:[]};
  checked.push(rows.results[0].id);
 }
 return {...base,ids:checked};
}
export async function buildWechatContextSnapshot(
 env:Env,baby:WechatBaby,thread:ConversationMemo|null|undefined,
 at:number=Date.now(),scope:MessageReferenceScope=captureMessageReferences(thread,at)
){
 const now=Date.now();
 const query=await presentReferences(env,baby.id,thread?.lastQuery,now);
 const originalQuery=await presentReferences(env,baby.id,scope.query,now);
 const invalidated=referenceState(thread?.invalidReferences||scope.invalidated,baby.id,now);
 const mediaRef=referenceState(thread?.lastMedia,baby.id,now);
 const originalMedia=referenceState(scope.media,baby.id,now);
 const mediaIds=[...new Set([...idsOf(thread?.lastMedia),...idsOf(scope.media)])].slice(0,4);
 const media=[];
 for(const id of mediaIds){
  const rows=await env.DB.prepare('SELECT id,baby_id,title,day,upload_state,deleted_at,purge_token FROM media WHERE id=? AND baby_id=? LIMIT 1')
   .bind(id,baby.id).all<{id:string;baby_id:string;title?:string;day:string;upload_state?:string;deleted_at?:string;purge_token?:string}>();
  const row=rows.results[0];
  if(row)media.push({id:row.id,fileName:row.title||null,day:row.day,
   uploadState:row.upload_state||'ready',capabilities:mediaCapabilities(row),source:'d1'});
 }
 return {
  schemaVersion:1,observedAt:new Date(now).toISOString(),messageTimestamp:new Date(at).toISOString(),
  currentBaby:{id:baby.id,name:baby.name,source:'d1'},
  references:{lastQuery:query,originalQuery,invalidated:invalidated.reason==='baby_changed'?{valid:false,reason:'baby_changed',sourceMessageId:invalidated.sourceMessageId}:null,
   lastMedia:mediaRef,originalMedia},
  recentMedia:media,
  interpretation:'Capabilities describe server state only, not user authorization. Query results never authorize a write. Writes are revalidated at execution.'
 };
}
