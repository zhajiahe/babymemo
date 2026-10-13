import {useEffect,useState,type FormEvent} from 'react';
import {Card,Field,Primary} from '../../components/ui';
import {Baby,Check,Plus,ShieldCheck,CloudUpload,WandSparkles,MessageCircle,RefreshCw,WifiOff,Wifi} from 'lucide-react';
import {api,post,today,type BabyInfo,type State,type WechatRunStatus} from '../../lib/client';
import {DEFAULT_OPENROUTER_MODEL} from '../../openrouter-model.mjs';
import {wechatStatusView,wechatStatusTime} from '../../wechat-status.mjs';

export function Settings({state,baby,changed,notify,onBabyCreated,onBabySelected}:{state:State;baby:BabyInfo;changed:()=>void;notify:(s:string)=>void;onBabyCreated:(id:string)=>void;onBabySelected:(id:string)=>void}){
 const [model,setModel]=useState(state.openrouter.model),[apiKey,setApiKey]=useState(''),[saving,setSaving]=useState(false);
 const [photoBaby,setPhotoBaby]=useState(state.wechat.defaultBabyId||''),[photoBabyBusy,setPhotoBabyBusy]=useState(false);
 useEffect(()=>{setPhotoBaby(state.wechat.defaultBabyId||'')},[state.wechat.defaultBabyId]);
 const [name,setName]=useState(baby.name),[birthday,setBirthday]=useState(baby.birthday),[birthTime,setBirthTime]=useState(baby.birth_time||''),[allergies,setAllergies]=useState(baby.allergies);
 const [showNewBaby,setShowNewBaby]=useState(false),[creatingBaby,setCreatingBaby]=useState(false),[createError,setCreateError]=useState('');
 const [newBaby,setNewBaby]=useState({name:'',birthday:'',birthTime:'',gender:'girl',timeZone:'Asia/Shanghai',allergies:''});
 const [qr,setQr]=useState(''),[pairingId,setPairingId]=useState(''),[qrImage,setQrImage]=useState(''),[status,setStatus]=useState(''),[verifyCode,setVerifyCode]=useState('');
 const [runStatuses,setRunStatuses]=useState<Record<string,WechatRunStatus>>({}),[inspectedMember,setInspectedMember]=useState('');
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
 const [memberName,setMemberName]=useState(''),[memberBusy,setMemberBusy]=useState('');
 const [password,setPassword]=useState({currentPassword:'',newPassword:'',confirmPassword:''}),[passwordBusy,setPasswordBusy]=useState(false);
 const [trash,setTrash]=useState<{growth:{id:string;baby_id:string;day:string;deleted_at:string}[];milestones:{id:string;baby_id:string;day:string;title:string;deleted_at:string}[];media:{id:string;baby_id:string;day:string;title:string;deleted_at:string}[]}|null>(null);
 const [trashBusy,setTrashBusy]=useState(false);
 useEffect(()=>{setName(baby.name);setBirthday(baby.birthday);setBirthTime(baby.birth_time||'');setAllergies(baby.allergies)},[baby.id,baby.name,baby.birthday,baby.birth_time,baby.allergies]);
 useEffect(()=>{if(qr)void import('qrcode').then(({default:QRCode})=>QRCode.toDataURL(qr,{width:220,margin:2,errorCorrectionLevel:'M'})).then(setQrImage).catch(()=>notify('二维码渲染失败'))},[qr]);
 useEffect(()=>{if(!qr||status==='confirmed'||status==='expired')return;let cancelled=false;let timeout:ReturnType<typeof setTimeout>;
  const poll=async()=>{try{const r=await post<{status:string}>('/api/settings/wechat/qr/status',{pairingId,verifyCode});if(cancelled)return;setStatus(r.status);if(r.status==='confirmed'){setQr('');setQrImage('');setPairingId('');setVerifyCode('');changed();notify('微信成员绑定成功，可在列表中启用');return;}}catch(e){if(!cancelled)setStatus('连接重试中');}if(!cancelled)timeout=setTimeout(poll,2000)};
  timeout=setTimeout(poll,500);return()=>{cancelled=true;clearTimeout(timeout)};
 },[qr,pairingId,verifyCode,status==='confirmed',status==='expired']);
 async function saveOpenrouter(e:FormEvent){e.preventDefault();setSaving(true);try{await post('/api/settings/openrouter',{model,...(!state.openrouter.managedByDeployment&&apiKey?{apiKey}:{})});setApiKey('');changed();notify('微信指令模型配置已保存')}catch(e){notify(String(e))}finally{setSaving(false)}}
 async function saveBaby(e:FormEvent){e.preventDefault();try{await api('/api/babies/'+baby.id,{method:'PATCH',body:JSON.stringify({name,birthday,birthTime,allergies,notes:baby.notes})});changed();notify('宝宝资料已更新')}catch(e){notify(String(e))}}
 async function addBaby(e:FormEvent){
  e.preventDefault();
  if(creatingBaby)return;
  setCreatingBaby(true);setCreateError('');
  try{
   const created=await post<{id:string}>('/api/babies',newBaby);
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
 async function test(){try{await post('/api/settings/openrouter/test',{});notify('模型连接测试成功')}catch(e){notify(String(e))}}
 async function inspect(id:string){setInspectedMember(id);try{const status=await api<WechatRunStatus>('/api/settings/wechat/connections/'+encodeURIComponent(id)+'/status');setRunStatuses(current=>({...current,[id]:status}))}catch{notify('暂时无法读取微信状态，请稍后重试')}}
 return <div className="settings-grid"><Card><div className="section-title"><h3>宝宝资料</h3><Baby size={20}/></div><div className="settings-baby-switch"><Field label="当前查看的宝宝"><select aria-label="选择宝宝" value={baby.id} onChange={e=>onBabySelected(e.target.value)}>{state.babies.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><p className="muted small">仅在设置中切换宝宝，其他页面自动展示所选宝宝的记录。</p></div><form className="stack" onSubmit={saveBaby}><Field label="宝宝昵称"><input value={name} required onChange={e=>setName(e.target.value)}/></Field><div className="two"><Field label="出生日期"><input type="date" value={birthday} required onChange={e=>setBirthday(e.target.value)}/></Field><Field label="出生时间（可后补）"><input type="time" value={birthTime} onChange={e=>setBirthTime(e.target.value)}/></Field></div><Field label="过敏与注意事项"><textarea rows={3} value={allergies} onChange={e=>setAllergies(e.target.value)}/></Field><Primary>保存资料 <Check size={16}/></Primary></form>
 <div className="baby-create-section"><div className="section-title"><div><h3>家庭成员 · 宝宝</h3><p className="muted small">空间：{state.familyName||'家庭空间'} · 当前家庭有 {state.babies.length} 位宝宝，可切换查看各自的照片与成长记录。</p></div></div>
 {!showNewBaby?<button type="button" className="secondary full" onClick={()=>setShowNewBaby(true)} aria-expanded={false}><Plus size={16}/>新增宝宝</button>:<form className="stack baby-create-form" onSubmit={addBaby}>
  <div className="section-title"><strong>创建新的宝宝档案</strong><button type="button" className="text-btn" disabled={creatingBaby} onClick={()=>{setShowNewBaby(false);setCreateError('')}}>取消</button></div>
  <Field label="宝宝名字"><input required maxLength={80} autoComplete="off" value={newBaby.name} onChange={e=>setNewBaby({...newBaby,name:e.target.value})} placeholder="宝宝昵称"/></Field>
  <div className="two"><Field label="出生日期"><input required type="date" max={today()} value={newBaby.birthday} onChange={e=>setNewBaby({...newBaby,birthday:e.target.value})}/></Field><Field label="出生时间（可后补）"><input type="time" value={newBaby.birthTime} onChange={e=>setNewBaby({...newBaby,birthTime:e.target.value})}/></Field></div><div className="two"><Field label="性别"><select value={newBaby.gender} onChange={e=>setNewBaby({...newBaby,gender:e.target.value})}><option value="girl">女孩</option><option value="boy">男孩</option><option value="other">暂不填写</option></select></Field></div>
  <Field label="家庭时区"><select value={newBaby.timeZone} onChange={e=>setNewBaby({...newBaby,timeZone:e.target.value})}><option value="Asia/Shanghai">中国标准时间 · UTC+8</option><option value="Asia/Tokyo">日本标准时间 · UTC+9</option><option value="America/Los_Angeles">美国太平洋时间</option></select></Field>
  <Field label="过敏与注意事项（可选）"><textarea rows={2} maxLength={2000} value={newBaby.allergies} onChange={e=>setNewBaby({...newBaby,allergies:e.target.value})} placeholder="可以以后填写"/></Field>
  {createError&&<div className="error" role="alert">{createError}</div>}
  <Primary disabled={creatingBaby}>{creatingBaby?'正在创建…':'创建并切换到新宝宝'} <Plus size={16}/></Primary>
 </form>}</div></Card>
 <Card><div className="section-title"><h3>家庭数据与回收站</h3><ShieldCheck size={20}/></div><p className="muted small">删除的记录和媒体保留 30 天，可在到期前恢复；定时清理由服务器执行。导出仅包含记录与媒体清单，不含原文件，不等于完整灾备。</p><a className="secondary full" href="/api/export/records" download="babymemo-records.json"><CloudUpload size={16}/> 导出记录 JSON</a><button className="secondary full" onClick={()=>void loadTrash()} disabled={trashBusy}>{trashBusy?'读取中…':'查看回收站'}</button>
 {trash&&<div className="trash-list">{(['growth','milestones','media'] as const).flatMap(kind=>trash[kind].map(entry=><div className="trash-item" key={kind+entry.id}><div><strong>{kind==='growth'?'成长测量':kind==='milestones'?'成长瞬间':'媒体'} · {kind==='media'?entry.day:'title' in entry?entry.title:entry.day}</strong><p className="muted small">{state.babies.find(b=>b.id===entry.baby_id)?.name||'宝宝'} · {entry.day} · 删除于 {entry.deleted_at.slice(0,10)}</p></div><button className="secondary" onClick={()=>void restore(kind,entry.id)}>恢复</button></div>))}{!trash.growth.length&&!trash.milestones.length&&!trash.media.length&&<p className="muted small">回收站为空</p>}</div>}
 </Card>
 <Card><div className="section-title"><h3>账户安全</h3><ShieldCheck size={20}/></div><p className="muted small">修改家庭密码会注销所有设备的会话。支持至少 6 位的数字或混合密码，推荐使用更长的密码。</p><form className="stack" onSubmit={changePassword}><Field label="当前密码"><input type="password" autoComplete="current-password" required value={password.currentPassword} onChange={e=>setPassword({...password,currentPassword:e.target.value})}/></Field><Field label="新密码"><input type="password" autoComplete="new-password" required minLength={6} value={password.newPassword} onChange={e=>setPassword({...password,newPassword:e.target.value})}/></Field><Field label="确认新密码"><input type="password" autoComplete="new-password" required minLength={6} value={password.confirmPassword} onChange={e=>setPassword({...password,confirmPassword:e.target.value})}/></Field><Primary disabled={passwordBusy}>{passwordBusy?'正在更新…':'修改密码并退出所有设备'}</Primary></form></Card>
 <Card><div className="section-title"><h3>微信操作引擎 · OpenRouter</h3><WandSparkles size={20}/></div><p className="muted small">模型仅负责将微信自然语言转成受限工具调用，不提供网页 AI 聊天。{state.openrouter.managedByDeployment?'API Key 由部署管理员通过 Cloudflare Secret 管理；需要换 Key 请更新 GitHub Actions Secret 并重新部署。网页仅可修改模型 ID。':'API Key 可在此加密保存于 D1，也可由部署管理员在 GitHub Actions 设置 OPENROUTER_API_KEY Secret；密钥不会返回浏览器。'}</p><form className="stack" onSubmit={saveOpenrouter}><Field label="模型 ID"><input required value={model} onChange={e=>setModel(e.target.value)} placeholder={DEFAULT_OPENROUTER_MODEL}/></Field><Field label={'API Key · '+(state.openrouter.managedByDeployment?'部署 Secret 管理':state.openrouter.configured?'已配置，可留空不变':'尚未配置')}><input type="password" autoComplete="off" disabled={state.openrouter.managedByDeployment} value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={state.openrouter.managedByDeployment?'由部署配置（不显示密钥）':'sk-or-v1-…'}/></Field><Primary disabled={saving}>保存 OpenRouter 设置 <Check size={16}/></Primary></form><button className="secondary full" onClick={()=>void test()} disabled={!state.openrouter.configured}>测试指令模型连接</button></Card>
 <Card className="span-2"><div className="section-title"><h3>微信操作</h3><MessageCircle size={20}/></div><p className="muted">网页扫码绑定微信，不需要 VPS。绑定后由 Cloudflare Durable Objects 定时轮询消息，使用 OpenRouter 识别操作意图并调用受限工具，直接对当前家庭数据进行增删改查；操作结果取自数据库，不是模型编造的回答。</p>
 <div className="wechat-photo-setting"><div><strong>微信照片/视频 → 自动存入相册</strong><p className="muted small">直接给绑定的微信 Bot 发送照片或视频，不经过 AI 分析。原图或原视频从微信 CDN 解密后分片保存到私有 R2，网页相册自动可见。多宝宝家庭可指定默认归档宝宝，或在图片消息文字中写宝宝名字；每条最多 4 项图片或视频，单文件不超过 50 MiB。</p></div><div className="wechat-photo-controls"><label className="field">默认收图宝宝<select aria-label="微信照片默认宝宝" value={photoBaby} onChange={e=>setPhotoBaby(e.target.value)}><option value="">未选择（多宝宝时需附带名字）</option>{state.babies.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button className="secondary" type="button" disabled={photoBabyBusy} onClick={()=>void savePhotoBaby()}>{photoBabyBusy?'保存中…':'保存默认宝宝'}</button></div></div>
 <div className="wechat-row"><div className="wechat-status"><span className={'status-dot '+(state.wechat.enabled?'online':'')}/><strong>已绑定 {state.wechat.connections.length} 位微信成员 · 已启用 {state.wechat.connections.filter(x=>x.enabled).length} 位</strong></div></div>
 <div className="wechat-member-list">
 {state.wechat.connections.map(member=>{const status=runStatuses[member.id];const view=wechatStatusView(status);return <div key={member.id} className="wechat-member-row">
  <div className="wechat-member-info"><strong>{member.label}</strong><span className={'wechat-run-state '+view.tone} role="status">{view.label}</span><p className="muted small">{view.detail}</p><p className="muted small">最近连接：{wechatStatusTime(status?.lastPoll)} · 最近回复：{wechatStatusTime(status?.lastMessage)}</p></div>
  <div className="wechat-actions"><button type="button" className="secondary" onClick={()=>void inspect(member.id)} disabled={memberBusy===member.id}><RefreshCw size={15}/>状态</button>
   <button type="button" className="secondary" onClick={()=>void renameMember(member.id,member.label)} disabled={!!memberBusy}>改名</button>
   <button type="button" className={member.enabled?'secondary':'primary'} onClick={()=>void toggleBot(member.id,member.enabled?'pause':'start')} disabled={!!memberBusy}>{member.enabled?<><WifiOff size={15}/>暂停</>:<><Wifi size={15}/>启用</>}</button>
   <button type="button" className="text-btn" onClick={()=>void removeMember(member.id,member.label)} disabled={!!memberBusy}>移除</button>
  </div></div>})}
 {!state.wechat.connections.length&&<p className="muted small">尚未连接微信。家庭成员分别扫描自己的二维码即可加入同一个家庭空间。</p>}
 </div>
 {inspectedMember&&runStatuses[inspectedMember]&&<div className="wechat-member-status"><strong>运行详情 · {state.wechat.connections.find(x=>x.id===inspectedMember)?.label||''}</strong><p>{wechatStatusView(runStatuses[inspectedMember]).detail}</p><dl className="wechat-status-details"><div><dt>待保存消息</dt><dd>{runStatuses[inspectedMember].media?.pending||0} 条</dd></div><div><dt>最近保存完成</dt><dd>{wechatStatusTime(runStatuses[inspectedMember].media?.lastCompleted)}</dd></div></dl></div>}
 <div className="wechat-add"><Field label="新增微信成员 · 称呼"><input maxLength={40} value={memberName} onChange={e=>setMemberName(e.target.value)} placeholder="例如：爸爸、妈妈、外婆"/></Field>
  <button type="button" className="secondary" onClick={()=>void pair()} disabled={!memberName.trim()}><MessageCircle size={16}/>扫码添加成员</button></div>
 {qrImage&&<div className="qr-panel"><img src={qrImage} alt="微信扫码绑定二维码"/><strong>请让“{memberName}”本人用微信扫描二维码</strong><span>扫码后在手机确认绑定；二维码属于敏感凭据，请勿分享。有效期约 10 分钟。</span><p className="small">状态：{status}</p>{status==='need_verifycode'&&<Field label="微信显示的验证码"><input value={verifyCode} onChange={e=>setVerifyCode(e.target.value)}/></Field>}</div>}
 <div className="wechat-examples"><strong>微信指令示例</strong><p>「小好今天体重 10.5kg」「查询小好最近 5 次测量」「修改小好 10 月 1 日体重为 10kg」「删除小好 10 月 1 日的里程碑」「查看小好回收站」</p><p className="hint">修改或删除需明确记录日期或查询结果中的编号；同日多条记录时必须用编号。删除内容可在 30 天内恢复。仅接受已启用、已绑定成员的微信私聊消息。不同成员的多轮会话互相隔离，记录与相册共享。</p></div>
 <p className="hint">微信 iLink 属于第三方协议适配；上线前还需真号验证账号授权、消息去重、权限及持续运行情况。</p></Card></div>;
}
