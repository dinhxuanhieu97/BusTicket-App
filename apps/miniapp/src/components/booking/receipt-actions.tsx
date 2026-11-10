import { useState } from "react";
import { downloadFile, openShareSheet } from "zmp-sdk/apis";
import { useSnackbar } from "zmp-ui";
import { config } from "@/config";
import type { SavedBooking } from "@/stores/my-bookings.store";
import type { BookingView } from "@/types/api.types";
import { receiptLines } from "@/utils/booking-receipt";
import { formatVnDate, formatVnTime } from "@/utils/time";

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
      const pdf = createBookingPdf(config.operatorName, [
        ...receiptLines(saved, booking),
        "",
        `Xuất phiếu lúc ${formatVnTime(now)} · ${formatVnDate(now)}`,
      ]);
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
    <div className="mt-4 space-y-3">
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
