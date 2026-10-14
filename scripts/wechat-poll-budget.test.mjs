import test from 'node:test';
import assert from 'node:assert/strict';
import {
 WECHAT_LISTEN_TIMEOUT_MS,WECHAT_IDLE_INTERVAL_MS,WECHAT_ACTIVE_INTERVAL_MS,WECHAT_FAILURE_RETRY_MS,
 nextWechatPollDelay,isWechatIdleTimeout
} from '../src/wechat-poll-budget.ts';

test('bounded iLink listen has a predictable lower DO billable duration upper bound',()=>{
 assert.equal(WECHAT_LISTEN_TIMEOUT_MS,8000);
 assert.equal(WECHAT_IDLE_INTERVAL_MS,22000);
 const original=45000/(45000+2500);
 const updated=WECHAT_LISTEN_TIMEOUT_MS/(WECHAT_LISTEN_TIMEOUT_MS+WECHAT_IDLE_INTERVAL_MS);
 assert.ok(updated<original/2,'Idle listening duty cycle must fall at least 50%');
 // Two always-enabled sessions with 128 MiB assigned memory each.
 const estimatedDailyGbSeconds=2*86400*updated*(128/1024);
 assert.ok(estimatedDailyGbSeconds<6500,'Daily 2-connection DO polling budget too high');
});

test('quiet poll gets lower frequency, active batches drain rapidly, true faults retain backoff',()=>{
 assert.equal(nextWechatPollDelay('messages'),WECHAT_ACTIVE_INTERVAL_MS);
 assert.equal(nextWechatPollDelay('empty'),WECHAT_IDLE_INTERVAL_MS);
 assert.equal(nextWechatPollDelay('idle-timeout'),WECHAT_IDLE_INTERVAL_MS);
 assert.equal(nextWechatPollDelay('error'),WECHAT_FAILURE_RETRY_MS);
 assert.ok(WECHAT_ACTIVE_INTERVAL_MS<WECHAT_IDLE_INTERVAL_MS);
 assert.ok(WECHAT_FAILURE_RETRY_MS>WECHAT_IDLE_INTERVAL_MS);
});

test('only our explicit getupdates deadline is normal idle; auth/network faults are not hidden',()=>{
 assert.equal(isWechatIdleTimeout(new Error('WECHAT_GETUPDATES_TIMEOUT')),true);
 for(const error of [new Error('WECHAT_AUTH_EXPIRED'),new Error('WECHAT_HTTP_503'),new DOMException('Aborted','AbortError'),new Error('POLL_OR_NETWORK_ERROR'),null]){
  assert.equal(isWechatIdleTimeout(error),false);
 }
});
