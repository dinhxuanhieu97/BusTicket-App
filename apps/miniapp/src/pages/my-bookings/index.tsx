import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Modal, useSnackbar } from "zmp-ui";
import { useQueries } from "@tanstack/react-query";
import { copy } from "@/constants/copy";
import { EmptyState } from "@/components/booking/empty-state";
import { StatusBadge } from "@/components/booking/status-badge";
import { Journey } from "@/components/booking/journey";
import {
  bookingQueryOptions,
  isBookingUnavailable,
} from "@/services/booking/booking.queries";
import { useMyBookings, type SavedBooking } from "@/stores/my-bookings.store";
import type { BookingView } from "@/types/api.types";
import { useCancelBooking } from "@/services/booking/booking.mutations";
import { errorMessage } from "@/constants/copy";
import { canCancel, canRemove, needsPayment } from "@/utils/booking-status";
import { formatVnDate, formatVnTime } from "@/utils/time";

export default function MyBookingsPage() {
  const navigate = useNavigate();
  const bookings = useMyBookings((s) => s.bookings);
  const [pendingOnly, setPendingOnly] = useState(false);
  const queries = useQueries({
    queries: bookings.map((b) => bookingQueryOptions(b.code, b.accessToken)),
  });
  // Keep unresolved orders in the pending view until the server reports a status or a 404.
  const visible = bookings
    .map((saved, index) => ({
      saved,
      query: queries[index],
      unavailable: isBookingUnavailable(queries[index].error),
    }))
    .filter(
      ({ query, unavailable }) =>
        !pendingOnly ||
        (!unavailable &&
          (query.isError || !query.data || needsPayment(query.data))),
    );

  return (
    <>
      <div
        className="pn-tabs"
        role="tablist"
        aria-label={copy.myBookings.title}
      >
        {[false, true].map((pending) => (
          <button
            key={String(pending)}
            id={pending ? "pending-tab" : "all-tab"}
            role="tab"
            type="button"
            aria-selected={pendingOnly === pending}
            aria-controls="booking-list"
            onClick={() => setPendingOnly(pending)}
            onKeyDown={(event) => {
              if (
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight" ||
                event.key === "Home" ||
                event.key === "End"
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? false
                    : event.key === "End"
                      ? true
                      : !pending;
                setPendingOnly(next);
                document
                  .getElementById(next ? "pending-tab" : "all-tab")
                  ?.focus();
              }
            }}
            tabIndex={pendingOnly === pending ? 0 : -1}
          >
            {pending ? copy.myBookings.pending : copy.myBookings.all}
          </button>
        ))}
      </div>
      <div
        className="pn-page"
        id="booking-list"
        role="tabpanel"
        aria-labelledby={pendingOnly ? "pending-tab" : "all-tab"}
      >
        {visible.length === 0 ? (
          <EmptyState
            title={
              pendingOnly && bookings.length
                ? copy.myBookings.noPending
                : copy.myBookings.empty
            }
            hint={copy.myBookings.emptyHint}
            actionLabel={copy.myBookings.bookNow}
            onAction={() => navigate("/")}
          />
        ) : (
          <>
            {visible.map(({ saved, query, unavailable }) => (
              <BookingRow
                key={saved.code}
                saved={saved}
                booking={unavailable ? undefined : query.data}
                failed={query.isError}
                unavailable={unavailable}
              />
            ))}
            <p className="pn-meta">{copy.myBookings.emptyHint}</p>
          </>
        )}
      </div>
    </>
  );
}

