import test from 'node:test';
import assert from 'node:assert/strict';
import {videoCaptureDay,r2VideoCaptureDay} from '../src/video-date.mjs';
import {bestEffortFileDay} from '../src/media-date.mjs';

function box(type,body){
 const head=Buffer.alloc(8);head.writeUInt32BE(8+body.length,0);
 Buffer.from(type,'latin1').copy(head,4);
 return Buffer.concat([head,body]);
}
function movieHeader(iso){
 const body=Buffer.alloc(20);
 const seconds=Math.floor(Date.parse(iso)/1000)+2082844800;
 body.writeUInt32BE(seconds,4);
 return box('mvhd',body);
}
function cameraMetadata(text){
 const name=Buffer.from('com.apple.quicktime.creationdate');
 const entry=Buffer.alloc(8+name.length);
 entry.writeUInt32BE(entry.length,0);entry.write('mdta',4);name.copy(entry,8);
 const keyHead=Buffer.alloc(8);keyHead.writeUInt32BE(1,4);
 const keys=box('keys',Buffer.concat([keyHead,entry]));
 const data=box('data',Buffer.concat([Buffer.alloc(8),Buffer.from(text)]));
 const keyed=Buffer.concat([Buffer.alloc(8),data]);keyed.writeUInt32BE(8+data.length,0);keyed.writeUInt32BE(1,4);
 const ilst=box('ilst',keyed);
 return box('udta',box('meta',Buffer.concat([Buffer.alloc(4),keys,ilst])));
}
function mp4(creationDate,metadata,large=0){
 const ftyp=box('ftyp',Buffer.from('isom0000'));
 const mdat=box('mdat',Buffer.alloc(large));
 const moov=box('moov',Buffer.concat([movieHeader(creationDate),...(metadata?[cameraMetadata(metadata)]:[])]));
 return Buffer.concat([ftyp,mdat,moov]);
}
test('MOV local QuickTime creationdate takes precedence over UTC mvhd date',async()=>{
 const bytes=mp4('2020-09-02T12:00:00Z','2020-09-03T00:14:00+08:00');
 assert.equal(await videoCaptureDay(new File([bytes],'iphone.mov',{type:'video/quicktime'}),'Asia/Shanghai'),'2020-09-03');
 assert.equal(await bestEffortFileDay(new File([bytes],'iphone.mov',{type:'video/quicktime',lastModified:Date.now()}),'2026-10-15','Asia/Shanghai'),'2020-09-03');
});
test('MP4 mvhd creates a capture day when local camera metadata is absent',async()=>{
 const bytes=mp4('2020-09-03T10:35:00Z',null);
 assert.equal(await videoCaptureDay(bytes,'Asia/Shanghai'),'2020-09-03');
});
test('private R2 skips a large media payload and reads only bounded metadata pages',async()=>{
 const bytes=mp4('2020-09-03T10:35:00Z',null,3*1024*1024),ranges=[];
 const bucket={get:async(_key,{range})=>{
  ranges.push(range);return {arrayBuffer:async()=>bytes.subarray(range.offset,range.offset+range.length).buffer.slice(
   bytes.byteOffset+range.offset,bytes.byteOffset+range.offset+range.length)};
 }};
 assert.equal(await r2VideoCaptureDay(bucket,'private/example',bytes.length,'video/mp4','Asia/Shanghai'),'2020-09-03');
 assert.ok(ranges.length<=16);
 assert.ok(ranges.reduce((sum,x)=>sum+x.length,0)<=1048576);
 assert.ok(ranges.some(x=>x.offset>=3*1024*1024));
});
test('unsupported or corrupt video metadata cannot invent a capture date',async()=>{
 const bytes=Buffer.alloc(40);
 assert.equal(await videoCaptureDay(bytes,'Asia/Shanghai'),null);
 assert.equal(await videoCaptureDay(mp4('2030-01-01T12:00:00Z',null),'Asia/Shanghai'),null);
 assert.equal(await r2VideoCaptureDay({get:async()=>{throw Error('must not read')}},'private/fake',1234,'video/webm'),null);
 assert.equal(await bestEffortFileDay(new File([bytes],'no-metadata.mp4',{type:'video/mp4',lastModified:Date.now()}),'2026-09-01','Asia/Shanghai'),'2026-09-01');
});
