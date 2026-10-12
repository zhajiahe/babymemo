import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "./types";
import { authenticated, b64, cookieHeader, cookieName, matchesSecret, openSeal, passwordHash, passwordIterations, protectOrigin, randomToken, seal, sha256, unb64 } from "./security";

const app = new Hono<Env>();
const babySchema=z.object({name:z.string().trim().min(1).max(60),birthDate:z.iso.date(),gender:z.enum(["boy","girl","unknown"]).default("unknown"),allergies:z.string().max(2000).optional()});
const setupSchema=z.object({bootstrapSecret:z.string().min(1),email:z.email().max(320),password:z.string().min(12).max(128),baby:babySchema});
app.onError((error,c)=>{console.error("request failure",error instanceof Error?error.message:"unknown");return c.json({error:"服务器暂时无法完成请求"},500);});
app.use("/api/*",async(c,next)=>{
 await next();
 c.header("Cache-Control","no-store");
 c.header("X-Content-Type-Options","nosniff");
 c.header("Referrer-Policy","no-referrer");
 c.header("X-Frame-Options","DENY");
});
app.use("/api/*",protectOrigin);
const setting=async(c: {env:Env["Bindings"]},key:string)=>{const x=await c.env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first<{value:string}>();return x?.value??null;};
app.get("/api/health",(c)=>c.json({ok:true,app:"BabyMemo"}));
app.get("/api/setup/status",async(c)=>{
 const initialized=(await setting(c,"initialized"))==="1";
 return c.json({initialized,setupAvailable:!initialized&&Boolean(c.env.BOOTSTRAP_SECRET?.length>=32)});
});
app.post("/api/setup",zValidator("json",setupSchema),async(c)=>{
 const data=c.req.valid("json");
 if(!c.env.BOOTSTRAP_SECRET || c.env.BOOTSTRAP_SECRET.length<32)return c.json({error:"请先配置 BOOTSTRAP_SECRET"},503);
 if(!(await matchesSecret(data.bootstrapSecret,c.env.BOOTSTRAP_SECRET)))return c.json({error:"初始化密钥不正确"},403);
 if((await setting(c,"initialized"))==="1")return c.json({error:"实例已初始化"},409);
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const uid=crypto.randomUUID(),bid=crypto.randomUUID();
 const statements=[
  c.env.DB.prepare("INSERT INTO users (id,email,password_salt,password_hash,iterations) VALUES (?,?,?,?,?)").bind(uid,data.email.toLowerCase(),b64(salt),await passwordHash(data.password,salt),passwordIterations),
  c.env.DB.prepare("INSERT INTO babies (id,name,birth_date,gender,allergies) VALUES (?,?,?,?,?)").bind(bid,data.baby.name,data.baby.birthDate,data.baby.gender,data.baby.allergies??null),
  c.env.DB.prepare("INSERT INTO settings (key,value) VALUES ('initialized','1')")
 ];
 try{await c.env.DB.batch(statements)}catch{return c.json({error:"初始化失败；如果已创建账号，请联系维护者检查数据库，不要重复初始化"},409);}
 return c.json({ok:true},201);
});
app.post("/api/auth/login",zValidator("json",z.object({email:z.email(),password:z.string().min(1)})),async(c)=>{
 const {email,password}=c.req.valid("json");const id=email.trim().toLowerCase();
 const attempts=await c.env.DB.prepare("SELECT failures,blocked_until FROM auth_attempts WHERE identifier=?").bind(id).first<{failures:number,blocked_until:number}>();
 if(attempts && attempts.blocked_until>Date.now())return c.json({error:"尝试过多，请稍后再试"},429);
 const user=await c.env.DB.prepare("SELECT id,password_salt,password_hash,iterations FROM users WHERE email=?").bind(id).first<{id:string,password_salt:string,password_hash:string,iterations:number}>();
 const salt=user?unb64(user.password_salt):new Uint8Array(16);
 const ok=await matchesSecret(await passwordHash(password,salt,user?.iterations??passwordIterations),user?.password_hash??"invalid");
 if(!user||!ok){
 const failures=(attempts?.failures??0)+1;
 await c.env.DB.prepare("INSERT INTO auth_attempts(identifier,failures,blocked_until) VALUES(?,?,?) ON CONFLICT(identifier) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until").bind(id,failures,failures>=5?Date.now()+15*60*1000:0).run();
 return c.json({error:"邮箱或密码错误"},401);
 }
 await c.env.DB.prepare("DELETE FROM auth_attempts WHERE identifier=?").bind(id).run();
 const token=randomToken();
 await c.env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(await sha256(token),user.id,Date.now()+30*86400_000).run();
 c.header("Set-Cookie",cookieHeader(token,new URL(c.req.url).protocol==="https:"));
 return c.json({ok:true});
});
app.post("/api/auth/logout",authenticated,async(c)=>{
 const cookie=c.req.header("cookie")?.split(";").map(s=>s.trim()).find(s=>s.startsWith(cookieName+"="))?.slice(cookieName.length+1);
 if(cookie)await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(cookie)).run();
 c.header("Set-Cookie",cookieHeader("",new URL(c.req.url).protocol==="https:")+"; Max-Age=0");
 return c.json({ok:true});
});
app.get("/api/me",authenticated,async(c)=>{
 const row=await c.env.DB.prepare("SELECT email FROM users WHERE id=?").bind(c.get("userId")).first();
 return c.json(row);
});
app.get("/api/babies",authenticated,async(c)=>{
 const babies=await c.env.DB.prepare("SELECT * FROM babies ORDER BY created_at ASC").all();
 return c.json({items:babies.results});
});
app.get("/api/growth",authenticated,async(c)=>{
 const id=c.req.query("babyId");if(!id)return c.json({error:"缺少 babyId"},400);
 const limit=Math.min(100,Math.max(1,Number(c.req.query("limit"))||30));
 const rows=await c.env.DB.prepare("SELECT * FROM growth_records WHERE baby_id=? ORDER BY recorded_at DESC LIMIT ?").bind(id,limit).all();
 return c.json({items:rows.results});
});
app.post("/api/growth",authenticated,zValidator("json",z.object({babyId:z.string().uuid(),recordedAt:z.iso.date(),weight:z.number().positive().max(250).optional(),height:z.number().positive().max(250).optional(),headCircumference:z.number().positive().max(100).optional(),notes:z.string().max(2000).optional()})),async(c)=>{
 const d=c.req.valid("json"),id=crypto.randomUUID();
 const hasBaby=await c.env.DB.prepare("SELECT id FROM babies WHERE id=?").bind(d.babyId).first();if(!hasBaby)return c.json({error:"宝宝不存在"},404);
 await c.env.DB.prepare("INSERT INTO growth_records (id,baby_id,recorded_at,weight,height,head_circumference,notes) VALUES (?,?,?,?,?,?,?)").bind(id,d.babyId,d.recordedAt,d.weight??null,d.height??null,d.headCircumference??null,d.notes??null).run();
 return c.json({id},201);
});
app.get("/api/milestones",authenticated,async(c)=>{
 const id=c.req.query("babyId");if(!id)return c.json({error:"缺少 babyId"},400);
 const rows=await c.env.DB.prepare("SELECT * FROM milestones WHERE baby_id=? ORDER BY happened_at DESC LIMIT 50").bind(id).all();
 return c.json({items:rows.results});
});
app.post("/api/milestones",authenticated,zValidator("json",z.object({babyId:z.string().uuid(),happenedAt:z.iso.date(),title:z.string().trim().min(1).max(150),content:z.string().max(10000).optional()})),async(c)=>{
 const d=c.req.valid("json"),id=crypto.randomUUID();
 const hasBaby=await c.env.DB.prepare("SELECT id FROM babies WHERE id=?").bind(d.babyId).first();if(!hasBaby)return c.json({error:"宝宝不存在"},404);
 await c.env.DB.prepare("INSERT INTO milestones (id,baby_id,happened_at,title,content) VALUES (?,?,?,?,?)").bind(id,d.babyId,d.happenedAt,d.title,d.content??null).run();
 return c.json({id},201);
});
const integrationSchema=z.object({openrouterApiKey:z.string().max(512).optional(),openrouterModel:z.string().min(1).max(160).default("openai/gpt-4o-mini"),botEnabled:z.boolean().default(false),botWebhookSecret:z.string().max(256).optional(),botAccountId:z.string().max(120).optional(),botProvider:z.literal("wechat-clawbot").default("wechat-clawbot")});
app.get("/api/integrations",authenticated,async(c)=>{
 const model=(await setting(c,"openrouter_model"))||"openai/gpt-4o-mini";
 return c.json({openrouterModel:model,hasOpenrouterKey:Boolean(await setting(c,"openrouter_key")),botEnabled:(await setting(c,"bot_enabled"))==="1",botAccountId:(await setting(c,"bot_account"))??"",hasBotSecret:Boolean(await setting(c,"bot_secret")),botProvider:"wechat-clawbot"});
});
app.put("/api/integrations",authenticated,zValidator("json",integrationSchema),async(c)=>{
 const d=c.req.valid("json");
 const entries:[string,string][]=[["openrouter_model",d.openrouterModel],["bot_enabled",d.botEnabled?"1":"0"],["bot_account",d.botAccountId||""]];
 if(d.openrouterApiKey){if(!d.openrouterApiKey.startsWith("sk-or-"))return c.json({error:"OpenRouter Key 格式不正确"},400);entries.push(["openrouter_key",await seal(d.openrouterApiKey,c.env.CONFIG_ENCRYPTION_KEY)]);}
 if(d.botWebhookSecret){if(d.botWebhookSecret.length<32)return c.json({error:"Webhook Secret 至少 32 个字符"},400);entries.push(["bot_secret",await seal(d.botWebhookSecret,c.env.CONFIG_ENCRYPTION_KEY)]);}
 await c.env.DB.batch(entries.map(([key,value])=>c.env.DB.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").bind(key,value)));
 return c.json({ok:true});
});
app.post("/api/integrations/openrouter/test",authenticated,async(c)=>{
 const encrypted=await setting(c,"openrouter_key");if(!encrypted)return c.json({error:"请先填写 OpenRouter API Key"},400);
 const key=await openSeal(encrypted,c.env.CONFIG_ENCRYPTION_KEY);
 const response=await fetch("https://openrouter.ai/api/v1/models",{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)});
 return c.json({ok:response.ok,status:response.status},response.ok?200:502);
});
export default app;
