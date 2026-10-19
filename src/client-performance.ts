/** Only aggregate-safe timings; no identifiers, URLs or user-generated text. */
export type ExperienceMetric='app_ready'|'view_data'|'photo_ready';
const budgets:Record<ExperienceMetric,number>={app_ready:1,view_data:8,photo_ready:8};
export function trackExperience(metric:ExperienceMetric,durationMs:number):void{
 if(!Number.isFinite(durationMs)||durationMs<0||durationMs>600000||budgets[metric]<=0||!navigator.onLine)return;
 budgets[metric]--;
 void fetch('/api/performance/metrics',{
  method:'POST',credentials:'same-origin',keepalive:true,
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({metric,durationMs:Math.round(durationMs)})
 }).catch(()=>{});
}
