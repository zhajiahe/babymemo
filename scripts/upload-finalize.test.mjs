import assert from 'node:assert/strict';
import test from 'node:test';
import {finalizeUpload,FinalizeMismatchError} from '../src/upload-finalize.mjs';

function mock(size=11) {
  const state={stored:null,commits:0,completeCalls:0,errors:0};
  const row={object_key:'private/test/uuid',upload_id:'multipart-id',size};
  const parts=[{partNumber:1,etag:'test-etag'}];
  const bucket={
    async head(key){assert.equal(key,row.object_key);return state.stored;},
    resumeMultipartUpload(key,id) {
      assert.equal(key,row.object_key);
      assert.equal(id,row.upload_id);
      return {
        async complete(p){
          assert.deepEqual(p,parts);
          state.completeCalls++;
          state.stored={size};
          return state.stored;
        }
      };
    }
  };
  return {state,row,parts,bucket};
}

test('R2 completed but D1 failed: retry commits metadata without repeating complete',async()=>{
 const {state,row,parts,bucket}=mock();
 const deps={bucket,row,parts,
   async persist(){state.commits++;if(state.commits===1)throw Error('D1 unavailable');},
   async isRecorded(){return state.commits>1}
 };
 await assert.rejects(finalizeUpload(deps),/D1 unavailable/);
 assert.equal(state.completeCalls,1);
 assert.deepEqual(state.stored,{size:11});
 const result=await finalizeUpload(deps);
 assert.deepEqual(result,{recovered:true});
 assert.equal(state.completeCalls,1,'Multipart cannot be completed twice');
 assert.equal(state.commits,2);
});

test('ambiguous R2 completion error after object stored is recoverable',async()=>{
 const {state,row,parts,bucket}=mock();
 bucket.resumeMultipartUpload=()=>({
   async complete(){state.completeCalls++;state.stored={size:11};throw Error('response lost');}
 });
 const result=await finalizeUpload({bucket,row,parts,
   async persist(){state.commits++;},async isRecorded(){return false;}
 });
 assert.deepEqual(result,{recovered:true});
 assert.equal(state.completeCalls,1);
 assert.equal(state.commits,1);
});

test('concurrent metadata commit conflict is success if D1 row already exists',async()=>{
 const {state,row,parts,bucket}=mock();
 state.stored={size:11};
 const result=await finalizeUpload({bucket,row,parts,
   async persist(){throw Error('UNIQUE constraint');},
   async isRecorded(){return true}
 });
 assert.deepEqual(result,{recovered:true});
 assert.equal(state.completeCalls,0);
});

test('existing R2 object of mismatched size never overrides or commits',async()=>{
 const {state,row,parts,bucket}=mock();
 state.stored={size:5};
 await assert.rejects(finalizeUpload({bucket,row,parts,
   async persist(){state.commits++},async isRecorded(){return false;}
 }),FinalizeMismatchError);
 assert.equal(state.completeCalls,0);
 assert.equal(state.commits,0);
});

test('no R2 object after complete failure does not insert false metadata',async()=>{
 const {state,row,parts,bucket}=mock();
 bucket.resumeMultipartUpload=()=>({async complete(){state.completeCalls++;throw Error('multipart missing')}});
 await assert.rejects(finalizeUpload({bucket,row,parts,
   async persist(){state.commits++},async isRecorded(){return false;}
 }),/multipart missing/);
 assert.equal(state.commits,0);
 assert.equal(state.completeCalls,1);
});

test('fresh successful finish stores exactly once',async()=>{
 const {state,row,parts,bucket}=mock();
 const result=await finalizeUpload({bucket,row,parts,
   async persist(){state.commits++},async isRecorded(){return false;}
 });
 assert.deepEqual(result,{recovered:false});
 assert.equal(state.completeCalls,1);
 assert.equal(state.commits,1);
});
