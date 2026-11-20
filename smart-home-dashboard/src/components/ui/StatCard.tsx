import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Sparkline } from './Sparkline';

export function StatCard({ icon: Icon, label, value, unit, foot, spark, sparkColor, fillSpark = true }: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  unit?: string;
  foot?: ReactNode;
  spark?: number[];
  sparkColor?: string;
  fillSpark?: boolean;
}) {
  return (
    <section className="glass relative overflow-hidden rounded-[22px] p-5">
      <div className="flex items-center gap-2 text-sm text-muted"><Icon className="size-4" aria-hidden />{label}</div>
      <div className="mt-3 mb-3 flex items-end justify-between gap-3">
        <div className="text-[28px] leading-none font-semibold tracking-tight">
          {value}{unit && <span className="ml-1 text-sm font-normal text-muted">{unit}</span>}
        </div>
        {spark && <Sparkline values={spark} color={sparkColor} fill={fillSpark} className="h-10 w-24 shrink-0 sm:w-28" />}
      </div>
      {foot && <div className="flex items-center gap-2 text-xs text-muted">{foot}</div>}
    </section>
  );
}

export function Delta({ value, good = true }: { value: string; good?: boolean }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${good ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'}`}>{value}</span>
  );
}

export function LiveDot() {
  return <span className="size-2 rounded-full bg-ok shadow-[0_0_0_4px_color-mix(in_oklab,var(--ok)_20%,transparent)]" aria-hidden />;
}
