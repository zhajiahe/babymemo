import test from 'node:test';
import assert from 'node:assert/strict';
import {DurableMediaQueue,MAX_MEDIA_TASKS} from '../src/wechat-media-queue.mjs';
function storage(){
 const data=new Map();let serial=Promise.resolve();
 const api={data,get:async key=>structuredClone(data.get(key)),put:async(key,value)=>data.set(key,structuredClone(value)),delete:async key=>data.delete(key),setAlarm:async value=>data.set('alarm',value),deleteAlarm:async()=>data.delete('alarm')};
 api.transaction=fn=>{const next=serial.then(async()=>{const backup=structuredClone(data);try{return await fn(api)}catch(e){data.clear();for(const entry of backup)data.set(...entry);throw e}});serial=next.catch(()=>{});return next};return api;
}
function hooks(overrides={}){
 return {permission:async()=> 'active',execute:async()=>({payload:'encrypted-result',ok:true}),failure:async(_payload,_error,attempt)=>attempt>=3?{payload:'encrypted-failure',ok:false}:null,deliver:async()=>{},errorCode:()=> 'WECHAT_CDN_HTTP_503',...overrides};
}
test('durable acceptance survives a new consumer and duplicate delivery does not execute twice',async()=>{
 const state=storage();let writes=0,replies=0;const callbacks=hooks({execute:async()=>{writes++;return {payload:'cipher-result',ok:true}},deliver:async()=>{replies++}});
 const first=new DurableMediaQueue(state,callbacks);await first.enqueue('message-one','cipher-media');await first.enqueue('message-one','cipher-media');assert.equal(writes,0);assert.equal((await first.status()).pending,1);
 const recovered=new DurableMediaQueue(state,callbacks);await recovered.alarm();await recovered.enqueue('message-one','cipher-media');await recovered.alarm();assert.equal(writes,1);assert.equal(replies,1);assert.equal((await recovered.status()).pending,0);
});
test('failed final reply is retried with the same client ID and without rerunning media or caption writes',async t=>{
 let now=100000;t.mock.method(Date,'now',()=>now);const state=storage();let writes=0;const clientIds=[];
 const callbacks=hooks({execute:async()=>{writes++;return {payload:'cipher-result',ok:true}},deliver:async(_p,_r,id)=>{clientIds.push(id);if(clientIds.length===1)throw Error('transport')}});
 const first=new DurableMediaQueue(state,callbacks);await first.enqueue('reply-retry','cipher');await first.alarm();assert.equal((await first.status()).retrying,true);
 now+=30001;await new DurableMediaQueue(state,callbacks).alarm();assert.equal(writes,1);assert.equal(clientIds.length,2);assert.equal(clientIds[0],clientIds[1]);
});
test('media failures have three durable attempts, respect backoff and retain a sanitized final failure',async t=>{
 let now=100000;t.mock.method(Date,'now',()=>now);const state=storage();let attempts=0;const replies=[];
 const callbacks=hooks({execute:async()=>{attempts++;throw Error('provider URL and key must not enter status')},deliver:async(_p,result)=>replies.push(result)});
 const first=new DurableMediaQueue(state,callbacks);await first.enqueue('failure','cipher');await first.alarm();await first.alarm();assert.equal(attempts,1);
 for(let n=0;n<2;n++){now+=30001;await new DurableMediaQueue(state,callbacks).alarm()}
 assert.equal(attempts,3);assert.deepEqual(replies,['encrypted-failure']);const status=await first.status();assert.equal(status.pending,0);assert.equal(status.lastError.attempt,3);assert.doesNotMatch(JSON.stringify(status),/provider|URL|key|cipher/);
});
test('reset during an in-flight save cannot resurrect the job or publish an old binding result',async()=>{
 const state=storage();let unblock,started,deliveries=0;const gate=new Promise(resolve=>unblock=resolve),began=new Promise(resolve=>started=resolve);
 const queue=new DurableMediaQueue(state,hooks({execute:async()=>{started();await gate;return {payload:'cipher-result',ok:true}},deliver:async()=>{deliveries++}}));
 await queue.enqueue('old-binding','cipher');const running=queue.alarm();await began;await queue.reset();unblock();await running;assert.equal(deliveries,0);assert.equal((await queue.status()).pending,0);assert.equal(state.data.has('alarm'),false);
});
test('pause preserves accepted tasks and credential changes reject stale tasks',async()=>{
 const state=storage();let permission='paused',writes=0;const queue=new DurableMediaQueue(state,hooks({permission:async()=>permission,execute:async()=>{writes++;return {payload:'result',ok:true}}}));
 await queue.enqueue('paused','cipher');await queue.alarm();assert.equal(writes,0);assert.equal((await queue.status()).pending,1);
 permission='active';await queue.start();await queue.alarm();assert.equal(writes,1);
 await queue.enqueue('stale','cipher');permission='stale';await queue.alarm();assert.equal(writes,1);assert.equal((await queue.status()).pending,0);
});
test('enqueue while a media save is pending preserves both jobs in source order',async()=>{
 const state=storage();let started,unblock;const gate=new Promise(resolve=>unblock=resolve),began=new Promise(resolve=>started=resolve);const writes=[];
 const queue=new DurableMediaQueue(state,hooks({execute:async payload=>{writes.push(payload);if(writes.length===1){started();await gate}return {payload:'result',ok:true}}}));
 await queue.enqueue('first','cipher-first');const running=queue.alarm();await began;await queue.enqueue('second','cipher-second');unblock();await running;assert.equal((await queue.status()).pending,1);await queue.alarm();assert.deepEqual(writes,['cipher-first','cipher-second']);
});
test('bounded queue explicitly refuses excess work and accepts it when capacity is available',async()=>{
 const queue=new DurableMediaQueue(storage(),hooks());for(let n=0;n<MAX_MEDIA_TASKS;n++)assert.equal((await queue.enqueue('m'+n,'cipher')).accepted,true);
 assert.equal((await queue.enqueue('overflow','cipher')).accepted,false);assert.equal((await queue.status()).pending,MAX_MEDIA_TASKS);await queue.alarm();assert.equal((await queue.enqueue('overflow','cipher')).accepted,true);
});
