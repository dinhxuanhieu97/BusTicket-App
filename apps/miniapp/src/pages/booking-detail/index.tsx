import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSnackbar } from "zmp-ui";
import { copy, errorMessage } from "@/constants/copy";
import { config } from "@/config";
import receiptLogo from "@/assets/receipt-logo.png";
import { EmptyState } from "@/components/booking/empty-state";
import { ReceiptActions } from "@/components/booking/receipt-actions";
import { StatusBadge } from "@/components/booking/status-badge";
import { Journey } from "@/components/booking/journey";
import { LoadingState } from "@/components/common/loading-state";
import { Notice } from "@/components/common/notice";
import { isRetriable } from "@/lib/query-client";
import { useNow } from "@/hooks/use-now";
import {
  isBookingUnavailable,
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
    isFetching,
    isRefetchError,
    error,
    refetch,
  } = useBooking(code, saved?.accessToken);
  const unavailable = isBookingUnavailable(error);
  const holding = booking?.status === "HOLDING";
  const now = useNow(holding);
  const left = secondsLeft(booking?.holdExpiresAt ?? null, now);
  const payable =
    !!booking && !isRefetchError && left > 0 && needsPayment(booking);
  const payment = usePaymentInstructions(
    code,
    saved?.accessToken,
    payable,
    booking?.amountDueNow,
  );

  useEffect(() => {
    if (holding && left === 0 && !unavailable) void refetch();
  }, [holding, left, refetch, unavailable]);

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
  if (isLoading) return <LoadingState label="Đang tải đơn đặt vé…" />;
  if (unavailable)
    return (
      <div className="pn-page">
        <Notice
          tone="warning"
          action={{
            label: copy.myBookings.title,
            onClick: () => navigate("/my-bookings"),
          }}
        >
          <p className="font-semibold">{copy.booking.unavailable}</p>
          <p>
            {copy.booking.code} · {code}
          </p>
          <p>{copy.booking.unavailableHint}</p>
        </Notice>
      </div>
    );
  if (!booking || (isRefetchError && !isRetriable(error)))
    return (
      <div className="pn-page">
        <Notice
          tone="error"
          action={{
            label: copy.common.retry,
            onClick: () => void refetch(),
            disabled: isFetching,
          }}
        >
          <p className="font-semibold">Chưa tải được đơn đặt vé.</p>
          <p>{errorMessage(error)}</p>
        </Notice>
      </div>
    );

  const confirmed =
    booking.status === "CONFIRMED" || booking.status === "COMPLETED";
  const retryStatus = {
    label: "Kiểm tra lại",
    onClick: () => void refetch(),
    disabled: isFetching,
  };
  return (
    <div className="pn-page pn-stack">
      {isRefetchError ? (
        <Notice tone="warning" action={retryStatus}>
          {copy.booking.refreshError}
        </Notice>
      ) : holding ? (
        <Notice tone="warning" action={left === 0 ? retryStatus : undefined}>
          {left > 0 ? (
            <>
              <div className="pn-row font-semibold">
                <span>{copy.booking.holdLeft}</span>
                <strong
                  role="timer"
                  aria-live="off"
                  aria-label={copy.booking.holdLeft}
                >
                  {formatCountdown(left)}
                </strong>
              </div>
              <p className="mt-1">{copy.booking.waiting}</p>
            </>
          ) : (
            copy.booking.deadlinePassed
          )}
        </Notice>
      ) : (
        <Notice tone={confirmed ? "success" : "warning"}>
          {confirmed
            ? copy.booking.confirmed
            : booking.status === "CANCELLED"
              ? copy.booking.cancelled
              : copy.booking.expired}
        </Notice>
      )}
      <section
        className="pn-card pn-receipt"
        aria-labelledby="booking-receipt-heading"
      >
        <header className="pn-receipt-header">
          <img
            className="pn-receipt-logo"
            src={receiptLogo}
            alt=""
            width={48}
            height={48}
          />
          <div>
            <p>{config.operatorName}</p>
            <h2 id="booking-receipt-heading">Phiếu đặt vé</h2>
          </div>
        </header>
        <div className="pn-receipt-body">
          <div className="pn-receipt-watermark" aria-hidden="true">
            <span>{copy.booking.status[booking.status]}</span>
            <span>{booking.code}</span>
          </div>
          <div className="pn-receipt-content">
            <div className="pn-row pn-ticket-heading">
              <span className="pn-receipt-code">
                <small>{copy.booking.code}</small>
                {booking.code}
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
          </div>
        </div>
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
          <LoadingState label="Đang tải thông tin chuyển khoản…" />
        ) : payment.isError ? (
          <Notice
            tone="error"
            action={{
              label: copy.common.retry,
              onClick: () => void payment.refetch(),
              disabled: payment.isFetching,
            }}
          >
            <p className="font-semibold">
              Chưa tải được thông tin chuyển khoản.
            </p>
            <p>{errorMessage(payment.error)}</p>
          </Notice>
        ) : payment.data?.payable ? (
          <PaymentBox key={payment.data.qrImageUrl} payment={payment.data} />
        ) : payment.data ? (
          <Notice
            tone="warning"
            action={{
              ...retryStatus,
              disabled: isFetching || payment.isFetching,
              onClick: () => {
                void refetch();
                void payment.refetch();
              },
            }}
          >
            {copy.booking.paymentNotPayable}
          </Notice>
        ) : null)}
      <div className="pn-meta flex flex-wrap justify-between gap-x-6 gap-y-2">
        <div className="min-w-48 flex-1">
          {(holding || booking.status === "CONFIRMED") && (
            <p>{copy.booking.followContact}</p>
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
        <Notice tone="warning">{copy.booking.qrError}</Notice>
      ) : (
        <img
          src={payment.qrImageUrl}
          alt={`QR ${payment.transferContent}`}
          className="pn-qr"
          draggable={false}
          onError={() => setQrFailed(true)}
        />
      )}
      {!qrFailed && (
        <p className="pn-meta mb-4 text-center">{copy.booking.payHint}</p>
      )}
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
