// Bounded, baby-scoped conversation. The LLM understands follow-ups, dates
// and confirmation; do not add specialized Chinese intent/grounding parsers.
export const CONTEXT_TTL_MS=20*60*1000;
const MAX_TURNS=4;
const bounded=(s,n)=>typeof s==='string'?s.slice(0,n):'';
const copy=(o)=>o&&typeof o==='object'&&!Array.isArray(o)?structuredClone(o):null;
export function getActiveThread(saved,botId,userId,now=Date.now()){
 const fresh={botId,userId,turns:[],babyId:'',pending:null,lastQuery:null,lastMedia:null,lastOperation:null,pendingMedia:null};
 if(!saved||saved.botId!==botId||saved.userId!==userId||
    !Number.isFinite(saved.expiresAt)||saved.expiresAt<=now)return fresh;
 const within=o=>o&&Number.isFinite(o.expiresAt)&&o.expiresAt>now&&o.expiresAt<=now+CONTEXT_TTL_MS;
 return {...fresh,babyId:bounded(saved.babyId,80),
  turns:Array.isArray(saved.turns)?saved.turns.slice(-MAX_TURNS)
   .filter(t=>typeof t.user==='string'&&typeof t.reply==='string')
   .map(t=>({user:bounded(t.user,600),reply:bounded(t.reply,1200),babyId:bounded(t.babyId,80)})):[],
  pending:within(saved.pending)?copy(saved.pending):null,
  lastQuery:within(saved.lastQuery)?copy(saved.lastQuery):null,
  lastMedia:within(saved.lastMedia)?copy(saved.lastMedia):null,
  lastOperation:within(saved.lastOperation)?copy(saved.lastOperation):null,
  pendingMedia:within(saved.pendingMedia)?copy(saved.pendingMedia):null};
}
export function appendTurn(thread,user,reply,babyId,now=Date.now()){
 return {botId:thread.botId,userId:thread.userId,babyId:bounded(babyId||thread.babyId,80),
  expiresAt:now+CONTEXT_TTL_MS,
  turns:[...(thread.turns||[]),{user:bounded(user,600),reply:bounded(reply,1200),babyId:bounded(babyId,80)}].slice(-MAX_TURNS),
  pending:thread.pending||null,lastQuery:thread.lastQuery||null,
  lastMedia:thread.lastMedia||null,lastOperation:thread.lastOperation||null,
  pendingMedia:thread.pendingMedia||null};
}
export function isClearContext(text){return /^(清除(?:会话|上下文|记忆)|忘记(?:刚才|上下文)|重置(?:对话|会话)|新话题)[。!！]?$/i.test(text.trim())}
export function recordQuery(thread,babyId,kind,ids,now=Date.now(),sourceMessageId=''){
 thread.lastQuery={babyId,kind,sourceMessageId,
  ids:ids.filter(x=>typeof x==='string'&&/^[0-9a-f-]{8,36}$/i.test(x)).slice(0,10),
  expiresAt:now+CONTEXT_TTL_MS};
}
export function buildCommandContext(text,thread,now=Date.now(),babyId=thread.babyId){
 const turns=(thread.turns||[]).filter(t=>t.babyId===babyId),messages=[];
 for(const turn of turns){
  messages.push({role:'user',content:bounded(turn.user,600)});
  const prior=bounded(turn.reply,1200).replace(/^\{"currentTimestamp":[^\n]*\}\s*/,'');
  messages.push({role:'assistant',content:prior||'上轮已处理。'});
 }
 // The model receives real user/assistant history, no inferred instructions.
 // Tools still enforce actual record ownership, uniqueness and valid fields.
 messages.push({role:'user',content:text});
 return {modelMessages:messages,groundedText:text,milestoneGroundedText:null,referencedId:null};
}
