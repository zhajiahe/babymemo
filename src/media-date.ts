import {videoCaptureDay} from './video-date.ts';
let parserPromise:Promise<any>|undefined;
function metadataParser(){
 if(!parserPromise)parserPromise=import('exifr').then(({default:exifr})=>{
  // The stock reader requires FileReader, which Workers does not expose.
  const BlobReader=(exifr as any).fileReaders.get('blob');
  (exifr as any).fileReaders.set('blob',class extends BlobReader {
   async readWhole(){this.chunked=false;this._swapArrayBuffer(await this.input.arrayBuffer())}
   async _readChunk(offset:number,length?:number){return this.set(await this.input.slice(offset,length?offset+length:undefined).arrayBuffer(),offset,true)}
  });return exifr;
 });return parserPromise;
}
/** Metadata is read locally; original media and manually edited dates stay intact. */
export function jpegCaptureDay(bytes:Uint8Array){
  if(!(bytes instanceof Uint8Array)||bytes.length<18||bytes[0]!==255||bytes[1]!==216)return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),n=bytes.length;
  let p=2;
  while(p+4<n&&bytes[p]===255){
    const marker=bytes[p+1];
    if(marker===218||marker===217)break;
    const segmentLength=view.getUint16(p+2,false),end=p+2+segmentLength;
    if(segmentLength<2||end>n)break;
    if(marker===225&&p+10<n&&bytes[p+4]===69&&bytes[p+5]===120&&bytes[p+6]===105&&bytes[p+7]===102&&bytes[p+8]===0&&bytes[p+9]===0){
      const base=p+10;
      if(base+8>=end)return null;
      const endian=String.fromCharCode(bytes[base],bytes[base+1]);
      if(endian!=='II'&&endian!=='MM')return null;
      const little=endian==='II';
      const u16=(offset:number)=>offset+2<=end?view.getUint16(offset,little):null;
      const u32=(offset:number)=>offset+4<=end?view.getUint32(offset,little):null;
      if(u16(base+2)!==42)return null;
      const find=(relative:number|null,tag:number)=>{
        if(relative===null)return null;
        const start=base+relative,count=u16(start);
        if(count===null||count>100||start+2+count*12>end)return null;
        for(let k=0;k<count;k++){
          const at=start+2+k*12;
          if(u16(at)===tag)return {type:u16(at+2),count:u32(at+4),value:u32(at+8)};
        }
        return null;
      };
      const exif=find(u32(base+4),0x8769);
      if(!exif||exif.type!==4)return null;
      const date=find(exif.value,0x9003);
      if(!date||date.type!==2||date.count==null||date.value==null||date.count<11||date.count>128)return null;
      const start=base+date.value;
      if(start+date.count>end)return null;
      const value=new TextDecoder().decode(bytes.subarray(start,start+date.count)).split('\0')[0];
      const match=/^(\d{4}):(\d{2}):(\d{2})\s/.exec(value);
      if(!match)return null;
      const result=match[1]+'-'+match[2]+'-'+match[3];
      const day=new Date(result+'T00:00:00Z');
      return !Number.isNaN(day.getTime())&&day.toISOString().slice(0,10)===result?result:null;
    }
    p=end;
  }
  return null;
}
export function validCaptureDay(value:unknown,timeZone:string='Asia/Shanghai'){
 const match=typeof value==='string'&&/^(\d{4})[:-](\d{2})[:-](\d{2})(?:\s|T|$)/.exec(value);
 if(!match)return null;
 const day=match.slice(1).join('-'),date=new Date(day+'T00:00:00Z');
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)return null;
 const today=new Date().toLocaleDateString('sv-SE',{timeZone});
 return day<=today?day:null;
}
/**
 * JPEG APP1 may still carry camera dates in Adobe XMP even when WeChat or an
 * exporter removed the EXIF TIFF block. Only accept named creation fields;
 * never search pixel data, file modification dates, or arbitrary date strings.
 */
export function jpegXmpCaptureDay(bytes:Uint8Array,timeZone:string='Asia/Shanghai'){
 if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes[0]!==255||bytes[1]!==216)return null;
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const fields=['exif:DateTimeOriginal','photoshop:DateCreated','xmp:CreateDate'];
 const candidates=new Map<string,Set<string>>();
 const header='http://ns.adobe.com/xap/1.0/'+String.fromCharCode(0);
 let p=2;
 while(p+4<=bytes.length&&bytes[p]===255){
  const marker=bytes[p+1];
  if(marker===218||marker===217)break;
  if(marker===255){p++;continue}
  const segmentLength=view.getUint16(p+2,false),end=p+2+segmentLength;
  if(segmentLength<2||end>bytes.length)break;
  if(marker===225&&end-p-4>header.length){
   const payload=new TextDecoder().decode(bytes.subarray(p+4,Math.min(end,p+4+header.length)));
   if(payload===header){
    const xml=new TextDecoder().decode(bytes.subarray(p+4+header.length,end));
    for(const field of fields){
     const attribute=new RegExp('\\b'+field+'\\s*=\\s*["\\\']([^"\\\']{10,48})["\\\']','gi');
     const element=new RegExp('<'+field+'(?:\\s[^>]*)?>([^<]{10,48})<\\/'+field+'>','gi');
     for(const re of [attribute,element])for(const m of xml.matchAll(re)){
      const day=validCaptureDay(m[1],timeZone);
      if(day){
       if(!candidates.has(field))candidates.set(field,new Set());
       candidates.get(field)!.add(day);
      }
     }
    }
   }
  }
  p=end;
 }
 for(const field of fields){
  const days=candidates.get(field);
  if(days?.size===1)return [...days][0];
  if(days&&days.size>1)return null; // Conflicting values are not an authoritative date.
 }
 return null;
}

