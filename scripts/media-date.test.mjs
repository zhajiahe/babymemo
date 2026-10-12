import assert from 'node:assert/strict';
import test from 'node:test';
import {jpegCaptureDay} from '../src/media-date.mjs';

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
