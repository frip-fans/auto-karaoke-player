import { useEffect, useState, type ReactNode } from 'react';

export function AnimatedCollapse({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  const [retained, setRetained] = useState(open);
  useEffect(() => {
    if (open) { setRetained(true); return; }
    // Keep the rows mounted until the close animation finishes, with a fallback
    // for interrupted transitions and reduced-motion preferences.
    const timer = setTimeout(() => setRetained(false), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
    return () => clearTimeout(timer);
  }, [open]);
  return <div id={id} className={`album-collapse${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}
    onTransitionEnd={event => { if (!open && event.target === event.currentTarget && event.propertyName === 'grid-template-rows') setRetained(false); }}>
    <div className="album-collapse-inner">{(open || retained) && children}</div>
  </div>;
}
