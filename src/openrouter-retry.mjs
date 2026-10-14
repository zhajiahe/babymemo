// Pure retry policy: only model selection may be retried; no D1/R2 writes here.
import {DEEPSEEK_V41_FLASH,GPT_6_LUNA,CLAUDE_HAIKU_55} from './openrouter-model.mjs';
export {DEEPSEEK_V41_FLASH};

// DeepSeek is deliberately pinned to Relace, not silently served by another host.
export function openRouterProviderForModel(model){
 return model===DEEPSEEK_V41_FLASH?{only:['relace'],allow_fallbacks:false}:null;
}
export function openRouterReasoningForModel(model,mode='auto'){
 if(!['auto','off','low'].includes(mode))throw Error('INVALID_REASONING_MODE');
 const managed=[DEEPSEEK_V41_FLASH,GPT_6_LUNA,CLAUDE_HAIKU_55].includes(model);
 if(mode==='off'||mode==='auto'&&managed)return {enabled:false};
 if(mode==='low')return {enabled:true,effort:model===GPT_6_LUNA?'minimal':'low'};
 return null;
}
export function openRouterLowestReasoningForModel(model){
 return {enabled:true,effort:model===GPT_6_LUNA?'minimal':'low'};
}
// Only fallback when a 400 explicitly rejects disabling reasoning.
// Unrelated bad requests must not trigger a second (potentially paid) inference.
function isDisableReasoningRejected(body){
 const message=typeof body?.error?.message==='string'?body.error.message:'';
 const param=typeof body?.error?.param==='string'?body.error.param:'';
 const metadata=typeof body?.error?.metadata?.raw==='string'?body.error.metadata.raw.slice(0,900):'';
 const combined=[message,param,metadata].join(' ').slice(0,2500);
 return /(?:reasoning|thinking|effort)/i.test(combined)&&
  /(?:not.supported|unsupported|cannot|can't|not.allowed|must|mandatory|required|invalid|disable|off|none)/i.test(combined);
}
export function retryAfterMs(value, now=Date.now()){
 if(!value)return null;
 const seconds=Number(value);
 if(Number.isFinite(seconds)&&seconds>=0)return Math.round(seconds*1000);
 const when=Date.parse(value);
 return Number.isFinite(when)?Math.max(0,when-now):null;
}
export async function openRouterCompletion({key,model,messages,tools,max_tokens=450,tool_choice='auto',fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxAttempts=3,now=Date.now,random=Math.random,reasoningMode='auto'}){
 let reasoning=openRouterReasoningForModel(model,reasoningMode);
 const provider=openRouterProviderForModel(model),fallbackReasoning=openRouterLowestReasoningForModel(model);
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+key,
   'HTTP-Referer':'https://github.com/zhajiahe/babymemo','X-Title':'BabyMemo WeChat Operations'};
 let cumulativeWait=0,usedReasoningFallback=false;
 for(let attempt=0;attempt<maxAttempts;attempt++){
  const body=JSON.stringify({model,messages,...(tools?{tools,tool_choice}:{}),temperature:0,max_tokens,
   ...(reasoning?{reasoning}:{}),...(provider?{provider}:{})});
  let response;
  try{
   response=await fetchImpl('https://openrouter.ai/api/v1/chat/completions',{
     method:'POST',headers,body,redirect:'manual',signal:AbortSignal.timeout(25000)
   });
  }catch(e){
   if(attempt===maxAttempts-1)throw Error('OPENROUTER_NETWORK_FAILED');
   const delay=Math.min(4500,600*2**attempt+Math.floor(random()*250));
   await sleep(delay);continue;
  }
  if(response.ok){
   try{
    const result=await response.json();
    // This is request metadata, not a claim about actual underlying reasoning usage.
    if(result&&typeof result==='object')result._babymemo_request={
     reasoningRequested:reasoning||null,requestedProvider:provider||null,
     reasoningFallbackUsed:usedReasoningFallback
    };
    return result;
   }catch{throw Error('OPENROUTER_INVALID_REPLY')}
  }
  const status=response.status;
  if(status===400){
   let errorResponse;
   try{errorResponse=await response.json()}catch{}
   if(reasoning?.enabled===false&&!usedReasoningFallback&&
      (reasoningMode==='off'||[DEEPSEEK_V41_FLASH,GPT_6_LUNA,CLAUDE_HAIKU_55].includes(model))&&
      isDisableReasoningRejected(errorResponse)){
    reasoning=fallbackReasoning;
    usedReasoningFallback=true;
    attempt--; // one guarded compatibility retry, even if maxAttempts=1
    continue;
   }
   throw Error('OPENROUTER_HTTP_400');
  }
  const hint=retryAfterMs(response.headers.get('Retry-After'),now());
  await response.body?.cancel();
  if(![429,502,503,504].includes(status))throw Error('OPENROUTER_HTTP_'+status);
  if(attempt===maxAttempts-1)throw Error(status===429?'OPENROUTER_RATE_LIMITED':'OPENROUTER_HTTP_'+status);
  const exponential=Math.min(5000,800*2**attempt+Math.floor(random()*300));
  const delay=hint??exponential;
  if(delay>12000||cumulativeWait+delay>18000)
   throw Error(status===429?'OPENROUTER_RATE_LIMITED':'OPENROUTER_RETRY_LATER');
  cumulativeWait+=delay;
  await sleep(delay);
 }
 throw Error('OPENROUTER_RETRY_EXHAUSTED');
}
export function friendlyOpenRouterError(e){
 const code=e instanceof Error?e.message:'';
 if(code==='OPENROUTER_RATE_LIMITED')return 'OpenRouter 当前触发 429 限流，已尝试退避重试。请稍后再次发送这条微信指令；本次没有执行数据修改。';
 if(code.startsWith('OPENROUTER_'))return '微信指令模型暂时不可用（'+code+'）。请稍后重试，本次没有执行数据修改。';
 return null;
}
