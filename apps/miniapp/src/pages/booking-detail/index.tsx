import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Spinner, useSnackbar } from "zmp-ui";
import { copy, errorMessage } from "@/constants/copy";
import { config } from "@/config";
import { EmptyState } from "@/components/booking/empty-state";
import { ReceiptActions } from "@/components/booking/receipt-actions";
import { StatusBadge } from "@/components/booking/status-badge";
import { Journey } from "@/components/booking/journey";
import { useNow } from "@/hooks/use-now";
import {
  useBooking,
  usePaymentInstructions,
} from "@/services/booking/booking.queries";
import { useMyBookings } from "@/stores/my-bookings.store";
import type { BookingView, PaymentInstructions } from "@/types/api.types";
import { needsPayment } from "@/utils/booking-status";
import { receiptPaymentLabel } from "@/utils/booking-receipt";
import { formatCurrency } from "@/utils/format";
import {
  formatCountdown,
  formatVnDate,
  formatVnTime,
  secondsLeft,
} from "@/utils/time";

export default function BookingDetailPage() {
  const navigate = useNavigate();
  const { code = "" } = useParams();
  const saved = useMyBookings((s) => s.bookings.find((b) => b.code === code));
  const {
    data: booking,
    isLoading,
    isError,
    error,
    refetch,
  } = useBooking(code, saved?.accessToken);
  const holding = booking?.status === "HOLDING";
  const now = useNow(holding);
  const left = secondsLeft(booking?.holdExpiresAt ?? null, now);
  const payable = !!booking && left > 0 && needsPayment(booking);
  const payment = usePaymentInstructions(
    code,
    saved?.accessToken,
    payable,
    booking?.amountDueNow,
  );

  useEffect(() => {
    if (holding && left === 0) void refetch();
  }, [holding, left, refetch]);

  if (!saved)
    return (
      <div className="pn-page">
        <EmptyState
          title={copy.booking.notFound}
          actionLabel={copy.myBookings.title}
          onAction={() => navigate("/my-bookings")}
        />
      </div>
    );
  if (isLoading)
    return (
      <div className="pn-loading" role="status">
        <Spinner />
        {copy.common.loading}
      </div>
    );
  if (isError || !booking)
    return (
      <div className="pn-page">
        <EmptyState
          title={errorMessage(error)}
          actionLabel={copy.common.retry}
          onAction={() => void refetch()}
        />
      </div>
    );

  return (
    <div className="pn-page">
      {holding && (
        <div className="pn-notice pn-row">
          <span>{copy.booking.holdLeft}</span>
          <strong role="timer" aria-label={copy.booking.holdLeft}>
            {formatCountdown(left)}
          </strong>
        </div>
      )}
      <section className="pn-card" aria-labelledby="booking-receipt-heading">
        <h2 id="booking-receipt-heading" className="pn-section-title">
          Phiếu đặt vé
        </h2>
        <div className="pn-row pn-ticket-heading">
          <span className="pn-ticket-code">
            {copy.booking.code} · {booking.code}
          </span>
          <StatusBadge status={booking.status} />
        </div>
        <Journey route={saved.route} fallback={saved.tripName} />
        <div className="pn-date">
          {formatVnTime(saved.departAt)} · {formatVnDate(saved.departAt)}
        </div>
        <div className="pn-meta">{saved.tripName}</div>
        <div aria-label={copy.checkout.summary}>
          {booking.items
            .filter((i) => !saved.inbound || i.tripId === booking.tripId)
            .map((item) => (
              <span key={item.seatCode} className="pn-seat">
                {item.seatCode}
              </span>
            ))}
        </div>
        {saved.inbound && (
          <section className="mt-4 border-t border-[var(--pn-line)] pt-4">
            <h2 className="pn-section-title">Lượt về</h2>
            <Journey route={saved.inbound.route} fallback="" />
            <p>
              {formatVnDate(saved.inbound.departAt)} ·{" "}
              {formatVnTime(saved.inbound.departAt)}
            </p>
            {booking.items
              .filter((i) => i.tripId === saved.inbound?.tripId)
              .map((i) => (
                <span className="pn-seat" key={i.seatCode}>
                  {i.seatCode}
                </span>
              ))}
          </section>
        )}
        <Amounts booking={booking} />
        <ReceiptActions saved={saved} booking={booking} />
      </section>
      {booking.note && (
        <section className="pn-card">
          <h2 className="pn-section-title">Ghi chú cho nhà xe</h2>
          <p className="whitespace-pre-wrap break-words">{booking.note}</p>
        </section>
      )}
      {payable &&
        (payment.isLoading ? (
          <div className="pn-loading" role="status">
            <Spinner />
            {copy.common.loading}
          </div>
        ) : payment.isError ? (
          <div className="pn-error" role="alert">
            <p>{errorMessage(payment.error)}</p>
            <button
              className="pn-link"
              type="button"
              onClick={() => void payment.refetch()}
            >
              {copy.common.retry}
            </button>
          </div>
        ) : payment.data?.payable ? (
          <PaymentBox key={payment.data.qrImageUrl} payment={payment.data} />
        ) : payment.data ? (
          <div className="pn-notice">
            <p>{copy.booking.paymentNotPayable}</p>
            <button
              className="pn-link"
              type="button"
              onClick={() => {
                void refetch();
                void payment.refetch();
              }}
            >
              {copy.common.retry}
            </button>
          </div>
        ) : null)}
      <div className="pn-meta flex flex-wrap justify-between gap-x-6 gap-y-2">
        <div className="min-w-48 flex-1">
          <p role="status">
            {booking.status === "HOLDING"
              ? copy.booking.waiting
              : booking.status === "CONFIRMED" || booking.status === "COMPLETED"
                ? copy.booking.confirmed
                : booking.status === "CANCELLED"
                  ? copy.booking.cancelled
                  : copy.booking.expired}
          </p>
          {(holding || booking.status === "CONFIRMED") && (
            <p className="mt-1">{copy.booking.followContact}</p>
          )}
        </div>
        <div className="ml-auto flex flex-col items-end gap-1 text-right">
          {config.supportPhone && (
            <ContactLink label="Hotline nhà xe" phone={config.supportPhone} />
          )}
          {booking.tripContacts?.map(({ tripId, phone }) => (
            <ContactLink
              key={tripId}
              label={
                saved.inbound
                  ? tripId === booking.tripId
                    ? "Phụ xe lượt đi"
                    : "Phụ xe lượt về"
                  : "Số phụ xe"
              }
              phone={phone}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ContactLink({ label, phone }: { label: string; phone: string }) {
  return (
    <a className="pn-link" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
      {label} · {phone}
    </a>
  );
}

function Amounts({ booking }: { booking: BookingView }) {
  return (
    <dl aria-label={copy.booking.amountsTitle}>
      {booking.items.map((item) => (
        <div key={item.tripId + ":" + item.seatCode} className="pn-amount-row">
          <dt>
            {booking.items.some(
              (i) => i.tripId && i.tripId !== booking.tripId,
            ) && (item.tripId === booking.tripId ? "Đi · " : "Về · ")}
            {item.seatCode} · {item.occupancy} người
            {item.infantCount > 0 ? ` · ${item.infantCount} trẻ em` : ""}
          </dt>
        </div>
      ))}
      <div className="pn-amount-row">
        <dt>Thanh toán</dt>
        <dd>{receiptPaymentLabel(booking.paymentStatus)}</dd>
      </div>
      <div className="pn-amount-row pn-amount-total">
        <dt>{copy.seats.totalDeposit}</dt>
        <dd>{formatCurrency(booking.depositAmount)}</dd>
      </div>
    </dl>
  );
}

function PaymentBox({
  payment,
}: {
  payment: Extract<PaymentInstructions, { payable: true }>;
}) {
  const { openSnackbar } = useSnackbar();
  const [qrFailed, setQrFailed] = useState(false);
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      openSnackbar({ text: copy.common.copied, type: "success" });
    } catch {
      openSnackbar({ text, type: "default" });
    }
  };
  const rows: [string, string, boolean][] = [
    [copy.booking.bank, payment.bank.code, false],
    [copy.booking.accountNumber, payment.bank.accountNumber, true],
    [copy.booking.accountName, payment.bank.accountName, false],
    [copy.booking.transferContent, payment.transferContent, true],
  ];
  return (
    <section className="pn-card">
      <h2 className="pn-section-title">{copy.booking.payTitle}</h2>
      <div className="pn-row pn-pay-summary">
        <span>{copy.booking.due}</span>
        <strong className="pn-price">
          {formatCurrency(payment.amountDue)}
        </strong>
      </div>
      {qrFailed ? (
        <p className="pn-error" role="alert">
          {copy.booking.qrError}
        </p>
      ) : (
        <img
          src={payment.qrImageUrl}
          alt={`QR ${payment.transferContent}`}
          className="pn-qr"
          draggable={false}
          onError={() => setQrFailed(true)}
        />
      )}
      <p className="pn-meta mb-4 text-center">{copy.booking.payHint}</p>
      <dl>
        {rows.map(([label, value, copyable]) => (
          <div className="pn-bank-row" key={label}>
            <dt>{label}</dt>
            <dd>
              {value}
              {copyable && (
                <button
                  type="button"
                  className="pn-copy"
                  aria-label={`${copy.common.copy} ${label.toLowerCase()}`}
                  onClick={() => void copyText(value)}
                >
                  {copy.common.copy}
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
