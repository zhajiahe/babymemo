import {useEffect,useRef,useState,type ReactNode} from 'react';
import {
  Baby, BookHeart, BookOpenText, Camera, ChevronLeft, ChevronRight, Heart,
  Images, Play, Plus, Settings2, ShieldCheck, TrendingUp, X, UsersRound, CalendarHeart, BrainCircuit, HardDriveDownload, Wifi
} from 'lucide-react';
import {Logo,Button,SegmentedControl} from '../components/ui';
import {ThemeSelector} from '../components/ThemeSelector';
import {GrowthChart} from '../features/growth/RecordView';
import type {RecordItem} from '../lib/client';

type DemoTab='overview'|'album'|'growth'|'moments'|'settings';
type Photo={id:string;day:string;description:string;src:string;alt:string;video?:boolean};

// Independent fictional sample data. No family account, storage or BabyMemo API is used.
// Public demonstration photographs are loaded from Unsplash, never from a family's R2 bucket.
const photos:Photo[]=[
 {id:'garden',day:'2026-10-12',description:'今天在公园里发现了会飞的泡泡。小星星一路追着跑，摔了一跤也不哭，爬起来还要再试一次。傍晚的阳光刚刚好，想把这个笑容一直记住。',alt:'户外玩耍的孩子',src:'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?auto=format&fit=crop&w=1400&q=82'},
 {id:'morning',day:'2026-10-10',description:'早上醒来就冲我们笑，抱着小毯子不肯松手。普通的星期六，也成了值得珍藏的一天。',alt:'温暖的亲子生活照片',src:'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?auto=format&fit=crop&w=1200&q=80'},
 {id:'steps',day:'2026-10-08',description:'今天扶着沙发站稳了好几秒！奶奶在旁边拍手，爸爸忙着拿手机，大家笑成一团。',alt:'孩子成长的日常瞬间',src:'https://images.unsplash.com/photo-1522771930-78848d9293e8?auto=format&fit=crop&w=1200&q=80',video:true},
 {id:'weekend',day:'2026-10-03',description:'一家人慢慢地散步，走走停停。原来平凡的周末，也可以这么幸福。',alt:'一家人相处的日常照片',src:'https://images.unsplash.com/photo-1491013516836-7db643ee125a?auto=format&fit=crop&w=1200&q=80'},
 {id:'play',day:'2026-09-28',description:'最喜欢的玩具还是那只小熊。今天突然学会了把它抱进怀里，然后开心地转圈圈。',alt:'孩子玩耍的照片',src:'https://images.unsplash.com/photo-1516627145497-ae6968895b74?auto=format&fit=crop&w=1200&q=80'}
];
const growth:RecordItem[]=[
 {id:'g1',day:'2026-06-15',weight:7.1,height:66.2},
 {id:'g2',day:'2026-07-16',weight:7.5,height:68.0},
 {id:'g3',day:'2026-08-17',weight:7.9,height:69.4},
 {id:'g4',day:'2026-09-16',weight:8.3,height:71.1},
 {id:'g5',day:'2026-10-11',weight:8.6,height:72.5}
];
const moments=[
 {day:'2026-10-10',title:'第一次扶站',description:'扶着沙发稳稳站住了。我们都在旁边鼓掌，宝宝自己也笑得很得意。'},
 {day:'2026-10-03',title:'一起过周末',description:'去公园吹风，捡了一片特别漂亮的落叶。没做什么大事，却是很温暖的一天。'},
 {day:'2026-09-25',title:'学会说“妈妈”',description:'吃饭时突然清清楚楚地叫了一声“妈妈”，全家都惊喜地看向她。'},
 {day:'2026-09-19',title:'第一次认真翻绘本',description:'自己翻过一页，又一页。读到小兔子时指着画面笑个不停。'}
];

