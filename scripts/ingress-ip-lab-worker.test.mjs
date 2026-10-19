import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import lab from './ingress-ip-lab-worker.mjs';

const origin='https://bm-ip-lab.20250530.space';
const makeEnv=()=>({
 ENAM_D1:{prepare(sql){assert.equal(sql,'SELECT 1 AS healthy');return {first:async()=>({healthy:1})}}},
 APAC_D1:{prepare(sql){assert.equal(sql,'SELECT 1 AS healthy');return {first:async()=>({healthy:1})}}},
 ENAM_R2:{get:async (key,opts)=>({arrayBuffer:async()=>new Uint8Array(key.endsWith('photo-2m-v1.bin')?(opts?.range?.length||2097152):key.endsWith('medium-v1.bin')?262144:31).buffer})},
 APAC_R2:{get:async key=>({arrayBuffer:async()=>new Uint8Array(key.endsWith('medium-v1.bin')?262144:31).buffer})}
});
test('single-page mobile dashboard contains valid inline JavaScript, no external tracking',async()=>{
 const resp=await lab.fetch(new Request(origin+'/'),makeEnv());
 assert.equal(resp.status,200);
 assert.match(resp.headers.get('content-security-policy'),/connect-src/);
 const html=await resp.text();
 assert.match(html,/开始一键测速/);
 assert.match(html,/媒体256KB/);
 const source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(source,'missing inline application script');
 assert.doesNotThrow(()=>new Script(source));
 const candidateDefinitions=source.split('const candidates=[')[1]?.split('];')[0]||'';
 assert.equal((candidateDefinitions.match(/bm-lab-[sju]\d\.20250530\.space/g)||[]).length,6);
 assert.match(source,/const rounds=focused\?6:3/);
});
test('media test only returns synthetic bytes with exact origin-scoped CORS',async()=>{
 const resp=await lab.fetch(new Request('https://bm-lab-s1.20250530.space/probe/media/enam',{headers:{Origin:origin}}),makeEnv());
 assert.equal(resp.status,200);
 assert.equal(resp.headers.get('access-control-allow-origin'),origin);
 assert.match(resp.headers.get('access-control-expose-headers'),/X-Probe-Backend-Ms/);
 assert.equal((await resp.arrayBuffer()).byteLength,262144);
 const untrusted=await lab.fetch(new Request('https://bm-lab-s1.20250530.space/probe/media/enam',{headers:{Origin:'https://evil.example'}}),makeEnv());
 assert.equal(untrusted.headers.get('access-control-allow-origin'),null);
});
test('D1 probes remain read-only and app account routes are not exposed',async()=>{
 const ok=await lab.fetch(new Request(origin+'/probe/d1/enam',{headers:{Origin:origin}}),makeEnv());
 assert.equal(ok.status,200);
 assert.deepEqual({kind:(await ok.json()).kind}, {kind:'d1'});
 const denied=await lab.fetch(new Request(origin+'/api/login'),makeEnv());
 assert.equal(denied.status,404);
});

test('fourth-round 2MiB / Range page is syntactically valid and remains isolated',async()=>{
 const resp=await lab.fetch(new Request(origin+'/?media=1'),makeEnv());
 assert.equal(resp.status,200);
 const html=await resp.text();
 assert.match(html,/第四轮/);
 assert.match(html,/2 MiB/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js,'media dashboard script missing');
 assert.doesNotThrow(()=>new Script(js));
 assert.match(js,/bm-lab-j1\.20250530\.space/);
 assert.match(js,/bm-lab-s2\.20250530\.space/);
 assert.doesNotMatch(js,/api\/login/);
});
test('large synthetic full download and verified video Range 206',async()=>{
 const h={Origin:origin};
 const root='https://bm-lab-j1.20250530.space';
 const full=await lab.fetch(new Request(root+'/probe/large/full/enam',{headers:h}),makeEnv());
 assert.equal(full.status,200);
 assert.equal(full.headers.get('access-control-allow-origin'),origin);
 assert.equal(full.headers.get('Accept-Ranges'),'bytes');
 assert.equal((await full.arrayBuffer()).byteLength,2097152);
 const part=await lab.fetch(new Request(root+'/probe/large/range/enam',{headers:{...h,Range:'bytes=0-262143'}}),makeEnv());
 assert.equal(part.status,206);
 assert.equal(part.headers.get('Content-Range'),'bytes 0-262143/2097152');
 assert.equal(part.headers.get('access-control-allow-origin'),origin);
 assert.equal((await part.arrayBuffer()).byteLength,262144);
 const wrong=await lab.fetch(new Request(root+'/probe/large/range/enam',{headers:{...h,Range:'bytes=1-262144'}}),makeEnv());
 assert.equal(wrong.status,416);
 const untrusted=await lab.fetch(new Request(root+'/probe/large/full/enam',{headers:{Origin:'https://evil.example'}}),makeEnv());
 assert.equal(untrusted.headers.get('access-control-allow-origin'),null);
});
test('video Range preflight allows only lab origin and Range header',async()=>{
 const req=new Request('https://bm-lab-j1.20250530.space/probe/large/range/enam',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Range'}});
 const res=await lab.fetch(req,makeEnv());
 assert.equal(res.status,204);
 assert.equal(res.headers.get('access-control-allow-origin'),origin);
 assert.match(res.headers.get('Access-Control-Allow-Headers'),/Range/);
 const denied=await lab.fetch(new Request(req.url,{method:'OPTIONS',headers:{Origin:'https://evil.example'}}),makeEnv());
 assert.equal(denied.headers.get('access-control-allow-origin'),null);
});
