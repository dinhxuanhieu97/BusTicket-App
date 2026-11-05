import { BusIcon } from "@/components/common/bus-icon";

interface EmptyStateProps {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}
export function EmptyState({
  title,
  hint,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="pn-empty">
      <BusIcon aria-hidden="true" />
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="pn-button pn-button-primary"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
