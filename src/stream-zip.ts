// Stored ZIP64 entries: stream originals with bounded memory, CRC integrity and
// backpressure. ZIP64 also supports a family archive larger than 4 GiB.
const encode=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
const crcUpdate=(crc:number,bytes:Uint8Array)=>{for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return crc>>>0};
type ZipEntry={name:string;size:number|undefined;open:()=>Promise<ReadableStream<Uint8Array>>};
type HeaderField=[number,number,number];
function header(length:number,fields:HeaderField[]){const bytes=new Uint8Array(length),v=new DataView(bytes.buffer);for(const [at,size,value] of fields){if(size===8)v.setBigUint64(at,BigInt(value),true);else if(size===4)v.setUint32(at,value,true);else v.setUint16(at,value,true)}return bytes}
export const textEntry=(name:string,text:string):ZipEntry=>{const bytes=encode.encode(text);return{name,size:bytes.length,open:async()=>new Blob([bytes as BlobPart]).stream()}};
export function streamZip(entries:ZipEntry[]):ReadableStream<Uint8Array>{
 async function* chunks():AsyncGenerator<Uint8Array,void,unknown>{
  let offset=0;const directory:{name:Uint8Array;size:number;crc:number;offset:number}[]=[];
  for(const entry of entries){
   let source;
   // Browser exports learn derivative sizes from individual protected responses,
   // keeping every Worker invocation independent of the total archive size.
   if(entry.size==null)source=await entry.open();
   if(!/^[\w./-]+$/.test(entry.name)||entry.name.startsWith('/')||entry.name.split('/').includes('..')||!Number.isSafeInteger(entry.size)||entry.size==null||entry.size<0)throw Error('INVALID_ARCHIVE_ENTRY');
   const name=encode.encode(entry.name),localOffset=offset;
   const entrySize=entry.size as number;
   const local=header(30,[[0,4,0x04034b50],[4,2,45],[6,2,0x0808],[18,4,0xffffffff],[22,4,0xffffffff],[26,2,name.length],[28,2,20]]);
   const extra=header(20,[[0,2,1],[2,2,16],[4,8,entrySize],[12,8,entrySize]]);
   yield local;yield name;yield extra;offset+=local.length+name.length+extra.length;
   let crc=0xffffffff,size=0;source??=await entry.open();const reader=source.getReader();
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>entrySize)throw Error('ARCHIVE_OBJECT_SIZE_CHANGED');crc=crcUpdate(crc,value);yield value;offset+=value.length}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
   if(size!==entrySize)throw Error('ARCHIVE_OBJECT_MISSING_BYTES');
   crc=(crc^0xffffffff)>>>0;
   const descriptor=header(24,[[0,4,0x08074b50],[4,4,crc],[8,8,size],[16,8,size]]);yield descriptor;offset+=24;
   directory.push({name,size,crc,offset:localOffset});
  }
  const directoryOffset=offset;
  for(const entry of directory){
   const h=header(46,[[0,4,0x02014b50],[4,2,45],[6,2,45],[8,2,0x0808],[16,4,entry.crc],[20,4,0xffffffff],[24,4,0xffffffff],[28,2,entry.name.length],[30,2,28],[42,4,0xffffffff]]);
   const extra=header(28,[[0,2,1],[2,2,24],[4,8,entry.size],[12,8,entry.size],[20,8,entry.offset]]);
   yield h;yield entry.name;yield extra;offset+=h.length+entry.name.length+extra.length;
  }
  const directorySize=offset-directoryOffset;
  yield header(56,[[0,4,0x06064b50],[4,8,44],[12,2,45],[14,2,45],[24,8,directory.length],[32,8,directory.length],[40,8,directorySize],[48,8,directoryOffset]]);
  yield header(20,[[0,4,0x07064b50],[8,8,offset],[16,4,1]]);
  yield header(22,[[0,4,0x06054b50],[8,2,65535],[10,2,65535],[12,4,0xffffffff],[16,4,0xffffffff]]);
 }
 const iterator=chunks();
 return new ReadableStream({async pull(controller){try{const result=await iterator.next();if(result.done)controller.close();else controller.enqueue(result.value)}catch(e){controller.error(e)}},async cancel(){await iterator.return(undefined)}});
}
