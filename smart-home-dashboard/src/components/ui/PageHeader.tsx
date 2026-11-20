import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="glass flex flex-col gap-4 rounded-[24px] p-6 sm:flex-row sm:items-end sm:justify-between sm:p-7">
      <div>
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
        {subtitle && <p className="mt-1.5 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}
