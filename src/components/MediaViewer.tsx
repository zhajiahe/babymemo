import { useEffect, useRef, useState, type FormEvent, type TouchEvent } from 'react';
import { ChevronLeft, ChevronRight, Download, Save, X, Trash2 } from 'lucide-react';
import {saveMediaOffline} from '../offline';
import {api} from '../lib/client';

export type MediaItem = {
  id: string;
  day: string;
  title: string;
  description: string;
  mime: string;
  size: number;
  thumbnail_ready?: number;
  updated_at?: string;
  pending?: boolean;
};
type MediaEdit = { day: string;description: string;requestId?:string;expectedUpdatedAt?:string };
type MediaReply = {updated_at?:string;id?:string;queued?:boolean};
function mediaDraft(item:MediaItem){try{return JSON.parse(localStorage.getItem('babymemo-draft-media-'+item.id)||'null')||{}}catch{return {}}}

export function MediaViewer({ item, index, count, onNavigate, onClose, onSave, onDelete }: {
  item: MediaItem;
  index: number;
  count: number;
  onNavigate: (direction: number) => void;
  onClose: () => void;
  onSave: (value: MediaEdit) => Promise<MediaReply>;
  onDelete: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<{x:number;y:number}|null>(null);
  const [day, setDay] = useState(()=>mediaDraft(item).day||item.day);
  const [description,setDescription]=useState<string>(()=>mediaDraft(item).description??item.description??'');
  const [version,setVersion]=useState(()=>mediaDraft(item).version??item.updated_at??'');
  const [draftId,setDraftId]=useState(item.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [requestId,setRequestId]=useState(()=>mediaDraft(item).requestId||crypto.randomUUID());

  // Native modal dialog supplies focus trapping, Escape and focus restoration.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  useEffect(() => {
    const draft=mediaDraft(item);setDay(draft.day||item.day);setDescription(draft.description??item.description??'');setVersion(draft.version??item.updated_at??'');setRequestId(draft.requestId||crypto.randomUUID());setDraftId(item.id);
    setError('');
  }, [item.id]);
  useEffect(()=>{if(draftId!==item.id)return;try{localStorage.setItem('babymemo-draft-media-'+item.id,JSON.stringify({day,description,requestId,version}))}catch{/* The visible form remains usable. */}},[day,description,requestId,version,item.id,draftId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const result=await onSave({day,description,requestId,expectedUpdatedAt:version});setVersion(result.queued?'pending:'+result.id:result.updated_at??version);
      localStorage.removeItem('babymemo-draft-media-'+item.id);setRequestId(crypto.randomUUID());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }
  async function reviewVersion(){try{const current=await api<MediaItem>('/api/media/'+item.id);if(confirm('服务器拍摄日期：'+current.day+'。服务器描述：'+(current.description||'（空）')+'。当前草稿仍保留；核对后允许再次保存？')){setVersion(current.updated_at||'');setRequestId(crypto.randomUUID());setError('')}}catch(e){setError(e instanceof Error?e.message:'读取失败')}}

  const src = '/api/media/' + encodeURIComponent(item.id) + '/content';
  const video = item.mime.startsWith('video/');
  // Only deliberate horizontal photo gestures page; never intercept video or vertical scrolling.
  function startSwipe(event:TouchEvent<HTMLDivElement>){
    touchStart.current=!video&&!saving&&event.touches.length===1
      ?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;
  }
  function finishSwipe(event:TouchEvent<HTMLDivElement>){
    const start=touchStart.current;touchStart.current=null;
    if(!start||video||saving||event.changedTouches.length!==1)return;
    const dx=event.changedTouches[0].clientX-start.x;
    const dy=event.changedTouches[0].clientY-start.y;
    if(Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.3)return;
    if(dx<0&&index<count-1)onNavigate(1);
    if(dx>0&&index>0)onNavigate(-1);
  }
  return (
    <dialog ref={dialogRef} className="media-dialog" aria-label="相册预览" onClose={onClose}
      onClick={event => { if (event.target === dialogRef.current) dialogRef.current?.close(); }}>
      <div className="media-viewer">
        <header className="media-viewer-header">
          <div>
            <strong>{item.day}</strong>
            <span className="muted">第 {index + 1} / {count} 项</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => dialogRef.current?.close()} aria-label="关闭预览"><X size={20} /></button>
        </header>
        <div className="media-viewer-stage" onTouchStart={startSwipe} onTouchEnd={finishSwipe} onTouchCancel={()=>{touchStart.current=null}}>
          {video
            ? <video key={item.id} src={src} controls playsInline preload="metadata" aria-label={'成长视频'} />
            : <img key={item.id} src={src} alt={'成长照片'} />}
        </div>
        <div className="media-viewer-toolbar">
          <div className="media-viewer-arrows">
            <button type="button" className="secondary" disabled={index <= 0 || saving} onClick={() => onNavigate(-1)}><ChevronLeft size={16} /> 上一项</button>
            <button type="button" className="secondary" disabled={index >= count - 1 || saving} onClick={() => onNavigate(1)}>下一项 <ChevronRight size={16} /></button>
          </div>
          <div className="media-detail-actions">
           <button type="button" className="secondary" disabled={saving} onClick={()=>{setSaving(true);setError('');void saveMediaOffline(src).then(()=>setError('已保存到本机，可离线查看。')).catch(e=>setError(e instanceof Error?e.message:'本机存储不足')).finally(()=>setSaving(false))}}>离线保存</button>
           <a className="secondary media-download" href={src + '?download=1'} download={item.title||'babymemo-media'}><Download size={16}/>下载</a>
           <button type="button" className="icon-btn media-remove" onClick={onDelete} aria-label="移入回收站"><Trash2 size={19}/></button>
          </div>
        </div>
        <form className="media-viewer-edit" onSubmit={event => void save(event)}>
          <label className="field"><span>拍摄日期</span><input type="date" value={day} onChange={event => setDay(event.target.value)} required /></label>
          <label className="field"><span>照片或视频描述</span><textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={1000} rows={3} placeholder="写下这段回忆…" /></label>
          <button type="submit" className="primary" disabled={saving}><Save size={16} />{saving ? '保存中…' : '保存信息'}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {error&&navigator.onLine&&<button type="button" className="secondary" disabled={saving} onClick={()=>void reviewVersion()}>核对服务器版本（保留草稿）</button>}
      </div>
    </dialog>
  );
}
