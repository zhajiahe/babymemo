import {useCallback,useEffect,useRef,useState} from 'react';
import QRCode from 'qrcode';
import './tv.css';

type Pair={id:string;verifier:string;code:string;expiresAt:number};
type Baby={id:string;name:string;birthday:string};
type Media={id:string;day:string;title:string;description:string;mime:string;thumbnail_ready?:number;upload_state?:string};
type Catalog={familyName:string;babies:Baby[]};
const apiJson=async <T,>(path:string,init?:RequestInit):Promise<T>=>{
  const response=await fetch(path,{credentials:'same-origin',...init,headers:{...(init?.body?{'Content-Type':'application/json'}:{}),...init?.headers}});
  if(!response.ok)throw new Error(String(response.status));
  return response.json() as Promise<T>;
};
const post=<T,>(path:string,data:unknown)=>apiJson<T>(path,{method:'POST',body:JSON.stringify(data)});
const preview=(m:Media)=>'/api/media/'+encodeURIComponent(m.id)+'/thumbnail';
const original=(m:Media)=>'/api/media/'+encodeURIComponent(m.id)+'/content';
const displayStory=(m:Media)=>m.description?.trim()||m.title?.trim()||'把每一刻都留在时光里';
function PairScreen({pair,onRetry}:{pair:Pair|null;onRetry:()=>void}){
  const [qr,setQr]=useState('');
  useEffect(()=>{
    if(!pair)return;
    const url=new URL('/tv/activate',window.location.origin);
    url.searchParams.set('code',pair.code);
    let active=true;
    QRCode.toDataURL(url.toString(),{margin:2,width:320,errorCorrectionLevel:'M'}).then(value=>{if(active)setQr(value)}).catch(()=>setQr(''));
    return()=>{active=false};
  },[pair?.code]);
  return <div className="tv-pair tv-center">
    <div className="tv-symbol">✦</div>
    <h1>让家里的回忆，住进电视里。</h1>
    <p>使用已登录 BabyMemo 的手机扫描二维码，确认这台电视的只读访问权限。</p>
    {pair?<div className="tv-pair-card">
      {qr?<img className="tv-qr" src={qr} alt="BabyMemo 电视配对二维码"/>:<div className="tv-qr tv-qr-loading">二维码生成中…</div>}
      <div><span>配对码</span><strong>{pair.code.slice(0,5)} · {pair.code.slice(5)}</strong><small>10 分钟内有效 · 不会在电视保存家庭密码</small></div>
    </div>:<p>正在创建安全配对…</p>}
    <button className="tv-action" onClick={onRetry}>重新生成配对码</button>
  </div>;
}
export function TvApp(){
  const [mode,setMode]=useState<'loading'|'pair'|'ready'|'error'>('loading');
  const [pair,setPair]=useState<Pair|null>(null);
  const [family,setFamily]=useState('BabyMemo');
  const [babies,setBabies]=useState<Baby[]>([]);
  const [babyId,setBabyId]=useState('');
  const [media,setMedia]=useState<Media[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [hasMore,setHasMore]=useState(false);
  const [busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<number|null>(null);
  const [playing,setPlaying]=useState(false);
  const [error,setError]=useState('');
  const requestVersion=useRef(0);
  const [refreshToken,setRefreshToken]=useState(0);

  const loadCatalog=useCallback(async()=>{
    const catalog=await apiJson<Catalog>('/api/tv/catalog');
    setFamily(catalog.familyName);
    setBabies(catalog.babies);
    setBabyId(current=>catalog.babies.some(b=>b.id===current)?current:(catalog.babies[0]?.id||''));
    setMode('ready');
    setPair(null);
  },[]);
  const startPair=useCallback(async()=>{
    setMode('loading');
    try{
      const result=await post<Pair>('/api/tv/pair/start',{});
      setPair(result);setMode('pair');
    }catch{setError('无法创建配对码，请检查网络或稍后重试。');setMode('error')}
  },[]);
  useEffect(()=>{
    let mounted=true;
    void loadCatalog().catch(()=>{if(mounted)void startPair()});
    return()=>{mounted=false};
  },[loadCatalog,startPair]);
  useEffect(()=>{
    if(mode!=='pair'||!pair)return;
    const current=pair;
    let stopped=false,busyPoll=false;
    const check=async()=>{
      if(stopped||busyPoll)return;
      if(Date.now()>=current.expiresAt){setError('配对码已过期，请重新生成。');setMode('error');return;}
      busyPoll=true;
      try{
        const result=await post<{status:'pending'|'approved'}>('/api/tv/pair/poll',{id:current.id,verifier:current.verifier});
        if(!stopped&&result.status==='approved')await loadCatalog();
      }catch(e){if(!stopped&&e instanceof Error&&e.message==='410'){setError('配对已过期，请重新生成。');setMode('error')}}
      finally{busyPoll=false}
    };
    const timer=window.setInterval(()=>void check(),2500);
    void check();
    return()=>{stopped=true;window.clearInterval(timer)};
  },[mode,pair,loadCatalog]);
  useEffect(()=>{
    if(mode!=='ready'||!babyId)return;
    const version=++requestVersion.current;
    setMedia([]);setCursor(null);setHasMore(false);setSelected(null);setPlaying(false);setBusy(true);
    void apiJson<{items:Media[];hasMore:boolean;nextCursor:string|null}>('/api/media?babyId='+encodeURIComponent(babyId))
      .then(data=>{
        if(version!==requestVersion.current)return;
        setMedia(data.items.filter(m=>!m.upload_state||m.upload_state==='ready'));
        setCursor(data.nextCursor);setHasMore(data.hasMore);
      }).catch(()=>{if(version===requestVersion.current)setError('相册加载失败，请检查网络后重试。')})
      .finally(()=>{if(version===requestVersion.current)setBusy(false)});
  },[mode,babyId,refreshToken]);
  const loadMore=useCallback(async()=>{
    if(!cursor||busy||!babyId)return;
    const version=requestVersion.current;
    setBusy(true);
    try{
      const data=await apiJson<{items:Media[];hasMore:boolean;nextCursor:string|null}>('/api/media?babyId='+encodeURIComponent(babyId)+'&cursor='+encodeURIComponent(cursor));
      if(version!==requestVersion.current)return;
      setMedia(old=>[...old,...data.items.filter(m=>!m.upload_state||m.upload_state==='ready')]);
      setCursor(data.nextCursor);setHasMore(data.hasMore);
    }catch{setError('继续加载失败，可按确定键重试。')}
    finally{if(version===requestVersion.current)setBusy(false)}
  },[babyId,cursor,busy]);
  const navigate=useCallback((step:number)=>{
    if(!media.length)return;
    setSelected(current=>current===null?0:(current+step+media.length)%media.length);
  },[media.length]);
  useEffect(()=>{
    if(selected===null)return;
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
        e.preventDefault();navigate(e.key==='ArrowRight'?1:-1);
      }else if(e.key==='Escape'||e.key==='Backspace'){
        e.preventDefault();setSelected(null);setPlaying(false);
      }else if(e.key===' '){
        e.preventDefault();setPlaying(value=>!value);
      }
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[selected,navigate]);
  useEffect(()=>{
    if(!playing||selected===null||media[selected]?.mime.startsWith('video/'))return;
    const timer=window.setTimeout(()=>navigate(1),8000);
    return()=>window.clearTimeout(timer);
  },[playing,selected,media,navigate]);
  const current=selected===null?null:media[selected];
  return <div className="tv-root">
    {mode==='loading'?<div className="tv-center"><h1>BabyMemo</h1><p>正在连接家庭相册…</p></div>:
      mode==='pair'?<PairScreen pair={pair} onRetry={()=>void startPair()}/>:
      mode==='error'?<div className="tv-center"><h1>暂时无法连接</h1><p>{error}</p><button className="tv-action" onClick={()=>void startPair()}>重新配对</button></div>:
      <>
        <header className="tv-header"><div><span className="tv-brand">✦ BabyMemo TV</span><h1>{family} <small>· 成长时光</small></h1></div>
        <div className="tv-header-actions">
          {babies.map(b=><button key={b.id} className={'tv-chip '+(babyId===b.id?'tv-active':'')} onClick={()=>setBabyId(b.id)}>{b.name}</button>)}
          <button className="tv-chip" onClick={()=>setRefreshToken(v=>v+1)}>刷新</button>
        </div></header>
        {error&&<p className="tv-error" role="status">{error}<button onClick={()=>setError('')}>关闭</button></p>}
        {selected===null?
          <main className="tv-gallery">
            <div className="tv-section-title"><div><span>珍藏的日子</span><h2>每个瞬间，都值得重温。</h2></div>
              <button className="tv-action" disabled={!media.length} onClick={()=>{setSelected(0);setPlaying(true)}}>▶ 开始播放</button>
            </div>
            <div className="tv-grid">{media.map((m,i)=><button className="tv-photo" key={m.id} onClick={()=>{setSelected(i);setPlaying(false)}} aria-label={'查看 '+m.day+' 的回忆'}>
              <img loading={i<10?'eager':'lazy'} src={preview(m)} alt="" />
              {m.mime.startsWith('video/')&&<span className="tv-video-label">▶ 视频</span>}
              <div className="tv-photo-caption"><time>{m.day}</time><strong>{displayStory(m)}</strong></div>
            </button>)}</div>
            {!busy&&!media.length?<p className="tv-empty">这里还没有准备好的照片。通过微信或手机添加后，再返回电视刷新。</p>:null}
            {hasMore&&<button className="tv-action tv-more" disabled={busy} onClick={()=>void loadMore()}>{busy?'加载中…':'查看更多回忆'}</button>}
          </main>:
          current?<main className="tv-stage" role="dialog" aria-label="照片与视频预览">
            <div className="tv-stage-media">{current.mime.startsWith('video/')
              ?<video key={current.id} src={original(current)} poster={preview(current)} controls autoPlay={playing} onEnded={()=>{if(playing)navigate(1)}}/>
              :<img key={current.id} src={original(current)} alt={displayStory(current)}/>}</div>
            <aside className="tv-story"><span className="tv-eyebrow">这天的故事 · {selected+1} / {media.length}</span><h2>{current.day}</h2><p>{displayStory(current)}</p>
              <div className="tv-stage-actions"><button className="tv-chip" onClick={()=>navigate(-1)}>← 上一张</button><button className="tv-chip" onClick={()=>navigate(1)}>下一张 →</button><button className="tv-chip" onClick={()=>setPlaying(v=>!v)}>{playing?'暂停轮播':'自动轮播'}</button><button className="tv-chip" onClick={()=>{setSelected(null);setPlaying(false)}}>返回相册</button></div>
            </aside>
          </main>:null}
        <footer className="tv-footer">遥控器 ← → 切换照片 · 确定键打开 · 返回键关闭 · 手机和微信随时添加新的回忆</footer>
      </>}
  </div>;
}
type TvDevice={id:string;created_at:number;revoked_at:number|null};
export function TvActivate(){
  const [code,setCode]=useState(new URLSearchParams(location.search).get('code')?.toUpperCase()||'');
  const [password,setPassword]=useState('');
  const [logged,setLogged]=useState<boolean|null>(null);
  const [done,setDone]=useState(false);
  const [devices,setDevices]=useState<TvDevice[]>([]);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const refresh=useCallback(async()=>{
    try{
      const data=await apiJson<{items:TvDevice[]}>('/api/tv/devices');setDevices(data.items);setLogged(true);
    }catch{setLogged(false)}
  },[]);
  useEffect(()=>{void refresh()},[refresh]);
  const login=async(e:React.FormEvent)=>{
    e.preventDefault();setBusy(true);setNotice('');
    try{await post('/api/login',{password});setPassword('');await refresh()}
    catch{setNotice('家庭密码错误，或尝试次数过多。')}
    finally{setBusy(false)}
  };
  const approve=async()=>{
    setBusy(true);setNotice('');
    try{await post('/api/tv/pair/approve',{code:code.replace(/\s/g,'')});setDone(true);await refresh()}
    catch{setNotice('配对码无效或已过期，请在电视上重新生成。')}
    finally{setBusy(false)}
  };
  const revoke=async(id:string)=>{
    if(!confirm('立即撤销这台电视的访问权限？'))return;
    try{await post('/api/tv/devices/'+encodeURIComponent(id)+'/revoke',{});await refresh()}
    catch{setNotice('撤销失败，请重试')}
  };
  return <div className="tv-activate"><div className="tv-activate-card"><span className="tv-brand">✦ BabyMemo</span><h1>电视配对</h1>
    {logged===null?<p>正在检查登录状态…</p>:logged===false?<form onSubmit={login}><p>请先输入家庭密码，确认你有权限为家里的电视授权。</p><label>家庭密码<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy}>登录并继续</button></form>:
    <><p>授权电视浏览家庭照片、视频及照片故事。<strong>电视只能读取，不能编辑、删除或导出家庭档案。</strong></p>
    {done?<p className="tv-done">✓ 已授权。现在可以回到电视打开相册。</p>:<div className="tv-authorize"><label>电视上显示的配对码<input value={code} maxLength={10} onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-F0-9]/g,''))}/></label><button disabled={busy||!/^[A-F0-9]{10}$/.test(code)} onClick={()=>void approve()}>确认授权这台电视</button></div>}
    <h2>已配对的电视</h2>{devices.filter(d=>!d.revoked_at).length===0?<p>暂时没有已配对设备。</p>:devices.filter(d=>!d.revoked_at).map(d=><div className="tv-device" key={d.id}><span>电视 · {new Date(d.created_at).toLocaleDateString('zh-CN')}</span><button onClick={()=>void revoke(d.id)}>撤销访问</button></div>)}
    </>}
    {notice&&<p role="alert" className="tv-error">{notice}</p>}
  </div></div>;
}
