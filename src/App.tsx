import {api,post,ApiFailure,today,type State,type Tab,type RecordItem} from './lib/client';
import {RecordView} from './features/growth/RecordView';
import {Album} from './features/album/Album';
import {Settings} from './features/settings/Settings';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Card, Field, Logo, Notice, Pager, Primary } from './components/ui';
import { MediaViewer, type MediaItem } from './components/MediaViewer';
import { createAlbumThumbnail, createStoredThumbnail, createVideoThumbnail, fingerprintFile } from './media-upload';
import { pickMatchingUpload, remainingPartNumbers } from './upload-plan.mjs';
import { Baby, BookHeart, CalendarDays, Camera, Check, ChevronRight, CloudUpload, Heart, LogOut, MessageCircle, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles, Trash2, TrendingUp, WandSparkles, Wifi, WifiOff } from 'lucide-react';

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
 const sections:[Tab,string,ReactNode][]=[['overview','概览',<Baby size={19}/>],['growth','成长曲线',<TrendingUp size={19}/>],['moments','成长瞬间',<BookHeart size={19}/>],['album','家庭相册',<Camera size={19}/>],['settings','设置',<Settings2 size={19}/>]];
 return <><aside className="sidebar"><Logo/><div className="side-label">MY SPACE</div><nav>{sections.map(([tab,label,icon])=><button className={'nav-link '+(tab===active?'active':'')} key={tab} type="button" aria-current={tab===active?'page':undefined} onClick={()=>setActive(tab)}>{icon}{label}{tab===active&&<span className="active-dot"/>}</button>)}</nav><div className="sidebar-bottom"><div className="privacy"><ShieldCheck size={16}/> 私密家庭空间</div><button className="nav-link" onClick={logout}><LogOut size={18}/> 安全退出</button></div></aside><nav className="mobile-nav">{sections.map(([tab,label,icon])=><button key={tab} type="button" aria-label={label} aria-current={tab===active?'page':undefined} onClick={()=>setActive(tab)} className={tab===active?'active':''}>{icon}<span>{label.replace('成长','')}</span></button>)}</nav></>;
}
export default function App(){
 const [mode,setMode]=useState<'loading'|'gate'|'app'|'unavailable'>('loading');
 const [state,setState]=useState<State|null>(null),[active,setActive]=useState<Tab>('overview'),[babyId,setBabyId]=useState(''),[toast,setToast]=useState('');
 const [records,setRecords]=useState<RecordItem[]>([]),[milestones,setMilestones]=useState<RecordItem[]>([]),[media,setMedia]=useState<MediaItem[]>([]);
 const [growthHistory,setGrowthHistory]=useState<RecordItem[]>([]),[historyLimited,setHistoryLimited]=useState(false);
 const [albumQuery,setAlbumQuery]=useState(''),[favoriteOnly,setFavoriteOnly]=useState(false);
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
  if(active==='growth'){
   loads.push(api<{items:RecordItem[];limited:boolean}>('/api/growth/history?babyId='+id)
    .then(r=>{if(!cancelled){setGrowthHistory(r.items);setHistoryLimited(r.limited)}}));
  }
  if(active==='album'){
   loads.push(api<{items:MediaItem[];hasMore:boolean}>('/api/media?babyId='+id+'&page='+albumPage+'&q='+encodeURIComponent(albumQuery)+(favoriteOnly?'&favorite=1':''))
    .then(r=>{if(!cancelled){setMedia(r.items);setHasMore(p=>({...p,album:r.hasMore}))}}));
  }
  void Promise.all(loads).catch(e=>{if(!cancelled)setToast(e instanceof Error?e.message:'数据读取失败')});
  return ()=>{cancelled=true};
 },[active,baby?.id,growthPage,momentPage,albumPage,state?.counts.growth,state?.counts.milestones,state?.counts.media,albumQuery,favoriteOnly]);
 function changed(){void refresh();setGrowthPage(0);setMomentPage(0);setAlbumPage(0);}
 async function logout(){await post('/api/logout',{});setMode('gate');setState(null)}
 if(mode==='loading')return <div className="loading-screen"><Logo/><div>正在载入家庭空间…</div></div>;
 if(mode==='gate')return <Gate onReady={()=>void refresh()}/>;
 if(mode==='unavailable')return <div className="loading-screen"><Logo/><p>暂时无法连接家庭空间，已保留你的会话。</p><button className="secondary" onClick={()=>void refresh()}><RefreshCw size={16}/>重新连接</button></div>;
 if(!state||!baby)return <div className="loading-screen">家庭空间中暂无宝宝档案</div>;
 const titles:Record<Tab,string>={overview:'每一刻，都很珍贵',growth:'成长记录',moments:'小小里程碑',album:'家庭相册',settings:'空间设置'};
 const currentCounts=state.countsByBaby?.[baby.id]??{growth:0,milestones:0,media:0};
 return <div className="app"><Nav active={active} setActive={setActive} logout={logout}/><main className="workspace"><div className="topbar"><div className="crumb">{state.familyName||'家庭空间'} <ChevronRight size={14}/> <strong>{titles[active]}</strong></div><div className="top-right"><span className="secure"><ShieldCheck size={14}/> 仅家人可见</span><div className="avatar">{state.ownerName.slice(0,1)}</div></div></div>
 <div className="page"><header className="page-heading"><div><div className="eyebrow">BABYMEMO / {active.toUpperCase()}</div><h1>{titles[active]}</h1><p className="muted">{active==='overview'?'把日常小事，变成以后回望的宝藏。':baby.name+' · '+years(baby.birthday)+' · 记录属于你们的故事'}</p></div><div className="baby-pill"><Heart size={15} fill="currentColor"/><select aria-label="选择宝宝" value={baby.id} onChange={e=>{setBabyId(e.target.value);setGrowthPage(0);setMomentPage(0);setAlbumPage(0)}}>{state.babies.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div></header>
 {active==='overview'&&<><section className="welcome"><div className="welcome-content"><div className="eyebrow">OUR LITTLE STORY</div><h2>{baby.name}，<br/>今天也在闪闪发光。</h2><p>从 {baby.birthday} 开始，已陪伴我们 {years(baby.birthday)}。<br/>愿每个寻常的日子，都留下一点温暖。</p><button className="light-btn" onClick={()=>setActive('moments')}><Plus size={16}/>记下一个瞬间</button></div><div className="welcome-art"><span>✳</span><Heart fill="currentColor" size={84}/><i>♡</i></div></section>
 <div className="stats"><Card><div className="stat-icon peach"><TrendingUp size={20}/></div><div className="stat-value">{currentCounts.growth}</div><div className="muted">成长记录</div></Card><Card><div className="stat-icon lavender"><BookHeart size={20}/></div><div className="stat-value">{currentCounts.milestones}</div><div className="muted">珍贵时刻</div></Card><Card><div className="stat-icon mint"><Camera size={20}/></div><div className="stat-value">{currentCounts.media}</div><div className="muted">相册回忆</div></Card></div>
 <div className="two-panels"><Card><div className="section-title"><h3>最近的成长</h3><button className="text-btn" onClick={()=>setActive('growth')}>查看全部 <ChevronRight size={15}/></button></div>{records.slice(0,4).map(x=><div className="event" key={x.id}><span className="event-date">{x.day}</span><span>{[x.weight!=null?x.weight+' kg':null,x.height!=null?x.height+' cm':null].filter(Boolean).join(' · ')||'成长测量'}</span></div>)}{!records.length&&<div className="empty">还没有成长记录，记下第一次测量吧。</div>}</Card>
 <Card><div className="section-title"><h3>闪光的时刻</h3><button className="text-btn" onClick={()=>setActive('moments')}>查看全部 <ChevronRight size={15}/></button></div>{milestones.slice(0,4).map(x=><div className="event" key={x.id}><span className="event-date">{x.day}</span><span>{x.title}</span></div>)}{!milestones.length&&<div className="empty">成长中的惊喜，从现在开始收藏。</div>}</Card></div></>}
 {active==='growth'&&<RecordView baby={baby} kind="growth" items={records} history={growthHistory} historyLimited={historyLimited} busy={busy} setBusy={setBusy} changed={changed} notify={setToast} hasMore={hasMore.growth} page={growthPage} setPage={setGrowthPage}/>}
 {active==='moments'&&<RecordView baby={baby} kind="milestones" items={milestones} busy={busy} setBusy={setBusy} changed={changed} notify={setToast} hasMore={hasMore.moments} page={momentPage} setPage={setMomentPage}/>}
 {active==='album'&&<Album baby={baby} media={media} query={albumQuery} onQuery={v=>{setAlbumQuery(v);setAlbumPage(0)}} favoriteOnly={favoriteOnly} onFavoriteOnly={v=>{setFavoriteOnly(v);setAlbumPage(0)}} favoriteUpdated={(id,favorite)=>setMedia(items=>items.map(item=>item.id===id?{...item,favorite:favorite?1:0}:item))} mediaEdited={(id,value)=>setMedia(items=>items.map(item=>item.id===id?{...item,...value}:item))} changed={changed} notify={setToast} hasMore={hasMore.album} page={albumPage} setPage={setAlbumPage}/>}
 {active==='settings'&&<Settings state={state} baby={baby} changed={changed} notify={setToast} onBabyCreated={id=>{setBabyId(id);setActive('overview');setGrowthPage(0);setMomentPage(0);setAlbumPage(0)}}/>}
 <footer className="footer">BabyMemo · 用爱记录，用心珍藏 <Heart size={13}/></footer>
 </div></main>{toast&&<Notice text={toast} onClose={()=>setToast('')}/>}</div>;
}
