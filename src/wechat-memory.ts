/** Short-lived WeChat dialogue. Persistent family facts remain in D1 tools. */
export type MemoMediaReference={id:string;kind:'image'|'video';fileName?:string};
export type MemoTurn={user:string;reply:string;babyId:string;media?:MemoMediaReference[]};
export type ExpiringMemo=Record<string,unknown>&{expiresAt:number};
export type ConversationMemo={botId:string;userId:string;turns:MemoTurn[];babyId:string;pending:ExpiringMemo|null;lastQuery:ExpiringMemo|null;lastMedia:ExpiringMemo|null;lastOperation:ExpiringMemo|null;pendingMedia:ExpiringMemo|null;expiresAt?:number};
// 20 turns may be stored, but only recent complete turns fitting the prompt budget are sent.
// This is not long-term recall. Keep the existing expiry and structured action references.
export const CONTEXT_TTL_MS=20*60*1000;
export const MAX_CONTEXT_TURNS=20;
export const MAX_HISTORY_UNITS=5600;
const bounded=(s:unknown,n:number)=>typeof s==='string'?s.slice(0,n):'';
const copy=(o:unknown):ExpiringMemo|null=>o&&typeof o==='object'&&!Array.isArray(o)?structuredClone(o) as ExpiringMemo:null;
const MEDIA_ID=/^[0-9a-f]{8}-[0-9a-f-]{27,28}$/i;
// Keep only trusted server-assigned IDs and harmless attachment metadata.
// Never retain the encrypted CDN payload, access URL, AES key or binary.
function safeMediaRefs(value:unknown):MemoMediaReference[]{
 if(!Array.isArray(value))return [];
 const result:MemoMediaReference[]=[];
 for(const item of value.slice(0,4)){
  if(!item||typeof item!=='object')continue;
  const x=item as Record<string,unknown>;
  if(typeof x.id!=='string'||!MEDIA_ID.test(x.id)||!['image','video'].includes(String(x.kind)))continue;
  const fileName=bounded(x.fileName,120).replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
  result.push({id:x.id,kind:x.kind as 'image'|'video',...(fileName?{fileName}:{})});
 }
 return result;
}
const visibleMedia=(media:MemoMediaReference[]|undefined)=>{
 const refs=safeMediaRefs(media);
 return refs.length?'\n[本轮附件引用：仅元数据，不含图片/视频内容；是否已保存及详情须通过相册查询工具核对]\n'+
  refs.map(r=>'- '+(r.kind==='image'?'照片':'视频')+(r.fileName?'（微信原文件：'+r.fileName+'）':'')+'；记录编号 '+r.id).join('\n'):'';
};
// Conservative token-equivalent estimate: Chinese/other Unicode about one unit
// per code point; ASCII about one unit per 3 characters.
const units=(s:string)=>{let n=0;for(const char of s)n+=char.codePointAt(0)!>127?1:0.34;return Math.ceil(n)};
export function getActiveThread(saved:ConversationMemo|null|undefined,botId:string,userId:string,now:number=Date.now()):ConversationMemo{
 const fresh:ConversationMemo={botId,userId,turns:[],babyId:'',pending:null,lastQuery:null,lastMedia:null,lastOperation:null,pendingMedia:null};
 if(!saved||saved.botId!==botId||saved.userId!==userId||
    typeof saved.expiresAt!=='number'||!Number.isFinite(saved.expiresAt)||saved.expiresAt<=now)return fresh;
 const within=(o:ExpiringMemo|null)=>o&&Number.isFinite(o.expiresAt)&&o.expiresAt>now&&o.expiresAt<=now+CONTEXT_TTL_MS;
 return {...fresh,babyId:bounded(saved.babyId,80),
  turns:Array.isArray(saved.turns)?saved.turns.slice(-MAX_CONTEXT_TURNS)
   .filter(t=>typeof t.user==='string'&&typeof t.reply==='string')
   .map(t=>{
    const media=safeMediaRefs(t.media);
    return {user:bounded(t.user,600),reply:bounded(t.reply,1200),babyId:bounded(t.babyId,80),...(media.length?{media}:{})};
   }):[],
  pending:within(saved.pending)?copy(saved.pending):null,
  lastQuery:within(saved.lastQuery)?copy(saved.lastQuery):null,
  lastMedia:within(saved.lastMedia)?copy(saved.lastMedia):null,
  lastOperation:within(saved.lastOperation)?copy(saved.lastOperation):null,
  pendingMedia:within(saved.pendingMedia)?copy(saved.pendingMedia):null};
}
export function appendTurn(thread:ConversationMemo,user:string,reply:string,babyId:string,now:number=Date.now(),media:MemoMediaReference[]=[]):ConversationMemo{
 const refs=safeMediaRefs(media);
 return {botId:thread.botId,userId:thread.userId,babyId:bounded(babyId||thread.babyId,80),
  expiresAt:now+CONTEXT_TTL_MS,
  turns:[...(thread.turns||[]),{user:bounded(user,600),reply:bounded(reply,1200),babyId:bounded(babyId,80),...(refs.length?{media:refs}:{})}].slice(-MAX_CONTEXT_TURNS),
  pending:thread.pending||null,lastQuery:thread.lastQuery||null,
  lastMedia:thread.lastMedia||null,lastOperation:thread.lastOperation||null,
  pendingMedia:thread.pendingMedia||null};
}
export function isClearContext(text:string){return /^(清除(?:会话|上下文|记忆)|忘记(?:刚才|上下文)|重置(?:对话|会话)|新话题)[。!！]?$/.test(text.trim())}
export function recordQuery(thread:ConversationMemo,babyId:string,kind:string,ids:string[],now:number=Date.now(),sourceMessageId=''){
 thread.lastQuery={babyId,kind,sourceMessageId,
  ids:ids.filter(x=>typeof x==='string'&&/^[0-9a-f-]{8,36}$/i.test(x)).slice(0,10),
  expiresAt:now+CONTEXT_TTL_MS};
}
export function buildCommandContext(text:string,thread:ConversationMemo,now:number=Date.now(),babyId=thread.babyId){
 const turns=(thread.turns||[]).filter(t=>t.babyId===babyId),chosen:{role:'user'|'assistant';content:string}[][]=[];
 let spent=0;
 for(let i=turns.length-1;i>=0;i--){
  const turn=turns[i];
  const user=bounded(turn.user,600)+visibleMedia(turn.media);
  const prior=bounded(turn.reply,1200).replace(/^\{"currentTimestamp":[^\n]*\}\s*/,'');
  const pair:[{role:'user';content:string},{role:'assistant';content:string}]=[
   {role:'user',content:user},{role:'assistant',content:prior||'上轮已处理。'}
  ];
  const cost=units(pair[0].content)+units(pair[1].content)+16;
  // Do not split an observation from its reply. Always keep the freshest pair.
  if(chosen.length&&spent+cost>MAX_HISTORY_UNITS)break;
  chosen.unshift(pair);spent+=cost;
 }
 const messages:{role:'user'|'assistant';content:string}[]=chosen.flat();
 // The current instruction must not be altered by attachment summaries.
 messages.push({role:'user',content:text});
 return {modelMessages:messages,groundedText:text,milestoneGroundedText:null,referencedId:null};
}
