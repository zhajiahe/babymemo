import {useEffect,useRef,useState,type ReactNode} from 'react';
import {
  Baby, BookHeart, BookOpenText, Camera, ChevronLeft, ChevronRight, Heart,
  Images, Play, Plus, Settings2, ShieldCheck, TrendingUp, X
} from 'lucide-react';
import {Logo,Button,SegmentedControl} from '../components/ui';
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
    <div className="demo-note"><span><strong>产品体验</strong> · 虚构家庭与示例记录，直接浏览真实风格的应用界面</span><a href="https://github.com/zhajiahe/babymemo" target="_blank" rel="noopener noreferrer">了解 BabyMemo ↗</a></div>
    <header className={'page-heading'+(active==='album'?' page-heading-album':'')}>
     <div className="page-heading-content"><h1>{active==='overview'?'小星星':titles[active]}</h1><p className="muted">{active==='overview'?'10 个月 · 成长日记':active==='album'?'照片与视频':'小星星 · 10 个月'}</p></div>
     {active==='overview'&&<button type="button" className="home-quick-add" onClick={()=>go('moments')}><Plus size={16}/> 记录瞬间</button>}
    </header>
    {active==='overview'&&<div className="home-feed">
     <section className="home-memories" aria-label="最近照片">
      <div className="section-title home-section-title"><h2>最近的照片</h2><button type="button" className="text-btn" onClick={()=>go('album')}>查看相册 <ChevronRight size={16}/></button></div>
      <button type="button" className="home-photo-cover" onClick={()=>go('album')} aria-label="打开相册查看照片故事"><DemoPhoto photo={photos[0]}/></button>
      <div className="home-photo-strip">{photos.slice(1).map((p,i)=><button type="button" key={p.id} className="home-photo-thumb" onClick={()=>{go('album');setSelected(i+1)}} aria-label={'查看 '+p.day+' 的照片故事'}><DemoPhoto photo={p} lazy/>{p.video&&<span className="home-thumb-video"><Play size={13} fill="currentColor"/></span>}</button>)}</div>
      <button type="button" className="demo-story-highlight" onClick={()=>{go('album');setSelected(0)}}>
       <span className="demo-story-date">10 月 12 日 · 一天的小故事</span>
       <strong>追着泡泡跑的下午</strong>
       <span>今天在公园里发现了会飞的泡泡。小星星一路追着跑，摔了一跤也不哭……</span>
       <span className="demo-story-open">读完整故事 <ChevronRight size={16}/></span>
      </button>
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
    {active==='settings'&&<div className="demo-settings"><section className="card"><h2>家庭空间</h2><p className="muted">我们的温暖小家</p><div className="demo-history-row"><span>宝宝</span><strong>小星星</strong></div><div className="demo-history-row"><span>家庭成员</span><strong>仅受邀家人</strong></div><div className="demo-history-row"><span>照片与日记</span><strong>私密保存</strong></div></section><section className="card demo-setting-note"><ShieldCheck size={22}/><h2>只属于家人的成长记录</h2><p>真实 BabyMemo 还支持微信记录、离线同步与家庭档案导出。演示仅展示只读界面，不会保存或修改数据。</p><a href="https://github.com/zhajiahe/babymemo" target="_blank" rel="noopener noreferrer">查看产品与部署说明 ↗</a></section></div>}
   </div>
  </main>
  {selected!==null&&<PhotoViewer index={selected} onClose={()=>setSelected(null)} onNavigate={setSelected}/>}
 </div>;
}
