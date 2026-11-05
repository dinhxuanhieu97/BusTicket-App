import { copy } from "@/constants/copy";
import { cn } from "@/utils/cn";

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn("pn-badge", `pn-badge-${status.toLowerCase()}`, className)}
    >
      {copy.booking.status[status] ?? status}
    </span>
  );
}
