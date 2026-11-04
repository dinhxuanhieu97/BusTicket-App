import { copy } from "@/constants/copy";
import { cn } from "@/utils/cn";

const STYLE: Record<string, string> = {
  HOLDING: "bg-yellow100 text-yellow700",
  CONFIRMED: "bg-green100 text-green500",
  COMPLETED: "bg-green100 text-green500",
  EXPIRED: "bg-neutral100 text-text-secondary",
  CANCELLED: "bg-neutral100 text-text-secondary",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xxxsmall-m", STYLE[status] ?? STYLE.EXPIRED, className)}>
      {copy.booking.status[status] ?? status}
    </span>
  );
}
