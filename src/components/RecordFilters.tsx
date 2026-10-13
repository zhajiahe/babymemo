import {useEffect,useState,type FormEvent} from 'react';
import {Field} from './ui';
export type RecordFilters={q:string;startDay:string;endDay:string;type:string};
export const emptyFilters:RecordFilters={q:'',startDay:'',endDay:'',type:''};
export const filterQuery=(filters:RecordFilters)=>{const params=new URLSearchParams();for(const [key,value] of Object.entries(filters))if(value)params.set(key,value);return params.size?'&'+params.toString():''};
export function RecordFilterBar({value,onChange,media=false}:{value:RecordFilters;onChange:(value:RecordFilters)=>void;media?:boolean}){
 const [draft,setDraft]=useState(value);useEffect(()=>setDraft(value),[value]);
 function submit(event:FormEvent){event.preventDefault();onChange(draft)}
 return <form className="record-filters" onSubmit={submit} aria-label="查询记录">
  {!media&&<Field label="关键词"><input value={draft.q} maxLength={80} onChange={e=>setDraft({...draft,q:e.target.value})} placeholder="搜索备注或故事"/></Field>}
  <Field label="开始日期"><input type="date" value={draft.startDay} max={draft.endDay||undefined} onChange={e=>setDraft({...draft,startDay:e.target.value})}/></Field>
  <Field label="结束日期"><input type="date" value={draft.endDay} min={draft.startDay||undefined} onChange={e=>setDraft({...draft,endDay:e.target.value})}/></Field>
  {media&&<Field label="媒体类型"><select value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})}><option value="">照片与视频</option><option value="image">照片</option><option value="video">视频</option></select></Field>}
  <button className="secondary" type="submit">查询</button><button className="text-btn" type="button" onClick={()=>{setDraft(emptyFilters);onChange(emptyFilters)}}>清除筛选</button>
 </form>;
}
