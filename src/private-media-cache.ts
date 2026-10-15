// The browser/Service Worker share a versioned URL. Version changes when the
// thumbnail is replaced, while the original stays private and unmodified.
export const PRIVATE_THUMBNAIL_CACHE='babymemo-private-thumbnails-v1';
export const MAX_AUTO_THUMBNAILS=160;
export const MAX_AUTO_THUMBNAIL_BYTES=128*1024; // <20 MiB worst case, typically much less

export function mediaThumbnailUrl(item:{id:string;updated_at?:string|null}):string{
 const base='/api/media/'+encodeURIComponent(item.id)+'/thumbnail';
 return item.updated_at?base+'?v='+encodeURIComponent(item.updated_at):base;
}
export function thumbnailVersion(requestUrl:string):string|null{
 const url=new URL(requestUrl,'https://babymemo.invalid');
 if(!/^\/api\/media\/[^/]+\/thumbnail$/.test(url.pathname))return null;
 const version=url.searchParams.get('v');
 return version&&url.searchParams.size===1?version:null;
}
export function cacheableThumbnail(requestUrl:string,response:Response):boolean{
 const version=thumbnailVersion(requestUrl);
 const size=Number(response.headers.get('Content-Length'));
 return !!version&&response.status===200&&
  response.headers.get('X-Thumbnail-Version')===version&&
  response.headers.get('X-Thumbnail-Derivative')==='1'&&
  response.headers.get('Content-Type')?.startsWith('image/jpeg')===true&&
  Number.isFinite(size)&&size>0&&size<=MAX_AUTO_THUMBNAIL_BYTES;
}
