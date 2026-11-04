import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { Spinner, useSnackbar } from "zmp-ui";
import { copy, errorMessage } from "@/constants/copy";
import { EmptyState } from "@/components/booking/empty-state";
import { StatusBadge } from "@/components/booking/status-badge";
import { useNow } from "@/hooks/use-now";
import { useBooking, usePaymentInstructions } from "@/services/booking/booking.queries";
import { useMyBookings } from "@/stores/my-bookings.store";
import type { BookingView, PaymentInstructions } from "@/types/api.types";
import { formatCurrency } from "@/utils/format";
import { formatCountdown, formatVnDate, formatVnTime, secondsLeft } from "@/utils/time";

export default function BookingDetailPage() {
  const { code = "" } = useParams();
  const saved = useMyBookings((s) => s.bookings.find((b) => b.code === code));
  const { data: booking, isLoading, isError, error, refetch } = useBooking(code, saved?.accessToken);
  const holding = booking?.status === "HOLDING";
  const now = useNow(holding);
  const left = secondsLeft(booking?.holdExpiresAt ?? null, now);
  const payable = !!booking && booking.amountDueNow > 0;
  const payment = usePaymentInstructions(code, saved?.accessToken, payable);

  // Hết giờ giữ chỗ trên đồng hồ: hỏi lại máy chủ (tiền có thể vừa về đúng lúc).
  useEffect(() => {
    if (holding && left === 0) void refetch();
  }, [holding, left, refetch]);

  if (!saved) return <EmptyState title={copy.booking.notFound} />;
  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (isError || !booking) {
    return <EmptyState title={errorMessage(error)} actionLabel={copy.common.retry} onAction={() => void refetch()} />;
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-8 pt-2">
      <section className="flex flex-col gap-2 rounded-xl bg-elevation-01 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xxsmall text-text-secondary">{copy.booking.code}</span>
          <StatusBadge status={booking.status} />
        </div>
        <div className="text-xxlarge-m tracking-wider">{booking.code}</div>
        <div className="text-small-m">{saved.tripName}</div>
        <div className="text-xxsmall text-text-secondary">
          {formatVnTime(saved.departAt)} · {formatVnDate(saved.departAt)}
          {saved.route ? ` · ${saved.route}` : ""}
        </div>
        {holding && (
          <div className="mt-1 flex items-center justify-between rounded-lg bg-yellow100 px-3 py-2 text-small text-yellow700">
            <span>{copy.booking.holdLeft}</span>
            <span className="text-large-sb tabular-nums">{formatCountdown(left)}</span>
          </div>
        )}
      </section>

      <Amounts booking={booking} />

      {payable &&
        (payment.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : payment.data ? (
          <PaymentBox payment={payment.data} />
        ) : payment.isError ? (
          <div className="rounded-lg bg-red100 px-3 py-2 text-xxsmall text-danger">{errorMessage(payment.error)}</div>
        ) : null)}

      <div className="text-xxsmall text-text-secondary">
        {booking.status === "HOLDING"
          ? copy.booking.waiting
          : booking.status === "CONFIRMED" || booking.status === "COMPLETED"
            ? copy.booking.confirmed
            : copy.booking.expired}
      </div>
    </div>
  );
}

function Amounts({ booking }: { booking: BookingView }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-elevation-01 p-4 text-small">
      {booking.items.map((it) => (
        <div key={it.seatCode} className="flex justify-between text-xxsmall">
          <span>
            {it.seatCode}
            {it.occupancy > 1 ? ` · ${it.occupancy} người` : ""}
            {it.infantCount > 0 ? ` · ${it.infantCount} trẻ em` : ""}
          </span>
          <span>{formatCurrency(it.lineTotal)}</span>
        </div>
      ))}
      <Row label={copy.booking.total} value={formatCurrency(booking.totalAmount)} strong />
      <Row label={copy.booking.paid} value={formatCurrency(booking.paidAmount)} />
      {booking.amountDueNow > 0 && <Row label={copy.booking.due} value={formatCurrency(booking.amountDueNow)} accent />}
    </section>
  );
}

function Row({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-divider01 pt-2 text-small-m" : "text-xxsmall"}`}>
      <span className="text-text-secondary">{label}</span>
      <span className={accent ? "text-primary" : undefined}>{value}</span>
    </div>
  );
}

function PaymentBox({ payment }: { payment: PaymentInstructions }) {
  const { openSnackbar } = useSnackbar();
  if (!payment.payable) return null;

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      openSnackbar({ text: copy.common.copied, type: "success" });
    } catch {
      openSnackbar({ text: text, type: "default" });
    }
  };

  const rows: [string, string, boolean][] = [
    [copy.booking.bank, payment.bank.code, false],
    [copy.booking.accountNumber, payment.bank.accountNumber, true],
    [copy.booking.accountName, payment.bank.accountName, false],
    [copy.booking.amount, formatCurrency(payment.amountDue), false],
    [copy.booking.transferContent, payment.transferContent, true],
  ];

  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-primary/30 p-4">
      <div className="text-normal-sb">{copy.booking.payTitle}</div>
      <img
        src={payment.qrImageUrl}
        alt={`QR ${payment.transferContent}`}
        className="size-56 rounded-lg bg-white object-contain"
        draggable={false}
      />
      <div className="text-center text-xxsmall text-text-secondary">{copy.booking.payHint}</div>
      <div className="flex w-full flex-col gap-2">
        {rows.map(([label, value, copyable]) => (
          <div key={label} className="flex items-center justify-between gap-2 text-xxsmall">
            <span className="text-text-secondary">{label}</span>
            <span className="flex items-center gap-2 text-right text-small-m">
              {value}
              {copyable && (
                <button type="button" className="text-xxsmall text-primary" onClick={() => void copyText(value)}>
                  {copy.common.copy}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
