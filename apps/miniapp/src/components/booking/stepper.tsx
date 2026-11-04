interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}

export function Stepper({ value, min, max, onChange, label }: StepperProps) {
  return (
    <div className="flex items-center gap-3" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Giảm ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        className="flex size-7 items-center justify-center rounded-full border border-primary text-primary disabled:border-neutral100 disabled:text-text-disabled"
      >
        −
      </button>
      <span className="w-4 text-center text-small">{value}</span>
      <button
        type="button"
        aria-label={`Tăng ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className="flex size-7 items-center justify-center rounded-full border border-primary text-primary disabled:border-neutral100 disabled:text-text-disabled"
      >
        +
      </button>
    </div>
  );
}
