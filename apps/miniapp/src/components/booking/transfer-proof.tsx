import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, useSnackbar } from "zmp-ui";
import { copy, errorMessage } from "@/constants/copy";
import { bookingService } from "@/services/booking/booking.api";
import { bookingKeys } from "@/services/booking/booking.queries";
import type { BookingView } from "@/types/api.types";
import { PROOF_MAX_COUNT, prepareProofImage } from "@/utils/proof-image";
import { formatVnTime } from "@/utils/time";

/**
 * "Tôi đã chuyển khoản": khách chọn ảnh chụp lệnh chuyển để nhà xe đối chiếu. Ảnh không tự xác nhận đơn;
 * lần gửi đầu, API gia hạn giữ chỗ (tối đa 2 giờ, không quá giờ đóng bán) trong lúc nhà xe kiểm tra.
 */
export function TransferProof({ booking, accessToken }: { booking: BookingView; accessToken: string }) {
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = booking.paymentProofCount ?? 0;
  const claimed = !!booking.transferClaimedAt;
  const full = count >= PROOF_MAX_COUNT;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const image = await prepareProofImage(file);
      if (!image) {
        setError(copy.proof.unreadable);
        return;
      }
      const result = await bookingService.submitPaymentProof(booking.code, accessToken, image);
      qc.setQueryData(bookingKeys.detail(booking.code), result.booking);
      openSnackbar({ text: result.duplicate ? copy.proof.duplicate : copy.proof.sent, type: "success" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <section className="pn-card" aria-labelledby="transfer-proof-heading">
      <h2 id="transfer-proof-heading" className="pn-section-title">
        {copy.proof.title}
      </h2>
      {claimed ? (
        <p>
          {copy.proof.claimed(count)}
          {booking.holdExpiresAt ? ` ${copy.proof.heldUntil(formatVnTime(booking.holdExpiresAt))}` : ""}
        </p>
      ) : (
        <p className="pn-meta">{copy.proof.hint}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[var(--pn-danger)]">
          {error}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {!full && (
        <Button
          className="mt-3"
          fullWidth
          variant={claimed ? "secondary" : "primary"}
          loading={busy}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? copy.proof.sending : claimed ? copy.proof.addMore : copy.proof.action}
        </Button>
      )}
      {full && <p className="pn-meta mt-2">{copy.proof.limit(PROOF_MAX_COUNT)}</p>}
    </section>
  );
}
