import { useId, useState } from 'react';

export interface Series { name: string; values: number[]; color: string; dashed?: boolean }

function smooth(pts: [number, number][]) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`;
  }
  return d;
}

export function AreaChart({ labels, series, unit, height = 260 }: { labels: string[]; series: Series[]; unit: string; height?: number }) {
  const uid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = height, L = 44, R = 22, T = 12, B = 28;
  const peak = Math.max(...series.flatMap((s) => s.values)) || 1;
  const step = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100].find((st) => peak / st <= 5) ?? 100;
  const max = Math.ceil(peak / step) * step;
  const x = (i: number) => L + (i / (labels.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, k) => k * step);
  const every = Math.ceil(labels.length / 8);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (labels.length - 1));
    setHover(Math.max(0, Math.min(labels.length - 1, i)));
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height: H }}
        role="img"
        aria-label={series.map((s) => s.name).join(', ')}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line-strong)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--faint)">{v.toLocaleString('vi-VN')}</text>
          </g>
        ))}
        {labels.map((lb, i) => (i % every === 0 || i === labels.length - 1) && (
          <text key={lb + i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--faint)">{lb}</text>
        ))}
        {series.map((s, si) => {
          const d = smooth(s.values.map((v, i) => [x(i), y(v)]));
          const gid = `${uid}-${si}`;
          return (
            <g key={s.name}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={s.color} stopOpacity={0.3} />
                  <stop offset="1" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              {!s.dashed && <path d={`${d} L${x(labels.length - 1)} ${y(0)} L${x(0)} ${y(0)}Z`} fill={`url(#${gid})`} />}
              <path d={d} fill="none" stroke={s.color} strokeWidth={2.4} strokeDasharray={s.dashed ? '6 6' : undefined} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--line-strong)" vectorEffect="non-scaling-stroke" />
            {series.map((s) => <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r={4.5} fill="var(--surface-2)" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          className="glass pointer-events-none absolute top-2 rounded-xl bg-surface-2 px-3 py-2 text-xs"
          style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% - 70px), calc(100% - 150px))` }}
        >
          <div className="mb-1 font-semibold">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-2 text-muted">
              <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
              {s.name}: <span className="text-fg">{s.values[hover].toLocaleString('vi-VN')} {unit}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color, opacity: s.dashed ? 0.7 : 1 }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
