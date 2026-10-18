import type {Env} from './types';
import {setting,resolveOpenRouterKey} from './crypto';
import {qwenCompletion,DEFAULT_AI_PROVIDER} from './qwen-workers-ai.mjs';
import {openRouterCompletion} from './openrouter-retry.mjs';
import {DEFAULT_OPENROUTER_MODEL} from './openrouter-model.mjs';
import {sendWechatFamilyReport} from './wechat';
import {scheduledReportPeriods,reportPeriod,type ReportKind,type ReportPeriod} from './family-report-schedule';
import {reportMetrics,reportMediaStories,reportEditorialInstructions,reportEditorialInput,parseReportNarrative,renderFamilyReport,type ReportFacts,type ReportGrowth,type ReportMoment,type ReportMedia} from './family-report-content';

type ReportConfig={weekly:boolean;monthly:boolean;hour:number;timeZone:string};
type Report={kind:ReportKind;period_start:string;period_end:string;body:string;created_at:string};
type Recipient={id:string;context_cipher:string|null;context_updated_at:string|null};
type Delivery={client_id:string;state:string;attempts:number;updated_at:string};
const hours=[8,12,20,21];
const now=()=>new Date().toISOString();
const clean=(v:unknown,len=150)=>typeof v==='string'?v.replace(/[\u0000-\u001f]+/g,' ').slice(0,len).trim():'';
const errorCode=(e:unknown)=>{const s=e instanceof Error?e.message:'UNKNOWN';return /^(WECHAT_|WORKERS_AI_|OPENROUTER_|REPORT_)[A-Z0-9_]+$/.test(s)?s:'REPORT_FAILED'};
export async function familyReportConfig(env:Env):Promise<ReportConfig>{
 const [w,m,h,b]=await Promise.all([setting(env,'family_report_weekly'),setting(env,'family_report_monthly'),setting(env,'family_report_hour'),env.DB.prepare('SELECT time_zone FROM babies WHERE archived_at IS NULL ORDER BY created_at LIMIT 1').first<{time_zone:string}>()]);
 const n=Number(h||20);
 return {weekly:w==='true',monthly:m==='true',hour:hours.includes(n)?n:20,timeZone:b?.time_zone||'Asia/Shanghai'};
}
export async function familyReportSettings(env:Env){
 const config=await familyReportConfig(env);
 const [members,reports]=await Promise.all([
  env.DB.prepare('SELECT id,label,enabled,report_subscribed,context_updated_at,CASE WHEN context_cipher IS NULL THEN 0 ELSE 1 END has_context FROM wechat_connections ORDER BY created_at,id').all<{id:string;label:string;enabled:number;report_subscribed:number;context_updated_at:string|null;has_context:number}>(),
  env.DB.prepare("SELECT r.kind,r.period_start,r.period_end,r.created_at,COUNT(d.connection_id) recipients,SUM(CASE WHEN d.state='sent' THEN 1 ELSE 0 END) sent,SUM(CASE WHEN d.state='failed' THEN 1 ELSE 0 END) failed,SUM(CASE WHEN d.state='waiting_context' THEN 1 ELSE 0 END) waiting FROM family_reports r LEFT JOIN family_report_deliveries d ON r.kind=d.kind AND r.period_start=d.period_start GROUP BY r.kind,r.period_start ORDER BY r.created_at DESC LIMIT 8").all()
 ]);
 return {...config,members:members.results.map(m=>({id:m.id,label:m.label,enabled:m.enabled===1,subscribed:m.report_subscribed===1,hasContext:m.has_context===1,lastContextAt:m.context_updated_at})),reports:reports.results};
}
export async function saveFamilyReportConfig(env:Env,value:unknown){
 const v=value as {weekly?:unknown;monthly?:unknown;hour?:unknown}|null;
 if(!v||typeof v.weekly!=='boolean'||typeof v.monthly!=='boolean'||typeof v.hour!=='number'||!hours.includes(v.hour))throw Error('INVALID_REPORT_SETTINGS');
 const at=now();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO app_settings(name,value,updated_at) VALUES('family_report_weekly',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(String(v.weekly),at),
  env.DB.prepare("INSERT INTO app_settings(name,value,updated_at) VALUES('family_report_monthly',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(String(v.monthly),at),
  env.DB.prepare("INSERT INTO app_settings(name,value,updated_at) VALUES('family_report_hour',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(String(v.hour),at)
 ]);
 if(!v.weekly||!v.monthly){
  await env.DB.prepare("UPDATE family_report_deliveries SET state='failed',error_code='REPORT_DISABLED',updated_at=? WHERE state IN ('pending','waiting_context','retry') AND kind=?").bind(now(),!v.weekly?'week':'month').run();
  if(!v.weekly&&!v.monthly)await env.DB.prepare("UPDATE family_report_deliveries SET state='failed',error_code='REPORT_DISABLED',updated_at=? WHERE state IN ('pending','waiting_context','retry') AND kind='month'").bind(now()).run();
 }
 return familyReportConfig(env);
}
async function factsFor(env:Env,period:ReportPeriod):Promise<ReportFacts[]|null>{
 const babies=await env.DB.prepare('SELECT id,name FROM babies WHERE archived_at IS NULL ORDER BY created_at').all<{id:string;name:string}>();
 const items:ReportFacts[]=[];
 const maxMoments=period.kind==='week'?12:24;
 const maxMedia=period.kind==='week'?24:48;
 for(const baby of babies.results.slice(0,20)){
  const [momentCount,mediaCounts,moments,media,growth,previous]=await Promise.all([
   env.DB.prepare('SELECT COUNT(*) total FROM milestones WHERE baby_id=? AND day BETWEEN ? AND ? AND deleted_at IS NULL').bind(baby.id,period.start,period.end).first<{total:number}>(),
   env.DB.prepare("SELECT SUM(CASE WHEN mime LIKE 'image/%' THEN 1 ELSE 0 END) photos,SUM(CASE WHEN mime LIKE 'video/%' THEN 1 ELSE 0 END) videos FROM media WHERE baby_id=? AND day BETWEEN ? AND ? AND deleted_at IS NULL AND upload_state='ready'").bind(baby.id,period.start,period.end).first<{photos:number|null;videos:number|null}>(),
   env.DB.prepare('SELECT day,title,description FROM milestones WHERE baby_id=? AND day BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY day DESC,created_at DESC LIMIT ?').bind(baby.id,period.start,period.end,maxMoments).all<ReportMoment>(),
   env.DB.prepare("SELECT day,title,description,mime FROM media WHERE baby_id=? AND day BETWEEN ? AND ? AND deleted_at IS NULL AND upload_state='ready' ORDER BY day DESC,created_at DESC LIMIT ?").bind(baby.id,period.start,period.end,maxMedia).all<ReportMedia>(),
   env.DB.prepare('SELECT day,weight,height,head_circumference FROM growth_records WHERE baby_id=? AND day BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY day DESC,created_at DESC LIMIT 60').bind(baby.id,period.start,period.end).all<ReportGrowth>(),
   env.DB.prepare('SELECT day,weight,height,head_circumference FROM growth_records WHERE baby_id=? AND day<? AND deleted_at IS NULL ORDER BY day DESC,created_at DESC LIMIT 30').bind(baby.id,period.start).all<ReportGrowth>()
  ]);
  const counts={moments:momentCount?.total||0,photos:mediaCounts?.photos||0,videos:mediaCounts?.videos||0,measurements:growth.results.length};
  if(!Object.values(counts).some(value=>value>0))continue;
  items.push({
   name:clean(baby.name,80),counts,
   metrics:reportMetrics(growth.results,previous.results,period.kind),
   moments:moments.results.map(row=>({day:row.day,title:clean(row.title,110),description:clean(row.description,240)})),
   media:reportMediaStories(media.results,period.kind==='week'?6:12)
  });
 }
 return items.length?items:null;
}
async function aiStory(env:Env,period:ReportPeriod,facts:ReportFacts[]){
 const messages=[
  {role:'system',content:reportEditorialInstructions(period.kind)},
  {role:'user',content:reportEditorialInput(period,facts)}
 ];
 const provider=await setting(env,'ai_provider')||DEFAULT_AI_PROVIDER;
 const max_tokens=period.kind==='week'?800:1150;
 let response;
 if(provider==='openrouter'){
  const key=await resolveOpenRouterKey(env);if(!key)throw Error('REPORT_AI_NOT_CONFIGURED');
  response=await openRouterCompletion({key,model:await setting(env,'openrouter_model')||DEFAULT_OPENROUTER_MODEL,messages,max_tokens,maxAttempts:1});
 }else response=await qwenCompletion({ai:env.AI!,messages,max_tokens});
 const result=(response as {choices?:{message?:{content?:unknown}}[]})?.choices?.[0]?.message?.content;
 return parseReportNarrative(result);
}
async function reportBody(env:Env,period:ReportPeriod):Promise<string|null>{
 const facts=await factsFor(env,period);
 if(!facts)return null;
 const narrative=await aiStory(env,period,facts);
 return renderFamilyReport(period,facts,narrative);
}
async function createReport(env:Env,period:ReportPeriod):Promise<Report|null>{
 const existing=await env.DB.prepare('SELECT * FROM family_reports WHERE kind=? AND period_start=?').bind(period.kind,period.start).first<Report>();
 if(existing)return existing;
 const body=await reportBody(env,period);
 if(!body)return null;
 await env.DB.prepare('INSERT OR IGNORE INTO family_reports(kind,period_start,period_end,body,created_at) VALUES(?,?,?,?,?)').bind(period.kind,period.start,period.end,body,now()).run();
 return env.DB.prepare('SELECT * FROM family_reports WHERE kind=? AND period_start=?').bind(period.kind,period.start).first<Report>();
}
// Manual tests are single-recipient, explicit admin actions, never scheduled.
export async function sendFamilyReportTest(env:Env,kind:unknown,connectionId:unknown){
 if((kind!=='week'&&kind!=='month')||typeof connectionId!=='string'||!/^(legacy|[0-9a-f-]{36})$/i.test(connectionId))throw Error('REPORT_TEST_INVALID_INPUT');
 const recipient=await env.DB.prepare('SELECT enabled,report_subscribed,context_cipher FROM wechat_connections WHERE id=?').bind(connectionId).first<{enabled:number;report_subscribed:number;context_cipher:string|null}>();
 if(!recipient)throw Error('REPORT_RECIPIENT_NOT_FOUND');
 if(recipient.enabled!==1||recipient.report_subscribed!==1)throw Error('REPORT_RECIPIENT_INACTIVE');
 if(!recipient.context_cipher)throw Error('WECHAT_CONTEXT_REQUIRED');
 const attemptedAt=now(),cutoff=new Date(Date.now()-10*60000).toISOString();
 const claim=await env.DB.prepare('INSERT INTO family_report_test_attempts(connection_id,attempted_at) VALUES(?,?) ON CONFLICT(connection_id) DO UPDATE SET attempted_at=excluded.attempted_at WHERE family_report_test_attempts.attempted_at<?').bind(connectionId,attemptedAt,cutoff).run();
 if(!claim.meta.changes)throw Error('REPORT_TEST_RATE_LIMITED');
 const config=await familyReportConfig(env);
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:config.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const period:ReportPeriod=kind==='week'?reportPeriod('week',today):{kind:'month',start:today.slice(0,7)+'-01',end:today};
 let body:string|null;
 try{
  body=await reportBody(env,period);
  if(!body)throw Error('REPORT_NO_RECORDS');
 }catch(e){
  // AI or source failure happened before outbound delivery; permit a corrected retry.
  await env.DB.prepare('DELETE FROM family_report_test_attempts WHERE connection_id=? AND attempted_at=?').bind(connectionId,attemptedAt).run();
  throw e;
 }
 await sendWechatFamilyReport(env,connectionId,'【测试消息 · 不计入正式报告】\n'+body,crypto.randomUUID());
 return {accepted:true,kind,periodStart:period.start,periodEnd:period.end};
}
async function deliver(env:Env,report:Report){
 const members=await env.DB.prepare('SELECT id,context_cipher,context_updated_at FROM wechat_connections WHERE enabled=1 AND report_subscribed=1').all<Recipient>();
 for(const member of members.results){
  await env.DB.prepare("INSERT OR IGNORE INTO family_report_deliveries(kind,period_start,connection_id,client_id,state,updated_at) VALUES(?,?,?,?,'pending',?)").bind(report.kind,report.period_start,member.id,crypto.randomUUID(),now()).run();
  const row=await env.DB.prepare('SELECT client_id,state,attempts,updated_at FROM family_report_deliveries WHERE kind=? AND period_start=? AND connection_id=?').bind(report.kind,report.period_start,member.id).first<Delivery>();
  if(!row||row.state==='sent'||row.state==='failed'||row.attempts>=3)continue;
  if(!member.context_cipher){
   await env.DB.prepare("UPDATE family_report_deliveries SET state='waiting_context',error_code='WECHAT_CONTEXT_REQUIRED',updated_at=? WHERE kind=? AND period_start=? AND connection_id=? AND state NOT IN ('sent','failed','sending')").bind(now(),report.kind,report.period_start,member.id).run();
   continue;
  }
  // A rejected or missing iLink conversation must be refreshed by an actual
  // incoming message; do not burn retry budget on the same stale token hourly.
  if(row.state==='waiting_context'&&(!member.context_updated_at||member.context_updated_at<=row.updated_at))continue;
  const stale=new Date(Date.now()-30*60000).toISOString();
  const claim=await env.DB.prepare("UPDATE family_report_deliveries SET state='sending',attempts=attempts+1,error_code=NULL,updated_at=? WHERE kind=? AND period_start=? AND connection_id=? AND attempts<3 AND (state IN ('pending','retry','waiting_context') OR (state='sending' AND updated_at<?))").bind(now(),report.kind,report.period_start,member.id,stale).run();
  if(!claim.meta.changes)continue;
  try{
   const conf=await familyReportConfig(env);
   if(report.kind==='week'?!conf.weekly:!conf.monthly)throw Error('REPORT_DISABLED');
   await sendWechatFamilyReport(env,member.id,report.body,row.client_id);
   await env.DB.prepare("UPDATE family_report_deliveries SET state='sent',error_code=NULL,updated_at=? WHERE kind=? AND period_start=? AND connection_id=?").bind(now(),report.kind,report.period_start,member.id).run();
  }catch(e){
   const reason=errorCode(e),wait=['WECHAT_SEND_REJECTED','WECHAT_CONTEXT_REQUIRED','WECHAT_STALE_TOKEN','WECHAT_PROTOCOL_ERROR'].includes(reason);
   await env.DB.prepare('UPDATE family_report_deliveries SET state=?,error_code=?,updated_at=? WHERE kind=? AND period_start=? AND connection_id=?').bind(row.attempts+1>=3?'failed':wait?'waiting_context':'retry',reason,now(),report.kind,report.period_start,member.id).run();
  }
 }
}
export async function runFamilyReportCron(env:Env,at=new Date()):Promise<void>{
 const conf=await familyReportConfig(env);
 // A message without a valid conversation cannot remain "waiting" forever.
 const expired=new Date(at.getTime()-36*3600000).toISOString();
 await env.DB.prepare("UPDATE family_report_deliveries SET state='failed',error_code='REPORT_WINDOW_EXPIRED',updated_at=? WHERE state IN ('pending','waiting_context','retry','sending') AND EXISTS (SELECT 1 FROM family_reports r WHERE r.kind=family_report_deliveries.kind AND r.period_start=family_report_deliveries.period_start AND r.created_at<?)").bind(now(),expired).run();
 if(!conf.weekly&&!conf.monthly)return;
 const due=scheduledReportPeriods(at,conf.timeZone,conf.hour).filter(p=>p.kind==='week'?conf.weekly:conf.monthly);
 for(const period of due){
  try{const report=await createReport(env,period);if(report)await deliver(env,report)}
  catch(e){console.error(JSON.stringify({event:'FAMILY_REPORT_GENERATION_FAILED',kind:period.kind,code:errorCode(e)}))}
 }
 const cutoff=new Date(at.getTime()-36*3600000).toISOString();
 const recent=await env.DB.prepare('SELECT * FROM family_reports WHERE created_at>=? ORDER BY created_at DESC LIMIT 4').bind(cutoff).all<Report>();
 for(const report of recent.results){
  if(due.some(p=>p.kind===report.kind&&p.start===report.period_start))continue;
  if(report.kind==='week'?conf.weekly:conf.monthly)await deliver(env,report);
 }
}
