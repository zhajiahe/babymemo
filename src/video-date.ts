/**
 * Best-effort MP4/MOV capture dates. Inspect bounded metadata ranges only:
 * never download, decrypt twice, or transcode a whole WeChat video.
 * Prefer the camera's local QuickTime creationdate over UTC movie headers.
 */
type Reader=(offset:number,length:number)=>Promise<Uint8Array>;
type Box={type:string;start:number;end:number;data:number};
const PAGE=65536,MAX_PAGES=16,MAX_BOXES=160;
const decoder=new TextDecoder();
const ascii=(b:Uint8Array)=>decoder.decode(b);
const u32=(b:Uint8Array,p=0)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p);
const u64=(b:Uint8Array,p=0)=>Number(new DataView(b.buffer,b.byteOffset,b.byteLength).getBigUint64(p));
function captureDay(value:string,zone:string){
 const day=/^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/.exec(value)?.[1];
 if(!day)return null;
 const date=new Date(day+'T00:00:00Z');
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)return null;
 try{return day<=new Date().toLocaleDateString('sv-SE',{timeZone:zone})?day:null}catch{return null}
}
function cachedReader(size:number,load:Reader):Reader{
 const pages=new Map<number,Uint8Array>();
 return async(offset,length)=>{
  if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0||length>8192||offset+length>size)throw Error('VIDEO_METADATA_RANGE');
  const result=new Uint8Array(length);
  let copied=0;
  while(copied<length){
   const index=Math.floor((offset+copied)/PAGE);
   let page=pages.get(index);
   if(!page){
    if(pages.size>=MAX_PAGES)throw Error('VIDEO_METADATA_BUDGET');
    const start=index*PAGE,expected=Math.min(PAGE,size-start);
    page=await load(start,expected);
    if(page.length!==expected)throw Error('VIDEO_METADATA_SHORT_READ');
    pages.set(index,page);
   }
   const within=(offset+copied)%PAGE,n=Math.min(length-copied,page.length-within);
   result.set(page.subarray(within,within+n),copied);copied+=n;
  }
  return result;
 };
}
async function boxes(read:Reader,start:number,end:number):Promise<Box[]>{
 const found:Box[]=[];
 for(let offset=start;offset+8<=end&&found.length<MAX_BOXES;){
  const header=await read(offset,8);
  const marker=u32(header),type=ascii(header.subarray(4,8));
  let length=marker,head=8;
  if(marker===1){if(offset+16>end)break;length=u64(await read(offset+8,8));head=16}
  else if(marker===0)length=end-offset;
  if(!Number.isSafeInteger(length)||length<head||offset+length>end)break;
  found.push({type,start:offset,end:offset+length,data:offset+head});
  offset+=length;
 }
 return found;
}
async function movieHeaderDay(read:Reader,box:Box,zone:string){
 try{
  const header=await read(box.data,Math.min(20,box.end-box.data));
  const version=header[0];
  if(version!==0&&version!==1)return null;
  const seconds=version===0?u32(header,4):u64(header,4);
  if(!Number.isFinite(seconds)||seconds<=0)return null;
  const epoch=(seconds-2082844800)*1000;
  const date=new Date(epoch);
  if(!Number.isFinite(date.getTime()))return null;
  return captureDay(date.toLocaleDateString('sv-SE',{timeZone:zone}),zone);
 }catch{return null}
}
async function metadataDay(read:Reader,container:Box,zone:string){
 const fields=await boxes(read,container.data+4,container.end); // ISO meta full-box header
 const keys=fields.find(x=>x.type==='keys'),ilst=fields.find(x=>x.type==='ilst');
 if(!keys||!ilst||keys.end-keys.data<8)return null;
 const count=u32(await read(keys.data+4,4));
 if(count>128)return null;
 let offset=keys.data+8,index=1,creationIndex=0;
 while(index<=count&&offset+8<=keys.end){
  const entry=await read(offset,8),length=u32(entry);
  if(length<8||length>512||offset+length>keys.end)return null;
  const ns=ascii(entry.subarray(4,8)),name=ascii(await read(offset+8,length-8));
  if(ns==='mdta'&&name==='com.apple.quicktime.creationdate')creationIndex=index;
  offset+=length;index++;
 }
 if(!creationIndex)return null;
 for(const field of await boxes(read,ilst.data,ilst.end)){
  // ilst entry names are 1-based binary key indexes.
  if(u32(await read(field.start+4,4))!==creationIndex)continue;
  const data=(await boxes(read,field.data,field.end)).find(x=>x.type==='data');
  if(!data||data.end-data.data<9||data.end-data.data>520)continue;
  const raw=ascii(await read(data.data+8,data.end-data.data-8)).replace(/\0+$/,'');
  const day=captureDay(raw,zone);
  if(day)return day;
 }
 return null;
}
async function quickTimeDay(read:Reader,moov:Box,zone:string){
 const children=await boxes(read,moov.data,moov.end);
 const mvhd=children.find(x=>x.type==='mvhd');
 const fallback=mvhd?await movieHeaderDay(read,mvhd,zone):null;
 for(const parent of children){
  if(parent.type!=='udta'&&parent.type!=='meta')continue;
  const containers=parent.type==='meta'?[parent]:await boxes(read,parent.data,parent.end);
  for(const meta of containers){
   if(meta.type!=='meta')continue;
   const day=await metadataDay(read,meta,zone);
   if(day)return day;
  }
 }
 return fallback;
}
async function parse(size:number,read:Reader,zone:string){
 if(!Number.isSafeInteger(size)||size<24)return null;
 try{
  const cached=cachedReader(size,read);
  for(const box of await boxes(cached,0,size)){
   if(box.type!=='moov')continue;
   return await quickTimeDay(cached,box,zone);
  }
 }catch{/* Unsupported or malformed metadata is not a failed original upload. */}
 return null;
}
export async function videoCaptureDay(input:Blob|Uint8Array,timeZone='Asia/Shanghai'){
 const data=input instanceof Uint8Array?input:null,size=data?data.length:input.size;
 return parse(size,async(offset,length)=>data?data.subarray(offset,offset+length):new Uint8Array(await (input as Blob).slice(offset,offset+length).arrayBuffer()),timeZone);
}
export async function r2VideoCaptureDay(bucket:R2Bucket,key:string,size:number,mime:string,timeZone='Asia/Shanghai'){
 if(!['video/mp4','video/quicktime'].includes(mime))return null;
 return parse(size,async(offset,length)=>{
  const object=await bucket.get(key,{range:{offset,length}});
  if(!object)throw Error('VIDEO_METADATA_MISSING');
  return new Uint8Array(await object.arrayBuffer());
 },timeZone);
}
