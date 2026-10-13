export const MAX_WECHAT_MEDIA_BYTES:number;
export const MAX_WECHAT_IMAGE_BYTES:number;
export class WechatPhotoError extends Error{}
export function wechatMediaErrorCode(error:unknown):string;
export function decodeWeChatAesKey(encoded:unknown):Uint8Array;
export function wechatCdnUrl(media:unknown):string;
export function imageReference(item:unknown):{media:Record<string,unknown>;key:string};
export function mediaReference(item:unknown):{media:Record<string,unknown>;key:string;kind:'image'|'video'};
export function inspectImage(bytes:Uint8Array):string;
export function inspectVideo(bytes:Uint8Array):string;
export function downloadWeChatImage(item:unknown,options?:{fetchImpl?:typeof fetch;maxBytes?:number}):Promise<{bytes:Uint8Array;mime:string}>;
export function downloadWeChatVideo(item:unknown,options?:{fetchImpl?:typeof fetch;maxBytes?:number}):Promise<{bytes:Uint8Array;mime:string}>;
export function storeEncryptedMedia(bucket:any,objectKey:string,item:unknown,options?:{fetchImpl?:typeof fetch;maxBytes?:number}):Promise<{size:number;mime:string}>;
export function mediaItems(raw:unknown):unknown[];
export function photoItems(raw:unknown):unknown[];
export function videoItems(raw:unknown):unknown[];
export function photoRecordId(sourceId:string):string;
export function persistWeChatMedia(env:any,raw:any,baby:any,messageId:string,options?:{fetchImpl?:typeof fetch;maxBytes?:number}):Promise<string|null>;
export function persistWeChatPhotos(env:any,raw:any,baby:any,messageId:string,options?:{fetchImpl?:typeof fetch;maxBytes?:number}):Promise<string|null>;
