import { Minus, Plus, Snowflake } from 'lucide-react';

export function Dial({ value, min = 16, max = 30, onChange, caption, mode }: {
  value: number; min?: number; max?: number; onChange: (v: number) => void; caption: string; mode: string;
}) {
  const size = 250, c = size / 2, r = 104, start = 135, sweep = 270, ticks = 60;
  const pct = (value - min) / (max - min);
  const pos = (frac: number, radius: number) => {
    const a = ((start + sweep * frac) * Math.PI) / 180;
    return [c + radius * Math.cos(a), c + radius * Math.sin(a)];
  };
  const [kx, ky] = pos(pct, r + 1);

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative grid place-items-center outline-none"
        role="slider"
        tabIndex={0}
        aria-label="Nhiệt độ cài đặt"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} độ C`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); onChange(value + 0.5); }
          if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); onChange(value - 0.5); }
        }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="max-w-full">
          <circle cx={c} cy={c} r={r - 26} fill="color-mix(in oklab, var(--fg) 3%, transparent)" stroke="var(--line)" />
          {Array.from({ length: ticks + 1 }, (_, i) => {
            const f = i / ticks;
            const on = f <= pct;
            const [x1, y1] = pos(f, r - (i % 10 === 0 ? 15 : 9));
            const [x2, y2] = pos(f, r);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={on ? 'var(--cool)' : 'var(--line-strong)'} strokeWidth={2.4} strokeLinecap="round" opacity={on ? 0.4 + 0.6 * f : 1} />;
          })}
          <circle cx={kx} cy={ky} r={8} fill="#fff" stroke="var(--cool)" strokeWidth={3} />
        </svg>
        <div className="absolute text-center">
          <div className="flex items-center justify-center gap-1.5 text-xs font-bold tracking-[0.12em] text-cool"><Snowflake className="size-3.5" aria-hidden />{mode}</div>
          <div className="text-[54px] leading-tight font-semibold tracking-tight">{value.toLocaleString('vi-VN')}<sup className="text-lg">°C</sup></div>
          <div className="text-sm text-muted">{caption}</div>
        </div>
      </div>
      <div className="-mt-6 flex gap-20">
        <button type="button" aria-label="Giảm nhiệt độ" onClick={() => onChange(value - 0.5)} className="grid size-12 place-items-center rounded-full border border-line-strong bg-surface-2 hover:bg-fg/10"><Minus className="size-5" /></button>
        <button type="button" aria-label="Tăng nhiệt độ" onClick={() => onChange(value + 0.5)} className="grid size-12 place-items-center rounded-full border border-line-strong bg-surface-2 hover:bg-fg/10"><Plus className="size-5" /></button>
      </div>
    </div>
  );
}
