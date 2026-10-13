// Bounded, scoped operational state for the paired private WeChat conversation.
// Only structured server-created result IDs can authorise a follow-up edit.
export const CONTEXT_TTL_MS=20*60*1000;
const MAX_TURNS=4;
const bounded=(s,n)=>typeof s==='string'?s.slice(0,n):'';
const copy=(o)=>o&&typeof o==='object'&&!Array.isArray(o)?structuredClone(o):null;
export function getActiveThread(saved,botId,userId,now=Date.now()){
 const fresh={botId,userId,turns:[],babyId:'',pending:null,lastQuery:null,lastMedia:null,lastOperation:null,pendingMedia:null};
 if(!saved||saved.botId!==botId||saved.userId!==userId||
    !Number.isFinite(saved.expiresAt)||saved.expiresAt<=now)return fresh;
 const within=(o)=>o&&Number.isFinite(o.expiresAt)&&o.expiresAt>now&&o.expiresAt<=now+CONTEXT_TTL_MS;
 return {...fresh,babyId:bounded(saved.babyId,80),turns:Array.isArray(saved.turns)?saved.turns.slice(-MAX_TURNS)
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
   expiresAt:now+CONTEXT_TTL_MS,turns:[...(thread.turns||[]),{user:bounded(user,600),reply:bounded(reply,1200),babyId:bounded(babyId,80)}].slice(-MAX_TURNS),
   pending:thread.pending||null,lastQuery:thread.lastQuery||null,
   lastMedia:thread.lastMedia||null,lastOperation:thread.lastOperation||null,pendingMedia:thread.pendingMedia||null};
}
export function isClearContext(text){return /^(清除(?:会话|上下文|记忆)|忘记(?:刚才|上下文)|重置(?:对话|会话)|新话题)[。!！]?$/i.test(text.trim())}
export function recordQuery(thread,babyId,kind,ids,now=Date.now(),sourceMessageId=''){
 thread.lastQuery={babyId,kind,sourceMessageId,ids:ids.filter(x=>typeof x==='string'&&/^[0-9a-f-]{8,36}$/i.test(x)).slice(0,10),expiresAt:now+CONTEXT_TTL_MS};
}
export function setPending(thread,babyId,action,text,args={},now=Date.now()){
 thread.pending={babyId,action,text:bounded(text,650),args:copy(args)||{},expiresAt:now+CONTEXT_TTL_MS};
}
// This is deliberately a narrow *authorisation* trigger, not an intent parser:
// models interpret observations; only an explicit user request may reuse their
// previous words as write-grounding for ONE milestone/diary entry.
export function isMilestoneSaveFollowup(text){
 return /^(?:(?:好的?[，,]?|那就|就|帮我|给我|请|把(?:这段|这些|这个|刚才说的|前面说的|上面说的))\s*)?(?:记下来|记下(?:来|吧)?|记录(?:下来|一下)?|保存(?:下来|一下)?|存下来|写进(?:日记|里程碑)|记(?:到|入)(?:日记|里程碑))(?:吧|呀|哦|啦|。|！|!|\s)*$/.test(String(text||'').trim());
}
// "好" is a write authorization ONLY immediately after the assistant has
// explicitly proposed saving the last user's observation. Assistant-generated
// dates/descriptions are never treated as database grounding.
export function confirmsMilestoneProposal(text,reply){
 const affirmative=/^(?:好|好的|好呀|好啊|好哒|行|可以|嗯|嗯嗯|没问题|就这么办)(?:[～~。！!，,\s]*)$/;
 if(!affirmative.test(String(text||'').trim()))return false;
 return /(?:要(?:不要)?我|需要我|想让我|我可以|要不要|是否).{0,100}(?:记下|记录|保存|写进|存入).{0,25}(?:吗|么|[？?])/.test(String(reply||''));
}
export function buildCommandContext(text,thread,now=Date.now(),babyId=thread.babyId){
 const turns=(thread.turns||[]).filter(t=>t.babyId===babyId),last=turns.at(-1),messages=[];
 for(const turn of turns){
  messages.push({role:'user',content:bounded(turn.user,600)});
  // Drop only legacy protocol/JSON noise, not the user's observations.
  const prior=bounded(turn.reply,1200);
  const withoutRuntime=prior.replace(/^\{"currentTimestamp":[^\n]*\}\s*/,'');
  messages.push({role:'assistant',content:withoutRuntime.includes('模型没有返回可执行的工具指令')?'上轮未执行记录操作。':withoutRuntime||'上轮工具结果已处理。'});
 }
 let executableText=text,modelText=text;
 // A follow-up "记下来" can refer to preceding observations. Do not trust
 // assistant replies as source material or authorise any other write tool.
 // Include only recent, same-baby observations, and respect the conversation TTL.
 const agreed=last&&confirmsMilestoneProposal(text,last.reply);
 const noteSave=isMilestoneSaveFollowup(text)||agreed;
 const sourceTurns=agreed?[last]:turns.slice(-3);
 const observations=noteSave?sourceTurns.map(t=>t.user.trim()).filter(s=>s.length>=4
  && !/^(?:查|查询|查看|删除|删掉|修改|更正|恢复|撤销|帮助|你能|请问|为什么)/.test(s)
  && !/[？?]\s*$/.test(s)):[];
 const milestoneGroundedText=observations.length?observations.join('\n')+'\n'+text:null;
 if(milestoneGroundedText){
  modelText='[用户明确同意记录此前描述。请仅凭当前宝宝的用户原话调用一次 create_milestone；日期和事实不能来自助手回答。]\n'+modelText;
 }
 const ordinal=text.match(/第\s*([一二三四五六七八九十1-9]|10)\s*(?:条|项|个|张|段)/);
 const ordinals={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
 const query=thread.lastQuery&&thread.lastQuery.babyId===babyId&&thread.lastQuery.expiresAt>now?thread.lastQuery:null;
 const ids=query?.ids||[];
 let ref=null;
 if(ordinal){const n=ordinals[ordinal[1]]||Number(ordinal[1]);ref=ids[n-1]||null}
 else if(/(?:刚才|上一条|那条|这一条)/.test(text)&&ids.length===1)ref=ids[0];
 // Legacy reply parsing deliberately removed: assistant text is not an authorisation source.
 if(ref){
  modelText+='\n[服务端查询结果第 '+(ids.indexOf(ref)+1)+' 项的记录编号为 '+ref+'。仅可用于宝宝 '+babyId+' 的 '+query.kind+' 记录]';
  executableText+=' 记录编号 '+ref;
 }
 const pending=thread.pending&&thread.pending.babyId===babyId&&thread.pending.expiresAt>now?thread.pending:null;
 if(pending&&text.trim().length<=100&&!/(?:查询|查找|查看|删除|删掉|新增|清除上下文)/.test(text)){
  modelText='[之前未完成的任务：'+bounded(pending.text,400)+'；原工具 '+pending.action+'，缺少字段请结合新消息补全]\n'+modelText;
  executableText=pending.text+'\n'+executableText;
 }else{
  const followup=!/(?:删除|删掉|更改|更正|修改|查询|查一下|新增|记录|恢复|收藏)/.test(text)&&/^(?:是|对|就|日期|编号|[0-9]{4}[-/年]|[0-9]{1,2}月|[a-f0-9]{8})/.test(text.trim());
  const clarification=last&&/请|哪|明确|提供|不唯一|不足|重新/.test(last.reply);
  if(followup&&clarification&&last.user&&last.babyId===babyId){
   modelText='[上一轮待补充的用户指令：'+bounded(last.user,300)+']\n'+modelText;
   executableText=last.user+'\n'+executableText;
  }
 }
 return {modelMessages:[...messages,{role:'user',content:modelText}],groundedText:executableText,milestoneGroundedText,referencedId:ref};
}
