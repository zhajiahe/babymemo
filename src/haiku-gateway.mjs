// Anthropic Messages adapter for Cloudflare AI Gateway (third-party, billed credits).
// No Cloudflare Workers AI free Neurons apply to anthropic/* models.
export const DEFAULT_HAIKU_MODEL = 'anthropic/claude-haiku-5.5';
export const HAIKU55_PRICES = Object.freeze({
  input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 // USD / million tokens, short context
});
const stringify=value=>typeof value==='string'?value:JSON.stringify(value);
export function toHaikuRequest({messages,tools,max_tokens=1200}){
  if(!Array.isArray(messages)||!messages.length)throw Error('HAIKU_INVALID_MESSAGES');
  const system=[],transcript=[];
  for(const message of messages){
    if(message.role==='system'){
      if(typeof message.content!=='string')throw Error('HAIKU_INVALID_SYSTEM');
      system.push(message.content);continue;
    }
    if(message.role==='tool'){
      const block={type:'tool_result',tool_use_id:message.tool_call_id,content:stringify(message.content)};
      if(typeof block.tool_use_id!=='string'||!block.tool_use_id)throw Error('HAIKU_INVALID_TOOL_RESULT');
      const previous=transcript[transcript.length-1];
      if(previous?.role==='user'&&Array.isArray(previous.content)&&previous.content[0]?.type==='tool_result')previous.content.push(block);
      else transcript.push({role:'user',content:[block]});
      continue;
    }
    if(message.role==='assistant'){
      const blocks=[];
      if(typeof message.content==='string'&&message.content)blocks.push({type:'text',text:message.content});
      for(const call of message.tool_calls||[]){
        let input;
        try{input=JSON.parse(call.function.arguments)}catch{throw Error('HAIKU_INVALID_TOOL_ARGUMENTS')}
        if(!input||typeof input!=='object'||Array.isArray(input))throw Error('HAIKU_INVALID_TOOL_ARGUMENTS');
        blocks.push({type:'tool_use',id:call.id,name:call.function.name,input});
      }
      transcript.push({role:'assistant',content:blocks.length?blocks:[{type:'text',text:' '} ]});
      continue;
    }
    if(message.role==='user'){
      if(typeof message.content!=='string'&& !Array.isArray(message.content))throw Error('HAIKU_INVALID_USER_CONTENT');
      transcript.push({role:'user',content:message.content});
      continue;
    }
    throw Error('HAIKU_INVALID_ROLE');
  }
  if(!Number.isInteger(max_tokens)||max_tokens<1||max_tokens>8192)throw Error('HAIKU_INVALID_MAX_TOKENS');
  const apiTools=tools?.map(tool=>{
    if(tool?.type!=='function'||!tool.function?.name)throw Error('HAIKU_INVALID_TOOL_SCHEMA');
    return {name:tool.function.name,description:tool.function.description||'',input_schema:tool.function.parameters||{type:'object',properties:{}}};
  });
  return {...(system.length?{system:system.join('\n\n')}:{ }),messages:transcript,max_tokens,...(apiTools?.length?{tools:apiTools,tool_choice:{type:'auto'}}:{})};
}
export function fromHaikuResponse(raw){
  const response=raw?.result?.content ? raw.result : raw;
  if(!response||!Array.isArray(response.content))throw Error('HAIKU_INVALID_RESPONSE');
  const tool_calls=[],text=[];
  for(const block of response.content){
    if(block?.type==='text'&&typeof block.text==='string')text.push(block.text);
    if(block?.type==='tool_use'){
      if(typeof block.id!=='string'||typeof block.name!=='string'||!block.input||typeof block.input!=='object')throw Error('HAIKU_INVALID_TOOL_USE');
      tool_calls.push({type:'function',id:block.id,function:{name:block.name,arguments:JSON.stringify(block.input)}});
    }
  }
  const content=text.join('\n').trim();
  return {choices:[{index:0,message:{role:'assistant',content:content||null,tool_calls},finish_reason:response.stop_reason==='tool_use'?'tool_calls':response.stop_reason==='max_tokens'?'length':'stop'}],usage:response.usage||null,model:response.model||DEFAULT_HAIKU_MODEL};
}
export async function haikuGatewayCompletion({run,messages,tools,max_tokens=1200,model=DEFAULT_HAIKU_MODEL}){
  if(typeof run!=='function')throw Error('HAIKU_PROVIDER_UNAVAILABLE');
  const payload=toHaikuRequest({messages,tools,max_tokens});
  return fromHaikuResponse(await run(model,payload));
}
export function haiku55Cost(usage){
  if(!usage||typeof usage!=='object')return null;
  const nums=['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'];
  if(nums.some(name=>usage[name]!==undefined&&(!Number.isFinite(usage[name])||usage[name]<0)))throw Error('HAIKU_INVALID_USAGE');
  const input=usage.input_tokens??0,output=usage.output_tokens??0,read=usage.cache_read_input_tokens??0,write=usage.cache_creation_input_tokens??0;
  return {inputTokens:input,outputTokens:output,cacheReadTokens:read,cacheWriteTokens:write,
    estimatedUSD:(input*HAIKU55_PRICES.input+output*HAIKU55_PRICES.output+read*HAIKU55_PRICES.cacheRead+write*HAIKU55_PRICES.cacheWrite)/1_000_000};
}
