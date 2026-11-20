export function RangeSlider({ value, onChange, label, disabled }: { value: number; onChange: (v: number) => void; label: string; disabled?: boolean }) {
  return (
    <input
      type="range"
      min={0}
      max={100}
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line-strong accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
      style={{ background: `linear-gradient(to right, var(--accent) ${value}%, var(--line-strong) ${value}%)` }}
    />
  );
}
