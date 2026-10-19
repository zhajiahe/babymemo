import {RecordFilterBar,emptyFilters,filterQuery,type RecordFilters} from './components/RecordFilters';
import {OfflineStatus} from './components/OfflineStatus';
import {clearDevice,offlineJobs} from './offline';
import {resumeThumbnailRepair,clearThumbnailRepair} from './thumbnail-repair';
import {repairMissingVideoCovers} from './auto-video-covers';
import {mediaThumbnailUrl} from './private-media-cache.mjs';
import {api,post,ApiFailure,today,type State,type Tab,type RecordItem} from './lib/client';
import {RecordView,GrowthChart} from './features/growth/RecordView';
import {ageLabel} from './lib/age.mjs';
import {trackExperience} from './client-performance';

import {ThemeSelector} from './components/ThemeSelector';
import { lazy, Suspense, useEffect, useState, useRef, type FormEvent, type ReactNode } from 'react';
import { Button, Card, Field, Logo, Notice, Pager, Primary } from './components/ui';
import type { MediaItem } from './components/MediaViewer';
import { createAlbumThumbnail, createStoredThumbnail, createVideoThumbnail, fingerprintFile } from './media-upload';
import { pickMatchingUpload, remainingPartNumbers } from './upload-plan.mjs';
import { Baby, BookHeart, CalendarDays, Camera, Check, ChevronLeft, ChevronRight, CloudUpload, Heart, LogOut, MessageCircle, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles, Play, Trash2, TrendingUp, WandSparkles, Wifi, WifiOff } from 'lucide-react';

