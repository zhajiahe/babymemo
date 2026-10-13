import test from 'node:test';
import assert from 'node:assert/strict';
import {projectMutation} from '../src/offline-store.mjs';
const job={id:'request-a',path:'/api/records/growth',method:'POST',payload:{babyId:'baby-a',day:'2026-10-12',weight:10,headCircumference:45,requestId:'request-a'}};
test('pending records retain stable IDs, units and baby isolation across reload',()=>{
 const resource={id:'/api/records/growth?babyId=baby-a&page=0',value:{items:[],hasMore:false}};
 const once=projectMutation(resource,job),twice=projectMutation(once,job);
 assert.equal(twice.value.items.length,1);assert.equal(twice.value.items[0].id,'request-a');assert.equal(twice.value.items[0].head_circumference,45);assert.equal(resource.value.items.length,0);
 const other={...resource,id:'/api/records/growth?babyId=baby-b&page=0'};assert.deepEqual(projectMutation(other,job).value,other.value);
});
test('local edits and deletions apply to cached rows without inventing server acknowledgement',()=>{
 const resource={id:'/api/records/growth?babyId=baby-a&page=0',value:{items:[{id:'record-a',day:'2026-10-12',weight:10}]}};
 const patch={...job,id:'edit-a',path:'/api/records/growth/record-a',method:'PATCH',payload:{...job.payload,weight:11}};
 const edited=projectMutation(resource,patch);assert.equal(edited.value.items[0].weight,11);assert.equal(edited.value.items[0].updated_at,'pending:edit-a');assert.equal(edited.value.items[0].pending,true);
 assert.deepEqual(projectMutation(edited,{...patch,method:'DELETE'}).value.items,[]);
});
test('offline baby profile changes include time, timezone, allergy and pending avatar',()=>{
 const state={id:'/api/state',value:{babies:[{id:'baby-a',name:'测试',birth_time:'',time_zone:'Asia/Shanghai'}]}};
 const updated=projectMutation(state,{id:'edit',path:'/api/babies/baby-a',method:'PATCH',payload:{birthTime:'12:34',timeZone:'Asia/Tokyo',allergies:'花生'}});
 assert.equal(updated.value.babies[0].birth_time,'12:34');assert.equal(updated.value.babies[0].allergies,'花生');
 const avatar=projectMutation(updated,{id:'avatar',path:'/api/babies/baby-a/avatar',kind:'avatar',payload:{babyId:'baby-a'}});assert.equal(avatar.value.babies[0].avatar_key,'pending:avatar');
 const removed=projectMutation(avatar,{id:'remove',path:'/api/babies/baby-a/avatar',method:'DELETE',payload:{}});assert.equal(removed.value.babies[0].avatar_key,'');assert.equal(removed.value.babies[0].updated_at,'pending:remove');
});
