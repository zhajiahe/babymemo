export interface UploadRow {object_key:string;upload_id:string;size:number}
export interface UploadPart {partNumber:number;etag:string}
export interface UploadBucket {
 head(key:string):Promise<{size:number}|null>;
 resumeMultipartUpload(key:string,id:string):{complete(parts:UploadPart[]):Promise<{size:number}>};
}
export class FinalizeMismatchError extends Error {}
export function finalizeUpload(options:{
 bucket:UploadBucket;row:UploadRow;parts:UploadPart[];persist:()=>Promise<void>;isRecorded:()=>Promise<boolean>
}):Promise<{recovered:boolean}>;