const navItems:[DemoTab,string,ReactNode][]=[
 ['overview','首页',<Baby size={19}/>],
 ['album','相册',<Camera size={19}/>],
 ['growth','成长',<TrendingUp size={19}/>],
 ['moments','瞬间',<BookHeart size={19}/>],
 ['settings','设置',<Settings2 size={19}/>]
];
function DemoNav({active,onSelect}:{active:DemoTab;onSelect:(value:DemoTab)=>void}){
 return <>
  <aside className="sidebar"><Logo/><div className="side-label side-space-name">我们的温暖小家</div>
   <nav aria-label="演示页面">{navItems.map(([id,name,icon])=>
    <button type="button" key={id} className={'nav-link'+(id===active?' active':'')} aria-current={id===active?'page':undefined} onClick={()=>onSelect(id)}>{icon}{name}</button>)}</nav>
   <div className="sidebar-bottom"><div className="privacy"><ShieldCheck size={16}/> 私密家庭空间</div>
    <div className="demo-sidebar-foot">这是仅供体验的示例家庭</div>
   </div>
  </aside>
  <nav className="mobile-nav" aria-label="底部主导航">{navItems.filter(([id])=>id!=='moments').map(([id,name,icon])=>
   <button type="button" key={id} className={id===active||active==='moments'&&id==='overview'?'active':''} aria-current={id===active?'page':undefined} onClick={()=>onSelect(id)}>
    <span className="mobile-nav-icon" aria-hidden="true">{icon}</span><span className="mobile-nav-label">{name}</span>
   </button>)}</nav>
 </>;
}
function DemoPhoto({photo,lazy=false}:{photo:Photo;lazy?:boolean}){
 return <img src={photo.src} alt={photo.alt} loading={lazy?'lazy':'eager'} decoding="async" referrerPolicy="no-referrer"/>;
}
function PhotoViewer({index,onClose,onNavigate}:{index:number;onClose:()=>void;onNavigate:(n:number)=>void}){
 const item=photos[index],dialogRef=useRef<HTMLDialogElement>(null);
 // Native dialog matches the private viewer's Escape, focus trap and focus restoration.
 useEffect(()=>{const dialog=dialogRef.current;if(dialog&&!dialog.open)dialog.showModal();return()=>{if(dialog?.open)dialog.close()}},[]);
 return <dialog ref={dialogRef} className="media-dialog demo-viewer" aria-label="照片故事" onClose={onClose}
  onClick={event=>{if(event.target===dialogRef.current)dialogRef.current?.close()}}
  onKeyDown={event=>{const step=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0;if(step&&index+step>=0&&index+step<photos.length){event.preventDefault();onNavigate(index+step)}}}>
  <div className="media-viewer">
   <header className="media-viewer-header">
    <div><strong>{item.day}</strong><span className="muted" aria-live="polite">第 {index+1} / {photos.length} 项 · 只读演示</span></div>
    <button type="button" className="icon-btn" onClick={()=>dialogRef.current?.close()} aria-label="关闭照片详情"><X size={20}/></button>
   </header>
   <div className="media-viewer-stage demo-viewer-photo"><DemoPhoto photo={item}/>{item.video&&<span className="demo-video-mark"><Play size={15} fill="currentColor"/> 视频封面示例</span>}</div>
   <section className="media-story-panel" aria-label="照片背后的故事">
    <div className="media-story-head"><div><span className="media-story-kicker">这天的故事</span><time dateTime={item.day}>{item.day}</time></div></div>
    <p className="media-story-body">{item.description}</p>
   </section>
   <div className="media-viewer-toolbar demo-viewer-controls">
    <Button variant="secondary" disabled={index===0} onClick={()=>onNavigate(index-1)}><ChevronLeft size={18}/>上一张</Button>
    <Button variant="secondary" disabled={index===photos.length-1} onClick={()=>onNavigate(index+1)}>下一张<ChevronRight size={18}/></Button>
   </div>
  </div>
 </dialog>;
}


