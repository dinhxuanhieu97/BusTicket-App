import { useEffect, useState } from "react";
import { downloadFile, openShareSheet } from "zmp-sdk/apis";
import { useSnackbar } from "zmp-ui";
import { config } from "@/config";
import { copy as messages } from "@/constants/copy";
import type { SavedBooking } from "@/stores/my-bookings.store";
import type { BookingView } from "@/types/api.types";
import { receiptLines } from "@/utils/booking-receipt";
import { formatVnDate, formatVnTime } from "@/utils/time";

async function makeTicketQr(url: string) {
  const { default: qr } = await import("qrcode");
  return qr.toDataURL(url, {
    width: 384,
    margin: 4,
    errorCorrectionLevel: "M",
  });
}

export function ReceiptActions({
  saved,
  booking,
}: {
  saved: SavedBooking;
  booking: BookingView;
}) {
  const { openSnackbar } = useSnackbar();
  const [downloading, setDownloading] = useState(false);
  const [showShareText, setShowShareText] = useState(false);
  const [qr, setQr] = useState<{ url: string; image: string } | null>(null);
  const verificationUrl = booking.ticketProof
    ? `${config.apiBaseUrl || window.location.origin}/api/v1/tickets/${encodeURIComponent(booking.code)}/verify?proof=${encodeURIComponent(booking.ticketProof)}`
    : "";
  const qrImage = qr?.url === verificationUrl ? qr.image : undefined;
  useEffect(() => {
    if (!verificationUrl) return;
    let current = true;
    void makeTicketQr(verificationUrl)
      .then((image) => {
        if (current) setQr({ url: verificationUrl, image });
      })
      .catch(() => {
        // The direct verification link still works if QR rendering fails.
      });
    return () => {
      current = false;
    };
  }, [verificationUrl]);
  const inZalo = /\bzalo\b/i.test(navigator.userAgent);
  const title = `Phiếu đặt vé ${booking.code}`;
  const text = [
    title,
    config.operatorName,
    "",
    ...receiptLines(saved, booking),
  ].join("\n");

  async function download() {
    setDownloading(true);
    try {
      const { createBookingPdf } = await import("@/utils/booking-receipt-pdf");
      const now = new Date().toISOString();
      const image =
        qrImage ??
        (verificationUrl ? await makeTicketQr(verificationUrl) : undefined);
      const pdf = await createBookingPdf(
        config.operatorName,
        [
          ...receiptLines(saved, booking),
          "",
          `Xuất phiếu lúc ${formatVnTime(now)} · ${formatVnDate(now)}`,
        ],
        {
          code: booking.code,
          status: messages.booking.status[booking.status] ?? booking.status,
          qrImage: image,
        },
      );
      if (inZalo) {
        try {
          await downloadFile({ fileBase64Data: pdf.output("datauristring") });
          return;
        } catch {
          // Older Zalo clients may not expose the native file download.
        }
      }
      pdf.save(`phieu-dat-ve-${booking.code}.pdf`);
    } catch {
      openSnackbar({
        text: "Chưa tải được PDF. Vui lòng thử lại.",
        type: "error",
      });
    } finally {
      setDownloading(false);
    }
  }

  async function share() {
    try {
      if (
        navigator.share &&
        (!navigator.canShare || navigator.canShare({ text }))
      ) {
        await navigator.share({ title, text });
      } else if (inZalo) {
        await openShareSheet({ type: "text", data: { text } });
      } else {
        setShowShareText(true);
      }
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") setShowShareText(true);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      openSnackbar({ text: "Đã sao chép phiếu đặt vé.", type: "success" });
    } catch {
      openSnackbar({
        text: "Hãy chọn và sao chép nội dung phiếu bên dưới.",
        type: "warning",
      });
    }
  }

  return (
    <div className="pn-receipt-footer space-y-3">
      <div className="pn-receipt-stub">
        <div>
          <p className="pn-receipt-stub-title">Đối chiếu vé</p>
          <p className="pn-meta">
            {verificationUrl
              ? "Quét QR để kiểm tra mã đơn, chuyến, chỗ và trạng thái trên hệ thống."
              : "Nhà xe đối chiếu mã đơn trên hệ thống."}
          </p>
          {verificationUrl && (
            <a
              className="pn-link"
              href={verificationUrl}
              target="_blank"
              rel="noreferrer"
            >
              Mở trang đối chiếu
            </a>
          )}
        </div>
        {qrImage && (
          <img
            className="pn-receipt-qr"
            src={qrImage}
            alt={`QR đối chiếu vé ${booking.code}`}
            width={128}
            height={128}
          />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          className="pn-button pn-button-primary"
          type="button"
          disabled={downloading}
          onClick={() => void download()}
        >
          {downloading ? "Đang tạo PDF…" : "Tải PDF"}
        </button>
        <button
          className="pn-button border border-solid border-[#c8d7e8] text-primary"
          type="button"
          onClick={() => void share()}
        >
          Chia sẻ
        </button>
      </div>
      {inZalo && !showShareText && (
        <button
          type="button"
          className="pn-link"
          onClick={() => setShowShareText(true)}
        >
          Sao chép để gửi qua ứng dụng khác
        </button>
      )}
      {showShareText && (
        <div className="space-y-2">
          <label className="pn-field">
            <span>Nội dung để gửi qua Zalo, Messenger hoặc ứng dụng khác</span>
            <textarea
              readOnly
              rows={5}
              value={text}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <button type="button" className="pn-link" onClick={() => void copy()}>
            Sao chép nội dung
          </button>
        </div>
      )}
    </div>
  );
}
