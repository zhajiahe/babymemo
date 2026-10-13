export type ZipEntry={name:string;size:number|undefined;open:()=>Promise<ReadableStream<Uint8Array>>};
export function streamZip(entries:ZipEntry[]):ReadableStream<Uint8Array>;
export function textEntry(name:string,text:string):ZipEntry;
