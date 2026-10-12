export const MAX_WECHAT_IMAGE_BYTES:number;
export class WechatPhotoError extends Error{}
export function decodeWeChatAesKey(encoded:unknown):Uint8Array;
export function wechatCdnUrl(media:unknown):string;
export function imageReference(item:unknown):{media:Record<string,unknown>;key:string};
export function inspectImage(bytes:Uint8Array):string;
export function downloadWeChatImage(item:unknown,options?:{fetchImpl?:typeof fetch;maxBytes?:number}):Promise<{bytes:Uint8Array;mime:string}>;
export function photoItems(raw:unknown):unknown[];
export function photoRecordId(sourceId:string):string;
export function persistWeChatPhotos(env:any,raw:any,baby:any,messageId:string,options?:{fetchImpl?:typeof fetch;maxBytes?:number}):Promise<string|null>;
