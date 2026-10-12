/** JPEG DateTimeOriginal extractor; best effort, never changes original media. */
export function jpegCaptureDay(bytes){
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
      const u16=offset=>offset+2<=end?view.getUint16(offset,little):null;
      const u32=offset=>offset+4<=end?view.getUint32(offset,little):null;
      if(u16(base+2)!==42)return null;
      const find=(relative,tag)=>{
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
      if(!date||date.type!==2||date.count<11||date.count>128)return null;
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
export async function bestEffortFileDay(file,fallback){
  let date=null;
  if(file.type==='image/jpeg'||/\.jpe?g$/i.test(file.name)){
    try{date=jpegCaptureDay(new Uint8Array(await file.slice(0,Math.min(file.size,262144)).arrayBuffer()))}catch{}
  }
  if(!date&&file.lastModified>0)date=new Date(file.lastModified).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  return date&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date<=today?date:fallback;
}
