/** Client-side optional derivatives; original photos/videos are never modified. */
export async function fingerprintFile(file: File): Promise<string> {
  const sample = 65536;
  const first = new Uint8Array(await file.slice(0, sample).arrayBuffer());
  const last = new Uint8Array(await file.slice(Math.max(sample, file.size - sample)).arrayBuffer());
  const prefix = new TextEncoder().encode(file.name + '\0' + file.size + '\0' + (file.type || '') + '\0');
  const data = new Uint8Array(prefix.length + first.length + last.length);
  data.set(prefix);
  data.set(first, prefix.length);
  data.set(last, prefix.length + first.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, v => v.toString(16).padStart(2, '0')).join('');
}

export async function createAlbumThumbnail(file: File): Promise<Blob | null> {
  // Avoid decoding very large photographs on memory-constrained iPhones.
  if (!file.type.startsWith('image/') || file.size > 25 * 1024 * 1024) return null;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) return null;
    const ratio = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext('2d', {alpha: false});
    if (!ctx) return null;
    ctx.fillStyle = '#fff'; // Translucent PNG/GIF backgrounds
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encode = (quality: number) => new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', quality));
    let result = await encode(0.76);
    if (result && result.size > 524288) result = await encode(0.52);
    return result && result.size <= 524288 ? result : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}


/** Derive a small private JPEG from an already stored original (on-demand only). */
export async function createStoredThumbnail(id: string, mime: string): Promise<Blob | null> {
  const response = await fetch('/api/media/'+encodeURIComponent(id)+'/content', {
    credentials: 'same-origin'
  });
  if (!response.ok) throw Error('ORIGINAL_FETCH_'+response.status);
  const size=Number(response.headers.get('content-length')||0);
  if(size>25*1024*1024)return null;
  const data=await response.blob();
  if(data.size>25*1024*1024)return null;
  return createAlbumThumbnail(new File([data], 'existing-image', {type:mime}));
}

/** Best-effort poster frame; never changes the uploaded original video. */
export async function createVideoThumbnail(file:File):Promise<Blob|null>{
  if(!file.type.startsWith('video/')&& !/\.(mov|mp4|webm)$/i.test(file.name))return null;
  const objectUrl=URL.createObjectURL(file);
  const video=document.createElement('video');
  video.preload='metadata';video.muted=true;video.playsInline=true;
  try{
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('VIDEO_THUMB_TIMEOUT')),12000);
      video.onloadedmetadata=()=>{clearTimeout(timer);resolve()};
      video.onerror=()=>{clearTimeout(timer);reject(Error('VIDEO_THUMB_UNSUPPORTED'))};
      video.src=objectUrl;
    });
    if(!Number.isFinite(video.duration)||!video.videoWidth||!video.videoHeight)return null;
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('VIDEO_SEEK_TIMEOUT')),12000);
      video.onseeked=()=>{clearTimeout(timer);resolve()};
      video.onerror=()=>{clearTimeout(timer);reject(Error('VIDEO_SEEK_FAILED'))};
      video.currentTime=Math.min(1,Math.max(0,video.duration*0.1));
    });
    const canvas=document.createElement('canvas');
    const scale=Math.min(1,512/Math.max(video.videoWidth,video.videoHeight));
    canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
    canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
    canvas.getContext('2d')?.drawImage(video,0,0,canvas.width,canvas.height);
    const jpeg=await new Promise<Blob|null>(r=>canvas.toBlob(r,'image/jpeg',0.65));
    return jpeg&&jpeg.size<=524288?jpeg:null;
  }catch{return null}
  finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(objectUrl);}
}