type DemoSettingsSection='profile'|'wechat'|'reports'|'ai'|'storage';
const demoSettingsSections:{id:DemoSettingsSection;label:string;description:string;icon:typeof Baby}[]=[
 {id:'profile',label:'宝宝与外观',description:'档案、主题',icon:Baby},
 {id:'wechat',label:'微信成员',description:'连接与收图',icon:UsersRound},
 {id:'reports',label:'成长报告',description:'周报、月报',icon:CalendarHeart},
 {id:'ai',label:'AI 模型',description:'模型设置',icon:BrainCircuit},
 {id:'storage',label:'数据与安全',description:'备份与维护',icon:HardDriveDownload}
];
function DemoSettings(){
 const [section,setSection]=useState<DemoSettingsSection>('profile');
 const [preview,setPreview]=useState<'week'|'month'>('week');
 const selected=demoSettingsSections.find(item=>item.id===section)!;
 return <div className="settings-layout demo-settings-layout">
  <nav className="settings-categories" aria-label="设置分类">
   {demoSettingsSections.map(item=>{const Icon=item.icon;return <button type="button" key={item.id} className={'settings-category'+(section===item.id?' is-active':'')} aria-current={section===item.id?'page':undefined} onClick={()=>setSection(item.id)}>
    <span className="settings-category-icon"><Icon size={19} aria-hidden="true"/></span>
    <span className="settings-category-label"><strong>{item.label}</strong><small>{item.description}</small></span>
    <ChevronRight size={16} className="settings-category-chevron" aria-hidden="true"/>
   </button>})}
  </nav>
  <section className="settings-main" aria-labelledby="demo-settings-section-title">
   <div className="settings-main-heading"><span className="settings-main-eyebrow">SETTINGS</span><h2 id="demo-settings-section-title">{selected.label}</h2><p>{selected.description} · 虚构家庭演示</p></div>
   <div className="settings-grid">
    {section==='profile'&&<>
     <section className="card span-2 appearance-settings"><div className="section-title"><h3>外观主题</h3></div><ThemeSelector/></section>
     <section className="card span-2"><div className="section-title"><h3>宝宝资料</h3><Baby size={20}/></div>
      <div className="demo-profile-intro"><span className="demo-profile-avatar"><Baby size={29}/></span><div><strong>小星星</strong><p className="muted small">我们的温暖小家 · 10 个月</p></div></div>
      <div className="demo-history-row"><span>出生日期</span><strong>2025-12-10</strong></div>
      <div className="demo-history-row"><span>家庭时区</span><strong>Asia/Shanghai</strong></div>
      <div className="demo-history-row"><span>家庭成员 · 宝宝</span><strong>1 位宝宝</strong></div>
      <p className="muted small">真实设置支持切换宝宝、修改档案、更新头像，以及新增和管理宝宝。</p>
     </section>
    </>}
    {section==='wechat'&&<section className="card span-2"><div className="section-title"><h3>微信操作</h3><UsersRound size={20}/></div>
      <p className="muted small">添加家庭成员的微信，就能在聊天中保存照片、视频和成长瞬间。</p>
      <div className="wechat-row"><div className="wechat-status"><strong>微信消息接收 · 已绑定 3 位 · 已启用 3 位</strong></div></div>
      {['爸爸','妈妈','外婆'].map(name=><div className="demo-wechat-member" key={name}><span className="demo-member-avatar"><UsersRound size={17}/></span><div><strong>{name}</strong><small className="muted">演示成员 · 正在接收消息</small></div><span className="demo-member-state"><Wifi size={14}/>已连接</span></div>)}
      <div className="demo-settings-explainer">真实产品可扫码绑定家人、查看连接状态、设置照片归档的默认宝宝。这里不会连接微信。</div>
     </section>}
    {section==='reports'&&<section className="card span-2 family-report-settings demo-report-settings">
     <div className="section-title"><div><h3>家庭成长周报与月报</h3><p className="muted small">AI 依据真实记录生成成长故事、成长指标及照片视频统计。</p></div><CalendarHeart size={20}/></div>
     <div className="stack">
      <div className="family-report-toggle"><span><strong>每周 AI 成长报告</strong><small className="muted">每周日自动发送微信</small></span><span className="demo-report-state">演示 · 关闭</span></div>
      <div className="family-report-toggle"><span><strong>每月 AI 成长报告</strong><small className="muted">每月 1 日发送上月报告</small></span><span className="demo-report-state">演示 · 关闭</span></div>
      <p className="muted small">正式设置中可分别开启、选择时间与家人，并向单个成员试发报告。</p>
      <div className="demo-report-preview">
       <div className="demo-preview-head"><strong>查看 AI 报告示例</strong><span className="demo-readonly">虚构内容 · 不发送</span></div>
       <SegmentedControl label="示例报告类型" value={preview} onChange={setPreview} options={[{value:'week' as const,label:'周报'},{value:'month' as const,label:'月报'}]}/>
       <article className="demo-wechat-report">
        <span className="demo-report-eyebrow">🌱 小星星的{preview==='week'?'这一周':'10月成长记'}</span>
        <time dateTime={preview==='week'?'2026-10-12':'2026-10-01'}>{preview==='week'?'10月12日 — 10月18日 · BabyMemo 成长周报':'2026年10月 · BabyMemo 成长月报'}</time>
        <strong>{preview==='week'?'追着泡泡跑的下午':'把平凡日子存进十月'}</strong>
        {preview==='week'?<>
         <p>这一周，小星星在公园里发现了会飞的泡泡，一路追着跑，跌倒后又爬起来。傍晚的阳光和这一阵笑声，成了家人想记住的下午。</p>
         <p>周末的早晨，她抱着小毯子笑个不停。这样的普通日常，也慢慢成了珍贵的回忆。</p>
        </>:<>
         <p>十月的小星星有不少值得珍藏的日子：在公园追泡泡、扶着沙发站住，还有一家人慢慢散步的周末。</p>
         <p>我们记下了她对小小世界的好奇，也记下平凡的清晨和周末。那些细节，正是这个月独一无二的模样。</p>
         <p>每次翻开记录，都能重新想起当时一家人陪在身边的时光。</p>
        </>}
        <strong>📒 本期成长足迹</strong>
        <p>✨ {preview==='week'?'2':'3'} 个瞬间 · 📷 {preview==='week'?'3':'4'} 张照片 · 🎬 1 段视频</p>
        <p>📏 体重 8.6 kg（10月11日测量） · 身高 72.5 cm（10月11日测量）</p>
       </article>
      </div>
      <p className="muted small">演示不会访问微信、不调用 AI、不修改报告设置。真实报告只根据家庭已有记录生成。</p>
     </div>
    </section>}
    {section==='ai'&&<section className="card span-2 settings-ai-card"><div className="section-title"><h3>微信 AI 模型</h3><BrainCircuit size={20}/></div>
      <div className="settings-ai-overview"><div><span className="settings-ai-caption">默认提供方</span><strong>Cloudflare Workers AI</strong><p className="muted small">也可在真实设置中切换到 OpenRouter 模型。</p></div><span className="demo-readonly">示例配置</span></div>
      <div className="demo-settings-explainer">真实设置还支持检测模型连接、填写模型 ID 与安全管理 API Key；演示不会调用任何 AI 服务。</div>
     </section>}
    {section==='storage'&&<>
     <section className="card span-2"><div className="section-title"><h3>家庭数据与回收站</h3><ShieldCheck size={20}/></div>
      <div className="demo-history-row"><span>完整家庭档案</span><strong>ZIP 导出</strong></div>
      <div className="demo-history-row"><span>恢复删除的记录</span><strong>30 天内</strong></div>
      <div className="demo-history-row"><span>相册封面维护</span><strong>按需修复</strong></div>
      <p className="muted small">真实产品支持私密备份、离线同步、回收站和封面修复。演示不会下载或修改数据。</p>
     </section>
     <section className="card span-2"><div className="section-title"><h3>账户安全</h3><ShieldCheck size={20}/></div>
      <div className="demo-settings-explainer">真实设置允许修改家庭密码并注销旧会话，演示不会要求输入密码。</div>
     </section>
    </>}
   </div>
  </section>
 </div>;
}

