// Family-facing state derived from bounded, sanitized operational fields.
export function wechatStatusView(status,now=Date.now()){
 if(!status)return {tone:'muted',label:'正在读取状态',detail:'正在确认微信连接和保存任务。'};
 if(status.unavailable)return {tone:'warning',label:'状态暂时无法获取',detail:'请稍后刷新；这不代表微信已断开。'};
 if(!status.connected)return {tone:'muted',label:'尚未连接',detail:'扫码绑定后即可启用微信操作。'};
 if(status.lastError==='WECHAT_AUTH_EXPIRED'||status.media?.lastError?.code==='WECHAT_AUTH_EXPIRED')return {tone:'warning',label:'需要重新绑定',detail:'微信授权已失效，请重新扫码绑定此成员。'};
 if(!status.enabled)return {tone:'muted',label:'已暂停',detail:'暂停期间不处理新消息；已接收的保存任务会保留，启用后继续。'};
 const last=Date.parse(status.lastPoll||status.startedAt||'');
 if(Number.isFinite(last)&&now-last>120000)return {tone:'warning',label:'连接暂时中断',detail:'最近未能收到微信轮询结果，请刷新状态或暂停后重新启用。'};
 if(status.lastError)return {tone:'warning',label:'连接重试中',detail:'微信连接暂时异常，系统会自动重试。'};
 if(status.media?.pending){
  if(status.media.notifying)return {tone:status.media.retrying?'warning':'active',label:status.media.retrying?'结果通知重试中':'正在通知处理结果',detail:'照片或视频的处理结果正在发送，文字记录仍可继续。'};
  if(status.media.retrying)return {tone:'warning',label:'保存重试中',detail:'有 '+status.media.pending+' 条媒体消息待完成，系统会自动重试。文字记录仍可继续。'};
  return {tone:'active',label:'媒体保存中',detail:'有 '+status.media.pending+' 条媒体消息待完成，保存结果会通过微信通知。文字记录仍可继续。'};
 }
 if(status.media?.lastError)return {tone:'warning',label:'部分媒体保存失败',detail:'请检查相册，重新发送未保存的照片或视频。文字记录仍可继续。'};
 if(!status.lastPoll)return {tone:'muted',label:'正在连接',detail:'正在等待微信首次连接结果。'};
 return {tone:'active',label:'运行正常',detail:'微信连接正常，可以发送成长记录、照片和视频。'};
}
export function wechatStatusTime(value){
 const date=new Date(value||'');
 return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'暂无';
}
