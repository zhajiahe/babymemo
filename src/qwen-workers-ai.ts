// Cloudflare-hosted Qwen model for BabyMemo's existing tool-journaled ReAct harness.
// Its Worker AI binding needs no OpenRouter key or AI Gateway credits.
export const DEFAULT_QWEN_MODEL='@cf/qwen/qwen3.8-27b';
export const DEFAULT_AI_PROVIDER='workers-ai';
export const QWEN_REASONING_MODE='off';
type Message={role:string;content?:unknown;tool_calls?:unknown[];[key:string]:unknown};
type QwenPayload={messages:Message[];tools?:unknown[];max_tokens?:number};
type AiBinding={run:(model:string,input:ReturnType<typeof qwenRequest>)=>Promise<unknown>};
export function qwenRequest({messages,tools,max_tokens=1200}:QwenPayload){
 if(!Array.isArray(messages)||messages.length===0)throw Error('WORKERS_AI_INVALID_MESSAGES');
 if(!Number.isInteger(max_tokens)||max_tokens<1||max_tokens>4096)throw Error('WORKERS_AI_INVALID_MAX_TOKENS');
 return {
  messages, ...(tools?.length?{tools,tool_choice:'auto',parallel_tool_calls:false}:{}),
  max_completion_tokens:max_tokens,temperature:1,
  chat_template_kwargs:{enable_thinking:false},
  // The schema permits low/medium/xhigh; 'none' is NOT a permitted value.
  // enable_thinking=false controls the actual off setting.
  reasoning_effort:'low'
 };
}
export async function qwenCompletion({ai,messages,tools,max_tokens=1200}:{ai:AiBinding;messages:Message[];tools?:unknown[];max_tokens?:number}){
 if(!ai||typeof ai.run!=='function')throw Error('WORKERS_AI_BINDING_MISSING');
 let result:unknown;
 try{result=await ai.run(DEFAULT_QWEN_MODEL,qwenRequest({messages,tools,max_tokens}))}
 catch(error){
  const msg=error instanceof Error?error.message:'';
  if(/quota|neuron|429|capacity|limit/i.test(msg))throw Error('WORKERS_AI_QUOTA_OR_CAPACITY');
  throw Error('WORKERS_AI_INFERENCE_FAILED');
 }
 if(result&&typeof result==='object'&&'choices' in result&&Array.isArray(result.choices)&&result.choices[0]?.message)return result;
 if(result&&typeof result==='object'&&'response' in result&&typeof result.response==='string')
  return {choices:[{message:{role:'assistant',content:result.response,tool_calls:[]},finish_reason:'stop'}],usage:('usage' in result?result.usage:null)||null};
 throw Error('WORKERS_AI_INVALID_RESPONSE');
}
export function friendlyWorkersAIError(error:unknown){
 const code=error instanceof Error?error.message:'';
 if(code==='WORKERS_AI_BINDING_MISSING')return 'Workers AI 尚未配置，请检查 Cloudflare AI Binding。';
 if(code==='WORKERS_AI_QUOTA_OR_CAPACITY')return 'Workers AI 免费额度或模型服务暂不可用，请稍后重试；本次未执行新的工具操作。';
 if(code.startsWith('WORKERS_AI_'))return '微信模型暂时不可用（'+code+'），请稍后重试。';
 return null;
}
