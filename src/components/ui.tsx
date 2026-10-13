import type { ReactNode } from 'react';


/**
 * Shared BabyMemo primitives; visual identity lives in editorial.css.
 * Keep business-specific forms, APIs, navigation state and data access in App.
 * Visual contracts live in src/styles.css and docs/design-system.md.
 */

export function Logo() {
  return (
    <div className="logo">
      <span className="logo-icon"><img src="/brand/baby-journal-source.png" alt="" width="44" height="44" /></span>
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
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Primary({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  return <button className="primary" type="submit" disabled={disabled}>{children}</button>;
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
