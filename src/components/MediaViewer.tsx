import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Download, Save, X } from 'lucide-react';

export type MediaItem = {
  id: string;
  day: string;
  title: string;
  mime: string;
  size: number;
  thumbnail_ready?: number;
  favorite?: number;
};
type MediaEdit = { day: string };

export function MediaViewer({ item, index, count, onNavigate, onClose, onSave }: {
  item: MediaItem;
  index: number;
  count: number;
  onNavigate: (direction: number) => void;
  onClose: () => void;
  onSave: (value: MediaEdit) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [day, setDay] = useState(item.day);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Native modal dialog supplies focus trapping, Escape and focus restoration.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  useEffect(() => {
    setDay(item.day);
    setError('');
  }, [item.id, item.day]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave({ day });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  const src = '/api/media/' + encodeURIComponent(item.id) + '/content';
  const video = item.mime.startsWith('video/');
  return (
    <dialog ref={dialogRef} className="media-dialog" aria-label="相册预览" onClose={onClose}
      onClick={event => { if (event.target === dialogRef.current) dialogRef.current?.close(); }}>
      <div className="media-viewer">
        <header className="media-viewer-header">
          <div>
            <strong>成长回忆</strong>
            <span className="muted">第 {index + 1} / {count} 项</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => dialogRef.current?.close()} aria-label="关闭预览"><X size={20} /></button>
        </header>
        <div className="media-viewer-stage">
          {video
            ? <video key={item.id} src={src} controls playsInline preload="metadata" aria-label={'成长视频'} />
            : <img key={item.id} src={src} alt={'成长照片'} />}
        </div>
        <div className="media-viewer-toolbar">
          <div className="media-viewer-arrows">
            <button type="button" className="secondary" disabled={index <= 0 || saving} onClick={() => onNavigate(-1)}><ChevronLeft size={16} /> 上一项</button>
            <button type="button" className="secondary" disabled={index >= count - 1 || saving} onClick={() => onNavigate(1)}>下一项 <ChevronRight size={16} /></button>
          </div>
          <a className="secondary media-download" href={src + '?download=1'}><Download size={16} />下载原文件</a>
        </div>
        <form className="media-viewer-edit" onSubmit={event => void save(event)}>
          <label className="field"><span>拍摄日期</span><input type="date" value={day} onChange={event => setDay(event.target.value)} required /></label>
          <button type="submit" className="primary" disabled={saving}><Save size={16} />{saving ? '保存中…' : '保存信息'}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </dialog>
  );
}
