import { useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Input, Spinner, useSnackbar } from "zmp-ui";
import { copy, errorMessage } from "@/constants/copy";
import { APIError } from "@/lib/api-error";
import { useCreateHold, useStartPhoneVerification, useVerifyPhone } from "@/services/booking/booking.mutations";
import { useSeatMap } from "@/services/trip/trip.queries";
import { useBookingDraft } from "@/stores/booking-draft.store";
import { useMyBookings } from "@/stores/my-bookings.store";
import { formatCurrency } from "@/utils/format";
import { isValidVnMobile } from "@/utils/phone";
import { estimateTotal, selectedCodes, toHoldItems, unitPrice } from "@/utils/seat-selection";
import { formatVnDate, formatVnTime } from "@/utils/time";

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const draft = useBookingDraft();
  const saveBooking = useMyBookings((s) => s.save);
  const { data: map, isLoading } = useSeatMap(draft.tripId ?? "");
  const createHold = useCreateHold();
  const [touched, setTouched] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  // Đã giữ chỗ xong và đang chuyển sang trang đơn: không được tự chuyển về trang chủ khi lựa chọn vừa bị xóa.
  const finished = useRef(false);

  if (finished.current) return null;
  if (!draft.tripId || selectedCodes(draft.selection).length === 0) return <Navigate to="/" replace />;
  if (isLoading || !map) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  const tripId = draft.tripId;
  const codes = selectedCodes(draft.selection);
  const estimate = estimateTotal(draft.selection, map.seats, map.fares);
  const nameError = touched && !draft.contactName.trim() ? copy.checkout.nameRequired : undefined;
  const phoneError = touched && !isValidVnMobile(draft.contactPhone) ? copy.checkout.phoneInvalid : undefined;
  const tokenValid =
    !!draft.phoneToken &&
    draft.phoneToken.phone === draft.contactPhone &&
    new Date(draft.phoneToken.expiresAt).getTime() > Date.now();
  const needsOtp = (map.booking.requiresPhoneOtp || otpRequested) && !tokenValid;

  const submit = () => {
    setTouched(true);
    if (!draft.contactName.trim() || !isValidVnMobile(draft.contactPhone) || needsOtp) return;
    const idempotencyKey = draft.ensureIdempotencyKey();
    createHold.mutate(
      {
        request: {
          tripId,
          contactName: draft.contactName.trim(),
          contactPhone: draft.contactPhone.trim(),
          items: toHoldItems(draft.selection),
        },
        idempotencyKey,
        phoneToken: tokenValid ? draft.phoneToken!.token : undefined,
      },
      {
        onSuccess: (result) => {
          saveBooking({
            code: result.booking.code,
            accessToken: result.accessToken,
            tripId,
            tripName: map.trip.name,
            departAt: map.trip.departAt,
            route: draft.trip ? `${draft.trip.route.origin} → ${draft.trip.route.destination}` : "",
            seatCodes: result.booking.items.map((i) => i.seatCode),
            createdAt: new Date().toISOString(),
          });
          finished.current = true;
          navigate(`/booking/${result.booking.code}`, { replace: true });
          draft.completed();
        },
        onError: (error) => {
          openSnackbar({ text: errorMessage(error), type: "error" });
          if (!(error instanceof APIError)) return;
          if (error.code === "SEAT_UNAVAILABLE") navigate(`/trip/${tripId}`, { replace: true });
          if (error.code === "PHONE_VERIFICATION_REQUIRED") setOtpRequested(true);
        },
      },
    );
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col gap-3 px-4 pb-32 pt-2">
        <section className="flex flex-col gap-2 rounded-xl bg-elevation-01 p-4">
          <div className="text-normal-sb">{map.trip.name}</div>
          <div className="text-xxsmall text-text-secondary">
            {formatVnTime(map.trip.departAt)} · {formatVnDate(map.trip.departAt)} · {map.vehicle.name}
          </div>
          <div className="mt-2 text-small-m">{copy.checkout.summary}</div>
          {codes.map((code) => {
            const seat = map.seats.find((s) => s.code === code);
            const unitSel = draft.selection[code];
            const price = seat ? unitPrice(map.fares, seat.floor, unitSel.occupancy) : null;
            return (
              <div key={code} className="flex justify-between text-xxsmall">
                <span className="capitalize">
                  {map.layout.unit} {code}
                  {unitSel.occupancy > 1 ? ` · ${unitSel.occupancy} người` : ""}
                  {unitSel.infantCount > 0 ? ` · ${unitSel.infantCount} trẻ em` : ""}
                </span>
                <span>{price === null ? "—" : formatCurrency(price)}</span>
              </div>
            );
          })}
          <div className="mt-1 flex justify-between border-t border-divider01 pt-2 text-small-m">
            <span>{copy.seats.estimate}</span>
            <span className="text-primary">{estimate === null ? "—" : formatCurrency(estimate)}</span>
          </div>
          <div className="text-xxxsmall text-text-secondary">{copy.seats.estimateHint}</div>
        </section>

        <section className="flex flex-col gap-3">
          <Input
            label={copy.checkout.contactName}
            placeholder={copy.checkout.namePlaceholder}
            value={draft.contactName}
            maxLength={120}
            status={nameError ? "error" : undefined}
            errorText={nameError}
            onChange={(e) => draft.setContact({ contactName: e.target.value })}
          />
          <Input
            label={copy.checkout.contactPhone}
            placeholder={copy.checkout.phonePlaceholder}
            type="text"
            inputMode="tel"
            value={draft.contactPhone}
            maxLength={20}
            status={phoneError ? "error" : undefined}
            errorText={phoneError}
            onChange={(e) => draft.setContact({ contactPhone: e.target.value })}
          />
        </section>

        {needsOtp && <OtpSection phone={draft.contactPhone} />}
        {tokenValid && <div className="text-xxsmall text-green500">✓ {copy.checkout.otpVerified}</div>}

        <div className="text-xxsmall text-text-secondary">{copy.checkout.holdNotice(map.booking.holdMinutes)}</div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-divider01 bg-white px-4 pb-5 pt-3">
        <Button fullWidth loading={createHold.isPending} disabled={createHold.isPending || needsOtp} onClick={submit}>
          {createHold.isPending ? copy.checkout.submitting : copy.checkout.submit}
        </Button>
      </div>
    </div>
  );
}

