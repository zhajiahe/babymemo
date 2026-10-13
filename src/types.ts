export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  BOT: DurableObjectNamespace;
  ASSETS: Fetcher;
  SESSION_SECRET?: string;
  DATA_KEY?: string;
  OPENROUTER_API_KEY?: string;
}
export type ApplicationEnv={Bindings:Env;Variables:{mutationIdentity:{id:string;path:string;method:string;hash:string}|null}};
export type Baby = {id:string; name:string; birthday:string; birth_time:string; gender:string; time_zone:string; allergies:string; notes:string;avatar_key:string;updated_at:string};
export type Owner = {id:number; name:string; password_salt:string; password_hash:string; session_version:number};
