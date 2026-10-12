import {useEffect,useState,type FormEvent} from 'react';
import {Card,Field,Primary,Pager} from '../../components/ui';
import {TrendingUp,BookHeart,Plus,Trash2} from 'lucide-react';
import {api,post,today,readDraft,emptyRecordForm,type BabyInfo,type RecordItem} from '../../lib/client';

export function RecordView({baby,kind,items,history,historyLimited,busy,setBusy,changed,notify,hasMore,page,setPage}:{baby:BabyInfo;kind:'growth'|'milestones';items:RecordItem[];history?:RecordItem[];historyLimited?:boolean;busy:boolean;setBusy:(v:boolean)=>void;changed:()=>void;notify:(v:string)=>void;hasMore:boolean;page:number;setPage:(v:number)=>void}){
 const draftKey='babymemo-draft-'+kind+'-'+baby.id;
 const [form,setForm]=useState(()=>readDraft(draftKey));
 const [offline,setOffline]=useState(()=>!navigator.onLine);
 useEffect(()=>{const refresh=()=>setOffline(!navigator.onLine);window.addEventListener('online',refresh);window.addEventListener('offline',refresh);return()=>{window.removeEventListener('online',refresh);window.removeEventListener('offline',refresh)}},[]);
 useEffect(()=>{setForm(readDraft(draftKey))},[draftKey]);
 useEffect(()=>{try{sessionStorage.setItem(draftKey,JSON.stringify(form))}catch{}},[draftKey,form]);
 async function save(e:FormEvent){e.preventDefault();if(offline){notify('当前离线：草稿保留在此浏览器标签页，联网后请重新点击保存');return}setBusy(true);try{
  const payload=kind==='growth'?{babyId:baby.id,requestId:form.requestId,day:form.day,weight:form.weight?Number(form.weight):null,height:form.height?Number(form.height):null,headCircumference:form.headCircumference?Number(form.headCircumference):null,notes:form.notes}:{babyId:baby.id,requestId:form.requestId,day:form.day,title:form.title,description:form.description};
  await post('/api/records/'+kind,payload);try{sessionStorage.removeItem(draftKey)}catch{}setForm(emptyRecordForm());notify('已保存到家庭记录');changed();
 }catch(e){notify(e instanceof Error?e.message:'保存失败')}finally{setBusy(false)}}
 async function remove(id:string){if(!confirm('移入回收站？30 天内可恢复。'))return;try{await api('/api/records/'+kind+'/'+id,{method:'DELETE'});changed();notify('已移入回收站，可在设置中恢复')}catch(e){notify(e instanceof Error?e.message:'删除失败')}}
 return <><div className="split-main"><Card><div className="section-title"><h3>{kind==='growth'?'新增测量':'记录一个第一次'}</h3><span className="icon-subtle">{kind==='growth'?<TrendingUp size={20}/>:<BookHeart size={20}/>}</span></div><form className="stack" onSubmit={save}>{offline&&<p className="hint" role="status">当前离线 · 草稿仅暂存于此标签页，联网后请手动保存</p>}<Field label="日期"><input type="date" max={today()} required value={form.day} onChange={e=>setForm({...form,day:e.target.value})}/></Field>
 {kind==='growth'?<><div className="two"><Field label="体重 · kg"><input type="number" min="0.1" max="150" step="0.01" placeholder="例如 9.5" value={form.weight} onChange={e=>setForm({...form,weight:e.target.value})}/></Field><Field label="身高 · cm"><input type="number" min="10" max="250" step="0.1" placeholder="例如 78" value={form.height} onChange={e=>setForm({...form,height:e.target.value})}/></Field></div><Field label="头围 · cm"><input type="number" min="10" max="100" step="0.1" placeholder="选填" value={form.headCircumference} onChange={e=>setForm({...form,headCircumference:e.target.value})}/></Field><Field label="备注"><textarea rows={3} placeholder="今天有什么新发现…" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field></>:<><Field label="事件标题"><input required maxLength={120} placeholder="第一次独立走路、第一次叫妈妈…" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></Field><Field label="故事内容"><textarea rows={4} placeholder="那个值得记住的瞬间…" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></Field></>}
 <Primary disabled={busy}>{busy?'正在保存…':<><Plus size={17}/> 保存记录</>}</Primary></form></Card>
 <Card><div className="section-title"><h3>记录时间线</h3><span className="muted small">最近 {items.length} 条</span></div><div className="timeline">{items.length?items.map(x=><div className="timeline-item" key={x.id}><div className="timeline-dot"/><div className="timeline-body"><div className="row-between"><time>{x.day}</time><button className="icon-btn" aria-label="删除" onClick={()=>void remove(x.id)}><Trash2 size={15}/></button></div><strong>{kind==='growth'?[x.weight!=null?'体重 '+x.weight+'kg':null,x.height!=null?'身高 '+x.height+'cm':null,x.head_circumference!=null?'头围 '+x.head_circumference+'cm':null].filter(Boolean).join(' · '):x.title}</strong><p>{kind==='growth'?x.notes:x.description}</p></div></div>):<div className="empty">还没有记录，左边可以创建第一条。</div>}</div><Pager page={page} setPage={setPage} hasMore={hasMore}/></Card></div>{kind==='growth'&&<GrowthChart items={history||items} limited={historyLimited}/>}</>;
}
function GrowthChart({items,limited}:{items:RecordItem[];limited?:boolean}){
 const [metric,setMetric]=useState<'weight'|'height'>('weight');
 const points=items.filter(x=>typeof x[metric]==='number').slice().sort((a,b)=>a.day.localeCompare(b.day));
 const values=points.map(p=>Number(p[metric]));
 const low=values.length?Math.min(...values):0,high=values.length?Math.max(...values):1;
 const spread=Math.max(0.2,high-low),min=low-spread*0.15,max=high+spread*0.15;
 const left=48,right=692,top=20,bottom=193;
 const dates=points.map(p=>Date.parse(p.day+'T00:00:00Z'));
 const earliest=dates[0]??0,latest=dates.at(-1)??earliest,span=Math.max(1,latest-earliest);
 const x=(i:number)=>points.length===1?(left+right)/2:left+(right-left)*(dates[i]-earliest)/span;
 const y=(v:number)=>bottom-(v-min)/(max-min)*(bottom-top);
 const poly=points.map((p,i)=>`${x(i)},${y(Number(p[metric]))}`).join(' ');
 return <Card className="growth-chart"><div className="section-title"><h3>成长趋势</h3><div className="chart-tabs"><button className={metric==='weight'?'active':''} onClick={()=>setMetric('weight')}>体重 · kg</button><button className={metric==='height'?'active':''} onClick={()=>setMetric('height')}>身高 · cm</button></div></div>{!points.length?<p className="empty">记录测量数据后，这里会显示变化趋势。</p>:<svg role="img" aria-label={`${metric==='weight'?'体重':'身高'}趋势，${points.length} 个测量点`} viewBox="0 0 720 235" className="growth-svg"><line x1={left} y1={bottom} x2={right} y2={bottom} stroke="#e8e8ed"/>{[0,1,2,3].map(step=>{const value=min+(max-min)*step/3;const yy=y(value);return <g key={step}><line x1={left} x2={right} y1={yy} y2={yy} stroke="#edf0f3" strokeDasharray="3 5"/><text x={left-10} y={yy+4} textAnchor="end" fontSize={12} fill="#87919f">{value.toFixed(1)}</text></g>})}{points.length>1&&<polyline points={poly} fill="none" stroke="#dd8068" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round"/>}{points.map((p,i)=><circle key={p.id} cx={x(i)} cy={y(Number(p[metric]))} r={4} fill="#df826c" stroke="#fff" strokeWidth={2}><title>{p.day}：{Number(p[metric])}{metric==='weight'?' kg':' cm'}</title></circle>)}<text x={left} y={226} fill="#8993a0" fontSize={11}>{points[0].day}</text><text x={right} y={226} fill="#8993a0" fontSize={11} textAnchor="end">{points.at(-1)?.day}</text></svg>}<p className="hint">横轴按真实测量日期绘制，展示历史记录（最多 2000 条）。{limited?'历史数据达到查询上限。':''}</p></Card>;
}
