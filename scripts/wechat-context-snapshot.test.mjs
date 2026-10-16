import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaCapabilities,explainMediaCapabilities} from '../src/wechat-capabilities.mjs';
import {referenceState,captureMessageReferences,validateReferenceMutation,buildWechatContextSnapshot} from '../src/wechat-context-snapshot.mjs';
const at=Date.parse('2026-10-16T10:00:00Z');
const id1='aaaaaaaa-1111-2222-3333-444444444444';
const id2='bbbbbbbb-1111-2222-3333-444444444444';
const refs=(babyId='a',expiresAt=at+60000)=>({babyId,kind:'growth',sourceMessageId:'old-query',ids:[id1,id2],expiresAt});
const base=(r=refs())=>({babyId:'a',lastQuery:r,lastMedia:null,invalidReferences:null});
const input=(thread,text,args,action='update_growth',babyId='a',messageId='incoming')=>validateReferenceMutation({
 action,args,text,babyId,messageId,scope:captureMessageReferences(thread,at),currentQuery:thread?.lastQuery,at
});
test('upload lifecycle capabilities distinguish editable metadata from committed original',()=>{
 const pending=mediaCapabilities({upload_state:'processing'});
 assert.equal(pending.editDescription,true);assert.equal(pending.editDay,true);
 assert.equal(pending.claimUploadComplete,false);
 assert.match(explainMediaCapabilities({upload_state:'processing'}),/不可宣称上传成功/);
 assert.equal(mediaCapabilities({upload_state:'ready'}).claimUploadComplete,true);
 for(const row of [{upload_state:'failed'},{upload_state:'processing',deleted_at:'deleted'},{upload_state:'unknown'}]){
  assert.equal(mediaCapabilities(row).editDescription,false);
  assert.equal(mediaCapabilities(row).claimUploadComplete,false);
 }
});
test('ordinal is bound to original query, never a newly supplied unrelated id',()=>{
 const thread=base();assert.equal(input(thread,'把刚才第一条体重改成10.2kg',{id:id1,weight:10.2}),null);
 assert.match(input(thread,'把刚才第一条体重改成10.2kg',{id:id2,weight:10.2}),/不一致/);
 assert.match(input(thread,'把刚才第一条体重改成10.2kg',{day:'2026-10-01',weight:10.2}),/不一致/);
 assert.equal(input(thread,'将10月1日体重改成10.2kg',{day:'2026-10-01',weight:10.2}),null);
});
test('a changed baby and expired reference cannot authorize an ordinal',()=>{
 const thread=base(refs('older-baby'));
 assert.equal(referenceState(thread.lastQuery,'a',at).reason,'baby_changed');
 assert.match(input(thread,'把刚才第一条体重改成10.2kg',{id:id1,weight:10.2}),/失效/);
 const expired=base(refs('a',at-1));
 assert.equal(referenceState(expired.lastQuery,'a',at).reason,'expired');
 assert.match(input(expired,'修改第一条体重',{id:id1,weight:10.2}),/失效/);
});
test('new query within this very message is only usable for explicitly query-then-update request',()=>{
 const thread=base(null),scope=captureMessageReferences(thread,at);
 thread.lastQuery={babyId:'a',kind:'growth',sourceMessageId:'incoming',ids:[id2],expiresAt:at+60000};
 assert.equal(validateReferenceMutation({action:'update_growth',args:{id:id2,weight:10.2},
   text:'先查询今年体重，然后把查到的第一条改成10.2kg',babyId:'a',messageId:'incoming',scope,currentQuery:thread.lastQuery,at}),null);
 assert.match(validateReferenceMutation({action:'update_growth',args:{id:id2,weight:10.2},
   text:'把刚才第一条改成10.2kg',babyId:'a',messageId:'incoming',scope,currentQuery:thread.lastQuery,at}),/失效/);
});
test('media-specific recent referent is scoped to the original batch',()=>{
 const thread={...base(null),lastMedia:{babyId:'a',ids:[id1],expiresAt:at+60000}};
 assert.equal(input(thread,'把刚才那张照片描述改成第一次踩沙子',{id:id1,description:'第一次踩沙子'},'update_media'),null);
 assert.match(input(thread,'把刚才那张照片描述改成第一次踩沙子',{id:id2,description:'第一次踩沙子'},'update_media'),/不匹配/);
 assert.match(input({...thread,lastMedia:{...thread.lastMedia,babyId:'b'}},'修改刚才照片',{id:id1},'update_media'),/失效/);
});
test('snapshot reads current D1 media status and reports original query provenance',async()=>{
 let state='processing';
 const env={DB:{prepare(sql){let params=[];return {bind(...args){params=args;return this},
 async all(){
  if(sql.includes('FROM growth_records'))return {results:[{id:id1},{id:id2}]};
  if(sql.includes('FROM media'))return {results:[{id:params[0],baby_id:'a',title:'IMG_1001.HEIC',day:'2026-10-16',upload_state:state}]};
  throw Error('unexpected SQL '+sql);
 }}}}};
 const thread={...base(refs()),lastMedia:{babyId:'a',ids:[id1],expiresAt:at+60000}};
 const scope=captureMessageReferences(thread,at);
 // Use a fresh time window; references are deliberately relative to wall clock.
 const now=Date.now();
 thread.lastQuery.expiresAt=now+60000;thread.lastMedia.expiresAt=now+60000;
 scope.query.expiresAt=now+60000;scope.media.expiresAt=now+60000;
 const baby={id:'a',name:'测试宝宝'};
 let snapshot=await buildWechatContextSnapshot(env,baby,thread,at,scope);
 assert.equal(snapshot.references.lastQuery.sourceMessageId,'old-query');
 assert.equal(snapshot.recentMedia[0].uploadState,'processing');
 assert.equal(snapshot.recentMedia[0].capabilities.editDescription,true);
 assert.equal(snapshot.recentMedia[0].capabilities.claimUploadComplete,false);
 state='ready';
 snapshot=await buildWechatContextSnapshot(env,baby,thread,at,scope);
 assert.equal(snapshot.recentMedia[0].capabilities.claimUploadComplete,true);
});
