// Only the already-paired one-to-one WeChat session uses this memory.
// Bounded, short-lived operational context; not a general personal profile.
export const CONTEXT_TTL_MS=20*60*1000;
const MAX_TURNS=4;
const bounded=(s,n)=>typeof s==='string'?s.slice(0,n):'';
export function getActiveThread(saved,botId,userId,now=Date.now()){
 if(!saved||saved.botId!==botId||saved.userId!==userId||
    !Number.isFinite(saved.expiresAt)||saved.expiresAt<=now)return {botId,userId,turns:[],babyId:''};
 return {botId,userId,babyId:bounded(saved.babyId,80),turns:Array.isArray(saved.turns)?saved.turns.slice(-MAX_TURNS)
  .filter(t=>typeof t.user==='string'&&typeof t.reply==='string')
  .map(t=>({user:bounded(t.user,600),reply:bounded(t.reply,1200),babyId:bounded(t.babyId,80)})):[]};
}
export function appendTurn(thread,user,reply,babyId,now=Date.now()){
 return {botId:thread.botId,userId:thread.userId,babyId:bounded(babyId||thread.babyId,80),
   expiresAt:now+CONTEXT_TTL_MS,turns:[...thread.turns,{user:bounded(user,600),reply:bounded(reply,1200),babyId:bounded(babyId,80)}].slice(-MAX_TURNS)};
}
export function isClearContext(text){return /^(清除(?:会话|上下文|记忆)|忘记(?:刚才|上下文)|重置(?:对话|会话)|新话题)[。!！]?$/i.test(text.trim())}
export function buildCommandContext(text,thread){
 const turns=thread.turns||[],last=turns.at(-1);
 const messages=[];
 for(const turn of turns){
  messages.push({role:'user',content:bounded(turn.user,600)});
  // Model sees factual tool results, but this output is NEVER treated as a direct authorization.
  messages.push({role:'assistant',content:bounded(turn.reply,1200)});
 }
 let executableText=text,modelText=text;
 // A first/second/third entry reference can be mapped to an actual ID from
 // the last query's reply; only IDs shown in that last reply are valid.
 const ordinal=text.match(/第\s*([一二三四五六七八九十1-9]|10)\s*(?:条|项|个|张|段)/);
 const ordinals={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
 const ids=last?.reply?.split('\n').map(line=>line.match(/^([a-f0-9]{8}) · /i)?.[1]).filter(Boolean)||[];
 let ref=null;
 if(ordinal){const n=ordinals[ordinal[1]]||Number(ordinal[1]);ref=ids[n-1]||null}
 else if(/(?:刚才|上一条|那条|这一条)/.test(text)&&ids.length===1)ref=ids[0];
 if(ref){
  modelText+='\n[上一条查询结果对应的明确记录编号为 '+ref+'。仅当当前消息要求操作这条记录时使用]';
  executableText+=' 记录编号 '+ref;
 }
 // An immediately preceding clarification can supply intent in a short
 // follow-up ("10月1日", "小好") but not change the user's current action.
 const followup=!/(?:删除|删掉|更改|更正|修改|查找|查询|查一下|新增|记录|恢复|收藏)/.test(text)&&/^(?:是|对|就|日期|编号|[\u4e00-\u9fff]{1,8}$|[0-9]{4}[-/年]|[0-9]{1,2}月|[a-f0-9]{8})/.test(text.trim());
 const clarification=last&&/请|哪|明确|提供|不唯一|不足|重新/.test(last.reply);
 if(followup&&clarification&&last.user){
  modelText='[上一轮待补充的用户指令：'+bounded(last.user,300)+']\n'+modelText;
  executableText=last.user+'\n'+executableText;
 }
 return {modelMessages:[...messages,{role:'user',content:modelText}],groundedText:executableText,referencedId:ref};
}
