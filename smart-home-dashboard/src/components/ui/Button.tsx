import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'ghost' | 'soft';

export function Button({ variant = 'ghost', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[14px] px-4 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-accent-fg hover:brightness-105',
        variant === 'ghost' && 'border border-line-strong bg-fg/[0.03] hover:bg-fg/[0.07]',
        variant === 'soft' && 'bg-accent/15 text-accent hover:bg-accent/25',
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'relative grid size-11 shrink-0 place-items-center rounded-[14px] border border-line-strong bg-fg/[0.03] transition hover:bg-fg/[0.07] focus-visible:outline-2 focus-visible:outline-accent',
        className,
      )}
      {...props}
    />
  );
}
