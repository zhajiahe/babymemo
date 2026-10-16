import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Button,Card,Field,Primary,Pager,SegmentedControl,IconButton,ModalDialog} from '../../components/ui';
import {TrendingUp,BookHeart,Plus,Trash2,Pencil} from 'lucide-react';
import {api,post,today,readDraft,emptyRecordForm,type BabyInfo,type RecordItem} from '../../lib/client';
import {RecordFilterBar,type RecordFilters} from '../../components/RecordFilters';
import {MediaViewer,type MediaItem} from '../../components/MediaViewer';
import {mediaThumbnailUrl} from '../../private-media-cache.mjs';

type Form=ReturnType<typeof emptyRecordForm>;
export function RecordView({baby,kind,items,history,historyLimited,busy,setBusy,changed,notify,hasMore,page,setPage,filters,onFilters}:{baby:BabyInfo;kind:'growth'|'milestones';items:RecordItem[];history?:RecordItem[];historyLimited?:boolean;busy:boolean;setBusy:(v:boolean)=>void;changed:()=>void;notify:(v:string)=>void;hasMore:boolean;page:number;setPage:(v:number)=>void;filters:RecordFilters;onFilters:(value:RecordFilters)=>void}){
 const draftKey='babymemo-draft-'+kind+'-'+baby.id;
 const initial=()=>{try{const raw=localStorage.getItem(draftKey+'-edit');return raw?JSON.parse(raw):null}catch{return null}};
 const [editing,setEditing]=useState<{id:string;version:string;form:Form}|null>(initial);
 const [editorOpen,setEditorOpen]=useState(false),[createOpen,setCreateOpen]=useState(false);
 const [form,setForm]=useState<Form>(()=>initial()?.form||readDraft(draftKey,baby.time_zone));
 const [offline,setOffline]=useState(()=>!navigator.onLine),[selected,setSelected]=useState<MediaItem|null>(null);
 const storageWarning=useRef(false);
 useEffect(()=>{const refresh=()=>setOffline(!navigator.onLine);window.addEventListener('online',refresh);window.addEventListener('offline',refresh);return()=>{window.removeEventListener('online',refresh);window.removeEventListener('offline',refresh)}},[]);
 useEffect(()=>{try{localStorage.setItem(editing?draftKey+'-edit':draftKey,JSON.stringify(editing?{...editing,form}:form))}catch{if(!storageWarning.current){storageWarning.current=true;notify('本机存储不可用，关闭页面前请先完成保存。')}}},[draftKey,form,editing?.id]);
 function reset(){
  if(editing)localStorage.removeItem(draftKey+'-edit');
  const next=editing?readDraft(draftKey,baby.time_zone):emptyRecordForm(baby.time_zone);
  setEditing(null);setEditorOpen(false);setCreateOpen(false);setForm(next);
 }
 function edit(item:RecordItem){
  const next={...emptyRecordForm(baby.time_zone),day:item.day,weight:item.weight==null?'':String(item.weight),height:item.height==null?'':String(item.height),headCircumference:item.head_circumference==null?'':String(item.head_circumference),notes:item.notes||'',title:item.title||'',description:item.description||''};
  if(editing){
   setEditorOpen(true);
   if(editing.id!==item.id)notify('请先完成或取消当前记录的编辑，原有草稿已保留');
   return;
  }
  // Preserve the current unsaved creation draft before switching form state.
  try{localStorage.setItem(draftKey,JSON.stringify(form))}catch{notify('本机存储不可用，关闭页面前请保存草稿')}
  setCreateOpen(false);setEditing({id:item.id,version:item.updated_at||'',form:next});setForm(next);setEditorOpen(true);
 }
 async function save(event:FormEvent){event.preventDefault();if(busy)return;if(kind==='growth'&&![form.weight,form.height,form.headCircumference].some(Boolean)){notify('请填写至少一项体重、身高或头围');return}setBusy(true);try{
  const payload=kind==='growth'?{babyId:baby.id,requestId:form.requestId,day:form.day,weight:form.weight?Number(form.weight):null,height:form.height?Number(form.height):null,headCircumference:form.headCircumference?Number(form.headCircumference):null,notes:form.notes}:{babyId:baby.id,requestId:form.requestId,day:form.day,title:form.title,description:form.description};
  const result=editing?await api<{queued?:boolean}>('/api/records/'+kind+'/'+editing.id,{method:'PATCH',body:JSON.stringify({...payload,expectedUpdatedAt:editing.version})}):await post<{queued?:boolean}>('/api/records/'+kind,payload);
  localStorage.removeItem(editing?draftKey+'-edit':draftKey);reset();notify(result.queued?'已保存到本机，联网后自动同步':'已保存到家庭记录');changed();
 }catch(e){notify(e instanceof Error?e.message:'保存失败')}finally{setBusy(false)}}
 async function remove(id:string){if(!confirm('移入回收站？30 天内可恢复。'))return;try{const result=await api<{queued?:boolean}>('/api/records/'+kind+'/'+id,{method:'DELETE',body:JSON.stringify({babyId:baby.id})});if(editing?.id===id)reset();changed();notify(result.queued?'删除操作已保存在本机，联网后同步':'已移入回收站，可在设置中恢复')}catch(e){notify(e instanceof Error?e.message:'删除失败')}}
 async function reviewVersion(){if(!editing)return;try{const current=await api<RecordItem>('/api/records/'+kind+'/'+editing.id);const summary=kind==='growth'?[current.day,current.weight!=null?'体重 '+current.weight+'kg':'',current.height!=null?'身高 '+current.height+'cm':'',current.notes||''].filter(Boolean).join(' · '):[current.day,current.title,current.description].filter(Boolean).join(' · ');if(confirm('服务器当前记录：'+summary+'\n已保留你的草稿。确认核对后，允许用当前草稿保存修改？'))setEditing({...editing,version:current.updated_at||''})}catch(e){notify(e instanceof Error?e.message:'读取失败')}}
 const recordForm=<form className="stack" onSubmit={save}>
 {offline&&<p className="hint" role="status">当前离线 · 草稿保留在本机，保存后联网自动同步</p>}<Field label="日期"><input type="date" max={today(baby.time_zone)} required value={form.day} onChange={e=>setForm({...form,day:e.target.value})}/></Field>
 {kind==='growth'?<><div className="two"><Field label="体重 · kg"><input type="number" min="0.1" max="150" step="0.01" placeholder="例如 9.5" value={form.weight} onChange={e=>setForm({...form,weight:e.target.value})}/></Field><Field label="身高 · cm"><input type="number" min="10" max="250" step="0.1" placeholder="例如 78" value={form.height} onChange={e=>setForm({...form,height:e.target.value})}/></Field></div><Field label="头围 · cm"><input type="number" min="10" max="100" step="0.1" placeholder="选填" value={form.headCircumference} onChange={e=>setForm({...form,headCircumference:e.target.value})}/></Field><Field label="备注"><textarea rows={3} maxLength={1500} placeholder="今天有什么新发现…" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field></>:<><Field label="事件标题"><input required maxLength={120} placeholder="第一次独立走路、第一次叫妈妈…" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></Field><Field label="故事内容"><textarea rows={4} maxLength={3000} placeholder="那个值得记住的瞬间…" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></Field></>}
 <Primary disabled={busy}>{busy?'正在保存…':editing?'保存修改':<><Plus size={17}/> 保存记录</>}</Primary>{editing&&<><Button type="button" variant="secondary" disabled={busy||offline} onClick={()=>void reviewVersion()}>核对服务器版本（保留草稿）</Button><Button type="button" variant="secondary" disabled={busy} onClick={reset}>取消编辑</Button></>}</form>;
 return <>{kind==='growth'&&<div className="record-create-toolbar"><Button type="button" variant="primary" aria-haspopup="dialog" onClick={()=>setCreateOpen(true)} disabled={busy||!!editing}><Plus size={18}/>新增成长记录</Button></div>}{kind==='growth'&&<GrowthChart items={history||items} limited={historyLimited}/>}<RecordFilterBar value={filters} onChange={onFilters}/><div className="split-main record-layout">
 <Card><div className="section-title"><h3>记录时间线</h3><span className="muted small">本页 {items.length} 条</span></div><div className="timeline">{items.length?items.map(item=><div className="timeline-item" key={item.id}><div className="timeline-dot"/><div className="timeline-body"><div className="row-between"><time>{item.day}{item.pending&&<span className="pending-label"> · 待同步</span>}</time><div className="record-actions"><IconButton aria-label="编辑记录" disabled={busy} onClick={()=>edit(item)}><Pencil size={16}/></IconButton><IconButton aria-label="删除" disabled={busy} onClick={()=>void remove(item.id)}><Trash2 size={16}/></IconButton></div></div><strong>{kind==='growth'?[item.weight!=null?'体重 '+item.weight+'kg':null,item.height!=null?'身高 '+item.height+'cm':null,item.head_circumference!=null?'头围 '+item.head_circumference+'cm':null].filter(Boolean).join(' · '):item.title}</strong><p>{kind==='growth'?item.notes:item.description}</p>
 {!!item.media?.length&&<div className="moment-media">{item.media.map(media=><button type="button" key={media.id} aria-label={'预览 '+media.day+' 的媒体'} onClick={()=>setSelected(media)}>{media.mime.startsWith('image/')||media.thumbnail_ready?<img src={mediaThumbnailUrl(media)} alt="成长瞬间照片" loading="lazy"/>:<span>查看视频</span>}</button>)}</div>}
 </div></div>):<div className="empty">没有符合条件的记录，可以清除筛选或新增记录。</div>}</div><Pager page={page} setPage={setPage} hasMore={hasMore}/></Card>
 <div className="record-editor-side">
  {!editing?kind==='growth'?null:<Card><div className="section-title"><h3>记录一个第一次</h3><span className="icon-subtle"><BookHeart size={20}/></span></div>{recordForm}</Card>
  :<Card className="record-resume-card"><div className="section-title"><h3>待完成的记录编辑</h3></div><p className="muted">修改草稿已保留在这台设备。继续编辑或取消后可新增记录。</p><div className="bm-modal-actions"><Button variant="primary" onClick={()=>setEditorOpen(true)}>继续编辑</Button><Button variant="secondary" disabled={busy} onClick={reset}>取消编辑</Button></div></Card>}
 </div>
 </div> <ModalDialog open={kind==='growth'&&!editing&&createOpen} onClose={()=>setCreateOpen(false)} busy={busy} title="新增成长记录">{recordForm}</ModalDialog>
 <ModalDialog open={!!editing&&editorOpen} onClose={()=>setEditorOpen(false)} busy={busy} title={kind==='growth'?'编辑成长记录':'编辑成长瞬间'}>
  {recordForm}
 </ModalDialog>{selected&&<MediaViewer item={selected} index={0} count={1} onNavigate={()=>{}} onClose={()=>setSelected(null)} onSave={async value=>{const result=await api<{id?:string;queued?:boolean;updated_at?:string}>('/api/media/'+selected.id,{method:'PATCH',body:JSON.stringify({...value,babyId:baby.id,expectedUpdatedAt:value.expectedUpdatedAt??selected.updated_at??''})});setSelected({...selected,...value,updated_at:result.queued?'pending:'+result.id:result.updated_at});changed();notify(result.queued?'修改已保存在本机，联网后同步':'照片信息已更新');return result}} onDelete={()=>{if(confirm('移入回收站？30 天内可恢复。'))void api('/api/media/'+selected.id,{method:'DELETE',body:JSON.stringify({babyId:baby.id})}).then(()=>{setSelected(null);changed()}).catch(e=>notify(e.message))}} onThumbnailSaved={(id,updatedAt)=>{setSelected(current=>current?.id===id?{...current,thumbnail_ready:1,...(updatedAt?{updated_at:updatedAt}:{})}:current);changed();notify('视频封面已更新')}}/>}</>;
}
export function GrowthChart({items,limited}:{items:RecordItem[];limited?:boolean}){
 const [metric,setMetric]=useState<'weight'|'height'>('weight');
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const points=items.filter(x=>typeof x[metric]==='number').slice().sort((a,b)=>a.day.localeCompare(b.day));
 const values=points.map(p=>Number(p[metric]));
 const low=values.length?Math.min(...values):0,high=values.length?Math.max(...values):1;
 const spread=Math.max(0.2,high-low),min=low-spread*0.15,max=high+spread*0.15;
 const left=48,right=692,top=20,bottom=193;
 const dates=points.map(p=>Date.parse(p.day+'T00:00:00Z'));
 const earliest=dates[0]??0,latest=dates.at(-1)??earliest,span=Math.max(1,latest-earliest);
 const x=(i:number)=>points.length===1?(left+right)/2:left+(right-left)*(dates[i]-earliest)/span;
 const y=(v:number)=>bottom-(v-min)/(max-min)*(bottom-top);
 const poly=points.map((p,i)=>String(x(i))+','+String(y(Number(p[metric])))).join(' ');
 const selected=points.find(p=>p.id===selectedId)||points.at(-1);
 const unit=metric==='weight'?'kg':'cm';
 const metricName=metric==='weight'?'体重':'身高';
 return <Card className="growth-chart">
  <div className="section-title"><h3>成长趋势</h3><SegmentedControl className="chart-tabs" label="成长曲线指标" value={metric} onChange={next=>{setMetric(next);setSelectedId(null)}} options={[{value:'weight' as const,label:'体重 · kg'},{value:'height' as const,label:'身高 · cm'}]} /></div>
  {!points.length?<p className="empty">记录测量数据后，这里会显示变化趋势。</p>:<>
   <div className="growth-latest"><span>{selectedId&&selected?.id===selectedId?'选中测量':'最近一次测量'}</span><strong>{Number(selected?.[metric])} <small>{unit}</small></strong><time>{selected?.day}</time></div>
   <svg role="img" aria-label={metricName+'趋势，'+points.length+' 个测量点，点击数据点查看详细数值'} viewBox="0 0 720 235" className="growth-svg">
    <line x1={left} y1={bottom} x2={right} y2={bottom} stroke="var(--bm-chart-grid)"/>
    {[0,1,2,3].map(step=>{const value=min+(max-min)*step/3;const yy=y(value);return <g key={step}><line x1={left} x2={right} y1={yy} y2={yy} stroke="var(--bm-chart-grid)" strokeDasharray="3 5"/><text x={left-10} y={yy+4} textAnchor="end" fontSize={12} fill="var(--bm-chart-axis)">{value.toFixed(1)}</text></g>})}
    {points.length>1&&<><polygon points={left+','+bottom+' '+poly+' '+right+','+bottom} fill="var(--bm-chart-area)" stroke="none"/><polyline points={poly} fill="none" stroke="var(--bm-chart-line)" strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round"/></>}
    {points.map((p,i)=><g key={p.id} role="button" tabIndex={0} aria-label={p.day+'：'+Number(p[metric])+' '+unit} onClick={()=>setSelectedId(p.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelectedId(p.id)}}}>
     <circle cx={x(i)} cy={y(Number(p[metric]))} r={22} fill="transparent"/>
     {selected?.id===p.id&&<circle cx={x(i)} cy={y(Number(p[metric]))} r={11} fill="var(--bm-chart-area)" stroke="var(--bm-chart-dot)" strokeWidth={1.5}/>}
     <circle cx={x(i)} cy={y(Number(p[metric]))} r={selected?.id===p.id?6:4.5} fill="var(--bm-chart-dot)" stroke="var(--bm-surface)" strokeWidth={2}/>
     <title>{p.day+'：'+Number(p[metric])+' '+unit}</title>
    </g>)}
    <text x={left} y={226} fill="var(--bm-chart-axis)" fontSize={11}>{points[0].day}</text><text x={right} y={226} fill="var(--bm-chart-axis)" fontSize={11} textAnchor="end">{points.at(-1)?.day}</text>
   </svg>
   <p className="chart-detail" aria-live="polite">点击曲线上的点，可查看对应测量日期与数值。</p>
  </>}
  {limited&&<p className="hint">历史记录较多，当前展示最近 2000 条。</p>}
 </Card>;
}
