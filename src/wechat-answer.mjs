// A deterministic property of a profile, not a special-case intent parser.
const DAY=86400000,utc=d=>new Date(d+'T00:00:00Z');
function addMonths(day,n){
 const d=utc(day),first=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n,1));
 const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 first.setUTCDate(Math.min(d.getUTCDate(),last));return first;
}
export function ageOnDay(birthday,asOfDay){
 if(!/^\d{4}-\d\d-\d\d$/.test(String(birthday))||!/^\d{4}-\d\d-\d\d$/.test(String(asOfDay)))return null;
 const b=utc(birthday),today=utc(asOfDay);
 if(!Number.isFinite(+b)||!Number.isFinite(+today)||b.toISOString().slice(0,10)!==birthday||
  today.toISOString().slice(0,10)!==asOfDay||today<b)return null;
 let n=(today.getUTCFullYear()-b.getUTCFullYear())*12+today.getUTCMonth()-b.getUTCMonth();
 if(addMonths(birthday,n)>today)n--;
 return {days:Math.round((today-b)/DAY),years:Math.floor(n/12),
  months:n%12,remainderDays:Math.round((today-addMonths(birthday,n))/DAY)};
}
