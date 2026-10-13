// Shared, deterministic scheduler for media transfers. Never launches unbounded
// File uploads or media decoding tasks on memory-constrained mobile browsers.
export async function mapBounded(items,limit,work){
 if(!Array.isArray(items)||!Number.isInteger(limit)||limit<1||limit>8||typeof work!=='function')
  throw Error('INVALID_TRANSFER_QUEUE');
 const result=new Array(items.length);
 let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
  while(next<items.length){
   const i=next++;
   try{result[i]={status:'fulfilled',value:await work(items[i],i)}}
   catch(reason){result[i]={status:'rejected',reason}}
  }
 }));
 return result;
}
export function transferConcurrency(mobile,fileCount){
 // More photos in flight, not an unlimited number of large MOV buffers.
 return {files:fileCount>1?2:1,parts:fileCount>1?(mobile?1:2):(mobile?2:3)};
}
export const DIRECT_UPLOAD_LIMIT=5*1024*1024;
export const canDirectUpload=size=>Number.isSafeInteger(size)&&size>=1&&size<=DIRECT_UPLOAD_LIMIT;
