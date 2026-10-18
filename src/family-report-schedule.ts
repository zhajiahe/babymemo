// Pure calendar logic: dates are the family's local dates, not UTC dates.
export type ReportKind='week'|'month';
export type ReportPeriod={kind:ReportKind;start:string;end:string};
const DAY=86400000;
function dayInZone(at:Date,zone:string):string {
 return new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
}
function hourInZone(at:Date,zone:string):number {
 return Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(at));
}
function addDays(day:string,delta:number):string {
 const timestamp=Date.parse(day+'T00:00:00Z');
 return new Date(timestamp+delta*DAY).toISOString().slice(0,10);
}
export function reportPeriod(kind:ReportKind,localDay:string):ReportPeriod {
 if(kind==='week')return {kind,start:addDays(localDay,-6),end:localDay};
 const currentMonth=localDay.slice(0,7)+'-01';
 const previousEnd=addDays(currentMonth,-1);
 return {kind,start:previousEnd.slice(0,7)+'-01',end:previousEnd};
}
export function scheduledReportPeriods(at:Date,zone:string,hour:number):ReportPeriod[] {
 const localDay=dayInZone(at,zone);
 const localHour=hourInZone(at,zone);
 if(localHour<hour)return [];
 const result:ReportPeriod[]=[];
 if(new Date(localDay+'T00:00:00Z').getUTCDay()===0)result.push(reportPeriod('week',localDay));
 if(localDay.endsWith('-01'))result.push(reportPeriod('month',localDay));
 return result;
}
