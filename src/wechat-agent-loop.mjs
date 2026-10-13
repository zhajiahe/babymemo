// Small, provider-independent ReAct driver for the WeChat command harness.
// Model choices are journaled BEFORE any tool executes. A replay uses the same
// exact calls and step indices, preventing a new model plan from replaying writes.
export const DEFAULT_AGENT_LIMITS=Object.freeze({rounds:4,tools:8,perRound:4,deadlineMs:90000});

function assistantMessage(raw){
 if(!raw||typeof raw!=='object')throw Error('AGENT_INVALID_ASSISTANT_MESSAGE');
 const calls=raw.tool_calls;
 if(calls!==undefined&&!Array.isArray(calls))throw Error('AGENT_INVALID_TOOL_CALLS');
 if(calls?.length>DEFAULT_AGENT_LIMITS.perRound)throw Error('AGENT_TOO_MANY_PARALLEL_TOOLS');
 const ids=new Set();
 const safe=[];
 for(const call of calls||[]){
  const id=call?.id,name=call?.function?.name,args=call?.function?.arguments;
  if(call?.type!=='function'||typeof id!=='string'||!id||id.length>120||
     ids.has(id)||typeof name!=='string'||!/^[a-z][a-z0-9_]{1,80}$/.test(name)||
     typeof args!=='string'||args.length>8000)throw Error('AGENT_INVALID_TOOL_CALL');
  ids.add(id);
  safe.push({id,type:'function',function:{name,arguments:args}});
 }
 const content=typeof raw.content==='string'?raw.content.slice(0,2000):null;
 return {role:'assistant',content,tool_calls:safe};
}
// Free-form replies are welcome, but never evidence that a database write
// happened. Catch the common "我已经帮你记下来了" forms even when not at start.
export function claimsUnverifiedWrite(text){
 const s=String(text||'').trim();
 return /(?:已(?:经)?|成功)\s*(?:(?:为你|帮你|替你|把(?:这条|这些|刚才)?|将(?:这条|这些)?|给你)\s*)?(?:保存|记录|记下|写入|新增|添加|更新|修改|删除|恢复|存入)|(?:保存|记录|记下|写入|添加|更新|修改|删除|恢复)(?:成功|完成|好了|好啦)/.test(s);
}
function render(results,finalText='',suffix=''){
 // Database/tool output is authoritative. A model's free-form text must not
 // claim that a write succeeded without a corresponding committed tool result.
 if(results.length){
  const verified=[...results,suffix].filter(Boolean).join('\n');
  return verified.length>1800?verified.slice(0,1690)+'\n结果较长，回复已截断；请到 BabyMemo 网页核对全部操作。':verified;
 }
 if(suffix)return suffix;
 const text=String(finalText||'').trim();
 // A pre-deploy no-tool response may still be replayed by an old journal or
 // echoed by the model from earlier conversation history.
 if(text.includes('模型没有返回可执行的工具指令'))
  return '这次没有修改记录。你可以继续说刚才的情况，需要保存时直接说“记下来”。';
 if(claimsUnverifiedWrite(text))
  return '这次没有实际保存或修改记录。需要记入日记或里程碑时，可以直接说“记下来”。';
 return text.slice(0,1500)||'我在听。想让我把刚才的内容记入日记，可以说“记下来”。';
}
export async function runWechatAgentLoop({
 messages,tools,complete,execute,loadDecision=async()=>null,saveDecision=async()=>{},
 now=Date.now,limits=DEFAULT_AGENT_LIMITS
}){
 const transcript=[...messages],results=[];
 const started=now();
 let totalCalls=0;
 for(let round=0;round<limits.rounds;round++){
  if(now()-started>=limits.deadlineMs)
   return render(results,'','本次操作达到时间上限，后续步骤未执行。');
  let assistant;
  const saved=await loadDecision(round);
  if(saved){
   assistant=assistantMessage(saved);
  }else{
   let response;
   try{response=await complete({messages:transcript,tools,round})}
   catch(error){
    if(results.length)return render(results,'','后续模型调用失败，以上是已执行的步骤；请先核对结果再继续。');
    throw error;
   }
   assistant=assistantMessage(response?.choices?.[0]?.message);
   // This await is a write-ahead barrier for side effects. Do not call any
   // tool if persisting the model's chosen plan has failed.
   await saveDecision(round,assistant);
  }
  transcript.push(assistant);
  if(!assistant.tool_calls.length)return render(results,assistant.content);
  if(assistant.tool_calls.length>limits.perRound || totalCalls+assistant.tool_calls.length>limits.tools)
   return render(results,'','本次操作达到工具调用上限，剩余步骤未执行。');
  for(const call of assistant.tool_calls){
   if(now()-started>=limits.deadlineMs)
    return render(results,'','本次操作达到时间上限，剩余工具未执行。');
   const outcome=await execute(call,totalCalls,round);
   const result=typeof outcome==='string'?outcome:String(outcome?.content||'工具未返回结果');
   const halt=typeof outcome==='object'&&outcome?.halt===true;
   totalCalls++;
   // get_runtime_context is an internal observation, never user-facing text.
   // The model may still use its complete JSON on the following ReAct round.
   if(call.function.name!=='get_runtime_context')results.push(result);
   transcript.push({role:'tool',tool_call_id:call.id,content:result.slice(0,3000)});
   if(halt)return render(results);
  }
 }
 return render(results,'','本次操作达到模型决策轮数上限；如有后续操作，请继续发送消息。');
}