function BookingRow({
  saved,
  booking,
  failed,
  unavailable,
}: {
  saved: SavedBooking;
  booking?: BookingView;
  failed: boolean;
  unavailable: boolean;
}) {
  const { openSnackbar } = useSnackbar();
  const cancel = useCancelBooking();
  const remove = useMyBookings((s) => s.remove);
  const [confirm, setConfirm] = useState<"cancel" | "remove" | null>(null);
  const [cancelError, setCancelError] = useState("");
  const cancellable = !!booking && canCancel(booking);
  const removable = canRemove(booking, unavailable);
  const statusMessage = unavailable
    ? copy.myBookings.statusUnavailable
    : failed
      ? copy.myBookings.statusError
      : copy.myBookings.statusLoading;
  return (
    <article className="pn-card">
      <div className="pn-row pn-ticket-heading">
        <span className="pn-ticket-code">
          {copy.booking.code} · {saved.code}
        </span>
        {booking && <StatusBadge status={booking.status} />}
      </div>
      <Journey route={saved.route} fallback={saved.tripName} />
      <div className="pn-date">
        {formatVnTime(saved.departAt)} · {formatVnDate(saved.departAt)}
      </div>
      <div className="pn-meta">{saved.tripName}</div>
      <div aria-label={copy.checkout.summary}>
        {saved.seatCodes.map((code) => (
          <span className="pn-seat" key={code}>
            {code}
          </span>
        ))}
      </div>
      {saved.inbound && (
        <div className="pn-meta">
          Lượt về · {saved.inbound.route} ·{" "}
          {formatVnDate(saved.inbound.departAt)} ·{" "}
          {formatVnTime(saved.inbound.departAt)} · Chỗ{" "}
          {saved.inbound.seatCodes.join(", ")}
        </div>
      )}
      {(failed || !booking) && (
        <p className="pn-meta mt-3" role="status">
          {statusMessage}
        </p>
      )}
      <div className="pn-row pn-ticket-foot">
        <span className="pn-meta">
          {copy.myBookings.seats(
            saved.seatCodes.length + (saved.inbound?.seatCodes.length ?? 0),
          )}
        </span>
        <Link
          className="pn-link"
          to={`/booking/${saved.code}`}
          aria-label={`${copy.myBookings.details} ${saved.code}`}
        >
          {copy.myBookings.details}
          <span aria-hidden="true"> →</span>
        </Link>
      </div>
      {(cancellable || removable) && (
        <div className="pn-row pn-ticket-actions">
          {cancellable && (
            <button
              type="button"
              className="pn-button pn-button-danger pn-button-form"
              aria-label={`${copy.myBookings.cancel} ${saved.code}`}
              onClick={() => {
                setCancelError("");
                setConfirm("cancel");
              }}
            >
              {copy.myBookings.cancel}
            </button>
          )}
          {removable && (
            <button
              type="button"
              className="pn-button pn-button-muted pn-button-form"
              aria-label={`${copy.myBookings.remove} ${saved.code}`}
              onClick={() => setConfirm("remove")}
            >
              {copy.myBookings.remove}
            </button>
          )}
        </div>
      )}
      <Modal
        visible={confirm === "cancel"}
        title={copy.myBookings.cancelTitle}
        onClose={() => !cancel.isPending && setConfirm(null)}
        actions={[
          {
            text: copy.myBookings.keep,
            close: true,
            disabled: cancel.isPending,
          },
          {
            text: cancel.isPending
              ? copy.myBookings.cancelling
              : copy.myBookings.cancelConfirm,
            danger: true,
            disabled: cancel.isPending,
            onClick: () =>
              cancel.mutate(saved, {
                onSuccess: () => {
                  setConfirm(null);
                  openSnackbar({
                    text: copy.myBookings.cancelled(saved.code),
                    type: "success",
                  });
                },
                onError: (e) => setCancelError(errorMessage(e)),
              }),
          },
        ]}
      >
        <p className="pn-meta">{copy.myBookings.cancelBody(saved.code)}</p>
        {booking?.transferClaimedAt && (
          <p className="pn-meta pn-text-warning" role="note">
            {copy.myBookings.cancelClaimed}
          </p>
        )}
        {cancelError && (
          <p className="pn-field-error" role="alert">
            {cancelError}
          </p>
        )}
      </Modal>
      <Modal
        visible={confirm === "remove"}
        title={copy.myBookings.removeTitle}
        onClose={() => setConfirm(null)}
        actions={[
          { text: copy.myBookings.keep, close: true },
          {
            text: copy.myBookings.removeConfirm,
            danger: true,
            onClick: () => {
              setConfirm(null);
              remove(saved.code);
              openSnackbar({
                text: copy.myBookings.removed(saved.code),
                type: "success",
              });
            },
          },
        ]}
      >
        <p className="pn-meta">{copy.myBookings.removeBody}</p>
        {(booking?.paidAmount ?? 0) > 0 && (
          <p className="pn-meta pn-text-warning" role="note">
            {copy.myBookings.removePaid(saved.code)}
          </p>
        )}
      </Modal>
    </article>
  );
}
