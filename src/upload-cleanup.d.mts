import type { Env } from './types';
export interface UploadRetentionStats {scanned:number;aborted:number;recovered:number;skipped:number;errors:number}
export function cleanupExpiredUploads(args:{
 env:Env;olderThan:string;limit?:number;
 finalizeUpload: (options:{
   bucket:Env['MEDIA'];row:{object_key:string;upload_id:string;size:number};
   parts:{partNumber:number;etag:string}[];
   persist:()=>Promise<void>;isRecorded:()=>Promise<boolean>
 })=>Promise<{recovered:boolean}>
}):Promise<UploadRetentionStats>;
