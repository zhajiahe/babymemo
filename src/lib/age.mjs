/** Calendar age in the baby's own time zone, with optional local birth time. */
const monthEnd=(year,month)=>new Date(Date.UTC(year,month,0)).getUTCDate();
const monthAt=(year,month,offset)=>{
 const d=new Date(Date.UTC(year,month-1+offset,1));
 return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1};
};
export function ageLabel(birthday,birthTime='',timeZone='Asia/Shanghai',now=new Date()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(birthday))return '年龄待补充';
 const [year,month,day]=birthday.split('-').map(Number);
 if(month<1||month>12||day<1||day>monthEnd(year,month))return '年龄待补充';
 const dt=/^([01]\d|2[0-3]):[0-5]\d$/.test(birthTime)?birthTime:'00:00';
 const birthMinute=Number(dt.slice(0,2))*60+Number(dt.slice(3));
 let format;
 try{format=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',hourCycle:'h23'});}
 catch{format=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',hourCycle:'h23'});}
 const parts=Object.fromEntries(format.formatToParts(now).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
 const date=Date.UTC(parts.year,parts.month-1,parts.day);
 const born=Date.UTC(year,month-1,day);
 const minute=parts.hour*60+parts.minute;
 if(date<born||(date===born&&minute<birthMinute))return '尚未出生';
 let months=(parts.year-year)*12+parts.month-month;
 let ann=monthAt(year,month,months);
 let anniversary=Date.UTC(ann.year,ann.month-1,Math.min(day,monthEnd(ann.year,ann.month)));
 if(date<anniversary||(date===anniversary&&minute<birthMinute)){
   months--;
   ann=monthAt(year,month,months);
   anniversary=Date.UTC(ann.year,ann.month-1,Math.min(day,monthEnd(ann.year,ann.month)));
 }
 const elapsedDays=Math.floor((date-born)/86400000)-(minute<birthMinute?1:0);
 if(months===0){
   if(elapsedDays===0&&birthTime){
     const hours=Math.floor((minute-birthMinute)/60);
     return hours<1?'出生不到 1 小时':hours+' 小时';
   }
   return Math.max(0,elapsedDays)+' 天';
 }
 const days=Math.max(0,Math.floor((date-anniversary)/86400000)-(minute<birthMinute?1:0));
 return months<36?months+' 个月'+(days?' '+days+' 天':''):Math.floor(months/12)+' 岁'+(months%12?' '+months%12+' 个月':'');
}
