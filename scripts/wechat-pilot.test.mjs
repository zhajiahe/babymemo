import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PILOT_LISTEN_TIMEOUT_MS,PILOT_LEASE_MS,PILOT_WATCHDOG_MS,PILOT_STALE_PAUSE_MS,
 PILOT_MAX_RESPONSE_CHARS,isPilotConnectionId,isActivePilotLease,isPilotCompletion,
 assertWechatPollResponse,trustedWechatBase} from '../src/wechat-pilot.ts';

test('Cron pilot is bounded and watchdog resumes legacy polling after a missed cron',()=>{
 assert.equal(PILOT_LISTEN_TIMEOUT_MS,35000);
 assert.ok(PILOT_LISTEN_TIMEOUT_MS<PILOT_WATCHDOG_MS);
 assert.ok(PILOT_WATCHDOG_MS<PILOT_LEASE_MS);
 assert.equal(PILOT_STALE_PAUSE_MS,3600000);
 const lease={id:'a',connectionId:'8d5357e7-2201-4e5f-9ac9-756576326404',expiresAt:120000};
 assert.equal(isActivePilotLease(lease,119999),true);
 assert.equal(isActivePilotLease(lease,120000),false);
 assert.equal(isActivePilotLease(null),false);
});
test('Pilot only targets an explicitly configured account and trusted iLink host',()=>{
 assert.equal(isPilotConnectionId('8d5357e7-2201-4e5f-9ac9-756576326404'),true);
 for(const v of ['','legacy','family','../../admin',null])assert.equal(isPilotConnectionId(v),false);
 assert.equal(trustedWechatBase('https://ilinkai.weixin.qq.com/'),'https://ilinkai.weixin.qq.com');
 for(const u of ['https://ilinkai.weixin.qq.com.evil.com/','http://ilinkai.weixin.qq.com/','https://ilinkai.weixin.qq.com:8080/','https://ilinkai.weixin.qq.com/path'])
  assert.throws(()=>trustedWechatBase(u),/WECHAT_UNTRUSTED_BASE/);
});
test('Stale token is not a generic protocol error; negative acknowledgements never advance cursor',()=>{
 assert.doesNotThrow(()=>assertWechatPollResponse({ret:0,msgs:[],get_updates_buf:'next'}));
 assert.throws(()=>assertWechatPollResponse({ret:-14}),/WECHAT_STALE_TOKEN/);
 assert.throws(()=>assertWechatPollResponse({errcode:-14}),/WECHAT_STALE_TOKEN/);
 assert.throws(()=>assertWechatPollResponse({ret:9}),/WECHAT_PROTOCOL_ERROR/);
 assert.throws(()=>assertWechatPollResponse([]),/WECHAT_PROTOCOL_ERROR/);
});
test('External replies are bounded and only known transport error classes are accepted',()=>{
 assert.equal(isPilotCompletion({kind:'response',raw:'{}'}),true);
 assert.equal(isPilotCompletion({kind:'response',raw:'a'.repeat(PILOT_MAX_RESPONSE_CHARS+1)}),false);
 assert.equal(isPilotCompletion({kind:'idle-timeout'}),true);
 assert.equal(isPilotCompletion({kind:'error',code:'WECHAT_HTTP_503'}),true);
 assert.equal(isPilotCompletion({kind:'error',code:'WECHAT_STALE_TOKEN'}),false);
 assert.equal(isPilotCompletion({kind:'error',code:'arbitrary'}),false);
});
test('Both drivers share the existing cursor-gated DO processor and Cron remains a separate deployment',()=>{
 const source=readFileSync(new URL('../src/wechat.ts',import.meta.url),'utf8');
 const pilot=readFileSync(new URL('../src/wechat-cron-pilot.ts',import.meta.url),'utf8');
 const config=readFileSync(new URL('../wrangler.wechat-pilot.jsonc',import.meta.url),'utf8');
 assert.match(source,/private async pollOnce\(external\?:PilotCompletion\)/);
 assert.match(source,/if\(external\)assertWechatPollResponse\(response\)/);
 assert.match(source,/this\.ctx\.storage\.put\('cursor',response\.get_updates_buf\)/);
 assert.match(source,/if\(isActivePilotLease\(lease\)\)/);
 assert.match(source,/if\(!external&&/);
 assert.doesNotMatch(pilot,/async fetch\(/);
 assert.equal(JSON.parse(config).name,'babymemo-wechat-cron-pilot');
 assert.equal(JSON.parse(config).durable_objects.bindings[0].script_name,'babymemo');
});
