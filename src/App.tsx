import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Card, Field, Logo, Notice, Pager, Primary } from './components/ui';
import { MediaViewer, type MediaItem } from './components/MediaViewer';
import { createAlbumThumbnail, fingerprintFile } from './media-upload';
import { pickMatchingUpload, remainingPartNumbers } from './upload-plan.mjs';
import { Baby, BookHeart, CalendarDays, Camera, Check, ChevronRight, CloudUpload, Heart, LogOut, MessageCircle, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles, Trash2, TrendingUp, WandSparkles, Wifi, WifiOff } from 'lucide-react';

type BabyInfo={id:string;name:string;birthday:string;gender:string;time_zone:string;allergies:string;notes:string};
type State={ownerName:string;familyName:string;babies:BabyInfo[];counts:{growth:number;milestones:number;media:number};openrouter:{configured:boolean;model:string};wechat:{connected:boolean;enabled:boolean}};
type Tab='overview'|'growth'|'moments'|'album'|'assistant'|'settings';
type RecordItem={id:string;day:string;weight?:number|null;height?:number|null;head_circumference?:number|null;title?:string;description?:string;notes?:string};
class ApiFailure extends Error { constructor(readonly status:number,message:string){super(message);this.name='ApiFailure'} }
async function api<T=any>(url:string, init?:RequestInit):Promise<T>{
 const r=await fetch(url,{credentials:'same-origin',...init,headers:{...(init?.body&&!(init.body instanceof Blob)?{'Content-Type':'application/json'}:{}),...init?.headers}});
 let data:any={};try{data=await r.json();}catch{}
 if(!r.ok)throw new ApiFailure(r.status,typeof data.error==='string'?data.error:'HTTP_'+r.status);
 return data as T;
}
async function post<T=any>(url:string,body:unknown):Promise<T>{return api<T>(url,{method:'POST',body:JSON.stringify(body)})}
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
const years=(date:string)=>{
 const days=Math.max(0,Math.floor((Date.now()-new Date(date+'T00:00:00+08:00').getTime())/86400000));
 return days<31?days+' 天':Math.floor(days/30.44)+' 个月';
};
function Gate({onReady}:{onReady:()=>void}){
 const [mode,setMode]=useState<'loading'|'setup'|'login'|'unavailable'>('loading');
 const [ready,setReady]=useState({sessionConfigured:false,encryptionConfigured:false});
 const [form,setForm]=useState({ownerName:'',password:'',familyName:'',babyName:'',birthday:'',gender:'girl',timeZone:'Asia/Shanghai',allergies:''});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{api<any>('/api/bootstrap/status').then(v=>{setReady(v);setMode(v.initialized?'login':'setup')}).catch(()=>{setMode('unavailable');setError('无法连接后端，请检查 Cloudflare 部署和 D1 迁移。')})},[]);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');
  try{await post(mode==='setup'?'/api/bootstrap':'/api/login',mode==='setup'?form:{name:form.ownerName,password:form.password});onReady();}
  catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}
 }
 return <div className="gate"><div className="gate-intro"><Logo/><h1>成长的每一刻，<br/>都值得被珍藏。</h1><p>一个安静、私密、为家人打造的成长空间。<br/>照片、第一次、身高体重，都在这里。</p><div className="gate-mark"><Heart size={36} fill="currentColor"/></div></div>
 <div className="gate-panel"><div className="gate-card"><div className="eyebrow">{mode==='setup'?'FIRST TIME SETUP':'WELCOME BACK'}</div><h2>{mode==='setup'?'创建你的家庭空间':'欢迎回家'}</h2><p className="muted">{mode==='setup'?'完成以下必填信息后，才会开放记录功能。':'使用你初始化时设置的家庭账号登录。'}</p>
 {mode==='loading'?<div className="skeleton">正在检查服务状态…</div>:mode==='unavailable'?<div className="stack"><div className="error" role="alert">{error}</div><button className="secondary" onClick={()=>location.reload()}><RefreshCw size={15}/>重新检查</button></div>:<form onSubmit={submit} className="stack">
 {mode==='setup'&&<><div className="setup-check">{[['会话密钥',ready.sessionConfigured],['加密密钥',ready.encryptionConfigured]].map(([label,ok])=><span key={String(label)} className={ok?'good':'bad'}>{ok?<Check size={13}/>:<WifiOff size={13}/>} {label}</span>)}</div><p className="setup-security-note">首次访问未初始化实例的人可以创建管理员。请部署后立即完成初始化；如需限制访问，请提前为站点启用 Cloudflare Access。</p></>}
 <>{mode==='setup'&&<Field label="家庭名称（必填）"><input required maxLength={80} value={form.familyName} onChange={e=>setForm({...form,familyName:e.target.value})} placeholder="例如：我们的温暖小家"/></Field>}<Field label={mode==='setup'?'管理员登录名':'管理员登录名'}><input required value={form.ownerName} autoComplete="username" onChange={e=>setForm({...form,ownerName:e.target.value})} placeholder="例如：爸爸 / 妈妈"/></Field>
 </><Field label="家庭密码"><input type="password" autoComplete={mode==='setup'?'new-password':'current-password'} minLength={mode==='setup'?6:1} required value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder={mode==='setup'?'至少 6 位字符（可使用数字）':'输入家庭密码'}/></Field>
 {mode==='setup'&&<><div className="form-divider"><span>宝宝档案</span></div><div className="two"><Field label="宝宝名字"><input required value={form.babyName} onChange={e=>setForm({...form,babyName:e.target.value})} placeholder="宝宝昵称"/></Field><Field label="性别"><select value={form.gender} onChange={e=>setForm({...form,gender:e.target.value})}><option value="girl">女孩</option><option value="boy">男孩</option><option value="other">暂不填写</option></select></Field></div>
 <Field label="出生日期"><input type="date" required max={today()} value={form.birthday} onChange={e=>setForm({...form,birthday:e.target.value})}/></Field>
 <Field label="家庭时区"><select value={form.timeZone} onChange={e=>setForm({...form,timeZone:e.target.value})}><option value="Asia/Shanghai">中国标准时间 · UTC+8</option><option value="Asia/Tokyo">日本标准时间 · UTC+9</option><option value="America/Los_Angeles">美国太平洋时间</option></select></Field>
 <Field label="已知过敏信息（可选）"><input value={form.allergies} onChange={e=>setForm({...form,allergies:e.target.value})} placeholder="可稍后补充"/></Field></>}
 {error&&<div className="error" role="alert">{error}</div>}
 <Primary disabled={busy||(mode==='setup'&&(!ready.sessionConfigured||!ready.encryptionConfigured))}>{busy?'正在处理…':mode==='setup'?'完成初始化':'登录我的空间'}<ChevronRight size={17}/></Primary>
 </form>}
 {mode==='setup'&&<div className="setup-guide"><strong>部署检查 · 2 个必需 Secret</strong><p>仅需 <code>SESSION_SECRET</code> 和 <code>DATA_KEY</code>。每个密钥分别用 <code>openssl rand -hex 32</code> 生成，再通过 GitHub Actions 同步或在 Cloudflare Worker 设置中配置。</p><p>配置完成后刷新页面，两项检查通过即可设置家庭管理员和密码；已存在的账号不会被重置。</p><a href="https://github.com/zhajiahe/babymemo/blob/main/docs/DEPLOY.md" target="_blank" rel="noreferrer">查看部署指南 ↗</a></div>}</div></div></div>;
}
function Nav({active,setActive,logout}:{active:Tab;setActive:(t:Tab)=>void;logout:()=>void}){
 const sections:[Tab,string,ReactNode][]=[['overview','概览',<Baby size={19}/>],['growth','成长曲线',<TrendingUp size={19}/>],['moments','成长瞬间',<BookHeart size={19}/>],['album','家庭相册',<Camera size={19}/>],['assistant','AI 助手',<Sparkles size={19}/>],['settings','设置',<Settings2 size={19}/>]];
 return <><aside className="sidebar"><Logo/><div className="side-label">MY SPACE</div><nav>{sections.map(([tab,label,icon])=><button className={'nav-link '+(tab===active?'active':'')} key={tab} type="button" aria-current={tab===active?'page':undefined} onClick={()=>setActive(tab)}>{icon}{label}{tab===active&&<span className="active-dot"/>}</button>)}</nav><div className="sidebar-bottom"><div className="privacy"><ShieldCheck size={16}/> 私密家庭空间</div><button className="nav-link" onClick={logout}><LogOut size={18}/> 安全退出</button></div></aside><nav className="mobile-nav">{sections.map(([tab,label,icon])=><button key={tab} type="button" aria-label={label} aria-current={tab===active?'page':undefined} onClick={()=>setActive(tab)} className={tab===active?'active':''}>{icon}<span>{label.replace('成长','')}</span></button>)}</nav></>;
}
export default function App(){
 const [mode,setMode]=useState<'loading'|'gate'|'app'|'unavailable'>('loading');
 const [state,setState]=useState<State|null>(null),[active,setActive]=useState<Tab>('overview'),[babyId,setBabyId]=useState(''),[toast,setToast]=useState('');
 const [records,setRecords]=useState<RecordItem[]>([]),[milestones,setMilestones]=useState<RecordItem[]>([]),[media,setMedia]=useState<MediaItem[]>([]);
 const [growthPage,setGrowthPage]=useState(0),[momentPage,setMomentPage]=useState(0),[albumPage,setAlbumPage]=useState(0);
 const [hasMore,setHasMore]=useState({growth:false,moments:false,album:false});
 const [busy,setBusy]=useState(false);
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(timer)},[toast]);
 const baby=state?.babies.find(b=>b.id===babyId)||state?.babies[0];
 async function refresh(){
  try{const v=await api<State>('/api/state');setState(v);setBabyId(old=>old&&v.babies.some(x=>x.id===old)?old:(v.babies[0]?.id||''));setMode('app');}
  catch(e){if(e instanceof ApiFailure&&e.status===401){setMode('gate');setState(null);}else{setToast('连接暂时中断，已保留当前页面。请检查网络并重试。');setMode(old=>old==='loading'?'unavailable':old);}}
 }
 useEffect(()=>{refresh()},[]);
 // Load only the resource required by the active view; avoid three D1 reads on
 // every navigation. Ignore late responses when baby or tab changes.
 useEffect(()=>{
  if(!baby?.id)return;
  let cancelled=false;
  const id=encodeURIComponent(baby.id);
  const loads:Promise<void>[]=[];
  if(active==='overview'||active==='growth'){
   loads.push(api<{items:RecordItem[];hasMore:boolean}>('/api/records/growth?babyId='+id+'&page='+growthPage)
    .then(r=>{if(!cancelled){setRecords(r.items);setHasMore(p=>({...p,growth:r.hasMore}))}}));
  }
  if(active==='overview'||active==='moments'){
   loads.push(api<{items:RecordItem[];hasMore:boolean}>('/api/records/milestones?babyId='+id+'&page='+momentPage)
    .then(r=>{if(!cancelled){setMilestones(r.items);setHasMore(p=>({...p,moments:r.hasMore}))}}));
  }
  if(active==='album'){
   loads.push(api<{items:MediaItem[];hasMore:boolean}>('/api/media?babyId='+id+'&page='+albumPage)
    .then(r=>{if(!cancelled){setMedia(r.items);setHasMore(p=>({...p,album:r.hasMore}))}}));
  }
  void Promise.all(loads).catch(e=>{if(!cancelled)setToast(e instanceof Error?e.message:'数据读取失败')});
  return ()=>{cancelled=true};
 },[active,baby?.id,growthPage,momentPage,albumPage,state?.counts.growth,state?.counts.milestones,state?.counts.media]);
 function changed(){void refresh();setGrowthPage(0);setMomentPage(0);setAlbumPage(0);}
 async function logout(){await post('/api/logout',{});setMode('gate');setState(null)}
 if(mode==='loading')return <div className="loading-screen"><Logo/><div>正在载入家庭空间…</div></div>;
 if(mode==='gate')return <Gate onReady={()=>void refresh()}/>;
 if(mode==='unavailable')return <div className="loading-screen"><Logo/><p>暂时无法连接家庭空间，已保留你的会话。</p><button className="secondary" onClick={()=>void refresh()}><RefreshCw size={16}/>重新连接</button></div>;
 if(!state||!baby)return <div className="loading-screen">家庭空间中暂无宝宝档案</div>;
 const titles:Record<Tab,string>={overview:'每一刻，都很珍贵',growth:'成长记录',moments:'小小里程碑',album:'家庭相册',assistant:'AI 成长助手',settings:'空间设置'};
 return <div className="app"><Nav active={active} setActive={setActive} logout={logout}/><main className="workspace"><div className="topbar"><div className="crumb">{state.familyName||'家庭空间'} <ChevronRight size={14}/> <strong>{titles[active]}</strong></div><div className="top-right"><span className="secure"><ShieldCheck size={14}/> 仅家人可见</span><div className="avatar">{state.ownerName.slice(0,1)}</div></div></div>
 <div className="page"><header className="page-heading"><div><div className="eyebrow">BABYMEMO / {active.toUpperCase()}</div><h1>{titles[active]}</h1><p className="muted">{active==='overview'?'把日常小事，变成以后回望的宝藏。':baby.name+' · '+years(baby.birthday)+' · 记录属于你们的故事'}</p></div><div className="baby-pill"><Heart size={15} fill="currentColor"/><select aria-label="选择宝宝" value={baby.id} onChange={e=>{setBabyId(e.target.value);setGrowthPage(0);setMomentPage(0);setAlbumPage(0)}}>{state.babies.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div></header>
 {active==='overview'&&<><section className="welcome"><div className="welcome-content"><div className="eyebrow">OUR LITTLE STORY</div><h2>{baby.name}，<br/>今天也在闪闪发光。</h2><p>从 {baby.birthday} 开始，已陪伴我们 {years(baby.birthday)}。<br/>愿每个寻常的日子，都留下一点温暖。</p><button className="light-btn" onClick={()=>setActive('moments')}><Plus size={16}/>记下一个瞬间</button></div><div className="welcome-art"><span>✳</span><Heart fill="currentColor" size={84}/><i>♡</i></div></section>
 <div className="stats"><Card><div className="stat-icon peach"><TrendingUp size={20}/></div><div className="stat-value">{state.counts.growth}</div><div className="muted">成长记录</div></Card><Card><div className="stat-icon lavender"><BookHeart size={20}/></div><div className="stat-value">{state.counts.milestones}</div><div className="muted">珍贵时刻</div></Card><Card><div className="stat-icon mint"><Camera size={20}/></div><div className="stat-value">{state.counts.media}</div><div className="muted">相册回忆</div></Card></div>
 <div className="two-panels"><Card><div className="section-title"><h3>最近的成长</h3><button className="text-btn" onClick={()=>setActive('growth')}>查看全部 <ChevronRight size={15}/></button></div>{records.slice(0,4).map(x=><div className="event" key={x.id}><span className="event-date">{x.day}</span><span>{[x.weight!=null?x.weight+' kg':null,x.height!=null?x.height+' cm':null].filter(Boolean).join(' · ')||'成长测量'}</span></div>)}{!records.length&&<div className="empty">还没有成长记录，记下第一次测量吧。</div>}</Card>
 <Card><div className="section-title"><h3>闪光的时刻</h3><button className="text-btn" onClick={()=>setActive('moments')}>查看全部 <ChevronRight size={15}/></button></div>{milestones.slice(0,4).map(x=><div className="event" key={x.id}><span className="event-date">{x.day}</span><span>{x.title}</span></div>)}{!milestones.length&&<div className="empty">成长中的惊喜，从现在开始收藏。</div>}</Card></div></>}
 {active==='growth'&&<RecordView baby={baby} kind="growth" items={records} busy={busy} setBusy={setBusy} changed={changed} notify={setToast} hasMore={hasMore.growth} page={growthPage} setPage={setGrowthPage}/>}
 {active==='moments'&&<RecordView baby={baby} kind="milestones" items={milestones} busy={busy} setBusy={setBusy} changed={changed} notify={setToast} hasMore={hasMore.moments} page={momentPage} setPage={setMomentPage}/>}
 {active==='album'&&<Album baby={baby} media={media} mediaEdited={(id,value)=>setMedia(items=>items.map(item=>item.id===id?{...item,...value}:item))} changed={changed} notify={setToast} hasMore={hasMore.album} page={albumPage} setPage={setAlbumPage}/>}
 {active==='assistant'&&<Assistant configured={state.openrouter.configured} babyId={baby.id} setActive={setActive}/>}
 {active==='settings'&&<Settings state={state} baby={baby} changed={changed} notify={setToast}/>}
 <footer className="footer">BabyMemo · 用爱记录，用心珍藏 <Heart size={13}/></footer>
 </div></main>{toast&&<Notice text={toast} onClose={()=>setToast('')}/>}</div>;
}
function RecordView({baby,kind,items,busy,setBusy,changed,notify,hasMore,page,setPage}:{baby:BabyInfo;kind:'growth'|'milestones';items:RecordItem[];busy:boolean;setBusy:(v:boolean)=>void;changed:()=>void;notify:(v:string)=>void;hasMore:boolean;page:number;setPage:(v:number)=>void}){
 const [form,setForm]=useState({day:today(),weight:'',height:'',headCircumference:'',notes:'',title:'',description:''});
 async function save(e:FormEvent){e.preventDefault();setBusy(true);try{
  const payload=kind==='growth'?{babyId:baby.id,day:form.day,weight:form.weight?Number(form.weight):null,height:form.height?Number(form.height):null,headCircumference:form.headCircumference?Number(form.headCircumference):null,notes:form.notes}:{babyId:baby.id,day:form.day,title:form.title,description:form.description};
  await post('/api/records/'+kind,payload);setForm({day:today(),weight:'',height:'',headCircumference:'',notes:'',title:'',description:''});notify('已保存到家庭记录');changed();
 }catch(e){notify(e instanceof Error?e.message:'保存失败')}finally{setBusy(false)}}
 async function remove(id:string){if(!confirm('确定要删除这条记录吗？'))return;await api('/api/records/'+kind+'/'+id,{method:'DELETE'});changed()}
 return <><div className="split-main"><Card><div className="section-title"><h3>{kind==='growth'?'新增测量':'记录一个第一次'}</h3><span className="icon-subtle">{kind==='growth'?<TrendingUp size={20}/>:<BookHeart size={20}/>}</span></div><form className="stack" onSubmit={save}><Field label="日期"><input type="date" max={today()} required value={form.day} onChange={e=>setForm({...form,day:e.target.value})}/></Field>
 {kind==='growth'?<><div className="two"><Field label="体重 · kg"><input type="number" min="0.1" max="150" step="0.01" placeholder="例如 9.5" value={form.weight} onChange={e=>setForm({...form,weight:e.target.value})}/></Field><Field label="身高 · cm"><input type="number" min="10" max="250" step="0.1" placeholder="例如 78" value={form.height} onChange={e=>setForm({...form,height:e.target.value})}/></Field></div><Field label="头围 · cm"><input type="number" min="10" max="100" step="0.1" placeholder="选填" value={form.headCircumference} onChange={e=>setForm({...form,headCircumference:e.target.value})}/></Field><Field label="备注"><textarea rows={3} placeholder="今天有什么新发现…" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field></>:<><Field label="事件标题"><input required maxLength={120} placeholder="第一次独立走路、第一次叫妈妈…" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></Field><Field label="故事内容"><textarea rows={4} placeholder="那个值得记住的瞬间…" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></Field></>}
 <Primary disabled={busy}>{busy?'正在保存…':<><Plus size={17}/> 保存记录</>}</Primary></form></Card>
 <Card><div className="section-title"><h3>记录时间线</h3><span className="muted small">最近 {items.length} 条</span></div><div className="timeline">{items.length?items.map(x=><div className="timeline-item" key={x.id}><div className="timeline-dot"/><div className="timeline-body"><div className="row-between"><time>{x.day}</time><button className="icon-btn" aria-label="删除" onClick={()=>void remove(x.id)}><Trash2 size={15}/></button></div><strong>{kind==='growth'?[x.weight!=null?'体重 '+x.weight+'kg':null,x.height!=null?'身高 '+x.height+'cm':null,x.head_circumference!=null?'头围 '+x.head_circumference+'cm':null].filter(Boolean).join(' · '):x.title}</strong><p>{kind==='growth'?x.notes:x.description}</p></div></div>):<div className="empty">还没有记录，左边可以创建第一条。</div>}</div><Pager page={page} setPage={setPage} hasMore={hasMore}/></Card></div>{kind==='growth'&&<GrowthChart items={items}/>}</>;
}
function GrowthChart({items}:{items:RecordItem[]}){
 const [metric,setMetric]=useState<'weight'|'height'>('weight');
 const points=items.filter(x=>typeof x[metric]==='number').slice().reverse();
 const values=points.map(p=>Number(p[metric]));
 const low=values.length?Math.min(...values):0,high=values.length?Math.max(...values):1;
 const spread=Math.max(0.2,high-low),min=low-spread*0.15,max=high+spread*0.15;
 const left=48,right=692,top=20,bottom=193;
 const x=(i:number)=>points.length===1?(left+right)/2:left+(right-left)*i/(points.length-1);
 const y=(v:number)=>bottom-(v-min)/(max-min)*(bottom-top);
 const poly=points.map((p,i)=>`${x(i)},${y(Number(p[metric]))}`).join(' ');
 return <Card className="growth-chart"><div className="section-title"><h3>成长趋势</h3><div className="chart-tabs"><button className={metric==='weight'?'active':''} onClick={()=>setMetric('weight')}>体重 · kg</button><button className={metric==='height'?'active':''} onClick={()=>setMetric('height')}>身高 · cm</button></div></div>{!points.length?<p className="empty">记录测量数据后，这里会显示变化趋势。</p>:<svg role="img" aria-label={`${metric==='weight'?'体重':'身高'}趋势，${points.length} 个测量点`} viewBox="0 0 720 235" className="growth-svg"><line x1={left} y1={bottom} x2={right} y2={bottom} stroke="#e8e8ed"/>{[0,1,2,3].map(step=>{const value=min+(max-min)*step/3;const yy=y(value);return <g key={step}><line x1={left} x2={right} y1={yy} y2={yy} stroke="#edf0f3" strokeDasharray="3 5"/><text x={left-10} y={yy+4} textAnchor="end" fontSize={12} fill="#87919f">{value.toFixed(1)}</text></g>})}{points.length>1&&<polyline points={poly} fill="none" stroke="#dd8068" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round"/>}{points.map((p,i)=><circle key={p.id} cx={x(i)} cy={y(Number(p[metric]))} r={4} fill="#df826c" stroke="#fff" strokeWidth={2}><title>{p.day}：{Number(p[metric])}{metric==='weight'?' kg':' cm'}</title></circle>)}<text x={left} y={226} fill="#8993a0" fontSize={11}>{points[0].day}</text><text x={right} y={226} fill="#8993a0" fontSize={11} textAnchor="end">{points.at(-1)?.day}</text></svg>}<p className="hint">展示当前页中有测量值的记录；支持切换体重与身高。</p></Card>;
}
function Album({baby,media,mediaEdited,changed,notify,hasMore,page,setPage}:{baby:BabyInfo;media:MediaItem[];mediaEdited:(id:string,value:{title:string;day:string})=>void;changed:()=>void;notify:(v:string)=>void;hasMore:boolean;page:number;setPage:(v:number)=>void}){
 const [uploading,setUploading]=useState(false),[progress,setProgress]=useState('');
 const [selected,setSelected]=useState<MediaItem|null>(null);
 useEffect(()=>{setSelected(null)},[baby.id]);
 type PendingUpload={id:string;day:string;title:string;mime:string;size:number;fingerprint:string;completedParts:number[];created_at:string};
 const [pending,setPending]=useState<PendingUpload[]>([]);
 async function refreshPending(){
  const response=await api<{items:PendingUpload[]}>('/api/upload/pending?babyId='+encodeURIComponent(baby.id));
  setPending(response.items);
  return response.items;
 }
 useEffect(()=>{
  let live=true;
  void api<{items:PendingUpload[]}>('/api/upload/pending?babyId='+encodeURIComponent(baby.id))
    .then(response=>{if(live)setPending(response.items)})
    .catch(()=>{if(live)setPending([])});
  return()=>{live=false};
 },[baby.id]);
 async function finishPending(id:string){
  if(uploading)return;
  setUploading(true);
  try{
   await post('/api/upload/'+id+'/finish',{});
   await refreshPending();
   changed();
   notify('上传已完成，照片或视频已保存。');
  }catch(e){notify(e instanceof Error?e.message:'保存失败，可稍后重试')}
  finally{setUploading(false)}
 }
 async function discard(id:string){
  if(uploading||!confirm('确定取消这项未完成的上传吗？已上传的分片会被删除。'))return;
  try{
   await post('/api/upload/'+id+'/cancel',{});
   await refreshPending();
   notify('已取消未完成上传');
  }catch(e){notify(e instanceof Error?e.message:'取消失败')}
 }
 async function upload(files:File[]){
  if(!files.length||uploading)return;
  setUploading(true);
  try{
   let queue=await refreshPending();
   for(const file of files){
    let uploadId:string|undefined;
    try{
     if(file.size<1||file.size>209715200)throw Error('文件大小需在 1B～200MB 之间');
     const extension=file.name.toLowerCase().match(/\.(heic|heif|jpg|jpeg|png|webp|gif|mov|mp4|webm)$/)?.[1];
     const formats:Record<string,string>={heic:'image/heic',heif:'image/heif',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',mov:'video/quicktime',mp4:'video/mp4',webm:'video/webm'};
     const mime=file.type||(extension?formats[extension]:'application/octet-stream');
     setProgress(file.name+' · 正在检查分片');
     const fingerprint=await fingerprintFile(file);
     const existing=pickMatchingUpload(queue,{title:file.name.slice(0,120),size:file.size,mime,fingerprint}) as PendingUpload|undefined;
     const session=existing||await post<{id:string;chunkSize:number}>('/api/upload/start',{babyId:baby.id,day:today(),title:file.name,mime,size:file.size,fingerprint});
     uploadId=session.id;
     const chunkSize=8388608;
     const total=Math.ceil(file.size/chunkSize);
     const numbers=remainingPartNumbers(total,existing?.completedParts||[]);
     const completed=new Set(existing?.completedParts||[]);
     if(existing)notify('找到上次的上传，正在续传：'+file.name);
     let next=0,failed=false;
     const sendPart=async(number:number)=>{
      const part=file.slice((number-1)*chunkSize,Math.min(file.size,number*chunkSize));
      for(let attempt=0;attempt<3;attempt++){
       try{
        await api('/api/upload/'+uploadId+'/part/'+number,{method:'PUT',body:part,headers:{'Content-Type':'application/octet-stream'}});
        return;
       }catch(error){
        if(attempt===2||error instanceof ApiFailure&&[400,401,403,404,413].includes(error.status))throw error;
        await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
       }
      }
     };
     const concurrency=window.matchMedia('(pointer:coarse)').matches?2:3;
     const jobs=Array.from({length:Math.min(concurrency,numbers.length)},async()=>{
      while(!failed&&next<numbers.length){
       const number=numbers[next++];
       try{
        await sendPart(number);
        completed.add(number);
        setProgress(file.name+' · '+Math.round(completed.size/total*100)+'%');
       }catch(error){failed=true;throw error}
      }
     });
     const results=await Promise.allSettled(jobs);
     const rejection=results.find((x):x is PromiseRejectedResult=>x.status==='rejected');
     if(rejection)throw rejection.reason;
     setProgress(file.name+' · 正在保存原文件');
     for(let attempt=0;attempt<3;attempt++){
      try{await post('/api/upload/'+uploadId+'/finish',{});break;}
      catch(error){
       if(attempt===2||error instanceof ApiFailure&&[400,401,403,404,409].includes(error.status))throw error;
       await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
      }
     }
     uploadId=undefined;
     queue=queue.filter(x=>x.id!==session.id);
     changed();
     notify('已保存 '+file.name);
     // Thumbnails are independent of the original multipart upload.
     if(mime.startsWith('image/')){
      try{
       setProgress(file.name+' · 正在生成缩略图');
       const thumb=await createAlbumThumbnail(file);
       if(thumb)await api('/api/media/'+session.id+'/thumbnail',{method:'PUT',body:thumb,headers:{'Content-Type':'image/jpeg'}});
      }catch{
       notify(file.name+' 已保存，但缩略图暂不可用（相册仍可查看原图）');
      }
     }
    }catch(error){
     // Never abort a recoverable session automatically; Safari can lose connectivity.
     notify(file.name+'：'+(error instanceof Error?error.message:'上传中断')+(uploadId?'。重新选择同一文件即可续传。':''));
    }
    try{queue=await refreshPending()}catch{}
   }
  }catch(error){
   notify(error instanceof Error?error.message:'无法检查未完成上传，请检查网络后重试');
  }finally{
   setUploading(false);
   setProgress('');
  }
 }
 async function remove(id:string){if(!confirm('确定从相册删除这项媒体吗？'))return;try{await api('/api/media/'+id,{method:'DELETE'});if(selected?.id===id)setSelected(null);changed();notify('已从相册删除')}catch(e){notify(e instanceof Error?e.message:'删除失败')}}
 async function saveMedia(value:{title:string;day:string}){
  if(!selected)return;
  await api('/api/media/'+selected.id,{method:'PATCH',body:JSON.stringify(value)});
  setSelected(current=>current?.id===selected.id?{...current,...value}:current);
  // The list must update even when the media count stays unchanged.
  mediaEdited(selected.id,value);
  changed();notify('照片信息已更新');
 }
 function navigateMedia(step:number){
  if(!selected)return;
  const current=media.findIndex(item=>item.id===selected.id);
  const next=media[current+step];
  if(next)setSelected(next);
 }
 return <><Card className="upload-card"><CloudUpload size={34}/><h3>收藏镜头里的成长</h3><p className="muted">支持照片、MP4 与 iPhone MOV，按 8MB 分片上传，大文件也无需一次传完。</p><label className="upload-action">{uploading?'正在上传…':'选择照片或视频'}<input type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm,.mov" disabled={uploading} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void upload(files);}}/></label>{progress&&<p className="small">{progress}</p>}</Card>
 {pending.length>0&&<Card className="pending-uploads"><div className="section-title"><h3>待续传文件</h3><span className="muted small">{pending.length} 项</span></div><p className="muted small">网络中断或刷新页面后，重新选择原来的文件，会自动识别并继续上传未完成的分片。文件不会保存在本网站中。</p>{pending.map(item=><div className="pending-upload" key={item.id}><div><strong>{item.title||'未命名文件'}</strong><p className="muted small">已完成 {item.completedParts.length}/{Math.ceil(item.size/8388608)} 个分片 · {Math.ceil(item.size/1048576)} MB</p></div><div className="pending-actions">{item.completedParts.length===Math.ceil(item.size/8388608)&&<button className="primary" type="button" disabled={uploading} onClick={()=>void finishPending(item.id)}>完成保存</button>}<button className="secondary" type="button" disabled={uploading} onClick={()=>void discard(item.id)}>取消上传</button></div></div>)}</Card>}
 <div className="photo-grid">{media.map(item=><Card key={item.id} className="photo-item"><button type="button" className="photo-preview" onClick={()=>setSelected(item)} aria-label={'预览 '+(item.title||'成长回忆')}><span className="photo-frame">{item.mime.startsWith('image/')?<img src={'/api/media/'+item.id+'/thumbnail'} loading="lazy" decoding="async" alt="" />:<span className="video-placeholder" aria-hidden="true"><Camera size={32}/><span>视频 · 点击播放</span></span>}</span><span className="photo-preview-hint">{item.mime.startsWith('image/')?'查看照片':'播放视频'}</span></button><div className="photo-caption"><div><strong>{item.title||'未命名'}</strong><p>{item.day}</p></div><button type="button" className="icon-btn" onClick={()=>void remove(item.id)} aria-label={'删除 '+(item.title||'媒体')}><Trash2 size={16}/></button></div></Card>)}</div>{!media.length&&<div className="empty card">还没有照片，试试上传第一张。</div>}<Pager page={page} setPage={setPage} hasMore={hasMore}/>{selected&&<MediaViewer key={baby.id} item={selected} index={media.findIndex(item=>item.id===selected.id)} count={media.length} onNavigate={navigateMedia} onClose={()=>setSelected(null)} onSave={saveMedia}/> }</>;
}
function Assistant({configured,babyId,setActive}:{configured:boolean;babyId:string;setActive:(v:Tab)=>void}){
 const [input,setInput]=useState(''),[messages,setMessages]=useState<{role:'me'|'bot';text:string}[]>([]),[waiting,setWaiting]=useState(false);
 async function send(e:FormEvent){e.preventDefault();if(!input.trim()||waiting)return;const content=input;setInput('');setMessages(v=>[...v,{role:'me',text:content}]);setWaiting(true);
 try{const res=await post<{answer:string}>('/api/chat',{message:content,babyId});setMessages(v=>[...v,{role:'bot',text:res.answer}])}catch(e){setMessages(v=>[...v,{role:'bot',text:e instanceof Error?e.message:'请求失败'}])}finally{setWaiting(false)}}
 return <Card className="chat"><div className="chat-header"><span className="stat-icon peach"><Sparkles size={21}/></span><div><h3>BabyMemo AI</h3><p className="muted small">由你的 OpenRouter 配置提供支持 · 只读问答</p></div></div>{!configured?<div className="empty"><p>还没有配置 OpenRouter</p><button className="primary" onClick={()=>setActive('settings')}>前往设置 <ChevronRight size={16}/></button></div>:<>
 <div className="chat-messages">{!messages.length&&<div className="chat-placeholder"><Sparkles size={32}/><p>有什么想聊的？</p><span>可以聊聊宝宝成长、育儿灵感，或帮你梳理记录。</span></div>}{messages.map((m,i)=><div className={'bubble '+m.role} key={i}>{m.text}</div>)}{waiting&&<div className="bubble bot">正在思考…</div>}</div>
 <form onSubmit={send} className="chat-input"><input placeholder="问问 BabyMemo…" value={input} onChange={e=>setInput(e.target.value)}/><button disabled={waiting||!input.trim()} aria-label="发送"><ChevronRight size={20}/></button></form></>}</Card>;
}
function Settings({state,baby,changed,notify}:{state:State;baby:BabyInfo;changed:()=>void;notify:(s:string)=>void}){
 const [model,setModel]=useState(state.openrouter.model),[apiKey,setApiKey]=useState(''),[saving,setSaving]=useState(false);
 const [name,setName]=useState(baby.name),[birthday,setBirthday]=useState(baby.birthday),[allergies,setAllergies]=useState(baby.allergies);
 const [qr,setQr]=useState(''),[qrImage,setQrImage]=useState(''),[status,setStatus]=useState(''),[verifyCode,setVerifyCode]=useState(''),[botStatus,setBotStatus]=useState<any>(null);
 useEffect(()=>{setName(baby.name);setBirthday(baby.birthday);setAllergies(baby.allergies)},[baby.id,baby.name,baby.birthday,baby.allergies]);
 useEffect(()=>{if(qr)void import('qrcode').then(({default:QRCode})=>QRCode.toDataURL(qr,{width:220,margin:2,errorCorrectionLevel:'M'})).then(setQrImage).catch(()=>notify('二维码渲染失败'))},[qr]);
 useEffect(()=>{if(!qr||status==='confirmed'||status==='expired')return;let cancelled=false;let timeout:ReturnType<typeof setTimeout>;
  const poll=async()=>{try{const r=await post<{status:string}>('/api/settings/wechat/qr/status',{verifyCode});if(cancelled)return;setStatus(r.status);if(r.status==='confirmed'){setQr('');setQrImage('');changed();notify('微信绑定成功，请手动启用 Bot');return;}}catch(e){if(!cancelled)setStatus('连接重试中');}if(!cancelled)timeout=setTimeout(poll,2000)};
  timeout=setTimeout(poll,500);return()=>{cancelled=true;clearTimeout(timeout)};
 },[qr,verifyCode,status==='confirmed',status==='expired']);
 async function saveOpenrouter(e:FormEvent){e.preventDefault();setSaving(true);try{await post('/api/settings/openrouter',{model,...(apiKey?{apiKey}:{})});setApiKey('');changed();notify('OpenRouter 已保存')}catch(e){notify(String(e))}finally{setSaving(false)}}
 async function saveBaby(e:FormEvent){e.preventDefault();try{await api('/api/babies/'+baby.id,{method:'PATCH',body:JSON.stringify({name,birthday,allergies,notes:baby.notes})});changed();notify('宝宝资料已更新')}catch(e){notify(String(e))}}
 async function pair(){try{setStatus('正在获取二维码…');const r=await post<{qrContent:string}>('/api/settings/wechat/qr',{});setQr(r.qrContent);setStatus('wait')}catch(e){notify(String(e))}}
 async function toggleBot(action:'start'|'pause'){try{await post('/api/settings/wechat/'+action,{});changed();notify(action==='start'?'微信 Bot 已启用':'微信 Bot 已暂停')}catch(e){notify(String(e))}}
 async function test(){try{const r=await post<any>('/api/settings/openrouter/test',{});notify('模型测试成功：'+r.answer)}catch(e){notify(String(e))}}
 async function inspect(){try{setBotStatus(await api('/api/settings/wechat/status'))}catch(e){notify(String(e))}}
 return <div className="settings-grid"><Card><div className="section-title"><h3>宝宝资料</h3><Baby size={20}/></div><form className="stack" onSubmit={saveBaby}><Field label="宝宝昵称"><input value={name} required onChange={e=>setName(e.target.value)}/></Field><Field label="出生日期"><input type="date" value={birthday} required onChange={e=>setBirthday(e.target.value)}/></Field><Field label="过敏与注意事项"><textarea rows={3} value={allergies} onChange={e=>setAllergies(e.target.value)}/></Field><Primary>保存资料 <Check size={16}/></Primary></form></Card>
 <Card><div className="section-title"><h3>OpenRouter</h3><WandSparkles size={20}/></div><p className="muted small">目前只支持 OpenRouter。API Key 在 Worker 内加密后保存到 D1，不返回到浏览器。</p><form className="stack" onSubmit={saveOpenrouter}><Field label="模型 ID"><input required value={model} onChange={e=>setModel(e.target.value)} placeholder="openai/gpt-4.1-mini"/></Field><Field label={'API Key · '+(state.openrouter.configured?'已配置，可留空不变':'尚未配置')}><input type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-or-v1-…"/></Field><Primary disabled={saving}>保存 OpenRouter 设置 <Check size={16}/></Primary></form><button className="secondary full" onClick={()=>void test()} disabled={!state.openrouter.configured}>测试模型连通性</button></Card>
 <Card className="span-2"><div className="section-title"><h3>微信 ClawBot</h3><MessageCircle size={20}/></div><p className="muted">网页扫码绑定微信，不需要 VPS。绑定后由 Cloudflare Durable Objects 定时轮询消息，使用 OpenRouter 回答、记录明确的成长事件。</p>
 <div className="wechat-row"><div className="wechat-status"><span className={'status-dot '+(state.wechat.enabled?'online':'')}/><strong>{state.wechat.connected?(state.wechat.enabled?'已连接并启用':'已绑定，当前暂停'):'尚未绑定微信'}</strong></div><button className="secondary" onClick={()=>void inspect()}><RefreshCw size={15}/> 运行状态</button></div>
 {botStatus&&<pre className="status-json">{JSON.stringify(botStatus,null,2)}</pre>}
 <div className="wechat-actions"><button className="secondary" onClick={()=>void pair()}><MessageCircle size={16}/>{state.wechat.connected?'重新扫码绑定':'扫码绑定微信'}</button>{state.wechat.connected&&(state.wechat.enabled?<button className="secondary" onClick={()=>void toggleBot('pause')}><WifiOff size={16}/>暂停 Bot</button>:<button className="primary" onClick={()=>void toggleBot('start')}><Wifi size={16}/>启用 Bot</button>)}</div>
 {qrImage&&<div className="qr-panel"><img src={qrImage} alt="微信扫码绑定二维码"/><strong>请用微信扫描二维码</strong><span>扫码后在手机确认绑定；二维码属于敏感凭据，请勿分享。</span><p className="small">状态：{status}</p>{status==='need_verifycode'&&<Field label="微信显示的验证码"><input value={verifyCode} onChange={e=>setVerifyCode(e.target.value)}/></Field>}</div>}
 <p className="hint">微信 iLink 对接属于第三方协议适配；上线前请验证账号授权、消息去重、隐私与持续运行情况。</p></Card></div>;
}
