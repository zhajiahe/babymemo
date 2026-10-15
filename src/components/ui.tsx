import {cloneElement,isValidElement,useId,type ReactNode,type ButtonHTMLAttributes} from 'react';


/**
 * Shared BabyMemo primitives; tokens and interactive states live in design-system.css.
 * Keep business-specific forms, APIs, navigation state and data access in App.
 * Visual contracts live in src/design-system.css and docs/design-system.md.
 */

export function Logo() {
  return (
    <div className="logo">
      <span className="logo-icon"><img src="/brand/mark.svg?v=20261013b" alt="" width="44" height="44" /></span>
      <span>BabyMemo</span>
    </div>
  );
}

export function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="notice" role="status">
      <span>{text}</span>
      <button type="button" onClick={onClose} aria-label="关闭提示">×</button>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const labelId=useId();
  const control=isValidElement<{'aria-label'?:string;'aria-labelledby'?:string}>(children)&&!children.props['aria-label']&&!children.props['aria-labelledby']
    ?cloneElement(children,{'aria-labelledby':labelId}):children;
  return <label className="field"><span id={labelId}>{label}</span>{control}</label>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  loading?: boolean;
};

export function Button({variant='secondary',className='',type='button',children,loading=false,disabled,...props}:ButtonProps) {
  return <button type={type} className={['bm-button',variant==='quiet'?'bm-button--quiet':variant==='danger'?'bm-button--danger':variant,className].filter(Boolean).join(' ')} disabled={disabled||loading} aria-busy={loading||undefined} {...props}>{children}</button>;
}
export function IconButton({className='',type='button',children,...props}:ButtonHTMLAttributes<HTMLButtonElement> & {'aria-label':string}) {
  return <button type={type} className={['bm-icon-button','icon-btn',className].filter(Boolean).join(' ')} {...props}>{children}</button>;
}
export function StatusMessage({children,tone='info'}:{children:ReactNode;tone?:'info'|'success'|'error'}) {
  return <span className={'bm-status bm-status--'+tone} role={tone==='error'?'alert':'status'} aria-live={tone==='error'?'assertive':'polite'}>{children}</span>;
}

type SegmentOption<T extends string> = {value:T;label:string;icon?:ReactNode};
export function SegmentedControl<T extends string>({label,value,options,onChange,className=''}:{
  label:string;
  value:T;
  options:readonly SegmentOption<T>[];
  onChange:(next:T)=>void;
  className?:string;
}) {
  return <div role="group" aria-label={label} className={['bm-segmented',className].filter(Boolean).join(' ')}>
    {options.map(option=><button key={option.value} type="button" aria-pressed={value===option.value} onClick={()=>onChange(option.value)}>
      {option.icon&&<span className="bm-segmented-icon" aria-hidden="true">{option.icon}</span>}
      <span>{option.label}</span>
    </button>)}
  </div>;
}

export function Primary({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  return <Button variant="primary" type="submit" disabled={disabled}>{children}</Button>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={className ? 'card ' + className : 'card'}>{children}</div>;
}

export function Pager({ page, setPage, hasMore }: {
  page: number;
  setPage: (value: number) => void;
  hasMore: boolean;
}) {
  return (
    <nav className="pager" aria-label="分页导航">
      <button type="button" disabled={page <= 0} onClick={() => setPage(page - 1)}>上一页</button>
      <span aria-live="polite">第 {page + 1} 页</span>
      <button type="button" disabled={!hasMore} onClick={() => setPage(page + 1)}>下一页</button>
    </nav>
  );
}
