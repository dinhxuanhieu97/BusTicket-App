import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('glass rounded-[24px] p-5 sm:p-6', className)}>{children}</section>;
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-base font-semibold">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
