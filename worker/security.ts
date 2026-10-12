import type { Context, Next } from "hono";
import type { Env } from "./types";

const encoder = new TextEncoder();
const ITERATIONS = 210000;

export const b64 = (a: Uint8Array) => btoa(String.fromCharCode(...a));
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const hex = (a: Uint8Array) => Array.from(a).map((x) => x.toString(16).padStart(2, "0")).join("");
export const sha256 = async (text: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function passwordHash(password: string, salt: Uint8Array, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, 256)));
}
export const passwordIterations = ITERATIONS;
export async function matchesSecret(actual: string, expected: string): Promise<boolean> {
  if (!actual || !expected) return false;
  const [a, b] = await Promise.all([sha256(actual), sha256(expected)]);
  let diff = 0;
  for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i);
  return diff === 0;
}
export async function seal(value: string, hexKey: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/i.test(hexKey)) throw new Error("CONFIG_ENCRYPTION_KEY must be 64 hex characters");
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(hexKey.match(/../g)!, x => parseInt(x,16)), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoder.encode(value)));
  return `${b64(iv)}.${b64(ciphertext)}`;
}
export async function openSeal(value: string, hexKey: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/i.test(hexKey)) throw new Error("CONFIG_ENCRYPTION_KEY is invalid");
  const [a,b]=value.split(".");
  if(!a||!b) throw new Error("Invalid ciphertext");
  const key=await crypto.subtle.importKey("raw",Uint8Array.from(hexKey.match(/../g)!, x=>parseInt(x,16)),"AES-GCM",false,["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(a)},key,unb64(b)));
}
export const cookieName = "babymemo_session";
export function cookieHeader(token: string, secure: boolean) {
  return `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure?"; Secure":""}`;
}
export async function authenticated(c: Context<Env>, next: Next) {
  const cookie=c.req.header("cookie")?.split(";").map(x=>x.trim()).find(x=>x.startsWith(cookieName+"="))?.slice(cookieName.length+1);
  if(!cookie) return c.json({error:"请先登录"},401);
  const row=await c.env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?").bind(await sha256(cookie),Date.now()).first<{user_id:string}>();
  if(!row) return c.json({error:"登录已过期"},401);
  c.set("userId",row.user_id);
  await next();
}
export async function protectOrigin(c: Context<Env>, next: Next) {
  if(["GET","HEAD","OPTIONS"].includes(c.req.method)) return next();
  const origin=c.req.header("origin");
  const selfOrigin=new URL(c.req.url).origin;
  if(!origin||origin!==selfOrigin|| (c.env.APP_ORIGIN && new URL(c.env.APP_ORIGIN).origin!==selfOrigin))
    return c.json({error:"请求来源不受信任，请检查 APP_ORIGIN 和域名设置"},403);
  const ct=c.req.header("content-type")||"";
  if(!ct.includes("application/json") && !ct.includes("multipart/form-data"))return c.json({error:"不支持的请求格式"},415);
  return next();
}
