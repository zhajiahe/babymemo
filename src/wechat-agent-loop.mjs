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
function render(results,finalText='',suffix=''){
 // Database/tool output is authoritative. A model's free-form text must not
 // claim that a write succeeded without a corresponding committed tool result.
 if(results.length)return [...results,suffix].filter(Boolean).join('\n').slice(0,1800);
 if(suffix)return suffix;
 const text=String(finalText||'').trim();
 if(/^(?:已保存|已更新|已删除|已恢复|已经记录|已添加)/.test(text))
  return '模型没有执行任何工具，未修改数据。请重新描述要执行的操作。';
 return text.slice(0,1500)||'未执行任何操作，请说明要记录、查询或修改的内容。';
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
   const outcome=await execute(call,totalCalls,round);
   const result=typeof outcome==='string'?outcome:String(outcome?.content||'工具未返回结果');
   const halt=typeof outcome==='object'&&outcome?.halt===true;
   totalCalls++;
   results.push(result);
   transcript.push({role:'tool',tool_call_id:call.id,content:result.slice(0,3000)});
   if(halt)return render(results);
  }
 }
 return render(results,'','本次操作达到模型决策轮数上限；如有后续操作，请继续发送消息。');
}