/** Chế độ cao điểm: gửi OTP qua SMS → nhập mã → nhận `phoneToken` gửi kèm khi giữ chỗ. */
function OtpSection({ phone }: { phone: string }) {
  const { openSnackbar } = useSnackbar();
  const setPhoneToken = useBookingDraft((s) => s.setPhoneToken);
  const start = useStartPhoneVerification();
  const verify = useVerifyPhone();
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const send = () => {
    if (!isValidVnMobile(phone)) {
      openSnackbar({ text: copy.checkout.phoneInvalid, type: "warning" });
      return;
    }
    start.mutate(phone, {
      onSuccess: (r) => setVerificationId(r.verificationId),
      onError: (e) => openSnackbar({ text: errorMessage(e), type: "error" }),
    });
  };

  const confirm = () => {
    if (!verificationId) return;
    verify.mutate(
      { verificationId, code: code.trim() },
      {
        onSuccess: (r) => setPhoneToken({ phone, token: r.phoneToken, expiresAt: r.expiresAt }),
        onError: (e) => openSnackbar({ text: errorMessage(e), type: "error" }),
      },
    );
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-primary/30 p-4">
      <div className="text-small-m">{copy.checkout.otpTitle}</div>
      <div className="text-xxsmall text-text-secondary">{copy.checkout.otpHint}</div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            placeholder={copy.checkout.otpCode}
            inputMode="numeric"
            maxLength={6}
            value={code}
            disabled={!verificationId}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        {verificationId ? (
          <Button size="medium" loading={verify.isPending} disabled={code.length !== 6} onClick={confirm}>
            {copy.checkout.otpVerify}
          </Button>
        ) : (
          <Button size="medium" variant="secondary" loading={start.isPending} onClick={send}>
            {copy.checkout.otpSend}
          </Button>
        )}
      </div>
      {verificationId && (
        <button type="button" className="self-start text-xxsmall text-primary" onClick={send} disabled={start.isPending}>
          {copy.checkout.otpSend}
        </button>
      )}
    </section>
  );
}
