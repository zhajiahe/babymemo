import {queueMedia,syncOffline} from '../../offline';
import {downloadFamilyArchive} from '../../export-download';
import {useEffect,useState,useSyncExternalStore,type FormEvent} from 'react';
import {Button,Card,Field,Primary,ModalDialog} from '../../components/ui';
import {ThemeSelector} from '../../components/ThemeSelector';
import {Baby,Check,Plus,ShieldCheck,CloudUpload,WandSparkles,MessageCircle,RefreshCw,WifiOff,Wifi,BrainCircuit,ChevronRight,ChevronLeft,CalendarHeart,HardDriveDownload,UsersRound} from 'lucide-react';
import {api,post,today,type BabyInfo,type State,type WechatRunStatus} from '../../lib/client';
import {DEFAULT_OPENROUTER_MODEL,OPENROUTER_MODEL_PRESETS,openRouterModelDescription} from '../../openrouter-model.mjs';
import {wechatStatusView,wechatStatusTime} from '../../wechat-status.mjs';
import {getThumbnailRepairSnapshot,subscribeThumbnailRepair,startThumbnailRepair,pauseThumbnailRepair} from '../../thumbnail-repair';

type FamilyReportSettings={weekly:boolean;monthly:boolean;hour:number;timeZone:string;
 members:{id:string;label:string;enabled:boolean;subscribed:boolean;hasContext:boolean;lastContextAt:string|null}[];
 reports:{kind:'week'|'month';period_start:string;period_end:string;recipients:number;sent:number;failed:number;waiting:number}[]};

type SettingsSection='profile'|'wechat'|'reports'|'ai'|'storage';
const SETTINGS_SECTIONS:{id:SettingsSection;label:string;description:string;icon:typeof Baby}[]=[
 {id:'profile',label:'宝宝与外观',description:'档案、主题',icon:Baby},
 {id:'wechat',label:'微信成员',description:'连接与收图',icon:UsersRound},
 {id:'reports',label:'成长报告',description:'周报、月报',icon:CalendarHeart},
 {id:'ai',label:'AI 模型',description:'模型设置',icon:BrainCircuit},
 {id:'storage',label:'数据与安全',description:'备份与维护',icon:HardDriveDownload}
];
function babyDraft(baby:BabyInfo){try{return JSON.parse(localStorage.getItem('babymemo-draft-baby-'+baby.id)||'null')||baby}catch{return baby}}

