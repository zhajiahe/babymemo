/** Server-owned capabilities. Do not duplicate these rules in model prompts. */
export type MediaUploadState='processing'|'ready'|'failed';
export type MediaCapabilities={
 editDescription:boolean; editDay:boolean; claimUploadComplete:boolean;
 reason:string|null;
};
export function mediaCapabilities(row:{upload_state?:unknown;deleted_at?:unknown;purge_token?:unknown}):MediaCapabilities{
 const state=row.upload_state||'ready';
 if(row.deleted_at||row.purge_token)return {editDescription:false,editDay:false,claimUploadComplete:false,reason:'record_unavailable'};
 if(state==='failed')return {editDescription:false,editDay:false,claimUploadComplete:false,reason:'original_upload_failed'};
 if(state==='processing')return {editDescription:true,editDay:true,claimUploadComplete:false,reason:'original_upload_pending'};
 if(state==='ready')return {editDescription:true,editDay:true,claimUploadComplete:true,reason:null};
 return {editDescription:false,editDay:false,claimUploadComplete:false,reason:'unknown_upload_state'};
}
export function explainMediaCapabilities(row:{upload_state?:unknown;deleted_at?:unknown;purge_token?:unknown}):string{
 const c=mediaCapabilities(row);
 return c.editDescription
  ?'元数据可编辑（描述、归档日期）；'+(c.claimUploadComplete?'原文件已保存':'原文件尚未完成保存，不可宣称上传成功')
  :'元数据不可编辑（'+c.reason+'）；不可宣称原文件已保存';
}