export default function Demo(){
 const [active,setActive]=useState<DemoTab>('overview');
 const [albumMode,setAlbumMode]=useState<'stories'|'grid'>('stories');
 const [selected,setSelected]=useState<number|null>(null);
 const titles:Record<DemoTab,string>={overview:'成长日记',album:'相册',growth:'成长记录',moments:'成长瞬间',settings:'设置'};
 function go(tab:DemoTab){setActive(tab);window.scrollTo(0,0)}
 return <div className="app demo-app">
  <DemoNav active={active} onSelect={go}/>
  <main className="workspace">
   <div className={'topbar'+(active==='moments'?' has-back':'')}>
    {active==='moments'&&<button type="button" className="mobile-back-button" onClick={()=>go('overview')}><ChevronLeft size={19}/>首页</button>}
    <div className="crumb"><span className="space-name">我们的温暖小家</span><ChevronRight size={14}/><strong>{titles[active]}</strong></div>
    <div className="top-right"><span className="secure"><ShieldCheck size={14}/> 仅家人可见</span><span className="avatar" aria-label="示例管理员">家</span></div>
   </div>
   <div className="page">
    <div className="demo-note" role="note"><span><strong>只读演示</strong> · 虚构的家庭与成长故事</span><div className="demo-note-links"><a href="/demo/mobile">体验手机版 ↗</a><a className="demo-note-project" href="https://github.com/zhajiahe/babymemo" target="_blank" rel="noopener noreferrer">了解项目 ↗</a></div></div>
    <header className={'page-heading'+(active==='album'?' page-heading-album':'')}>
     <div className="page-heading-content"><h1>{active==='overview'?'小星星':titles[active]}</h1><p className="muted">{active==='overview'?'10 个月 · 成长日记':active==='album'?'照片与视频':'小星星 · 10 个月'}</p></div>
     {active==='overview'&&<button type="button" className="home-quick-add" onClick={()=>go('moments')}><BookHeart size={16}/> 浏览瞬间</button>}
    </header>
    {active==='overview'&&<div className="home-feed">
     <section className="home-memories" aria-label="最近照片">
      <div className="section-title home-section-title"><h2>最近的照片</h2><button type="button" className="text-btn" onClick={()=>go('album')}>查看相册 <ChevronRight size={16}/></button></div>
      <button type="button" className="home-photo-cover" onClick={()=>go('album')} aria-label="打开相册查看照片故事"><DemoPhoto photo={photos[0]}/></button>
      <button type="button" className="home-story-highlight demo-story-highlight" onClick={()=>{go('album');setSelected(0)}}>
       <span className="home-story-date demo-story-date">10 月 12 日 · 一天的小故事</span>
       <strong>追着泡泡跑的下午</strong>
       <span>今天在公园里发现了会飞的泡泡。小星星一路追着跑，摔了一跤也不哭……</span>
       <span className="home-story-open demo-story-open">读完整故事 <ChevronRight size={16}/></span>
      </button>
      <div className="home-photo-strip">{photos.slice(1).map((p,i)=><button type="button" key={p.id} className="home-photo-thumb" onClick={()=>{go('album');setSelected(i+1)}} aria-label={'查看 '+p.day+' 的照片故事'}><DemoPhoto photo={p} lazy/>{p.video&&<span className="home-thumb-video"><Play size={13} fill="currentColor"/></span>}</button>)}</div>
     </section>
     <section className="home-measurements" aria-label="成长曲线"><div className="section-title home-section-title"><h2>成长记录</h2><button type="button" className="text-btn" onClick={()=>go('growth')}>查看记录 <ChevronRight size={16}/></button></div><GrowthChart items={growth}/></section>
     <section className="home-events" aria-label="最近的日子"><div className="section-title home-section-title"><h2>最近的日子</h2><button type="button" className="text-btn" onClick={()=>go('moments')}>查看全部 <ChevronRight size={16}/></button></div>
      {moments.slice(0,3).map(m=><div className="home-event" key={m.day}><time dateTime={m.day}>{m.day}</time><span>{m.title}</span></div>)}
      <button type="button" className="home-add-moment" onClick={()=>go('moments')}><Plus size={16}/> 记录新瞬间</button>
     </section>
    </div>}
    {active==='album'&&<>
     <div className="album-toolbar album-content-toolbar"><div className="album-toolbar-heading"><h2>照片与视频</h2></div><span className="demo-readonly">示例内容 · 只读</span></div>
     <SegmentedControl className="album-view-switch" label="相册浏览方式" value={albumMode} onChange={setAlbumMode} options={[{value:'stories' as const,label:'故事',icon:<BookOpenText size={17}/>},{value:'grid' as const,label:'照片墙',icon:<Images size={17}/>}]} />
     <section className={albumMode==='stories'?'photo-month photo-month-stories':'photo-month'}><h3>2026 年 10 月</h3>
      <div className={albumMode==='stories'?'photo-stories':'photo-grid'}>{photos.filter(p=>p.day.startsWith('2026-10')).map(photo=><article key={photo.id} className={albumMode==='stories'?'photo-story':'photo-item'}>
       <button type="button" className="photo-preview" onClick={()=>setSelected(photos.indexOf(photo))} aria-label={'打开 '+photo.day+' 的照片故事'}>
        <span className="photo-frame"><DemoPhoto photo={photo} lazy/>{photo.video&&<span className="video-play-badge"><Play size={14} fill="currentColor"/></span>}</span>
       </button>
       {albumMode==='stories'&&<div className="photo-story-copy"><time dateTime={photo.day}>{photo.day}</time><p className="photo-story-text">{photo.description}</p></div>}
      </article>)}</div>
     </section>
     <section className={albumMode==='stories'?'photo-month photo-month-stories':'photo-month'}><h3>2026 年 9 月</h3><div className={albumMode==='stories'?'photo-stories':'photo-grid'}>
      {photos.filter(p=>p.day.startsWith('2026-09')).map(photo=><article key={photo.id} className={albumMode==='stories'?'photo-story':'photo-item'}>
       <button type="button" className="photo-preview" onClick={()=>setSelected(photos.indexOf(photo))} aria-label={'打开 '+photo.day+' 的照片故事'}><span className="photo-frame"><DemoPhoto photo={photo} lazy/></span></button>
       {albumMode==='stories'&&<div className="photo-story-copy"><time dateTime={photo.day}>{photo.day}</time><p className="photo-story-text">{photo.description}</p></div>}
      </article>)}
     </div></section>
    </>}
    {active==='growth'&&<div className="demo-growth"><GrowthChart items={growth}/><section className="card"><h2>测量历史</h2><p className="muted">每一次变化，都有迹可循。</p>{growth.slice().reverse().map(record=><div className="demo-history-row" key={record.id}><time dateTime={record.day}>{record.day}</time><span>体重 {record.weight} kg</span><span>身高 {record.height} cm</span></div>)}</section></div>}
    {active==='moments'&&<section className="demo-moments"><div className="demo-moments-intro">记录那些不想忘记的第一次，和每一个平凡又珍贵的日子。</div>{moments.map(moment=><article className="card demo-moment" key={moment.day}><time dateTime={moment.day}>{moment.day}</time><h2>{moment.title}</h2><p>{moment.description}</p></article>)}</section>}
    {active==='settings'&&<DemoSettings/>}
   </div>
  </main>
  {selected!==null&&<PhotoViewer index={selected} onClose={()=>setSelected(null)} onNavigate={setSelected}/>}
 </div>;
}
