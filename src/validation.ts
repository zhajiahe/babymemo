/** Shared, dependency-free validation for externally supplied baby metadata. */
export function validCalendarDay(value:unknown):value is string{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function validTimeZone(value:unknown):value is string{
  if(typeof value!=='string'||value.length<1||value.length>64||!/^[-\w/]+$/.test(value))return false;
  try{new Intl.DateTimeFormat('en-US',{timeZone:value});return true}
  catch{return false}
}
