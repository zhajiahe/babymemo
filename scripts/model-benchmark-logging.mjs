// Safe and compact diagnostics for synthetic-only model benchmarks.
// Never print upstream response bodies, request headers, Bearer keys or raw prompts.
export function safeBenchPreview(value,max=220){
 const raw=typeof value==='string'?value:JSON.stringify(value??null);
 if(!Number.isInteger(max)||max<16||max>800)throw Error('INVALID_PREVIEW_SIZE');
 const redacted=String(raw)
  .replace(/sk-or-[A-Za-z0-9_-]+/g,'[REDACTED_OPENROUTER_KEY]')
  .replace(/Bearer\s+[^\s"',;]+/gi,'Bearer [REDACTED]')
  .replace(/\b[A-Za-z0-9_-]{40,}\b/g,'[REDACTED_LONG_TOKEN]')
  .replace(/[\r\n\t]+/g,' ').trim();
 return redacted.length>max?redacted.slice(0,max)+'…':redacted;
}
export function benchmarkFailureKind(code){
 if(/(?:WORKERS_AI_HTTP_10000|WORKERS_AI_HTTP_401|OPENROUTER_HTTP_401|OPENROUTER_HTTP_403)/.test(code||''))return 'AUTHENTICATION_OR_PERMISSION';
 if(/(?:OPENROUTER_HTTP_402|WORKERS_AI_HTTP_402|BUDGET|QUOTA|RATE_LIMIT)/.test(code||''))return 'QUOTA_OR_PAYMENT';
 if(/(?:HTTP_429|HTTP_503|HTTP_502|HTTP_504)/.test(code||''))return 'PROVIDER_UNAVAILABLE';
 return 'MODEL_OR_AGENT_ERROR';
}
export function isFatalBenchmarkError(code){
 return benchmarkFailureKind(code)==='AUTHENTICATION_OR_PERMISSION'||benchmarkFailureKind(code)==='QUOTA_OR_PAYMENT';
}
export function diagnosticEvent(stage,{provider,caseId,iteration,request,model,elapsedMs,...details}={}){
 const key=['provider','caseId','iteration','request','model','elapsedMs'];
 const base={event:stage,...(provider?{provider}:{}),...(model?{model}:{}),
  ...(caseId?{caseId}:{}),...(iteration!==undefined?{iteration}:{}),
  ...(request!==undefined?{request}:{}),...(elapsedMs!==undefined?{elapsedMs}:{})};
 for(const [k,v] of Object.entries(details))if(v!==undefined){
  if(k==='assistant'||k==='arguments'||k==='answer')base[k]=safeBenchPreview(v,240);
  else if(['inputTokens','outputTokens','neurons','reportedUSD','finishReason','reasoningTokens','toolNames','latencyMs','usage','issues','status','category','messageCount','toolCount','modelRequests','passed','httpStatus','upstreamCode','reasoningRequested','reasoningFallbackUsed','requestedProvider','servedProvider','actualReasoningRequested'].includes(k))base[k]=v;
 }
 return '[model-benchmark] '+JSON.stringify(base);
}
export function benchmarkMarkdownReport(models,setup){
 const out=['## BabyMemo · 同题模型 Benchmark','','> 合成家庭数据，无生产微信／D1／R2 访问或修改。模型为真实接口调用；工具观察为模拟结果。','',
 ' |模型|思考配置|优先服务商|状态|通过/已尝试|请求|输入 tokens|输出 tokens|Neurons|OpenRouter USD|',
 '|---|---|---|---|---:|---:|---:|---:|---:|---:|'];
 for(const model of models){
  const s=model.summary,u=s.usage;
  const val=v=>v===null||v===undefined?'未报告':String(v);
  out.push('|'+model.model+'|'+(model.reasoningRequested??'未知')+'|'+(model.preferredProvider??'自动')+'|'+(model.status??'OK')+'|'+s.passed+'/'+s.cases+'|'+s.modelRequests+'|'+val(u.inputTokens)+'|'+val(u.outputTokens)+'|'+val(u.neurons)+'|'+val(u.reportedUSD)+'|');
 }
 out.push('','### 逐场景结果','','|模型|场景|结果|工具轨迹|模型请求|耗时 ms|输入/输出 tokens|推理 tokens|Neurons|报告 USD|最低思考回退|错误|',
 '|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|');
 for(const model of models)for(const x of model.results){
  const escape=value=>String(value??'').replace(/\|/g,'\\|').replace(/[\r\n]/g,' ');
  const u=x.usage||{},val=v=>v===null||v===undefined?'—':String(v);
  out.push('|'+escape(model.model)+'|'+escape(x.name)+'|'+(x.passed?'通过':'失败')+'|'+escape(x.tools?.join(' → ')||'无')+'|'+x.modelRequests+'|'+x.latencyMs+'|'+val(u.inputTokens)+'/'+val(u.outputTokens)+'|'+val(u.reasoningTokens)+'|'+val(u.neurons)+'|'+val(u.reportedUSD)+'|'+(x.reasoningFallbackUsed?'是':'否')+'|'+escape(x.errorCode||x.issues?.join(', ')||'—')+'|');
 }
 out.push('','模型完整工具参数、最终回复摘录、逐请求 token 数据在 JSON artifact 和 Actions 日志中。失败/身份认证不能当成模型答错。','');
 if(models.some(x=>x.status?.startsWith('BLOCKED')))out.push('**阻塞：部分模型没有成功推理。** 请检查专用 Workers AI Token 的权限（Account → Workers AI → Read）、余额和网络，修复后重新运行。','');
 out.push('参数：每模型 '+(setup.tasksPerModel||20)+' 题 × '+setup.repetitions+' 次；费用限制按模型分别计算，均为软限额。');
 return out.join('\n')+'\n';
}
