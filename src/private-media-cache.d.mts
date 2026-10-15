export const PRIVATE_THUMBNAIL_CACHE:string;
export const MAX_AUTO_THUMBNAILS:number;
export const MAX_AUTO_THUMBNAIL_BYTES:number;
export function mediaThumbnailUrl(item:{id:string;updated_at?:string|null}):string;
export function thumbnailVersion(requestUrl:string):string|null;
export function cacheableThumbnail(requestUrl:string,response:Response):boolean;