const Album=lazy(()=>import('./features/album/Album').then(m=>({default:m.Album})));
const Settings=lazy(()=>import('./features/settings/Settings').then(m=>({default:m.Settings})));
function Gate({onReady}:{onReady:()=>void}){
 const [mode,setMode]=useState<'loading'|'setup'|'login'|'unavailable'>('loading');
 const [ready,setReady]=useState({sessionConfigured:false,encryptionConfigured:false});
 const [form,setForm]=useState({ownerName:'',password:'',familyName:'',babyName:'',birthday:'',birthTime:'',gender:'girl',timeZone:'Asia/Shanghai',allergies:''});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{api<{initialized:boolean;sessionConfigured:boolean;encryptionConfigured:boolean}>('/api/bootstrap/status').then(v=>{setReady(v);setMode(v.initialized?'login':'setup')}).catch(()=>{setMode('unavailable');setError('无法连接后端，请检查 Cloudflare 部署和 D1 迁移。')})},[]);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');
  try{await post(mode==='setup'?'/api/bootstrap':'/api/login',mode==='setup'?form:{password:form.password});onReady();}
  catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}
 }
 return <div className="gate"><div className="gate-intro"><Logo/><h1>一家人的成长，<br/>都记在这里。</h1><p>照片、成长记录和那些第一次。<br/>留下一份只属于家人的日记。</p><a className="demo-gate-link" href="/demo.html">先看看 BabyMemo 长什么样 <ChevronRight size={17}/></a></div>
 <div className="gate-panel"><div className="gate-card"><div className="gate-theme-selector"><ThemeSelector compact/></div><div className="eyebrow">{mode==='setup'?'首次设置':'家庭登录'}</div><h2>{mode==='setup'?'创建家庭空间':'登录 BabyMemo'}</h2><p className="muted">{mode==='setup'?'完成以下必填信息后，才会开放记录功能。':'输入家庭密码，继续记录一家人的成长。'}</p>
 {mode==='loading'?<div className="skeleton">正在检查服务状态…</div>:mode==='unavailable'?<div className="stack"><div className="error" role="alert">{error}</div><Button variant="secondary" onClick={()=>location.reload()}><RefreshCw size={15}/>重新检查</Button></div>:<form onSubmit={submit} className="stack">
 {mode==='setup'&&<><div className="setup-check">{[['会话密钥',ready.sessionConfigured],['加密密钥',ready.encryptionConfigured]].map(([label,ok])=><span key={String(label)} className={ok?'good':'bad'}>{ok?<Check size={13}/>:<WifiOff size={13}/>} {label}</span>)}</div><p className="setup-security-note">首次访问未初始化实例的人可以创建管理员。请部署后立即完成初始化；如需限制访问，请提前为站点启用 Cloudflare Access。</p></>}
 <>{mode==='setup'&&<Field label="家庭名称（必填）"><input required maxLength={80} value={form.familyName} onChange={e=>setForm({...form,familyName:e.target.value})} placeholder="例如：我们的温暖小家"/></Field>}{mode==='setup'&&<Field label="管理员登录名"><input required value={form.ownerName} autoComplete="username" onChange={e=>setForm({...form,ownerName:e.target.value})} placeholder="例如：爸爸 / 妈妈"/></Field>}
 </><Field label="家庭密码"><input type="password" autoComplete={mode==='setup'?'new-password':'current-password'} minLength={mode==='setup'?6:1} required value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder={mode==='setup'?'至少 6 位字符（可使用数字）':'输入家庭密码'}/></Field>
 {mode==='setup'&&<><div className="form-divider"><span>宝宝档案</span></div><div className="two"><Field label="宝宝名字"><input required value={form.babyName} onChange={e=>setForm({...form,babyName:e.target.value})} placeholder="宝宝昵称"/></Field><Field label="性别"><select value={form.gender} onChange={e=>setForm({...form,gender:e.target.value})}><option value="girl">女孩</option><option value="boy">男孩</option><option value="other">暂不填写</option></select></Field></div>
 <div className="two"><Field label="出生日期"><input type="date" required max={today()} value={form.birthday} onChange={e=>setForm({...form,birthday:e.target.value})}/></Field><Field label="出生时间（可后补）"><input type="time" value={form.birthTime} onChange={e=>setForm({...form,birthTime:e.target.value})}/></Field></div>
 <Field label="家庭时区"><select value={form.timeZone} onChange={e=>setForm({...form,timeZone:e.target.value})}><option value="Asia/Shanghai">中国标准时间 · UTC+8</option><option value="Asia/Tokyo">日本标准时间 · UTC+9</option><option value="America/Los_Angeles">美国太平洋时间</option></select></Field>
 <Field label="已知过敏信息（可选）"><input value={form.allergies} onChange={e=>setForm({...form,allergies:e.target.value})} placeholder="可稍后补充"/></Field></>}
 {error&&<div className="error" role="alert">{error}</div>}
 <Primary disabled={busy||(mode==='setup'&&(!ready.sessionConfigured||!ready.encryptionConfigured))}>{busy?'正在处理…':mode==='setup'?'完成初始化':'登录我的空间'}<ChevronRight size={17}/></Primary>
 </form>}
 {mode==='setup'&&<div className="setup-guide"><strong>部署检查 · 2 个必需 Secret</strong><p>仅需 <code>SESSION_SECRET</code> 和 <code>DATA_KEY</code>。每个密钥分别用 <code>openssl rand -hex 32</code> 生成，再通过 GitHub Actions 同步或在 Cloudflare Worker 设置中配置。</p><p>配置完成后刷新页面，两项检查通过即可设置家庭管理员和密码；已存在的账号不会被重置。</p><a href="https://github.com/zhajiahe/babymemo/blob/main/docs/DEPLOY.md" target="_blank" rel="noreferrer">查看部署指南 ↗</a></div>}</div></div></div>;
}
function Nav({active,setActive,logout,familyName}:{active:Tab;setActive:(t:Tab)=>void;logout:()=>void;familyName:string}){
 const sections:[Tab,string,ReactNode][]=[['overview','首页',<Baby size={19}/>],['album','相册',<Camera size={19}/>],['growth','成长',<TrendingUp size={19}/>],['moments','瞬间',<BookHeart size={19}/>],['settings','设置',<Settings2 size={19}/>]];
 return <><aside className="sidebar"><Logo/><div className="side-label side-space-name" title={familyName}>{familyName}</div><nav>{sections.map(([tab,label,icon])=><button className={'nav-link '+(tab===active?'active':'')} key={tab} type="button" aria-current={tab===active?'page':undefined} onClick={()=>setActive(tab)}>{icon}{label}{tab===active&&<span className="active-dot"/>}</button>)}</nav><div className="sidebar-bottom"><div className="privacy"><ShieldCheck size={16}/> 私密家庭空间</div><button className="nav-link" onClick={logout}><LogOut size={18}/> 安全退出</button></div></aside><nav className="mobile-nav" aria-label="底部主导航">{sections.filter(([tab])=>tab!=='moments').map(([tab,label,icon])=><button key={tab} type="button" aria-label={label} aria-current={tab===active?'page':active==='moments'&&tab==='overview'?'location':undefined} onClick={()=>setActive(tab)} className={tab===active||active==='moments'&&tab==='overview'?'active':''}><span className="mobile-nav-icon" aria-hidden="true">{icon}</span><span className="mobile-nav-label">{label}</span></button>)}</nav></>;
}
export default function App(){
 const [mode,setMode]=useState<'loading'|'gate'|'app'|'unavailable'>('loading');
 const [state,setState]=useState<State|null>(null),[active,setActive]=useState<Tab>(()=>{const value=localStorage.getItem('babymemo-view');return ['overview','growth','moments','album','settings'].includes(value||'')?value as Tab:'overview'}),[babyId,setBabyId]=useState(()=>localStorage.getItem('babymemo-baby')||''),[toast,setToast]=useState('');
 const [records,setRecords]=useState<RecordItem[]>([]),[milestones,setMilestones]=useState<RecordItem[]>([]),[media,setMedia]=useState<MediaItem[]>([]);
 const [growthHistory,setGrowthHistory]=useState<RecordItem[]>([]),[historyLimited,setHistoryLimited]=useState(false);
 const [growthPage,setGrowthPage]=useState(0),[momentPage,setMomentPage]=useState(0),[albumPage,setAlbumPage]=useState(0);
 const [hasMore,setHasMore]=useState({growth:false,moments:false,album:false});
 const [busy,setBusy]=useState(false);
 const [revision,setRevision]=useState(0);
 const [keyboardVisible,setKeyboardVisible]=useState(false);
 useEffect(()=>{
  const viewport=window.visualViewport;
  if(!viewport)return;
  // Do not hide tabs merely because an input is focused: only a real software
  // keyboard shrinks the visual viewport. This keeps hardware keyboards usable.
  function syncKeyboard(){
   const focused=document.activeElement;
   const textEditing=focused instanceof HTMLTextAreaElement
     ||(focused instanceof HTMLInputElement&&['text','password','number','email','search','tel','url'].includes(focused.type));
   setKeyboardVisible(textEditing&&window.innerWidth<=800&&window.innerHeight-viewport!.height>140);
  }
  viewport.addEventListener('resize',syncKeyboard);
  viewport.addEventListener('scroll',syncKeyboard);
  window.addEventListener('resize',syncKeyboard);
  document.addEventListener('focusin',syncKeyboard);
  document.addEventListener('focusout',syncKeyboard);
  syncKeyboard();
  return ()=>{
   viewport.removeEventListener('resize',syncKeyboard);
   viewport.removeEventListener('scroll',syncKeyboard);
   window.removeEventListener('resize',syncKeyboard);
   document.removeEventListener('focusin',syncKeyboard);
   document.removeEventListener('focusout',syncKeyboard);
  };
 },[]);
 const refreshSequence=useRef(0);
 const pageCursors=useRef<{growth:string[];moments:string[];album:string[]}>({growth:[''],moments:[''],album:['']});
 const pageArg=(kind:'growth'|'moments'|'album',page:number)=>{
  const cursor=pageCursors.current[kind][page];
  return cursor?'&cursor='+encodeURIComponent(cursor):'&page='+page;
 };
 const [growthFilters,setGrowthFilters]=useState<RecordFilters>(emptyFilters),[momentFilters,setMomentFilters]=useState<RecordFilters>(emptyFilters),[albumFilters,setAlbumFilters]=useState<RecordFilters>(emptyFilters);
 useEffect(()=>{localStorage.setItem('babymemo-view',active);localStorage.setItem('babymemo-baby',babyId)},[active,babyId]);
  // A new tab begins at its top, like iPhone tab navigation.
  useEffect(()=>{window.scrollTo(0,0)},[active]);
  function selectTab(tab:Tab){
    if(tab!==active){setActive(tab);return;}
    window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(timer)},[toast]);
 const baby=state?.babies.find(b=>b.id===babyId)||state?.babies[0];
 async function refresh(){
  const sequence=++refreshSequence.current;
  try{const v=await api<State>('/api/state');if(sequence!==refreshSequence.current)return;setState(v);setBabyId(old=>old&&v.babies.some(x=>x.id===old)?old:(v.babies[0]?.id||''));setMode('app');}
  catch(e){if(sequence!==refreshSequence.current)return;if(e instanceof ApiFailure&&e.status===401){setMode('gate');setState(null);}else{setToast('连接暂时中断，已保留当前页面。请检查网络并重试。');setMode(old=>old==='loading'?'unavailable':old);}}
 }
 useEffect(()=>{refresh();const wake=()=>{if(document.visibilityState==='visible')void refresh()};window.addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);return()=>{window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake)}},[]);
 // Refresh external WeChat edits without continually downloading the full album.
 // A per-baby D1 revision advances for every media mutation, including older captions.
 useEffect(()=>{
  if(mode!=='app'||(active!=='album'&&active!=='overview')||!baby?.id)return;
  let stopped=false,checking=false,version:string|null=null;
  const id=encodeURIComponent(baby.id);
  const check=async()=>{
   if(stopped||checking||document.visibilityState!=='visible'||!navigator.onLine)return;
   checking=true;
   try{
    const result=await api<{version:string}>('/api/media/revision?babyId='+id);
    if(!stopped){if(version!==null&&result.version!==version)setRevision(value=>value+1);version=result.version;}
   }catch{/* Keep current album on transient network errors. */}
   finally{checking=false}
  };
  void check();
  const timer=window.setInterval(()=>void check(),45000);
  const wake=()=>void check();
  window.addEventListener('online',wake);
  window.addEventListener('focus',wake);
  document.addEventListener('visibilitychange',wake);
  return()=>{stopped=true;window.clearInterval(timer);window.removeEventListener('online',wake);window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake)};
 },[mode,active,baby?.id]);
 useEffect(()=>{if(mode==='app')trackExperience('app_ready',performance.now())},[mode]);
 // Resume only jobs explicitly started by the user on this device.
 useEffect(()=>{if(mode==='app'&&state)resumeThumbnailRepair(state.babies.map(item=>item.id))},[mode,state]);
 // Best-effort automatic poster repair for WeChat videos lacking CDN thumbnails.
 // Uses small Range reads on visible, signed-in devices; never changes originals.
 const videoCoverBabies=state?.babies.map(item=>item.id).join('|')||'';
 useEffect(()=>{
  if(mode!=='app'||!videoCoverBabies)return;
  const controller=new AbortController();
  const run=()=>{if(!controller.signal.aborted)void repairMissingVideoCovers(videoCoverBabies.split('|'),controller.signal)};
  run();document.addEventListener('visibilitychange',run);window.addEventListener('online',run);
  return()=>{controller.abort();document.removeEventListener('visibilitychange',run);window.removeEventListener('online',run)};
 },[mode,videoCoverBabies]);
 useEffect(()=>{
  const ready=(event:Event)=>{
   const {id,updatedAt}=(event as CustomEvent<{id:string;updatedAt?:string}>).detail||{};
   if(!id)return;
   const delta={thumbnail_ready:1,...(updatedAt?{updated_at:updatedAt}:{})};
   setMedia(items=>items.map(item=>item.id===id?{...item,...delta}:item));
   setMilestones(items=>items.map(item=>item.media?.some(m=>m.id===id)
     ?{...item,media:item.media.map(m=>m.id===id?{...m,...delta}:m)}:item));
  };
  window.addEventListener('babymemo:thumbnail-repaired',ready);
  return()=>window.removeEventListener('babymemo:thumbnail-repaired',ready);
 },[]);
 // Load only the resource required by the active view; avoid three D1 reads on
 // every navigation. Ignore late responses when baby or tab changes.
 useEffect(()=>{
  if(!baby?.id)return;
  let cancelled=false;
  const id=encodeURIComponent(baby.id);
  const loads:Promise<void>[]=[];
  const loadStarted=performance.now();
  if(active==='overview'||active==='growth'){
   loads.push(api<{items:RecordItem[];hasMore:boolean;nextCursor?:string}>('/api/records/growth?babyId='+id+(active==='overview'?'&page=0':pageArg('growth',growthPage))+(active==='overview'?'':filterQuery(growthFilters)))
    .then(r=>{if(!cancelled){setRecords(r.items);setHasMore(p=>({...p,growth:r.hasMore}));if(active==='growth'&&r.nextCursor)pageCursors.current.growth[growthPage+1]=r.nextCursor}}));
  }
  if(active==='overview'||active==='moments'){
   loads.push(api<{items:RecordItem[];hasMore:boolean;nextCursor?:string}>('/api/records/milestones?babyId='+id+(active==='overview'?'&page=0':pageArg('moments',momentPage))+(active==='overview'?'':filterQuery(momentFilters)))
    .then(r=>{if(!cancelled){setMilestones(r.items);setHasMore(p=>({...p,moments:r.hasMore}));if(active==='moments'&&r.nextCursor)pageCursors.current.moments[momentPage+1]=r.nextCursor}}));
  }
  if(active==='overview'||active==='growth'){
   loads.push(api<{items:RecordItem[];limited:boolean}>('/api/growth/history?babyId='+id)
    .then(r=>{if(!cancelled){setGrowthHistory(r.items);setHistoryLimited(r.limited)}}));
  }
  if(active==='overview'||active==='album'){
   loads.push(api<{items:MediaItem[];hasMore:boolean;nextCursor?:string}>('/api/media?babyId='+id+(active==='overview'?'&page=0':pageArg('album',albumPage))+(active==='overview'?'':filterQuery(albumFilters)))
    .then(r=>{if(!cancelled){setMedia(r.items);setHasMore(p=>({...p,album:r.hasMore}));if(active==='album'&&r.nextCursor)pageCursors.current.album[albumPage+1]=r.nextCursor}}));
  }
  void Promise.all(loads).then(()=>{if(!cancelled&&loads.length)trackExperience('view_data',performance.now()-loadStarted)}).catch(e=>{if(!cancelled)setToast(e instanceof Error?e.message:'数据读取失败')});
  return ()=>{cancelled=true};
 },[active,baby?.id,growthPage,momentPage,albumPage,state?.counts.growth,state?.counts.milestones,state?.counts.media,revision,growthFilters,momentFilters,albumFilters]);
 function changed(){pageCursors.current={growth:[''],moments:[''],album:['']};setRevision(value=>value+1);void refresh();setGrowthPage(0);setMomentPage(0);setAlbumPage(0);}
 function selectBaby(id:string){
  // A newly created baby is valid before /api/state refresh includes the new ID.
  if(!id||id===babyId)return;
  pageCursors.current={growth:[''],moments:[''],album:['']};
  setBabyId(id);setGrowthFilters(emptyFilters);setMomentFilters(emptyFilters);setAlbumFilters(emptyFilters);
  setMedia([]);setRecords([]);setMilestones([]);setGrowthHistory([]);setHistoryLimited(false);
  setHasMore({growth:false,moments:false,album:false});
  setGrowthPage(0);setMomentPage(0);setAlbumPage(0);
 }
 async function logout(){
    try{
      if((await offlineJobs()).length&&!confirm('退出会清除此设备尚未同步的内容和草稿。确认退出？'))return;
      refreshSequence.current++;localStorage.setItem('babymemo-logout-pending','yes');
      if(navigator.onLine)try{await post('/api/logout',{});localStorage.removeItem('babymemo-logout-pending')}catch{/* Keep the server logout pending until connectivity returns. */}
      clearThumbnailRepair();await clearDevice();setMode('gate');setState(null);setRecords([]);setMilestones([]);setMedia([]);setGrowthHistory([]);
    }catch(e){setToast(e instanceof Error?e.message:'退出失败，请检查网络后重试')}
  }
 if(mode==='loading')return <div className="loading-screen"><Logo/><div>正在载入家庭空间…</div></div>;
 if(mode==='gate')return <Gate onReady={()=>void refresh()}/>;
 if(mode==='unavailable')return <div className="loading-screen"><Logo/><p>暂时无法连接家庭空间，已保留你的会话。</p><Button variant="secondary" onClick={()=>void refresh()}><RefreshCw size={16}/>重新连接</Button></div>;
 if(!state||!baby)return <div className="loading-screen">家庭空间中暂无宝宝档案</div>;
 const titles:Record<Tab,string>={overview:'成长日记',growth:'成长记录',moments:'成长瞬间',album:'相册',settings:'设置'};
 return <div className={'app'+(keyboardVisible?' keyboard-open':'')}><Nav active={active} setActive={selectTab} logout={logout} familyName={state.familyName||"家庭空间"}/><main className="workspace"><div className={'topbar'+(active==='moments'?' has-back':'')}>{active==='moments'&&<button type="button" className="mobile-back-button" onClick={()=>selectTab('overview')} aria-label="返回首页"><ChevronLeft size={19}/>首页</button>}<div className="crumb"><span className="space-name" aria-label="家庭空间名称" title={state.familyName||'家庭空间'}>{state.familyName||'家庭空间'}</span> <ChevronRight size={14}/> <strong>{titles[active]}</strong></div><div className="top-right"><span className="secure"><ShieldCheck size={14}/> 仅家人可见</span><div className="avatar">{state.ownerName.slice(0,1)}</div></div></div>
 <div className="page"><OfflineStatus changed={changed} notify={setToast}/><header className={"page-heading"+(active==="album"?" page-heading-album":"")}><div className={"page-heading-content"+(baby.avatar_key?" has-avatar":"")}>{baby.avatar_key&&<img className="baby-portrait" src={'/api/babies/'+baby.id+'/avatar?v='+encodeURIComponent(baby.updated_at||'')} alt={baby.name+'的头像'}/>}<h1>{active==='overview'?baby.name:titles[active]}</h1>
 <p className="muted">{active==='overview'
 ? ageLabel(baby.birthday,baby.birth_time,baby.time_zone)+' · 成长日记'
 : active==='album'?'照片与视频':baby.name+' · '+ageLabel(baby.birthday,baby.birth_time,baby.time_zone)}</p>
 </div>{active==="overview"&&<button className="home-quick-add" type="button" onClick={()=>setActive("moments")}><Plus size={16}/> 记录瞬间</button>}</header>
 {active==='overview'&&<div className="home-feed">
  <section className="home-memories" aria-label="最近照片">
   <div className="section-title home-section-title"><h2>最近的照片</h2><button type="button" className="text-btn" onClick={()=>setActive('album')}>查看相册 <ChevronRight size={16}/></button></div>
   {media.length>0?<><button type="button" className="home-photo-cover" onClick={()=>setActive('album')} aria-label="打开家庭相册查看最近照片">
    {media[0].upload_state&&media[0].upload_state!=='ready'?<span className="home-video-placeholder"><Camera size={27}/>{media[0].upload_state==='processing'?'正在保存照片…':'照片保存失败'}</span>:(media[0].mime.startsWith('image/')||media[0].thumbnail_ready)?<><img src={mediaThumbnailUrl(media[0])} alt="" decoding="async"/>{media[0].mime.startsWith('video/')&&<span className="home-video-badge"><Play size={15} fill="currentColor"/> 视频</span>}</>:<span className="home-video-placeholder"><Camera size={27}/>最近的视频</span>}
   </button>
   {!!media[0].description?.trim()&&<button type="button" className="home-story-highlight" onClick={()=>setActive('album')} aria-label={'在相册阅读 '+media[0].day+' 的照片故事'}>
    <span className="home-story-date"><time dateTime={media[0].day}>{media[0].day}</time> · 这天的故事</span>
    <strong>照片背后的故事</strong>
    <span className="home-story-excerpt">{media[0].description}</span>
    <span className="home-story-open">在相册阅读 <ChevronRight size={16}/></span>
   </button>}
   {media.length>1&&<div className="home-photo-strip">{media.slice(1,5).map(item=><button key={item.id} type="button" className="home-photo-thumb" onClick={()=>setActive('album')} aria-label={'查看 '+item.day+' 的媒体'}>
    {item.upload_state&&item.upload_state!=='ready'?<Camera size={22} aria-label={item.upload_state==='processing'?'正在保存':'保存失败'}/>:item.mime.startsWith('image/')||item.thumbnail_ready?<><img src={mediaThumbnailUrl(item)} loading="lazy" alt=""/>{item.mime.startsWith('video/')&&<span className="home-thumb-video" aria-hidden="true"><Play size={13} fill="currentColor"/></span>}</>:<>{item.mime.startsWith("video/")?<Play size={20} aria-hidden="true"/>:<Camera size={22}/>}</>}
   </button>)}</div>}</>:<div className="home-empty-photos"><Camera size={26}/><p>还没有照片</p><Button variant="secondary" type="button" onClick={()=>setActive('album')}>添加第一张照片</Button></div>}
  </section>
  <section className="home-measurements" aria-label="成长曲线"><div className="section-title home-section-title"><h2>成长记录</h2><button type="button" className="text-btn" onClick={()=>setActive('growth')}>查看记录 <ChevronRight size={16}/></button></div><GrowthChart items={growthHistory} limited={historyLimited}/></section>
  <section className="home-events" aria-label="成长时间轴"><div className="section-title home-section-title"><h2>最近的日子</h2><button type="button" className="text-btn" onClick={()=>setActive('moments')}>查看全部 <ChevronRight size={16}/></button></div>
   {milestones.slice(0,4).map(item=><div className="home-event" key={item.id}><time dateTime={item.day}>{item.day}</time><span>{item.title}</span></div>)}
   {!milestones.length&&<p className="empty">还没有成长瞬间，记录一次新的发现吧。</p>}
   <button type="button" className="home-add-moment" onClick={()=>setActive('moments')}><Plus size={16}/> 记录新瞬间</button>
  </section>
 </div>}
 {active==='growth'&&<RecordView key={'growth-'+baby.id} baby={baby} kind="growth" items={records} history={growthHistory} historyLimited={historyLimited} busy={busy} setBusy={setBusy} changed={changed} notify={setToast} hasMore={hasMore.growth} page={growthPage} setPage={setGrowthPage} filters={growthFilters} onFilters={value=>{pageCursors.current.growth=[''];setGrowthFilters(value);setGrowthPage(0)}}/>}
 {active==='moments'&&<RecordView key={'milestones-'+baby.id} baby={baby} kind="milestones" items={milestones} busy={busy} setBusy={setBusy} changed={changed} notify={setToast} hasMore={hasMore.moments} page={momentPage} setPage={setMomentPage} filters={momentFilters} onFilters={value=>{pageCursors.current.moments=[''];setMomentFilters(value);setMomentPage(0)}}/>}
 {active==='album'&&<Suspense fallback={<div className="skeleton">正在打开相册…</div>}><Album key={baby.id} baby={baby} media={media} mediaEdited={(id,value)=>setMedia(items=>items.map(item=>item.id===id?{...item,...value}:item))} changed={changed} notify={setToast} hasMore={hasMore.album} page={albumPage} setPage={setAlbumPage} filters={albumFilters} onFilters={value=>{pageCursors.current.album=[''];setAlbumFilters(value);setAlbumPage(0)}}/></Suspense>}
 {active==='settings'&&<Suspense fallback={<div className="skeleton">正在打开设置…</div>}><Settings key={baby.id} state={state} baby={baby} changed={changed} notify={setToast} onBabySelected={selectBaby} onBabyCreated={id=>{selectBaby(id);setActive('overview')}}/></Suspense>}
 
 </div></main>{toast&&<Notice text={toast} onClose={()=>setToast('')}/>}</div>;
}
