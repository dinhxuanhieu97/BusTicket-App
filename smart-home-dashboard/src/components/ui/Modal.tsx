import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="glass m-auto w-[min(520px,calc(100vw-32px))] rounded-[24px] bg-surface-2 p-0 text-fg backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Đóng" className="grid size-9 place-items-center rounded-xl hover:bg-fg/10"><X className="size-5" /></button>
      </div>
      <div className="px-6 py-5">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
    </dialog>
  );
}
