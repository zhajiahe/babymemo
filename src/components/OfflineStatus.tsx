import {useEffect,useState} from 'react';
import {Button} from './ui';
import {offlineJobs,retryOffline,discardOffline,syncOffline,type OfflineJob} from '../offline';
export function OfflineStatus({changed,notify}:{changed:()=>void;notify:(value:string)=>void}){
 const [online,setOnline]=useState(navigator.onLine),[jobs,setJobs]=useState<OfflineJob[]>([]),[expanded,setExpanded]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{
  let live=true,timer:ReturnType<typeof setTimeout>;
  const read=()=>{if(live){setOnline(navigator.onLine);void offlineJobs().then(value=>{if(live)setJobs(value)}).catch(()=>{})}};
  const update=()=>{read();clearTimeout(timer);timer=setTimeout(()=>{if(live)changed()},100)};
  read();window.addEventListener('online',update);window.addEventListener('offline',read);window.addEventListener('babymemo-offline',update);
  return()=>{live=false;clearTimeout(timer);window.removeEventListener('online',update);window.removeEventListener('offline',read);window.removeEventListener('babymemo-offline',update)};
 },[]);
 async function action(run:()=>Promise<void>){setBusy(true);try{await run()}catch(e){notify(e instanceof Error?e.message:'同步失败')}finally{setBusy(false)}}
 if(online&&!jobs.length)return null;
 return <div className="offline-status" role="status"><div className="row-between"><span>{online?'等待同步':'当前离线'} · {jobs.length?jobs.length+' 项更改保存在本机':'展示已保存到本机的内容'}</span>{jobs.length>0&&<button className="text-btn" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>查看待同步内容</button>}</div>
 {!online&&<p>草稿会保留；保存的记录和媒体将在重新联网并登录后自动同步。</p>}
 {expanded&&<div className="offline-jobs">{jobs.map(job=><div key={job.id}><strong>{job.kind==='media'?'照片或视频':job.kind==='avatar'?'宝宝头像':job.path.includes('milestones')?'成长瞬间':job.path.includes('growth')?'成长记录':'资料更改'} · {job.payload.day||job.payload.name||''}</strong><p>{job.error||'等待联网同步'}</p>{job.payload.title&&<p>{job.payload.title}</p>}
 <Button type="button" variant="secondary" disabled={!online||busy} onClick={()=>void action(()=>retryOffline(job.id))}>重试同步</Button>
 <button type="button" className="text-btn" disabled={!online||busy} onClick={()=>{if(!confirm('移出同步队列？这不会删除服务器记录。'))return;
  if(job.kind==='json'&&job.path.includes('/records/')){
   const kind=job.path.includes('milestones')?'milestones':'growth',p=job.payload;
   const form={...p,weight:p.weight==null?'':String(p.weight),height:p.height==null?'':String(p.height),headCircumference:p.headCircumference==null?'':String(p.headCircumference),requestId:crypto.randomUUID()};
   const key='babymemo-draft-'+kind+'-'+p.babyId;
   if(job.method==='PATCH')localStorage.setItem(key+'-edit',JSON.stringify({id:job.path.split('/').at(-1),version:p.expectedUpdatedAt,form}));else if(job.method==='POST')localStorage.setItem(key,JSON.stringify(form));
   notify('内容已保留为本机草稿，重新进入对应宝宝的记录页查看。');
  }
  void action(()=>discardOffline(job.id));
 }}>保留草稿并移出队列</button></div>)}<Button variant="secondary" disabled={!online||busy} onClick={()=>void action(syncOffline)}>同步全部</Button></div>}
 </div>;
}
