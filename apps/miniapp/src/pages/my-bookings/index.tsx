import { useNavigate } from "react-router-dom";
import { copy } from "@/constants/copy";
import { EmptyState } from "@/components/booking/empty-state";
import { StatusBadge } from "@/components/booking/status-badge";
import { ChevronRightIcon } from "@/components/common/vectors";
import { useBooking } from "@/services/booking/booking.queries";
import { useMyBookings, type SavedBooking } from "@/stores/my-bookings.store";
import { formatVnDate, formatVnTime } from "@/utils/time";

export default function MyBookingsPage() {
  const navigate = useNavigate();
  const bookings = useMyBookings((s) => s.bookings);

  if (bookings.length === 0) {
    return (
      <EmptyState
        title={copy.myBookings.empty}
        hint={copy.myBookings.emptyHint}
        actionLabel={copy.myBookings.bookNow}
        onAction={() => navigate("/")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-6 pt-2">
      {bookings.map((b) => (
        <BookingRow key={b.code} saved={b} onOpen={() => navigate(`/booking/${b.code}`)} />
      ))}
    </div>
  );
}

function BookingRow({ saved, onOpen }: { saved: SavedBooking; onOpen: () => void }) {
  const { data } = useBooking(saved.code, saved.accessToken);
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl bg-elevation-01 p-4 text-left">
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-normal-sb tracking-wider">{saved.code}</span>
          {data && <StatusBadge status={data.status} />}
        </div>
        <div className="text-small">{saved.tripName}</div>
        <div className="text-xxsmall text-text-secondary">
          {formatVnTime(saved.departAt)} · {formatVnDate(saved.departAt)} · {saved.seatCodes.join(", ")}
        </div>
      </div>
      <ChevronRightIcon className="size-4 text-text-disabled" />
    </button>
  );
}