function metadataCaptureDay(metadata:Record<string,unknown>|null|undefined,timeZone:string){
 // Camera EXIF wins. XMP/IPTC creation dates are useful fallbacks for exports
 // that preserve creation metadata but not the camera's original EXIF block.
 for(const field of ['DateTimeOriginal','DateCreated','CreateDate']){
  const date=validCaptureDay(metadata?.[field],timeZone);
  if(date)return date;
 }
 return null;
}
const photoOptions={pick:['DateTimeOriginal','DateCreated','CreateDate'],reviveValues:false,translateValues:false,gps:false,interop:false,ifd1:false,xmp:true,icc:false,iptc:true,jfif:false,ihdr:false,makerNote:false,userComment:false,chunked:true,firstChunkSize:65536,chunkSize:65536,chunkLimit:16};
export async function photoCaptureDay(input:Blob|Uint8Array,timeZone:string='Asia/Shanghai'){
 try{
  const prefix=input instanceof Uint8Array?input:new Uint8Array(await input.slice(0,Math.min(input.size,262144)).arrayBuffer());
  const day=validCaptureDay(jpegCaptureDay(prefix),timeZone)||jpegXmpCaptureDay(prefix,timeZone);if(day)return day;
  if(prefix.length>=12&&new TextDecoder().decode(prefix.subarray(0,4))==='RIFF'&&new TextDecoder().decode(prefix.subarray(8,12))==='WEBP'){
   const length=input instanceof Uint8Array?input.length:input.size;
   for(let offset=12,chunks=0;chunks<16&&offset+8<=length;chunks++){
    const header=offset+8<=prefix.length?prefix.subarray(offset,offset+8):new Uint8Array(await (input as Blob).slice(offset,offset+8).arrayBuffer());
    const size=new DataView(header.buffer,header.byteOffset,8).getUint32(4,true),end=offset+8+size;if(end>length)break;
    if(new TextDecoder().decode(header.subarray(0,4))==='EXIF'){
     if(size>262144)return null;
     let bytes=end<=prefix.length?prefix.subarray(offset+8,end):new Uint8Array(await (input as Blob).slice(offset+8,end).arrayBuffer());
     if(new TextDecoder().decode(bytes.subarray(0,6))==='Exif\0\0')bytes=bytes.subarray(6);
     const metadata=await (await metadataParser()).parse(bytes,photoOptions);return metadataCaptureDay(metadata,timeZone);
    }
    offset=end+(size%2);
   }
   return null;
  }
  const metadata=await (await metadataParser()).parse(input,photoOptions);
  return metadataCaptureDay(metadata,timeZone);
 }catch{return null}
}
// A lazy Blob for EXIF's supported Blob reader: all I/O stays in private R2.
// HEIC metadata may sit near the end of an image, so a prefix alone is insufficient.
class R2MetadataBlob extends Blob {
 bucket:R2Bucket;key:string;start:number;end:number;budget:{bytes:number;reads:number};
 constructor(bucket:R2Bucket,key:string,start:number,end:number,budget:{bytes:number;reads:number},type:string){super([],{type});this.bucket=bucket;this.key=key;this.start=start;this.end=end;this.budget=budget}
 get size(){return this.end-this.start}
 slice(start:number=0,end:number=this.size,type:string=this.type){
  const offset=(v:number)=>Math.min(this.size,Math.max(0,v<0?this.size+v:v));
  const a=offset(start),b=Math.max(a,offset(end));
  return new R2MetadataBlob(this.bucket,this.key,this.start+a,this.start+b,this.budget,type);
 }
 async arrayBuffer(){
  if(this.size>262144||this.budget.bytes+this.size>1048576||this.budget.reads>=16)throw Error('METADATA_READ_LIMIT');
  this.budget.bytes+=this.size;this.budget.reads++;
  if(!this.size)return new ArrayBuffer(0);
  const object=await this.bucket.get(this.key,{range:{offset:this.start,length:this.size}});
  if(!object)throw Error('METADATA_OBJECT_MISSING');
  const bytes=await object.arrayBuffer();if(bytes.byteLength!==this.size)throw Error('METADATA_RANGE_MISMATCH');return bytes;
 }
}
export async function r2PhotoCaptureDay(bucket:R2Bucket,key:string,size:number,mime:string,timeZone:string='Asia/Shanghai'){
 if(!mime?.startsWith('image/')||!Number.isSafeInteger(size)||size<1)return null;
 return photoCaptureDay(new R2MetadataBlob(bucket,key,0,size,{bytes:0,reads:0},mime),timeZone);
}
export async function bestEffortFileDay(file:File,fallback:string,timeZone:string='Asia/Shanghai'){
 const isPhoto=file.type.startsWith('image/')||/\.(?:heic|heif|jpe?g|png|webp|gif|tiff?)$/i.test(file.name);
 if(isPhoto)return await photoCaptureDay(file,timeZone)||fallback;
 const isVideo=file.type.startsWith('video/')||/\.(?:mov|mp4)$/i.test(file.name);
 if(isVideo)return await videoCaptureDay(file,timeZone)||fallback;
 if(file.lastModified>0){const day=validCaptureDay(new Date(file.lastModified).toLocaleDateString('sv-SE',{timeZone}),timeZone);if(day)return day}
 return fallback;
}
