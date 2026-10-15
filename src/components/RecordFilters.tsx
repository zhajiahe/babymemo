import {useEffect,useState,type FormEvent} from 'react';
import {ChevronDown,SlidersHorizontal} from 'lucide-react';
import {Field,Button} from './ui';

export type RecordFilters={q:string;startDay:string;endDay:string;type:string};
export const emptyFilters:RecordFilters={q:'',startDay:'',endDay:'',type:''};
export const filterQuery=(filters:RecordFilters)=>{const params=new URLSearchParams();for(const [key,value] of Object.entries(filters))if(value)params.set(key,value);return params.size?'&'+params.toString():''};

export function RecordFilterBar({value,onChange,media=false}:{value:RecordFilters;onChange:(value:RecordFilters)=>void;media?:boolean}){
 const [draft,setDraft]=useState(value);
 const [expanded,setExpanded]=useState(()=>Object.values(value).some(Boolean));
 useEffect(()=>setDraft(value),[value]);
 const active=Object.values(value).some(Boolean);
 function submit(event:FormEvent){event.preventDefault();onChange(draft);setExpanded(false)}
 return <section className="record-filter-shell">
  <button type="button" className="record-filter-toggle" aria-label="筛选记录" aria-expanded={expanded} aria-controls="record-filter-fields" onClick={()=>setExpanded(v=>!v)}>
   <SlidersHorizontal size={17} aria-hidden="true"/><span className="record-filter-full">筛选记录</span><span className="record-filter-compact" aria-hidden="true">筛选</span>{active&&<span className="record-filter-active">已筛选</span>}<ChevronDown size={16} className={expanded?'rotated':''} aria-hidden="true"/>
  </button>
  {expanded&&<form className="record-filters" id="record-filter-fields" onSubmit={submit} aria-label="查询记录">
   <div className="record-filter-fields">
    {!media&&<Field label="关键词"><input value={draft.q} maxLength={80} onChange={e=>setDraft({...draft,q:e.target.value})} placeholder="搜索备注或故事"/></Field>}
    <Field label="开始日期"><input type="date" value={draft.startDay} max={draft.endDay||undefined} onChange={e=>setDraft({...draft,startDay:e.target.value})}/></Field>
    <Field label="结束日期"><input type="date" value={draft.endDay} min={draft.startDay||undefined} onChange={e=>setDraft({...draft,endDay:e.target.value})}/></Field>
    {media&&<Field label="媒体类型"><select value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})}><option value="">照片与视频</option><option value="image">照片</option><option value="video">视频</option></select></Field>}
   </div>
   <div className="record-filter-actions"><Button variant="secondary" type="submit">查询</Button><button className="text-btn" type="button" onClick={()=>{setDraft(emptyFilters);onChange(emptyFilters);setExpanded(false)}}>清除筛选</button></div>
  </form>}
 </section>;
}
