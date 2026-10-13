import assert from 'node:assert/strict';
import test from 'node:test';
import {jpegCaptureDay,photoCaptureDay,bestEffortFileDay,r2PhotoCaptureDay} from '../src/media-date.mjs';
import {exifJpeg,exifHeic,exifWebp,exifPng} from './fixtures/media-exif.mjs';

test('valid JPEG EXIF original date wins over modification metadata',()=>{
  const bytes=new Uint8Array(76);
  const v=new DataView(bytes.buffer);bytes.set([255,216,255,225],0);v.setUint16(4,72,false);
  bytes.set([69,120,105,102,0,0],6);const b=12;
  bytes.set([73,73],b);v.setUint16(b+2,42,true);v.setUint32(b+4,8,true);
  v.setUint16(b+8,1,true);
  v.setUint16(b+10,0x8769,true);v.setUint16(b+12,4,true);v.setUint32(b+14,1,true);v.setUint32(b+18,26,true);
  v.setUint16(b+26,1,true);
  v.setUint16(b+28,0x9003,true);v.setUint16(b+30,2,true);v.setUint32(b+32,20,true);v.setUint32(b+36,44,true);
  bytes.set(new TextEncoder().encode('2026:09:03 12:34:56\0'),b+44);
  assert.equal(jpegCaptureDay(bytes),'2026-09-03');
  bytes[b+44]=88;
  assert.equal(jpegCaptureDay(bytes),null);
  assert.equal(jpegCaptureDay(new Uint8Array([1,2,3])),null);
});
test('JPEG, HEIC and WebP preserve the camera calendar day instead of a download modification date',async()=>{
 for(const [bytes,mime,name] of [[exifJpeg(),'image/jpeg','photo.jpg'],[exifHeic(),'image/heic','photo.heic'],[exifPng(),'image/png','photo.png'],[exifWebp(),'image/webp','photo.webp']]){
  const file=new File([bytes],name,{type:mime,lastModified:Date.now()});assert.equal(await bestEffortFileDay(file,'2026-10-13'),'2020-09-03');
 }
});
test('WebP metadata after a large pixel chunk is read without loading that chunk',async()=>{
 const bytes=exifWebp(undefined,524288),ranges=[];const bucket={get:async(_key,{range})=>{ranges.push(range);return {arrayBuffer:async()=>bytes.slice(range.offset,range.offset+range.length).buffer}}};
 assert.equal(await bestEffortFileDay(new File([bytes],'tail.webp',{type:'image/webp'}),'2026-10-13'),'2020-09-03');
 assert.equal(await r2PhotoCaptureDay(bucket,'private/tail',bytes.length,'image/webp'),'2020-09-03');assert.ok(ranges.some(x=>x.offset>262144));assert.ok(ranges.reduce((n,x)=>n+x.length,0)<=1048576);
});
test('a missing, corrupt, impossible or future capture date uses the selected fallback, never lastModified',async()=>{
 for(const bytes of [new Uint8Array([1,2,3]),exifJpeg('2020:02:30 12:34:56'),exifJpeg('2999:09:03 12:34:56')]){
  const file=new File([bytes],'photo.jpg',{type:'image/jpeg',lastModified:Date.now()});assert.equal(await bestEffortFileDay(file,'2019-01-01'),'2019-01-01');
 }
 assert.equal(await photoCaptureDay(exifJpeg()),'2020-09-03');
});
test('private R2 reads find HEIC metadata beyond the prefix within bounded range I/O',async()=>{
 const bytes=exifHeic(),ranges=[];const bucket={get:async(_key,{range})=>{ranges.push(range);return {arrayBuffer:async()=>bytes.slice(range.offset,range.offset+range.length).buffer}}};
 assert.equal(await r2PhotoCaptureDay(bucket,'private/test',bytes.length,'image/heic'),'2020-09-03');assert.ok(ranges.some(x=>x.offset>262144));assert.ok(ranges.length<=16);assert.ok(ranges.every(x=>x.length<=262144));assert.ok(ranges.reduce((n,x)=>n+x.length,0)<=1048576);
});
