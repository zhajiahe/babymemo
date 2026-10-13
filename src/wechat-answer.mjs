// Grounded age calculations for conversational BabyMemo answers.
// Only an actual get_baby tool observation can contribute a birthday.
const DAY_MS=86400000;
const ageQuestionKind=question=>{
 const text=String(question||'');
 if(/多少天|几天(?:大|了|啦|龄)?|出生(?:了)?(?:多少|几)天|出生多久.*天/.test(text))return 'days';
 if(/几个月|多少个月|多大月龄|月龄/.test(text))return 'months';
 if(/多大(?:了|啦|呀)?|几岁|多少岁|年龄|出生多久/.test(text))return 'age';
 return null;
};
const utcDay=date=>new Date(date+'T00:00:00Z');
const dayText=date=>date.toISOString().slice(0,10);
function addMonthsClamped(ymd,add){
 const date=utcDay(ymd);
 const target=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+add,1));
 const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
 target.setUTCDate(Math.min(date.getUTCDate(),last));
 return target;
}
export function deriveBabyAge({question,observations,asOfDay,babyName}){
 const kind=ageQuestionKind(question);
 if(!kind||!/^\d{4}-\d\d-\d\d$/.test(String(asOfDay)))return null;
 const profile=(observations||[]).filter(o=>o.name==='get_baby').at(-1)?.content||'';
 const match=String(profile).match(/生日\s*(\d{4}-\d{2}-\d{2})/);
 if(!match)return null;
 const birthday=match[1],birth=utcDay(birthday),today=utcDay(asOfDay);
 if(!Number.isFinite(birth.valueOf())||dayText(birth)!==birthday||!Number.isFinite(today.valueOf())||today<birth)return null;
 const days=Math.round((today-birth)/DAY_MS);
 let totalMonths=(today.getUTCFullYear()-birth.getUTCFullYear())*12+today.getUTCMonth()-birth.getUTCMonth();
 if(addMonthsClamped(birthday,totalMonths)>today)totalMonths--;
 const anchor=addMonthsClamped(birthday,totalMonths);
 const remainderDays=Math.round((today-anchor)/DAY_MS),years=Math.floor(totalMonths/12),months=totalMonths%12;
 const name=String(babyName||'宝宝').slice(0,80);
 const head=years?years+' 岁'+(months?' '+months+' 个月':''):(months?months+' 个月':'出生不久');
 const phrase=years||months?head+(remainderDays?' '+remainderDays+' 天':''):days+' 天';
 const answer=kind==='days'?name+'从出生到今天已经 '+days+' 天啦。':
  kind==='months'?name+'现在 '+totalMonths+' 个整月'+(remainderDays?'零 '+remainderDays+' 天':'')+'啦。':
  name+'现在 '+phrase+'啦。';
 return {kind,birthday,asOfDay,days,totalMonths,years,months,remainderDays,name,answer};
}
export function ageReplyMatches(text,age){
 if(!age)return true;
 const str=String(text||'').replace(/\s/g,'');
 if(/(?:的档案|过敏和注意事项|备注：|宝宝档案)/.test(str))return false;
 // Verify any computed age claim against server arithmetic, not just fluent prose.
 if(age.kind==='days')return str.includes(age.days+'天');
 if(age.kind==='months')return str.includes(age.totalMonths+'个月')||
  str.includes(age.totalMonths+'个整月');
 const cn=['零','一','二','三','四','五','六','七','八','九','十'];
 const years=age.years?String(age.years):'',months=String(age.months);
 const chinese=age.years<cn.length?cn[age.years]:null;
 const chineseMonth=age.months<cn.length?cn[age.months]:null;
 if(age.years>0){
  const hasYears=str.includes(years+'岁')||(chinese&&str.includes(chinese+'岁'))||(age.years===2&&str.includes('两岁'));
  if(!hasYears)return false;
  if(age.months>0){
   const hasMonths=str.includes(months+'个月')||(chineseMonth&&str.includes(chineseMonth+'个月'))||(age.months===2&&str.includes('两个月'));
   return !!hasMonths;
  }
  return true;
 }
 return str.includes(months+'个月')||(chineseMonth&&str.includes(chineseMonth+'个月'))||str.includes(age.days+'天');
}
