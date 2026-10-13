// Pure retry policy: the only retryable operation is LLM *tool selection*.
// No D1/R2 mutation happens inside this helper.
export function retryAfterMs(value, now=Date.now()){
 if(!value)return null;
 const seconds=Number(value);
 if(Number.isFinite(seconds)&&seconds>=0)return Math.round(seconds*1000);
 const when=Date.parse(value);
 return Number.isFinite(when)?Math.max(0,when-now):null;
}
export async function openRouterCompletion({key,model,messages,tools,max_tokens=450,tool_choice='auto',fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxAttempts=3,now=Date.now,random=Math.random}){
 const body=JSON.stringify({model,messages,...(tools?{tools,tool_choice}:{}),temperature:0,max_tokens});
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+key,
   'HTTP-Referer':'https://github.com/zhajiahe/babymemo','X-Title':'BabyMemo WeChat Operations'};
 let cumulativeWait=0;
 for(let attempt=0;attempt<maxAttempts;attempt++){
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
   try{return await response.json()}
   catch{throw Error('OPENROUTER_INVALID_REPLY')}
  }
  const status=response.status;
  const hint=retryAfterMs(response.headers.get('Retry-After'),now());
  await response.body?.cancel();
  if(![429,502,503,504].includes(status))throw Error('OPENROUTER_HTTP_'+status);
  if(attempt===maxAttempts-1)throw Error(status===429?'OPENROUTER_RATE_LIMITED':'OPENROUTER_HTTP_'+status);
  // Cloudflare Worker alarms should not wait indefinitely for a daily free-tier cap.
  // Honor short Retry-After windows; surface long windows rather than ignoring them.
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
