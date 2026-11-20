import { useId } from 'react';

export function Sparkline({ values, color = 'var(--accent)', fill = true, className = 'h-10 w-28' }: { values: number[]; color?: string; fill?: boolean; className?: string }) {
  const id = useId();
  const w = 120, h = 40;
  const max = Math.max(...values), min = Math.min(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / (max - min || 1)) * (h - 10)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.35} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={`${d} L${w} ${h} L0 ${h}Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
