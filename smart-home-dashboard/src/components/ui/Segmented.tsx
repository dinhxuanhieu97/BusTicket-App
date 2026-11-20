import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface SegmentOption<T extends string> { value: T; label: ReactNode; count?: number }

export function Segmented<T extends string>({ options, value, onChange, accent, className, label }: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  accent?: boolean;
  className?: string;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('inline-flex flex-wrap gap-1 rounded-[16px] border border-line bg-fg/[0.03] p-1', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[12px] px-3 py-2 text-sm transition',
              on ? (accent ? 'bg-accent font-medium text-accent-fg' : 'bg-line-strong text-fg') : 'text-muted hover:text-fg',
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={cn('rounded-full px-1.5 text-[11px] font-semibold', on && accent ? 'bg-black/15' : 'bg-line-strong text-muted')}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
