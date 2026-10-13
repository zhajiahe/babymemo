// Deterministic safety policy for BabyMemo's user-authorised WeChat tools.
// The model is a parser, NEVER an authority to bypass these checks.
const destructive=/delete_|restore_trash|update_/;
export const MUTATING_ACTIONS=new Set(['update_baby','create_growth','update_growth','delete_growth','create_milestone','update_milestone','delete_milestone','update_media','delete_media','restore_trash','update_recent_media']);
export const QUERY_KINDS={list_growth:'growth',list_milestones:'milestones',list_media:'media',search_records:null};
export function validDay(s){
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
 const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s;
}
export function messageTime(raw,now=Date.now()){
 const n=Number(raw?.create_time_ms);
 return Number.isFinite(n)&&n>now-30*86400000&&n<now+300000?n:now;
}
export function dayInZone(now,tz='Asia/Shanghai'){
 try{return new Date(now).toLocaleDateString('sv-SE',{timeZone:tz})}
 catch{return new Date(now).toISOString().slice(0,10)}
}
export function relativeDay(offset,now,tz){
 const day=dayInZone(now,tz);
 return new Date(new Date(day+'T12:00:00Z').getTime()+offset*86400000).toISOString().slice(0,10);
}
export function explicitDay(text,now,tz){
 if(typeof text!=='string')return null;
 const exact=text.match(/(?:^|[^\d])((?:19|20)\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
 if(exact){const day=[exact[1],exact[2].padStart(2,'0'),exact[3].padStart(2,'0')].join('-');return validDay(day)?day:null}
 // A date supplied as a relative weekday in the USER's original words is
 // still explicit grounding. Compute from the message's local calendar day,
 // never from the assistant's proposed (possibly invented) date.
 const previousWeekday=text.match(/上(?:周|星期|礼拜)\s*([一二三四五六日天])/);
 if(previousWeekday){
  const dayIndex={'一':0,'二':1,'三':2,'四':3,'五':4,'六':5,'日':6,'天':6}[previousWeekday[1]];
  const today=dayInZone(now,tz),d=new Date(today+'T12:00:00Z');
  const daysSinceMonday=(d.getUTCDay()+6)%7;
  const offset=-daysSinceMonday-7+dayIndex;
  return new Date(d.getTime()+offset*86400000).toISOString().slice(0,10);
 }
 for(const [mark,offset] of [['前天',-2],['昨天',-1],['昨日',-1],['昨晚',-1],['昨夜',-1],['今天',0],['今日',0]]){
  if(text.includes(mark))return relativeDay(offset,now,tz);
 }
 // Numeric dotted dates require an explicit day suffix to avoid treating
 // measurements such as 13.7kg as "13 July".
 const dotted=text.match(/(?:^|[^\d])(\d{1,2})\s*[./]\s*(\d{1,2})\s*(?:日|号)/);
 if(dotted){
  const year=dayInZone(now,tz).slice(0,4),day=year+'-'+dotted[1].padStart(2,'0')+'-'+dotted[2].padStart(2,'0');
  return validDay(day)?day:null;
 }
 const short=text.match(/(?:^|[^\d])(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
 if(short){const year=dayInZone(now,tz).slice(0,4),day=year+'-'+short[1].padStart(2,'0')+'-'+short[2].padStart(2,'0');return validDay(day)?day:null}
 return null;
}
export function isNegativeOrConditional(text,action){
 if(typeof text!=='string')return true;
 if(!MUTATING_ACTIONS.has(action))return false;
 if(/(?:如果|假如|除非|要是|等到|等.+再|先不要|暂时不要|别|不许|不用|无需|不想|没有说要|没说要|千万不要|不要|取消)\s*(?:[\u4e00-\u9fff]{0,8})\s*(?:删除|删掉|删|修改|改掉|更改|恢复|还原|添加|新增|记录|更新)/.test(text))return true;
 if(/(?:不要|不必|别|无需|并非|不是)\s*(?:.{0,10})(?:删|改|记|恢复|添加)/.test(text))return true;
 return false;
}
export function groundingOfDate(args,text,tz,at){
 if(typeof args?.id==='string')return text.toLowerCase().includes(args.id.slice(0,8).toLowerCase());
 if(!validDay(args?.day))return false;
 const when=explicitDay(text,at,tz);
 if(when===args.day)return true;
 // A date may be in a compound utterance; old selector must precede modification.
 const index=text.search(/改成|改为|改到|改至|更正为|设成/);
 if(index>=0)return explicitDay(text.slice(0,index),at,tz)===args.day;
 return false;
}
const asNum=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
function mentions(text,kind){
 const units=kind==='weight'?'(?:kg|KG|千克|公斤|斤|克|g)':kind==='height'?'(?:cm|CM|厘米|公分|米|m)':'(?:cm|CM|厘米|公分)';
 const regex=new RegExp('(\\d+(?:\\.\\d+)?)\\s*('+units+')','g');
 return [...String(text).matchAll(regex)].map(m=>({num:Number(m[1]),unit:m[2].toLowerCase()}));
}
function normalized(m,kind){
 if(kind==='weight')return m.unit==='斤'?m.num/2:m.unit==='克'||m.unit==='g'?m.num/1000:m.num;
 if(kind==='height')return m.unit==='米'||m.unit==='m'?m.num*100:m.num;
 return m.num;
}
// Height and head circumference share cm units. A matching number alone never
// authorises writing the *other* field; the closest measurement label must agree.
function semanticMeasurementGrounded(text,kind,target){
 if(kind==='weight')return true;
 const labels=[...String(text).matchAll(/身高|身长|个子|头围/g)];
 const matchedKind=word=>word==='头围'?'headCircumference':'height';
 const values=kind==='height'
  ? /(\d+(?:\.\d+)?)\s*(cm|厘米|公分|米|m)/gi
  : /(\d+(?:\.\d+)?)\s*(cm|厘米|公分)/gi;
 for(const m of String(text).matchAll(values)){
  if(Math.abs(normalized({num:Number(m[1]),unit:m[2].toLowerCase()},kind)-target)>=0.011)continue;
  const prior=labels.filter(x=>x.index<=m.index).at(-1);
  if(prior&&m.index-prior.index-prior[0].length<=16){
   if(matchedKind(prior[0])===kind)return true;
   continue;
  }
  const next=labels.find(x=>x.index>=m.index+m[0].length);
  if(next&&next.index-m.index-m[0].length<=6&&matchedKind(next[0])===kind)return true;
 }
 return false;
}
export function measurementGrounded(args,text){
 const present=[['weight','weight'],['height','height'],['headCircumference','headCircumference']].filter(([key])=>args[key]!==undefined);
 if(!present.length)return true;
 for(const [key,kind] of present){
  const got=asNum(args[key]);if(got===null)return false;
  const choices=mentions(text,kind).filter(m=>Math.abs(normalized(m,kind)-got)<0.011);
  if(!choices.length||!semanticMeasurementGrounded(text,kind,got))return false;
  const distinct=new Set(mentions(text,kind).map(m=>normalized(m,kind).toFixed(2)));
  if(distinct.size>1 && !/(?:更正|不是|改成|改为|而不是)/.test(text)){
   const word=kind==='weight'?'(?:体重|重量)':kind==='height'?'(?:身高|身长)':'头围';
   const related=new RegExp(word+'[^\\d]{0,12}'+got+'\\s*(?:kg|公斤|斤|克|cm|厘米|公分|米)','i');
   if(!related.test(text))return false;
  }
 }
 return true;
}
// New dates must be grounded AFTER the change verb. The first date in the
// utterance normally identifies the old record, not the new date.
export function newDayGrounded(newDay,text,at,tz){
 if(!validDay(newDay)||typeof text!=='string')return false;
 const verb=/(?:改成|改为|改到|改至|更正为|设成|设为|调整到|调整为|修改为|修改成|日期为)/g;
 for(const match of text.matchAll(verb)){
  if(explicitDay(text.slice(match.index+match[0].length),at,tz)===newDay)return true;
 }
 return false;
}
export function guardAction(action,args,text,baby,at=Date.now()){
 if(!MUTATING_ACTIONS.has(action))return null;
 if(isNegativeOrConditional(text,action))return '这句话包含否定或条件操作，尚未修改任何数据。请明确说明需要执行的动作。';
 if((action==='create_growth'||action==='create_milestone')&&args?.day){
  const target=explicitDay(text,at,baby?.time_zone||'Asia/Shanghai');
  if(target!==args.day)return '记录日期缺乏原消息的明确依据，请补充“今天、昨天”或具体日期。';
 }
 if((action==='create_growth'||action==='update_growth')&&!measurementGrounded(args,text))
  return '测量数值或单位与原消息不一致，请明确单位和数值后再记录。';
 if(action.startsWith('update_')||action.startsWith('delete_')||action==='restore_trash'){
  if(action!=='update_baby'&&action!=='update_recent_media'&&!groundingOfDate(args,text,baby?.time_zone||'Asia/Shanghai',at))
   return '请明确指出原记录日期或查询后的记录编号，未执行修改。';
 }
 if(['update_media','update_recent_media','update_milestone'].includes(action)&&args?.newDay&&!newDayGrounded(args.newDay,text,at,baby?.time_zone||'Asia/Shanghai'))return '新日期缺乏原文中修改目标的明确依据，未修改。';
 if(action==='update_baby'){
  if(args.birthday&&explicitDay(text,at,baby?.time_zone||'Asia/Shanghai')!==args.birthday)return '出生日期缺乏原文依据，未修改。';
  if(args.allergies&&!String(text).includes(String(args.allergies).trim()))return '过敏信息缺乏原文依据，未修改。';
  if(args.name&&!String(text).includes(String(args.name).trim()))return '宝宝姓名缺乏原文依据，未修改。';
 }
 if((action==='update_milestone'||action==='update_media')&&args?.newDay&&args.day===args.newDay)
  return '请区分要修改的原日期和新日期，未修改。';
 return null;
}
export function isCancel(text){return /^(取消|算了|不记了|不用了|取消操作)[。!！]?$/.test(String(text).trim())}
export function isUndo(text){return /^(撤销|撤回|恢复刚才的修改|撤销刚才的修改)[。!！]?$/.test(String(text).trim())}
export function isFollowup(text){
 const t=String(text).trim();return t.length<=60&&!/^(?:查询|查找|查看|删除|删掉|记录|新增)/.test(t);
}
