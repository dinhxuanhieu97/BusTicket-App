import { BusIcon } from "@/components/common/bus-icon";

interface EmptyStateProps {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, hint, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <BusIcon className="size-12 text-text-disabled" />
      <div className="text-large-m text-text-primary">{title}</div>
      {hint && <div className="text-xxsmall text-text-secondary">{hint}</div>}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-2 rounded-full border border-primary px-8 py-2.5 text-small text-primary"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