export function Settings({state,baby,changed,notify,onBabyCreated,onBabySelected}:{state:State;baby:BabyInfo;changed:()=>void;notify:(s:string)=>void;onBabyCreated:(id:string)=>void;onBabySelected:(id:string)=>void}){
 const [activeSection,setActiveSection]=useState<SettingsSection>('profile');
 const [mobileDetail,setMobileDetail]=useState(false);
 const selectedSection=SETTINGS_SECTIONS.find(section=>section.id===activeSection)!;
 useEffect(()=>{if(window.matchMedia('(max-width: 800px)').matches)window.scrollTo({top:0})},[mobileDetail,activeSection]);
 const [provider,setProvider]=useState<'workers-ai'|'openrouter'>(state.ai?.provider||'workers-ai');
 const [model,setModel]=useState(state.openrouter.model),[apiKey,setApiKey]=useState(''),[saving,setSaving]=useState(false);
 const [testingModel,setTestingModel]=useState(false),[aiProbe,setAiProbe]=useState<{provider:string;ok:boolean;message:string}|null>(null);
 const savedProvider=state.ai?.provider||'workers-ai',modelDirty=provider!==savedProvider||(provider==='openrouter'&&(model!==state.openrouter.model||!!apiKey));
 const activeModel=savedProvider==='workers-ai'?'Qwen3.8-27B':state.openrouter.model;
 useEffect(()=>{setProvider(state.ai?.provider||'workers-ai');setAiProbe(null)},[state.ai?.provider]);
 const [photoBaby,setPhotoBaby]=useState(state.wechat.defaultBabyId||''),[photoBabyBusy,setPhotoBabyBusy]=useState(false);
 const [reportSettings,setReportSettings]=useState<FamilyReportSettings|null>(null),[reportSaving,setReportSaving]=useState(false),[reportMemberBusy,setReportMemberBusy]=useState('');
 const [reportTestMember,setReportTestMember]=useState(''),[reportTestBusy,setReportTestBusy]=useState(false),[reportTestResult,setReportTestResult]=useState('');
 useEffect(()=>{
  let canceled=false;
  void api<FamilyReportSettings>('/api/settings/family-reports').then(x=>{if(!canceled)setReportSettings(x)}).catch(()=>{if(!canceled)notify('成长报告设置暂时无法读取')});
  return ()=>{canceled=true};
 },[state.wechat.connections.map(x=>x.id+':'+x.enabled+':'+x.updatedAt).join('|')]);
 async function saveReportSettings(){
  if(!reportSettings||reportSaving)return;
  setReportSaving(true);
  try{
   const result=await api<{config:{weekly:boolean;monthly:boolean;hour:number;timeZone:string}}>('/api/settings/family-reports',{method:'PUT',body:JSON.stringify({weekly:reportSettings.weekly,monthly:reportSettings.monthly,hour:reportSettings.hour})});
   setReportSettings(old=>old?{...old,...result.config}:old);notify('成长报告设置已保存');
  }catch(e){notify(e instanceof Error?e.message:'无法保存成长报告')}finally{setReportSaving(false)}
 }
 async function testFamilyReport(kind:'week'|'month'){
  if(reportTestBusy||!reportTestMember)return;
  setReportTestBusy(true);setReportTestResult('');
  try{
   const sent=await post<{accepted:boolean;periodStart:string;periodEnd:string}>('/api/settings/family-reports/test',{kind,connectionId:reportTestMember});
   setReportTestResult((kind==='week'?'测试周报':'测试月报')+'已提交微信接口（'+sent.periodStart+' 至 '+sent.periodEnd+'）。请在收件人手机微信中确认是否收到。');
   notify('测试消息已提交微信接口，需用手机确认实际送达');
  }catch(e){
   const reason=e instanceof Error?e.message:'测试发送失败';
   setReportTestResult('测试未成功：'+reason);
   notify('测试发送失败：'+reason);
  }finally{setReportTestBusy(false)}
 }
 async function changeReportMember(id:string,subscribed:boolean){
  if(reportMemberBusy)return;setReportMemberBusy(id);
  try{
   await api('/api/settings/family-reports/members/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({subscribed})});
   setReportSettings(old=>old?{...old,members:old.members.map(m=>m.id===id?{...m,subscribed}:m)}:old);
   notify(subscribed?'已允许该成员接收成长报告':'已停止向该成员发送报告');
  }catch(e){notify(e instanceof Error?e.message:'订阅设置更新失败')}finally{setReportMemberBusy('')}
 }
 useEffect(()=>{setPhotoBaby(state.wechat.defaultBabyId||'')},[state.wechat.defaultBabyId]);
 const draft=babyDraft(baby);
 const [name,setName]=useState(draft.name),[birthday,setBirthday]=useState(draft.birthday),[birthTime,setBirthTime]=useState(draft.birth_time||''),[allergies,setAllergies]=useState(draft.allergies);
 const [gender,setGender]=useState(draft.gender),[timeZone,setTimeZone]=useState(draft.time_zone),[notes,setNotes]=useState(draft.notes||''),[formVersion,setFormVersion]=useState(draft.updated_at||''),[dirty,setDirty]=useState(()=>!!localStorage.getItem('babymemo-draft-baby-'+baby.id));
 const [babyBusy,setBabyBusy]=useState(false),[avatarBusy,setAvatarBusy]=useState(false),[exportBusy,setExportBusy]=useState(false);
 const [archived,setArchived]=useState<{id:string;name:string}[]>([]);
 const [showNewBaby,setShowNewBaby]=useState(false),[creatingBaby,setCreatingBaby]=useState(false),[createError,setCreateError]=useState('');
 const newBabyDraftKey='babymemo-draft-new-baby-'+baby.id;
 const [newBaby,setNewBaby]=useState(()=>{
  try{const raw=localStorage.getItem(newBabyDraftKey);return raw?{name:'',birthday:'',birthTime:'',gender:'girl',timeZone:'Asia/Shanghai',allergies:'',...JSON.parse(raw)}:{name:'',birthday:'',birthTime:'',gender:'girl',timeZone:'Asia/Shanghai',allergies:''}}
  catch{return {name:'',birthday:'',birthTime:'',gender:'girl',timeZone:'Asia/Shanghai',allergies:''}}
 });
 useEffect(()=>{try{if(newBaby.name||newBaby.birthday||newBaby.birthTime||newBaby.allergies)localStorage.setItem(newBabyDraftKey,JSON.stringify(newBaby))}catch{/* The form remains usable without local device storage. */}},[newBaby,newBabyDraftKey]);
 const [qr,setQr]=useState(''),[pairingId,setPairingId]=useState(''),[qrImage,setQrImage]=useState(''),[status,setStatus]=useState(''),[verifyCode,setVerifyCode]=useState('');
 const [runStatuses,setRunStatuses]=useState<Record<string,WechatRunStatus>>({}),[inspectedMember,setInspectedMember]=useState('');
 const checkedWechat=state.wechat.connections.filter(member=>!!runStatuses[member.id]);
 const healthyWechat=checkedWechat.filter(member=>wechatStatusView(runStatuses[member.id]).tone==='active').length;
 const warningWechat=checkedWechat.filter(member=>wechatStatusView(runStatuses[member.id]).tone==='warning').length;
 const membersKey=state.wechat.connections.map(x=>x.id+':'+x.enabled+':'+x.updatedAt).join('|');
 useEffect(()=>{
  let cancelled=false;let timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
  async function refresh(){
   if(document.visibilityState==='hidden'){timer=setTimeout(refresh,10000);return}
   const entries=await Promise.all(state.wechat.connections.map(async member=>{
    try{return [member.id,await api<WechatRunStatus>('/api/settings/wechat/connections/'+encodeURIComponent(member.id)+'/status',{signal:controller.signal})] as const}
    catch{return [member.id,{connectionId:member.id,connected:true,enabled:member.enabled,unavailable:true,lastPoll:null,lastMessage:null,lastError:null}] as const}
   }));
   if(cancelled)return;setRunStatuses(Object.fromEntries(entries));timer=setTimeout(refresh,10000);
  }
  void refresh();return()=>{cancelled=true;controller.abort();clearTimeout(timer)};
 },[membersKey]);
 const [memberName,setMemberName]=useState(''),[memberBusy,setMemberBusy]=useState(''),[showPairing,setShowPairing]=useState(false);
 const [password,setPassword]=useState({currentPassword:'',newPassword:'',confirmPassword:''}),[passwordBusy,setPasswordBusy]=useState(false);
 const [trash,setTrash]=useState<{growth:{id:string;baby_id:string;day:string;deleted_at:string}[];milestones:{id:string;baby_id:string;day:string;title:string;deleted_at:string}[];media:{id:string;baby_id:string;day:string;title:string;deleted_at:string}[]}|null>(null);
 const [trashBusy,setTrashBusy]=useState(false);
 const coverRepair=useSyncExternalStore(subscribeThumbnailRepair,getThumbnailRepairSnapshot);
 useEffect(()=>{if(!dirty&&baby.updated_at!==formVersion){setName(baby.name);setBirthday(baby.birthday);setBirthTime(baby.birth_time||'');setAllergies(baby.allergies);setGender(baby.gender);setTimeZone(baby.time_zone);setNotes(baby.notes||'');setFormVersion(baby.updated_at||'')}},[baby.updated_at]);
 useEffect(()=>{if(dirty)try{localStorage.setItem('babymemo-draft-baby-'+baby.id,JSON.stringify({name,birthday,birth_time:birthTime,gender,time_zone:timeZone,allergies,notes,updated_at:formVersion}))}catch{notify('本机存储不可用，关闭页面前请保存资料。')}},[name,birthday,birthTime,gender,timeZone,allergies,notes,dirty]);
 useEffect(()=>{if(qr)void import('qrcode').then(({default:QRCode})=>QRCode.toDataURL(qr,{width:220,margin:2,errorCorrectionLevel:'M'})).then(setQrImage).catch(()=>notify('二维码渲染失败'))},[qr]);
 useEffect(()=>{if(!qr||status==='confirmed'||status==='expired')return;let cancelled=false;let timeout:ReturnType<typeof setTimeout>;
  const poll=async()=>{try{const r=await post<{status:string}>('/api/settings/wechat/qr/status',{pairingId,verifyCode});if(cancelled)return;setStatus(r.status);if(r.status==='confirmed'){setQr('');setQrImage('');setPairingId('');setVerifyCode('');setShowPairing(false);changed();notify('微信成员绑定成功，可在列表中启用');return;}}catch(e){if(!cancelled)setStatus('连接重试中');}if(!cancelled)timeout=setTimeout(poll,2000)};
  timeout=setTimeout(poll,500);return()=>{cancelled=true;clearTimeout(timeout)};
 },[qr,pairingId,verifyCode,status==='confirmed',status==='expired']);
 async function saveOpenrouter(e:FormEvent){e.preventDefault();if(saving)return;setSaving(true);setAiProbe(null);try{
  if(provider==='openrouter')await post('/api/settings/openrouter',{model,...(!state.openrouter.managedByDeployment&&apiKey?{apiKey}:{})});
  await post('/api/settings/ai',{provider});setApiKey('');changed();notify('微信模型设置已保存，全部成员将使用新提供方');
 }catch(e){notify(e instanceof Error?e.message:'保存失败')}finally{setSaving(false)}}
 async function saveBaby(e:FormEvent){e.preventDefault();if(babyBusy)return;setBabyBusy(true);try{
  const result=await api<{id:string;queued?:boolean}>('/api/babies/'+baby.id,{method:'PATCH',body:JSON.stringify({name,birthday,birthTime,gender,timeZone,allergies,notes,expectedUpdatedAt:formVersion})});
  localStorage.removeItem('babymemo-draft-baby-'+baby.id);setDirty(false);if(result.queued)setFormVersion('pending:'+result.id);changed();notify(result.queued?'宝宝资料已保存在本机，联网后同步':'宝宝资料已更新');
 }catch(e){notify(e instanceof Error?e.message:'保存失败')}finally{setBabyBusy(false)}}
 async function avatar(file:File){
  setAvatarBusy(true);
  const objectUrl=URL.createObjectURL(file);
  try{
   if(file.size>25*1024*1024)throw Error('头像文件请小于25MiB');
   const image=new Image();image.src=objectUrl;await image.decode();
   const side=Math.min(image.naturalWidth,image.naturalHeight),canvas=document.createElement('canvas');canvas.width=canvas.height=256;
   const context=canvas.getContext('2d');if(!context)throw Error('浏览器暂不支持头像处理');context.fillStyle='#fff';context.fillRect(0,0,256,256);context.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,256,256);
   const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85));if(!blob)throw Error('无法生成头像');
   await queueMedia(blob,{babyId:baby.id,mime:'image/jpeg',expectedUpdatedAt:baby.updated_at||''},'avatar','/api/babies/'+baby.id+'/avatar');await syncOffline();changed();notify(navigator.onLine?'头像已进入保存队列，请查看同步状态':'头像已保存在本机，联网后同步');
  }catch(e){notify(e instanceof Error?e.message:'头像处理失败')}finally{URL.revokeObjectURL(objectUrl);setAvatarBusy(false)}
 }
 async function archiveBaby(){if(!confirm('将宝宝移出常用列表？档案、照片和记录都会保留，可以恢复。'))return;try{await api('/api/babies/'+baby.id,{method:'DELETE'});changed();notify('宝宝已移出常用列表，记录保留')}catch(e){notify(e instanceof Error?e.message:'操作失败')}}
 async function loadArchived(){try{setArchived((await api<{items:{id:string;name:string}[]}>('/api/babies/archived/list')).items)}catch(e){notify(e instanceof Error?e.message:'读取失败')}}
 async function addBaby(e:FormEvent){
  e.preventDefault();
  if(creatingBaby)return;
  setCreatingBaby(true);setCreateError('');
  try{
   const created=await post<{id:string}>('/api/babies',newBaby);
   localStorage.removeItem(newBabyDraftKey);
   setNewBaby({name:'',birthday:'',birthTime:'',gender:'girl',timeZone:'Asia/Shanghai',allergies:''});
   setShowNewBaby(false);
   changed();
   onBabyCreated(created.id);
   notify('新宝宝档案已创建，已切换到 '+newBaby.name.trim());
  }catch(e){
   setCreateError(e instanceof Error?e.message:'新增宝宝失败，请重试');
  }finally{setCreatingBaby(false)}
 }
 async function loadTrash(){setTrashBusy(true);try{setTrash(await api('/api/trash'))}catch(e){notify(e instanceof Error?e.message:'回收站读取失败')}finally{setTrashBusy(false)}}
 async function restore(kind:'growth'|'milestones'|'media',id:string){try{await post('/api/trash/'+kind+'/'+id+'/restore',{});await loadTrash();changed();notify('已从回收站恢复')}catch(e){notify(e instanceof Error?e.message:'恢复失败')}}
 async function changePassword(e:FormEvent){e.preventDefault();if(password.newPassword!==password.confirmPassword){notify('两次新密码不一致');return}
  if(passwordBusy)return;setPasswordBusy(true);
  try{await post('/api/settings/password',{currentPassword:password.currentPassword,newPassword:password.newPassword});setPassword({currentPassword:'',newPassword:'',confirmPassword:''});window.location.reload()}
  catch(e){notify(e instanceof Error?e.message:'修改密码失败')}finally{setPasswordBusy(false)}
 }
 async function pair(){
  if(!memberName.trim()){notify('请先填写要绑定的家庭成员称呼');return}
  try{
   setStatus('正在获取二维码…');
   const r=await post<{qrContent:string;pairingId:string}>('/api/settings/wechat/qr',{label:memberName.trim()});
   setPairingId(r.pairingId);setQr(r.qrContent);setStatus('wait');setVerifyCode('');
  }catch(e){notify(String(e))}
 }
 async function savePhotoBaby(){
  if(photoBabyBusy)return;setPhotoBabyBusy(true);
  try{await post('/api/settings/wechat/default-baby',{babyId:photoBaby});changed();notify(photoBaby?'已设置微信照片的默认宝宝':'已清除微信媒体默认宝宝')}
  catch(e){notify(e instanceof Error?e.message:'无法保存默认宝宝')}
  finally{setPhotoBabyBusy(false)}
 }
 async function toggleBot(id:string,action:'start'|'pause'){
  if(memberBusy)return;setMemberBusy(id);
  try{await post('/api/settings/wechat/connections/'+encodeURIComponent(id)+'/'+action,{});changed();notify(action==='start'?'该微信 Bot 已启用':'该微信 Bot 已暂停')}
  catch(e){notify(String(e))}finally{setMemberBusy('')}
 }
 async function removeMember(id:string,label:string){
  if(memberBusy||!window.confirm('移除“'+label+'”的微信连接？尚未完成的微信保存任务会取消，已保存的成长记录和照片不会删除。'))return;
  setMemberBusy(id);
  try{await api('/api/settings/wechat/connections/'+encodeURIComponent(id),{method:'DELETE'});changed();setInspectedMember('');notify('已移除微信成员：'+label)}
  catch(e){notify(String(e))}finally{setMemberBusy('')}
 }
 async function renameMember(id:string,label:string){
  const next=window.prompt('修改成员称呼',label)?.trim();
  if(!next||next===label||memberBusy)return;
  setMemberBusy(id);
  try{await api('/api/settings/wechat/connections/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({label:next})});changed();notify('成员称呼已更新')}
  catch(e){notify(String(e))}finally{setMemberBusy('')}
 }
 async function test(){
  if(modelDirty){notify('请先保存模型设置，再测试当前生效的提供方');return}
  if(testingModel)return;
  setTestingModel(true);setAiProbe(null);
  try{
   const result=await post<{ok:boolean;provider:string}>('/api/settings/ai/test',{});
   if(!result.ok||result.provider!==savedProvider)throw Error('模型未返回有效的测试结果');
   const label=savedProvider==='workers-ai'?'Qwen3.8-27B':'OpenRouter';
   setAiProbe({provider:savedProvider,ok:true,message:label+' 测试成功（仅证明模型接口可用，不代表微信连接正常）'});
   notify('模型连接测试成功');
  }catch(e){
   const message=e instanceof Error?e.message:'模型测试失败';
   setAiProbe({provider:savedProvider,ok:false,message:'模型测试失败：'+message});
   notify(message);
  }finally{setTestingModel(false)}
 }
 async function inspect(id:string){setInspectedMember(id);try{const status=await api<WechatRunStatus>('/api/settings/wechat/connections/'+encodeURIComponent(id)+'/status');setRunStatuses(current=>({...current,[id]:status}))}catch{notify('暂时无法读取微信状态，请稍后重试')}}
 return <div className={"settings-layout"+(mobileDetail?" mobile-detail":"")}>
 <div className="settings-mobile-overview-header"><h2>家庭设置</h2><p>选择要管理的内容</p></div>
 <nav className="settings-categories" aria-label="设置分类">
  {SETTINGS_SECTIONS.map(section=>{const Icon=section.icon;return <button id={'settings-nav-'+section.id} type="button" key={section.id} className={'settings-category'+(activeSection===section.id?' is-active':'')} aria-current={activeSection===section.id?'page':undefined} onClick={()=>{setActiveSection(section.id);setMobileDetail(true)}}>
   <span className="settings-category-icon"><Icon size={19} aria-hidden="true"/></span>
   <span className="settings-category-label"><strong>{section.label}</strong><small>{section.description}</small></span>
   <ChevronRight size={16} className="settings-category-chevron" aria-hidden="true"/>
  </button>})}
 </nav>
 <section className="settings-main" aria-labelledby="settings-section-title">
  <button type="button" className="settings-mobile-back" onClick={()=>setMobileDetail(false)}><ChevronLeft size={20} aria-hidden="true"/>设置</button>
  <div className="settings-main-heading"><span className="settings-main-eyebrow">SETTINGS</span><h2 id="settings-section-title">{selectedSection.label}</h2><p>{selectedSection.description}</p></div>
  <div className="settings-grid">
  {activeSection==='profile'&&<>
  <Card className="span-2 appearance-settings"><div className="section-title"><h3>外观主题</h3></div><ThemeSelector/></Card><Card><div className="section-title"><h3>宝宝资料</h3><Baby size={20}/></div><div className="settings-baby-switch"><Field label="当前查看的宝宝"><select aria-label="选择宝宝" value={baby.id} onChange={e=>onBabySelected(e.target.value)}>{state.babies.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><p className="muted small">切换后，其他页面会同步显示这位宝宝。</p></div><div className="baby-avatar-control">{baby.avatar_key?<img className="baby-portrait" src={'/api/babies/'+baby.id+'/avatar?v='+encodeURIComponent(baby.updated_at||'')} alt={baby.name+'的头像'}/>:<Baby size={40}/>}<label className="secondary">{avatarBusy?'处理头像…':'更换头像'}<input type="file" accept="image/*" disabled={avatarBusy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void avatar(file)}}/></label>{baby.avatar_key&&<button type="button" className="text-btn" disabled={avatarBusy} onClick={()=>void api('/api/babies/'+baby.id+'/avatar',{method:'DELETE',body:JSON.stringify({expectedUpdatedAt:baby.updated_at||''})}).then(()=>{changed();notify('头像已移除')}).catch(e=>notify(e.message))}>移除头像</button>}</div><form className="stack" onSubmit={saveBaby}><Field label="宝宝昵称"><input value={name} required onChange={e=>{setDirty(true);setName(e.target.value)}}/></Field><div className="two"><Field label="出生日期"><input type="date" value={birthday} required onChange={e=>{setDirty(true);setBirthday(e.target.value)}}/></Field><Field label="出生时间（可后补）"><input type="time" value={birthTime} onChange={e=>{setDirty(true);setBirthTime(e.target.value)}}/></Field></div><Field label="过敏与注意事项"><textarea rows={3} value={allergies} onChange={e=>{setDirty(true);setAllergies(e.target.value)}}/></Field><div className="two"><Field label="性别"><select value={gender} onChange={e=>{setDirty(true);setGender(e.target.value)}}><option value="girl">女孩</option><option value="boy">男孩</option><option value="other">暂不填写</option></select></Field><Field label="宝宝时区"><select value={timeZone} onChange={e=>{setDirty(true);setTimeZone(e.target.value)}}>{Array.from(new Set([timeZone,'Asia/Shanghai','Asia/Tokyo','America/Los_Angeles','UTC'])).map(zone=><option value={zone} key={zone}>{zone}</option>)}</select></Field></div><Field label="档案备注"><textarea rows={3} maxLength={4000} value={notes} onChange={e=>{setDirty(true);setNotes(e.target.value)}}/></Field><Primary disabled={babyBusy}>{babyBusy?'正在保存…':'保存资料'} <Check size={16}/></Primary></form>
 <div className="baby-create-section"><div className="section-title"><div><h3>家庭成员 · 宝宝</h3><p className="muted small">空间：{state.familyName||'家庭空间'} · 当前家庭有 {state.babies.length} 位宝宝，可切换查看各自的照片与成长记录。</p></div></div>
 <Button type="button" variant="secondary" className="full" onClick={()=>{setCreateError('');setShowNewBaby(true)}} aria-haspopup="dialog"><Plus size={16}/>新增宝宝</Button>
 <ModalDialog open={showNewBaby} onClose={()=>{setShowNewBaby(false);setCreateError('')}} busy={creatingBaby} title="新增宝宝">
 <form className="stack baby-create-form" onSubmit={addBaby}>
 <Field label="宝宝名字"><input required maxLength={80} autoComplete="off" value={newBaby.name} onChange={e=>setNewBaby({...newBaby,name:e.target.value})} placeholder="宝宝昵称"/></Field>
  <div className="two"><Field label="出生日期"><input required type="date" max={today()} value={newBaby.birthday} onChange={e=>setNewBaby({...newBaby,birthday:e.target.value})}/></Field><Field label="出生时间（可后补）"><input type="time" value={newBaby.birthTime} onChange={e=>setNewBaby({...newBaby,birthTime:e.target.value})}/></Field></div><div className="two"><Field label="性别"><select value={newBaby.gender} onChange={e=>setNewBaby({...newBaby,gender:e.target.value})}><option value="girl">女孩</option><option value="boy">男孩</option><option value="other">暂不填写</option></select></Field></div>
  <Field label="家庭时区"><select value={newBaby.timeZone} onChange={e=>setNewBaby({...newBaby,timeZone:e.target.value})}><option value="Asia/Shanghai">中国标准时间 · UTC+8</option><option value="Asia/Tokyo">日本标准时间 · UTC+9</option><option value="America/Los_Angeles">美国太平洋时间</option></select></Field>
  <Field label="过敏与注意事项（可选）"><textarea rows={2} maxLength={2000} value={newBaby.allergies} onChange={e=>setNewBaby({...newBaby,allergies:e.target.value})} placeholder="可以以后填写"/></Field>
  {createError&&<div className="error" role="alert">{createError}</div>}
  <div className="bm-modal-actions"><Button variant="secondary" type="button" disabled={creatingBaby} onClick={()=>setShowNewBaby(false)}>稍后再说</Button><Primary disabled={creatingBaby}>{creatingBaby?'正在创建…':'创建并切换到新宝宝'} <Plus size={16}/></Primary></div>
 </form>
 </ModalDialog>
 <details className="settings-subsection"><summary>管理其他宝宝档案 <ChevronRight size={16}/></summary><div className="settings-subsection-body">
 <button className="text-btn" disabled={state.babies.length<2} onClick={()=>void archiveBaby()}>移出当前宝宝（记录保留）</button><Button variant="secondary" onClick={()=>void loadArchived()}>查看移出的宝宝</Button>{archived.map(item=><div className="row-between" key={item.id}><span>{item.name}</span><Button variant="secondary" onClick={()=>void post('/api/babies/'+item.id+'/restore',{}).then(()=>{changed();void loadArchived()}).catch(e=>notify(e.message))}>恢复宝宝</Button></div>)}
 </div></details></div></Card>
 </>}
 {activeSection==='storage'&&<>
 <Card className="span-2 thumbnail-repair-card">
  <div className="section-title"><h3>相册封面维护</h3><RefreshCw size={20}/></div>
  <p className="muted small">扫描并修复缺失的照片、视频封面。关闭页面会暂停，下次打开可继续。</p><details className="settings-help"><summary>修复说明</summary><p className="muted small">后台逐项保存进度；关闭应用或 iPhone 冻结页面后会暂停，重新打开后可继续。视频截帧依赖当前设备解码能力，并非服务器离线转码。</p></details>
  <div className="thumbnail-repair-actions">
    <Button type="button" variant="secondary" disabled={!navigator.onLine||coverRepair.phase==='running'}
      onClick={()=>startThumbnailRepair(state.babies.map(item=>item.id))}>
      <RefreshCw size={16}/>{coverRepair.phase==='paused'?'继续修复缺失封面':'一键后台修复全部封面'}
    </Button>
    {coverRepair.phase==='running'&&<Button type="button" variant="secondary" onClick={pauseThumbnailRepair}>暂停修复</Button>}
  </div>
  {coverRepair.phase!=='idle'&&<div className="thumbnail-repair-progress" role="status" aria-live="polite">
    <strong>{coverRepair.phase==='running'?'正在后台修复':coverRepair.phase==='paused'?'任务已暂停':'本轮扫描已结束'}</strong>
    <span>已检查 {coverRepair.processed}{coverRepair.total?' / '+coverRepair.total:''} 项 · 修复 {coverRepair.repaired} 项 · 未修复 {coverRepair.failed} 项</span>
    {coverRepair.total>0&&<progress max={coverRepair.total} value={Math.min(coverRepair.processed,coverRepair.total)} aria-label="封面修复进度"/>}
    {coverRepair.error&&<span className="muted">{coverRepair.error}</span>}
    {coverRepair.phase==='completed'&&coverRepair.failed>0&&<span className="muted">无法在此设备解码的文件仍保留原件，可在相册预览里手动补封面；再次执行只扫描仍缺少封面的项目。</span>}
  </div>}
 </Card>
 <Card><div className="section-title"><h3>家庭数据与回收站</h3><ShieldCheck size={20}/></div><p className="muted small">导出完整家庭档案，或恢复 30 天内删除的记录。</p><details className="settings-help"><summary>数据保存说明</summary><p className="muted small">完整导出包含宝宝资料、头像、记录、媒体原件和关联关系。离线内容保存在当前设备，主动退出会清理本机缓存。</p></details><Button type="button" variant="primary" className="full" disabled={exportBusy||!navigator.onLine} onClick={()=>{setExportBusy(true);void downloadFamilyArchive().then(()=>notify('家庭档案已生成，请在下载中查看')).catch(e=>notify(e instanceof Error?e.message:'导出失败')).finally(()=>setExportBusy(false))}}>{exportBusy?'正在导出家庭档案…':'下载完整家庭档案 ZIP'}</Button><a className="secondary full" href="/api/export/records" download="babymemo-records.json"><CloudUpload size={16}/> 导出记录 JSON</a><Button variant="secondary" className="full" onClick={()=>void loadTrash()} disabled={trashBusy}>{trashBusy?'读取中…':'查看回收站'}</Button>
 {trash&&<div className="trash-list">{(['growth','milestones','media'] as const).flatMap(kind=>trash[kind].map(entry=><div className="trash-item" key={kind+entry.id}><div><strong>{kind==='growth'?'成长测量':kind==='milestones'?'成长瞬间':'媒体'} · {kind==='media'?entry.day:'title' in entry?entry.title:entry.day}</strong><p className="muted small">{state.babies.find(b=>b.id===entry.baby_id)?.name||'宝宝'} · {entry.day} · 删除于 {entry.deleted_at.slice(0,10)}</p></div><Button variant="secondary" onClick={()=>void restore(kind,entry.id)}>恢复</Button></div>))}{!trash.growth.length&&!trash.milestones.length&&!trash.media.length&&<p className="muted small">回收站为空</p>}</div>}
 </Card>
 <Card className="span-2"><div className="section-title"><h3>账户安全</h3><ShieldCheck size={20}/></div><details className="settings-subsection"><summary>修改家庭密码 <ChevronRight size={16}/></summary><div className="settings-subsection-body"><p className="muted small">修改密码会注销所有设备。建议使用至少 6 位字符的长密码。</p><form className="stack" onSubmit={changePassword}><Field label="当前密码"><input type="password" autoComplete="current-password" required value={password.currentPassword} onChange={e=>setPassword({...password,currentPassword:e.target.value})}/></Field><Field label="新密码"><input type="password" autoComplete="new-password" required minLength={6} value={password.newPassword} onChange={e=>setPassword({...password,newPassword:e.target.value})}/></Field><Field label="确认新密码"><input type="password" autoComplete="new-password" required minLength={6} value={password.confirmPassword} onChange={e=>setPassword({...password,confirmPassword:e.target.value})}/></Field><Primary disabled={passwordBusy}>{passwordBusy?'正在更新…':'修改密码并退出所有设备'}</Primary></form></div></details></Card>
 </>}
 {activeSection==='ai'&&<>
 <Card className="span-2 settings-ai-card">
  <div className="section-title"><h3>微信 AI 模型</h3><BrainCircuit size={20}/></div>
  <div className="settings-ai-overview">
   <div><span className="settings-ai-caption">当前生效</span><strong>{activeModel}</strong><p className="muted small">{savedProvider==='workers-ai'?'Cloudflare Workers AI · 关闭思考':'OpenRouter · '+openRouterModelDescription(activeModel)} · 所有绑定的微信成员共用</p></div>
   <span className={'settings-ai-probe '+(aiProbe?.provider===savedProvider?(aiProbe.ok?'ok':'failed'):'idle')} role="status">{aiProbe?.provider===savedProvider?(aiProbe.ok?'模型接口已检测':'模型接口测试失败'):'模型接口未检测'}</span>
  </div>
  <p className="muted small settings-ai-hint">{savedProvider==='workers-ai'?'Workers AI 免费额度为全账号每天 10,000 Neurons（北京时间 08:00 重置），本页不提供实时余额；请到 Cloudflare 控制台查看实际消耗。':'OpenRouter 按所选模型的服务规则计费；余额、限流与历史调用请到 OpenRouter 查看。'}</p>
  <div className="settings-ai-actions">
   <Button type="button" variant="secondary" disabled={modelDirty||testingModel||saving} onClick={()=>void test()}>{testingModel?'正在测试接口…':'测试当前模型'}</Button>
   {modelDirty&&<span className="muted small" role="status">有未保存的模型改动，请先保存后测试。</span>}
  </div>
  {aiProbe?.provider===savedProvider&&<p className={'settings-ai-result '+(aiProbe.ok?'ok':'failed')} role="status" aria-live="polite">{aiProbe.message}</p>}
  <details className="settings-help settings-ai-config"><summary>切换模型或配置 OpenRouter</summary>
   <form className="stack" onSubmit={saveOpenrouter}>
    <Field label="模型提供方"><select value={provider} onChange={e=>{setProvider(e.target.value as 'workers-ai'|'openrouter');setAiProbe(null)}}><option value="workers-ai">Cloudflare Workers AI · Qwen3.8-27B（关闭思考）</option><option value="openrouter">OpenRouter · 自定义模型</option></select></Field>
    {provider==='openrouter'&&<>
     <p className="muted small">{state.openrouter.managedByDeployment?'API Key 由 Cloudflare Secret 管理。':'API Key 可加密保存在 D1，或由部署管理员配置 Secret。'}</p>
     <Field label="OpenRouter 模型 ID"><input list="babymemo-openrouter-model-presets" required value={model} onChange={e=>setModel(e.target.value)} placeholder={DEFAULT_OPENROUTER_MODEL}/><datalist id="babymemo-openrouter-model-presets">{OPENROUTER_MODEL_PRESETS.map(entry=><option key={entry.id} value={entry.id} label={entry.label}/>)}</datalist></Field><p className="muted small" role="status">模型策略：{openRouterModelDescription(model)}。仍可输入其他 OpenRouter 模型 ID。</p>
     <Field label={'API Key · '+(state.openrouter.managedByDeployment?'部署 Secret 管理':state.openrouter.configured?'已配置，可留空不变':'尚未配置')}><input type="password" autoComplete="off" disabled={state.openrouter.managedByDeployment} value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={state.openrouter.managedByDeployment?'由部署配置（不显示密钥）':'sk-or-v1-…'}/></Field>
    </>}
    <Primary disabled={saving}>{saving?'正在保存…':'保存模型设置'} <Check size={16}/></Primary>
   </form>
  </details>
  <p className="muted small settings-ai-note">模型接口测试只检查 AI 服务，不检查微信是否收到消息；测试本身可能产生少量 Neurons 或 OpenRouter 费用。</p>
 </Card>
 </>}
 {activeSection==='reports'&&<>
 <Card className="span-2 family-report-settings">
  <div className="section-title"><div><h3>家庭成长周报与月报</h3><p className="muted small">AI 根据成长瞬间、成长指标、照片与视频的文字记录生成报告，直接发送给家人的微信。</p></div><MessageCircle size={20}/></div>
  {!reportSettings?<p className="muted" role="status">正在读取成长报告设置…</p>:<div className="stack">
   <label className="family-report-toggle"><span><strong>每周 AI 成长报告</strong><small className="muted">每周日发送当周回顾</small></span><input type="checkbox" role="switch" checked={reportSettings.weekly} onChange={e=>setReportSettings(old=>old?{...old,weekly:e.target.checked}:old)}/></label>
   <label className="family-report-toggle"><span><strong>每月 AI 成长报告</strong><small className="muted">每月 1 日发送上月回顾</small></span><input type="checkbox" role="switch" checked={reportSettings.monthly} onChange={e=>setReportSettings(old=>old?{...old,monthly:e.target.checked}:old)}/></label>
   <Field label="发送时间（使用首位宝宝的时区）"><select aria-label="成长报告发送时间" value={reportSettings.hour} onChange={e=>setReportSettings(old=>old?{...old,hour:Number(e.target.value)}:old)}>{[8,12,20,21].map(h=><option key={h} value={h}>{String(h).padStart(2,'0')}:00</option>)}</select></Field>
   <p className="muted small">当前家庭时区：{reportSettings.timeZone}</p>
   <Button type="button" variant="primary" disabled={reportSaving} onClick={()=>void saveReportSettings()}>{reportSaving?'保存中…':'保存报告开关与时间'}</Button>
   <details className="settings-subsection family-report-recipients"><summary><span>微信接收成员 · {reportSettings.members.filter(m=>m.enabled&&m.subscribed).length} 位</span><ChevronRight size={16}/></summary><div className="settings-subsection-body"><p className="muted small">仅发送给已启用并订阅的成员。家人需要先给 Bot 发消息建立有效会话。</p>
    {reportSettings.members.map(m=><label key={m.id} className="family-report-member"><span><strong>{m.label}</strong><small className="muted">{!m.enabled?'微信连接已暂停':!m.hasContext?'等待成员发送微信消息':'已建立微信会话（会话可能过期）'}</small></span><input aria-label={m.label+'接收成长报告'} type="checkbox" checked={m.subscribed} disabled={!!reportMemberBusy} onChange={e=>void changeReportMember(m.id,e.target.checked)}/></label>)}
    {!reportSettings.members.length&&<p className="muted small">尚未绑定微信家庭成员，请在下方添加。</p>}
   </div></details>
   <section className="family-report-test">
    <strong>立即测试微信推送</strong>
    <p className="muted small">选择一位家人试发 AI 周报或月报，不影响正式开关。</p>
    <Field label="测试接收人"><select aria-label="测试报告接收人" value={reportTestMember} onChange={e=>{setReportTestMember(e.target.value);setReportTestResult('')}}><option value="">选择一位微信成员</option>{reportSettings.members.filter(m=>m.enabled&&m.subscribed).map(m=><option key={m.id} value={m.id}>{m.label}{m.hasContext?'':'（需先发送微信消息）'}</option>)}</select></Field>
    <div className="family-report-test-actions">
     <Button type="button" variant="secondary" disabled={!reportTestMember||reportTestBusy} onClick={()=>void testFamilyReport('week')}>{reportTestBusy?'生成和发送中…':'发送测试周报'}</Button>
     <Button type="button" variant="secondary" disabled={!reportTestMember||reportTestBusy} onClick={()=>void testFamilyReport('month')}>{reportTestBusy?'生成和发送中…':'发送测试月报'}</Button>
    </div>
    {reportTestResult&&<p className="muted small" role="status" aria-live="polite">{reportTestResult}</p>}
    <p className="muted small">每位成员 10 分钟限一次，需在微信确认实际送达。</p>
   </section>
   <details className="settings-subsection family-report-history"><summary>近期发送记录 <ChevronRight size={16}/></summary><div className="settings-subsection-body">
    {reportSettings.reports.map(r=><div className="family-report-history-row" key={r.kind+r.period_start}><span>{r.kind==='week'?'周报':'月报'} · {r.period_start} — {r.period_end}</span><small className="muted">接口已接受 {r.sent||0}/{r.recipients||0} · 等待会话 {r.waiting||0} · 失败 {r.failed||0}</small></div>)}
    {!reportSettings.reports.length&&<p className="muted small">尚未生成成长报告。</p>}
   </div></details>
   <p className="muted small">默认关闭；无新记录不发送。请用真实微信确认送达。</p>
  </div>}
 </Card>
 </>}
 {activeSection==='wechat'&&<>
 <Card className="span-2"><div className="section-title"><h3>微信操作</h3><MessageCircle size={20}/></div><p className="muted small">添加家庭成员的微信，直接发送照片、视频或成长记录。每位成员可以独立连接。</p><details className="settings-help"><summary>查看微信连接原理</summary><p className="muted small">通过 Cloudflare Durable Objects 轮询微信消息，默认由 Workers AI Qwen3.8（关闭思考）识别意图，再调用受限工具操作家庭数据；也支持切换 OpenRouter，无需 VPS。</p></details>
 <div className="wechat-row"><div className="wechat-status"><strong>微信消息接收 · 已绑定 {state.wechat.connections.length} 位 · 已启用 {state.wechat.connections.filter(x=>x.enabled).length} 位</strong><p className="muted small">最近确认运行 {healthyWechat} 位{warningWechat?' · 需关注 '+warningWechat+' 位':''}{checkedWechat.length<state.wechat.connections.length?' · 状态获取中':''}。启用不等于正在正常收消息。</p></div></div>
 <div className="wechat-photo-setting"><div><strong>微信照片/视频 → 自动存入相册</strong><details className="settings-help"><summary>照片与视频归档规则</summary><p className="muted small">给绑定的微信 Bot 发送照片或视频会直接存入私有 R2，无需 AI 分析。多宝宝家庭可以在消息文字中指定宝宝；每条最多 4 项，单文件不超过 50 MiB。</p></details></div><div className="wechat-photo-controls"><label className="field">默认收图宝宝<select aria-label="微信照片默认宝宝" value={photoBaby} onChange={e=>setPhotoBaby(e.target.value)}><option value="">未选择（多宝宝时需附带名字）</option>{state.babies.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><Button variant="secondary" type="button" disabled={photoBabyBusy} onClick={()=>void savePhotoBaby()}>{photoBabyBusy?'保存中…':'保存默认宝宝'}</Button></div></div>
 <div className="wechat-member-list">
 {state.wechat.connections.map(member=>{const status=runStatuses[member.id];const view=wechatStatusView(status);return <div key={member.id} className="wechat-member-row">
  <div className="wechat-member-info"><strong>{member.label}</strong><span className={'wechat-run-state '+view.tone} role="status">{view.label}</span><p className="muted small">{view.detail}</p><p className="muted small">最近连接：{wechatStatusTime(status?.lastPoll)} · 最近回复：{wechatStatusTime(status?.lastMessage)}</p></div>
  <div className="wechat-actions"><Button type="button" variant="secondary" onClick={()=>void inspect(member.id)} disabled={memberBusy===member.id}><RefreshCw size={15}/>状态</Button><details className="wechat-member-more"><summary>管理</summary><div className="wechat-member-menu">
   <Button type="button" variant="secondary" onClick={()=>void renameMember(member.id,member.label)} disabled={!!memberBusy}>改名</Button>
   <button type="button" className={member.enabled?'secondary':'primary'} onClick={()=>void toggleBot(member.id,member.enabled?'pause':'start')} disabled={!!memberBusy}>{member.enabled?<><WifiOff size={15}/>暂停</>:<><Wifi size={15}/>启用</>}</button>
   <button type="button" className="text-btn" onClick={()=>void removeMember(member.id,member.label)} disabled={!!memberBusy}>移除</button>
  </div></details></div></div>})}
 {!state.wechat.connections.length&&<p className="muted small">尚未连接微信。家庭成员分别扫描自己的二维码即可加入同一个家庭空间。</p>}
 </div>
 {inspectedMember&&runStatuses[inspectedMember]&&<div className="wechat-member-status"><strong>运行详情 · {state.wechat.connections.find(x=>x.id===inspectedMember)?.label||''}</strong><p>{wechatStatusView(runStatuses[inspectedMember]).detail}</p><dl className="wechat-status-details"><div><dt>待保存消息</dt><dd>{runStatuses[inspectedMember].media?.pending||0} 条</dd></div><div><dt>最近保存完成</dt><dd>{wechatStatusTime(runStatuses[inspectedMember].media?.lastCompleted)}</dd></div></dl></div>}
 <div className="settings-wechat-add-action"><Button type="button" variant="secondary" onClick={()=>setShowPairing(value=>!value)}><Plus size={16}/>{showPairing||qr?'收起添加成员':'添加微信成员'}</Button></div>
 {(showPairing||!!qr)&&<div className="settings-wechat-add-panel"><div className="wechat-add"><Field label="家庭成员称呼"><input maxLength={40} value={memberName} onChange={e=>setMemberName(e.target.value)} placeholder="例如：爸爸、妈妈、外婆"/></Field>
  <Button type="button" variant="secondary" onClick={()=>void pair()} disabled={!memberName.trim()}><MessageCircle size={16}/>扫码添加成员</Button></div>
 {qrImage&&<div className="qr-panel"><img src={qrImage} alt="微信扫码绑定二维码"/><strong>请让“{memberName}”本人用微信扫描二维码</strong><span>扫码后在手机确认绑定；二维码属于敏感凭据，请勿分享。有效期约 10 分钟。</span><p className="small">状态：{status}</p>{status==='need_verifycode'&&<Field label="微信显示的验证码"><input value={verifyCode} onChange={e=>setVerifyCode(e.target.value)}/></Field>}</div>}</div>}
 <details className="settings-help"><summary>微信指令示例与使用说明</summary><div className="wechat-examples"><strong>微信指令示例</strong><p>「小好今天体重 10.5kg」「查询小好最近 5 次测量」「修改小好 10 月 1 日体重为 10kg」「删除小好 10 月 1 日的里程碑」「查看小好回收站」</p><p className="hint">修改或删除需明确记录日期或查询结果中的编号；同日多条记录时必须用编号。删除内容可在 30 天内恢复。仅接受已启用、已绑定成员的微信私聊消息。不同成员的多轮会话互相隔离，记录与相册共享。</p></div></details>
 <p className="hint">微信 iLink 属于第三方协议适配；上线前还需真号验证账号授权、消息去重、权限及持续运行情况。</p></Card>
 </>}
 </div>
 </section>
 </div>;
}
