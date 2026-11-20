import { cn } from '../../lib/cn';

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40',
        on ? 'bg-accent' : 'bg-line-strong',
      )}
    >
      <span className={cn('absolute top-[3px] left-[3px] size-[22px] rounded-full bg-white shadow transition-transform', on && 'translate-x-5')} />
    </button>
  );
}
