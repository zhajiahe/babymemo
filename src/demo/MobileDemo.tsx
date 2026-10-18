import {useEffect,useState} from 'react';
import {ExternalLink,Monitor,Smartphone} from 'lucide-react';
import Demo from './Demo';
import {ThemeSelector} from '../components/ThemeSelector';

// Desktop: a real interactive 390px browser viewport. On phones: render the
// shared read-only Demo directly, avoiding nested touch scroll and iframe traps.
export default function MobileDemo(){
 const [onPhone,setOnPhone]=useState(()=>window.matchMedia('(max-width:800px)').matches);
 useEffect(()=>{
  const media=window.matchMedia('(max-width:800px)');
  const update=()=>setOnPhone(media.matches);
  media.addEventListener('change',update);
  return()=>media.removeEventListener('change',update);
 },[]);
 if(onPhone)return <div className="mobile-demo-live"><Demo/></div>;
 return <main className="mobile-demo-shell">
  <header className="mobile-demo-header">
   <a className="mobile-demo-brand" href="/demo" aria-label="返回 BabyMemo 网页 Demo"><span className="mobile-demo-mark"><Smartphone size={20}/></span><span>BabyMemo <small>移动端体验</small></span></a>
   <ThemeSelector compact/><nav className="mobile-demo-links" aria-label="切换演示版本">
    <a href="/demo"><Monitor size={16}/> 网页版</a>
    <a href="/demo/mobile" aria-current="page"><Smartphone size={16}/> 移动版</a>
   </nav>
  </header>
  <div className="mobile-demo-body">
   <div className="mobile-demo-intro">
    <span className="mobile-demo-kicker">一个温暖的小小空间</span>
    <h1>把每一个瞬间，都留在掌心。</h1>
    <p>在右侧手机中，亲自体验照片故事、成长曲线、分类设置，以及 AI 周报与月报示例。使用的是同一份只读交互 Demo，而不是手机界面截图。</p>
    <a href="/demo.html" className="mobile-demo-open"><ExternalLink size={17}/> 在新页面打开完整 Demo</a>
    <span className="mobile-demo-privacy">虚构家庭与示例照片 · 无需登录 · 不读取真实家庭数据</span>
   </div>
   <div className="mobile-demo-device-wrap">
    <div className="mobile-demo-device" aria-label="390 像素宽的手机预览">
     <div className="mobile-demo-island" aria-hidden="true"/>
     <iframe title="BabyMemo 移动端交互演示" src="/demo.html" loading="eager" referrerPolicy="no-referrer"/>
    </div>
    <p className="mobile-demo-device-label"><Smartphone size={14}/> 390px 手机视图 · 可点击、可滚动</p>
   </div>
  </div>
 </main>;
}
