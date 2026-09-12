import { Children, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

const defaultRatio = 1.15 / 2.15;
const storageKey = 'karaoke:layout:desk-ratio';
export function ResizableLayout({ children }: { children: ReactNode }) {
  const container = useRef<HTMLElement>(null);
  const [ratio, setRatio] = useState(() => {
    try { const raw = localStorage.getItem(storageKey); const saved = raw === null ? NaN : Number(raw); if (Number.isFinite(saved) && saved > 0 && saved < 1) return saved; } catch { /* Layout still works without storage. */ }
    return defaultRatio;
  });
  const current = useRef(ratio), active = useRef(false);
  const [resizing, setResizing] = useState(false), [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(container.current!); return () => observer.disconnect();
  }, []);
  const available = Math.max(820, width - 8);
  const minimum = 420 / available, maximum = 1 - 400 / available;
  const actual = Math.max(minimum, Math.min(maximum, ratio));
  function change(value: number, save = false) {
    current.current = Math.max(minimum, Math.min(maximum, value));
    setRatio(current.current);
    if (save) persist();
  }
  function persist() { try { localStorage.setItem(storageKey, String(current.current)); } catch { /* A failed preference write must not interrupt playback. */ } }
  function finish() { if (!active.current) return; active.current = false; setResizing(false); persist(); }
  const panels = Children.toArray(children);
  return <main ref={container} className={`resizable-layout${resizing ? ' resizing' : ''}`} style={{ '--desk-size': `${actual}fr`, '--library-size': `${1 - actual}fr` } as CSSProperties}>
    {panels[0]}
    <div className="panel-resizer" role="separator" tabIndex={0} aria-label="调整播放区与曲库宽度" aria-orientation="vertical" aria-valuemin={Math.round(minimum * 100)} aria-valuemax={Math.round(maximum * 100)} aria-valuenow={Math.round(actual * 100)} aria-valuetext={`播放区 ${Math.round(actual * 100)}%，曲库 ${100 - Math.round(actual * 100)}%`} title="拖动调整宽度 · 双击恢复默认"
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); active.current = true; current.current = actual; setResizing(true); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (!active.current) return; const rect = container.current!.getBoundingClientRect(); change((event.clientX - rect.left - 4) / (rect.width - 8)); }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={() => change(defaultRatio, true)}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        change(event.key === 'Home' ? minimum : event.key === 'End' ? maximum : actual + (event.key === 'ArrowLeft' ? -.02 : .02), true);
      }}><GripVertical aria-hidden="true" /></div>
    {panels[1]}
  </main>;
}
