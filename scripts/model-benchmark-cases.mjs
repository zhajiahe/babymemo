// Canonical, provider-neutral, production-isolated model task benchmark.
// Invariants: same system prompt, same BabyMemo tool JSON schemas, same synthetic
// tool observations and scoring for OpenRouter and Workers AI.
export const BENCHMARK_DATE='2026-10-14';
export const BENCHMARK_SYSTEM='你是 BabyMemo 微信家庭成长记录助手。今天是 2026-10-14，时区 Asia/Shanghai，家庭只有虚构的“测试宝宝”。用户发来的内容是当前指令。能直接执行的动作请调用工具，而不是只描述计划。工具结果为权威事实，完成后自然简短回复。禁止杜撰记录编号、测量结果或声称未执行的写入。没有实测就不新增测量，否定句不执行写入。查询后可以继续修改，不要反复调用相同工具。';
export const MODEL_BENCH_CASES=Object.freeze([
 {id:'growth-read',name:'查询最近体重',message:'查询测试宝宝最近五条体重记录',required:['list_growth'],forbidWrites:true},
 {id:'growth-create',name:'新增身高体重',message:'测试宝宝今天体重10.5kg，身高82cm，帮我记录',required:['create_growth'],args:{create_growth:{day:'2026-10-14',weight:10.5,height:82}}},
 {id:'milestone-create',name:'新增里程碑',message:'测试宝宝今天第一次自己走了五步，记成里程碑',required:['create_milestone'],args:{create_milestone:{day:'2026-10-14'}}},
 {id:'milestone-read',name:'查询成长瞬间',message:'测试宝宝最近有哪些成长瞬间',required:['list_milestones'],forbidWrites:true},
 {id:'growth-range',name:'区间体重汇总',message:'汇总测试宝宝2026年10月1日到10月10日的体重变化',any:['growth_summary','list_growth'],forbidWrites:true},
 {id:'growth-update',name:'先查再更正',message:'把测试宝宝昨天的体重10.5kg，先查出来，再更正成10.2kg',required:['list_growth','update_growth'],args:{update_growth:{weight:10.2}},ordered:true},
 {id:'negated-save',name:'否定写入',message:'不要保存，刚才说的10.5kg只是猜的，没实际称重',required:[],forbidWrites:true},
 {id:'media-read',name:'按日期查相册',message:'看看测试宝宝10月1日的照片',required:['list_media'],forbidWrites:true},
 {id:'media-update',name:'更正刚发照片日期',message:'把刚才发的照片日期改成昨天',required:['update_recent_media'],args:{update_recent_media:{newDay:'2026-10-13'}}},
 {id:'trash-restore',name:'查询并恢复记录',message:'从测试宝宝回收站找出10月1日的体重记录并恢复',required:['list_trash','restore_trash'],ordered:true,args:{restore_trash:{kind:'growth'}}},
 {id:'profile-allergy',name:'先读档案再补充过敏信息',message:'先看看测试宝宝目前的过敏备注，再把过敏信息更新成“对测试食物甲过敏”，其他资料不要动',required:['get_baby','update_baby'],ordered:true,args:{update_baby:{allergies:'对测试食物甲过敏'}}},
 {id:'media-description',name:'辨别同日照片与视频并更新描述',message:'先查测试宝宝10月1日的相册。只把那张照片（不是视频）的描述改成“第一次去公园”，不要改视频',required:['list_media','update_media'],ordered:true,args:{update_media:{description:'第一次去公园'}},targets:{update_media:'dddddddd'}},
 {id:'milestone-delete',name:'查明事件后定向删除',message:'先找出测试宝宝10月1日独立走路的里程碑，再把这一条移入回收站，其他记录保留',required:['list_milestones','delete_milestone'],ordered:true,targets:{delete_milestone:'cccccccc'}},
 {id:'growth-delete',name:'定位历史测量后删除',message:'先查测试宝宝10月1日的体重，确认对应记录后只删除这一条测量',required:['list_growth','delete_growth'],ordered:true,targets:{delete_growth:'bbbbbbbb'}},
 {id:'dual-create',name:'一条指令创建两类记录',message:'测试宝宝今天体重10.8kg、身高83cm，还第一次自己拿勺子吃饭。两个事情都帮我记录',required:['create_growth','create_milestone'],args:{create_growth:{day:'2026-10-14',weight:10.8,height:83},create_milestone:{day:'2026-10-14'}}},
 {id:'album-and-milestones',name:'跨实体同时查询',message:'分别查询测试宝宝10月1日的相册和那天的成长里程碑，告诉我有哪些，不要新增或修改',required:['list_media','list_milestones'],forbidWrites:true},
 {id:'conditional-search',name:'条件查询无结果时禁止杜撰',message:'查测试宝宝10月1日至10月10日包含“疫苗”的成长事件；没有就告诉我没有，绝对不要替我新建',required:['search_records'],args:{search_records:{kind:'milestones',startDay:'2026-10-01',endDay:'2026-10-10',keyword:'疫苗'}},forbidWrites:true},
 {id:'ambiguous-delete',name:'目标不明确时只查询',message:'10月1日相册里的东西我还没决定删哪一个，你先列出来让我选，不要删除也不要修改任何东西',required:['list_media'],forbidWrites:true},
 {id:'video-delete',name:'同日媒体精准区分视频后删除',message:'查一下10月1日相册，找到其中的视频（不是照片），只把视频移到回收站',required:['list_media','delete_media'],ordered:true,targets:{delete_media:'abcd1234'}},
 {id:'cross-report',name:'区间汇总加同期事件查询',message:'请汇总测试宝宝10月1日到10月10日的成长测量，并查找这段时间的成长事件；只查看，不要写入',required:['growth_summary','search_records'],args:{growth_summary:{startDay:'2026-10-01',endDay:'2026-10-10'},search_records:{kind:'milestones',startDay:'2026-10-01',endDay:'2026-10-10'}},forbidWrites:true}

]);
const WRITE=/^(create_|update_|delete_|restore_)/;
export const isWrite=name=>WRITE.test(String(name||''));
export function syntheticObservation(name,args={}){
 if(name==='get_runtime_context')return JSON.stringify({messageLocalDay:BENCHMARK_DATE,timeZone:'Asia/Shanghai',targetBaby:'测试宝宝'});
 if(name==='list_babies')return '家庭宝宝：测试宝宝（2025-05-30）';
 if(name==='get_baby')return '测试宝宝档案：2025-05-30，过敏和注意事项未填写';
 if(name==='list_growth')return '测试宝宝成长测量：\naaaaaaaa · 2026-10-13 · 体重 10.5kg，身高 82cm\nbbbbbbbb · 2026-10-01 · 体重 10.0kg';
 if(name==='list_milestones')return '测试宝宝成长事件：\ncccccccc · 2026-10-01 · 独立走路';
 if(name==='growth_summary')return '2026-10-01 至 2026-10-10：体重 10.0kg → 10.5kg，增加 0.5kg';
 if(name==='list_media')return '测试宝宝相册：\ndddddddd · 2026-10-01 · image/jpeg · 照片\nabcd1234 · 2026-10-01 · video/quicktime · 视频';
 if(name==='list_trash')return '回收站：\neeeeeeee · 2026-10-01 · 体重 10.5kg，kind=growth';
 if(name==='search_records'&&args.kind==='milestones'&&args.keyword==='疫苗')return '没有找到符合条件的成长事件';
 if(name==='search_records')return '查询结果：eeeeeeee · 2026-10-01 · 体重 10.5kg';
 if(name==='create_growth')return '已保存成长测量（编号 ffffffff）。';
 if(name==='update_growth')return '已更新成长测量（编号 aaaaaaaa）。';
 if(name==='create_milestone')return '已保存成长事件（编号 ffffffff）。';
 if(name==='update_recent_media')return '已更新照片日期（编号 dddddddd）。';
 if(name==='restore_trash')return '已恢复成长测量（编号 eeeeeeee）。';
 return '模拟工具执行成功，无生产数据操作。';
}
function validArgs(call,tools){
 const name=call?.function?.name,schema=tools.find(x=>x?.function?.name===name)?.function?.parameters;
 if(!schema||call?.type!=='function'||typeof call.function.arguments!=='string')return {name,args:null,issue:'UNKNOWN_OR_INVALID_TOOL'};
 let args;try{args=JSON.parse(call.function.arguments)}catch{return {name,args:null,issue:'INVALID_TOOL_JSON'}}
 if(!args||typeof args!=='object'||Array.isArray(args))return {name,args:null,issue:'INVALID_ARGUMENT_OBJECT'};
 const allowed=schema.properties||{};
 if(Object.keys(args).some(k=>!(k in allowed)))return {name,args,issue:'UNRECOGNIZED_ARGUMENT'};
 if((schema.required||[]).some(k=>!(k in args)))return {name,args,issue:'MISSING_REQUIRED_ARGUMENT'};
 for(const [key,value] of Object.entries(args)){
  const prop=allowed[key];
  if(prop.type==='number'&&(typeof value!=='number'||!Number.isFinite(value))||
    prop.type==='integer'&&!Number.isInteger(value)||
    prop.type==='string'&&typeof value!=='string'||
    prop.type==='boolean'&&typeof value!=='boolean'||
    Array.isArray(prop.enum)&&!prop.enum.includes(value))return {name,args,issue:'INVALID_ARGUMENT_TYPE'};
 }
 return {name,args,issue:null};
}
export function validateBenchmarkTool(caseItem,call,tools,history=[]){
 const x=validArgs(call,tools);
 if(x.issue)return x;
 const expected=new Set([...(caseItem.required||[]),...(caseItem.any||[])]);
 if(isWrite(x.name)&&(caseItem.forbidWrites||!expected.has(x.name)))return {...x,issue:'UNAUTHORIZED_MUTATION'};
 if((caseItem.required||[]).includes(x.name)&&history.some(h=>h.name===x.name)&&x.name!=='get_runtime_context')
  return {...x,issue:'REPEATED_REQUIRED_TOOL'};
 for(const [k,value] of Object.entries(caseItem.args?.[x.name]||{})){
  if(x.args[k]!==value)return {...x,issue:'WRONG_'+k.toUpperCase()};
 }
 if(caseItem.targets?.[x.name]&&x.args.id!==caseItem.targets[x.name])return {...x,issue:'UPDATE_TARGET_NOT_GROUNDED'};
 if(x.name==='update_growth'&&!((x.args.id||x.args.day)&&
   (x.args.id==='aaaaaaaa'||x.args.day==='2026-10-13')))return {...x,issue:'UPDATE_TARGET_NOT_GROUNDED'};
 if(x.name==='restore_trash'&&!((x.args.id||x.args.day)&&
   (x.args.id==='eeeeeeee'||x.args.day==='2026-10-01')))return {...x,issue:'RESTORE_TARGET_NOT_GROUNDED'};
 return x;
}
export function scoreModelCase(caseItem,{calls=[],issues=[],reply='',error=null}={}){
 const found=calls.map(x=>x.name);
 const errors=[...issues];
 if(error)errors.push('MODEL_OR_AGENT_ERROR');
 for(const name of caseItem.required||[])if(!found.includes(name))errors.push('MISSING_'+name.toUpperCase());
 if(caseItem.any?.length&&!caseItem.any.some(n=>found.includes(n)))errors.push('MISSING_ALTERNATIVE_TOOL');
 if(caseItem.forbidWrites&&found.some(isWrite))errors.push('UNAUTHORIZED_MUTATION');
 if(caseItem.ordered){
  const first=found.indexOf(caseItem.required[0]),second=found.indexOf(caseItem.required[1]);
  if(first<0||second<=first)errors.push('READ_BEFORE_WRITE_MISSING');
 }
 const text=String(reply).trim();
 if(!text)errors.push('MISSING_FINAL_REPLY');
 if(/^(?:已查到相关资料，但暂时没能整理|本次操作达到模型决策轮数上限|本次操作达到工具调用上限|后续模型调用失败)/.test(text))
  errors.push('INCOMPLETE_OR_FALLBACK_REPLY');
 if(caseItem.id==='negated-save'&&/(?:已保存|已记录|已经记下)/.test(text))errors.push('FALSE_WRITE_CLAIM');
 if(caseItem.id==='conditional-search'&&/(?:已找到|找到了一条|有一条疫苗)/.test(text))errors.push('FALSE_SEARCH_CLAIM');
 return {passed:errors.length===0,issues:[...new Set(errors)]};
}
export function aggregateBenchmark(results){
 const n=results.length,passed=results.filter(x=>x.passed).length;
 const requests=results.reduce((sum,x)=>sum+(x.modelRequests||0),0);
 const sumKnown=key=>results.some(x=>x.usage?.[key]===null||x.usage?.[key]===undefined)?null:
  results.reduce((sum,x)=>sum+(x.usage[key]||0),0);
 return {cases:n,passed,passRate:n?passed/n:0,modelRequests:requests,usage:{inputTokens:sumKnown('inputTokens'),outputTokens:sumKnown('outputTokens'),neurons:sumKnown('neurons'),reportedUSD:sumKnown('reportedUSD')}};
}
