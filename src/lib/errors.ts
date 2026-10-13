export class ApiFailure extends Error {
 constructor(readonly status:number,message:string){super(message);this.name='ApiFailure'}
}
export const friendlyError=(code:string)=>({EDIT_CONFLICT:'记录已被其他设备修改。请重新载入后核对并编辑。',KEEP_ONE_ACTIVE_BABY:'请保留至少一位宝宝档案。',RESTORE_EXPIRED_OR_UNAVAILABLE:'已超过恢复期限或正在清理，无法恢复。',REQUEST_ID_CONFLICT:'这次保存与之前的内容不一致，请核对后重新提交。',OFFLINE_NOT_CACHED:'这部分内容尚未保存到本机，请联网后打开一次。',DEVICE_STORAGE_UNAVAILABLE:'本机存储不可用，请允许站点存储后重试；内容仍保留在表单中。',LOGIN_REQUIRED:'请重新登录后同步。'}[code]||code);
