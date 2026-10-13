// Tiny synthetic containers, containing only a fictional EXIF date.
export function exifJpeg(date='2020:09:03 23:34:56'){
 const bytes=new Uint8Array(78),v=new DataView(bytes.buffer);bytes.set([255,216,255,225]);v.setUint16(4,72,false);bytes.set([69,120,105,102,0,0],6);const b=12;
 bytes.set([73,73],b);v.setUint16(b+2,42,true);v.setUint32(b+4,8,true);v.setUint16(b+8,1,true);v.setUint16(b+10,0x8769,true);v.setUint16(b+12,4,true);v.setUint32(b+14,1,true);v.setUint32(b+18,26,true);v.setUint16(b+26,1,true);v.setUint16(b+28,0x9003,true);v.setUint16(b+30,2,true);v.setUint32(b+32,20,true);v.setUint32(b+36,44,true);bytes.set(new TextEncoder().encode(date+'\0'),b+44);bytes.set([255,217],76);return bytes;
}
const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,x)=>n+x.length,0));let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length}return out};
const ascii=s=>new TextEncoder().encode(s);
const box=(type,payload)=>{const b=new Uint8Array(8+payload.length);new DataView(b.buffer).setUint32(0,b.length);b.set(ascii(type),4);b.set(payload,8);return b};
export function exifHeic(date='2020:09:03 23:34:56',padding=524288){
 const ftyp=box('ftyp',concat(ascii('heic'),new Uint8Array(4),ascii('mif1heic')));
 const infe=box('infe',concat(Uint8Array.from([2,0,0,0,0,1,0,0]),ascii('Exif'),new Uint8Array(1)));
 const iinf=box('iinf',concat(Uint8Array.from([0,0,0,0,0,1]),infe));
 const payload=concat(new Uint8Array(4),exifJpeg(date).subarray(12,76));
 const ilocData=Uint8Array.from([0,0,0,0,0x44,0,0,1,0,1,0,0,0,1,...new Uint8Array(8)]);
 let meta=box('meta',concat(new Uint8Array(4),iinf,box('iloc',ilocData)));
 const view=new DataView(ilocData.buffer);view.setUint32(14,ftyp.length+meta.length+8+padding);view.setUint32(18,payload.length);
 meta=box('meta',concat(new Uint8Array(4),iinf,box('iloc',ilocData)));
 return concat(ftyp,meta,box('mdat',concat(new Uint8Array(padding),payload)));
}
export function exifWebp(date='2020:09:03 23:34:56',padding=0){
 const tiff=exifJpeg(date).subarray(12,76),skip=padding?8+padding+(padding%2):0,out=new Uint8Array(20+skip+tiff.length),view=new DataView(out.buffer);out.set(ascii('RIFF'));view.setUint32(4,out.length-8,true);out.set(ascii('WEBP'),8);
 if(padding){out.set(ascii('VP8 '),12);view.setUint32(16,padding,true)}
 out.set(ascii('EXIF'),12+skip);view.setUint32(16+skip,tiff.length,true);out.set(tiff,20+skip);return out;
}
export function exifPng(date='2020:09:03 23:34:56'){
 const chunk=(type,bytes)=>{const out=new Uint8Array(12+bytes.length),view=new DataView(out.buffer);view.setUint32(0,bytes.length);out.set(ascii(type),4);out.set(bytes,8);let crc=0xffffffff;for(const byte of out.subarray(4,out.length-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1}view.setUint32(out.length-4,(crc^0xffffffff)>>>0);return out};
 const ihdr=new Uint8Array(13),view=new DataView(ihdr.buffer);view.setUint32(0,1);view.setUint32(4,1);ihdr.set([8,6],8);
 return concat(Uint8Array.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('eXIf',exifJpeg(date).subarray(12,76)),chunk('IEND',new Uint8Array()));
}
