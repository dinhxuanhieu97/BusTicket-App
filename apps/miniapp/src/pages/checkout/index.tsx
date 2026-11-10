import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Input, Spinner, useSnackbar } from "zmp-ui";
import { copy, errorMessage } from "@/constants/copy";
import { APIError } from "@/lib/api-error";
import {
  useCreateHold,
  useStartPhoneVerification,
  useVerifyPhone,
} from "@/services/booking/booking.mutations";
import { useSeatMap } from "@/services/trip/trip.queries";
import { useBookingDraft } from "@/stores/booking-draft.store";
import { usePassengers } from "@/stores/passengers.store";
import { useProfile } from "@/stores/profile.store";
import { useMyBookings } from "@/stores/my-bookings.store";
import {
  useZaloContact,
  ZaloPermissionDenied,
} from "@/services/zalo/zalo-contact";
import { formatCurrency } from "@/utils/format";
import { isValidVnMobile } from "@/utils/phone";
import {
  estimateDeposit,
  selectedCodes,
  toHoldItems,
  unitDeposit,
} from "@/utils/seat-selection";
import { formatVnDate, formatVnTime } from "@/utils/time";

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const draft = useBookingDraft();
  const passengers = usePassengers((s) => s.passengers);
  const saveBooking = useMyBookings((s) => s.save);
  const [outbound, inbound] = draft.pair ?? [];
  const first = outbound ?? draft.trip;
  const firstId = first?.id ?? draft.tripId;
  const selection = outbound
    ? (draft.selections[outbound.id] ?? {})
    : draft.selection;
  const returnSelection = inbound ? (draft.selections[inbound.id] ?? {}) : {};
  const { data: map, isLoading } = useSeatMap(firstId ?? "");
  const returnMap = useSeatMap(inbound?.id ?? "");
  const createHold = useCreateHold();
  const zaloContact = useZaloContact();
  const [touched, setTouched] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  // Đã giữ chỗ xong và đang chuyển sang trang đơn: không được tự chuyển về trang chủ khi lựa chọn vừa bị xóa.
  const finished = useRef(false);

  useEffect(() => {
    const current = useBookingDraft.getState();
    const profile = useProfile.getState();
    const defaults = {
      ...(!current.contactName && profile.name
        ? { contactName: profile.name }
        : {}),
      ...(!current.contactPhone && profile.phone
        ? { contactPhone: profile.phone }
        : {}),
    };
    if (Object.keys(defaults).length) current.setContact(defaults);
  }, []);

  if (finished.current) return null;
  if (
    !firstId ||
    !selectedCodes(selection).length ||
    (inbound && !selectedCodes(returnSelection).length)
  )
    return <Navigate to="/" replace />;
  if (returnMap.isError && inbound)
    return (
      <button className="pn-link" onClick={() => void returnMap.refetch()}>
        Tải lại thông tin lượt về
      </button>
    );
  if (isLoading || !map || (inbound && !returnMap.data)) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  const tripId = firstId;
  const codes = selectedCodes(selection);
  const secondLeg = inbound && returnMap.data
    ? { selection: returnSelection, map: returnMap.data }
    : undefined;
  const estimate = estimateDeposit({ selection, map }, secondLeg);
  const nameError =
    touched && !draft.contactName.trim()
      ? copy.checkout.nameRequired
      : undefined;
  const phoneError =
    touched && !isValidVnMobile(draft.contactPhone)
      ? copy.checkout.phoneInvalid
      : undefined;
  const tokenValid =
    !!draft.phoneToken &&
    draft.phoneToken.phone === draft.contactPhone &&
    new Date(draft.phoneToken.expiresAt).getTime() > Date.now();
  const needsOtp =
    (map.booking.requiresPhoneOtp || otpRequested) && !tokenValid;

  const fillFromZalo = () => {
    zaloContact.mutate(undefined, {
      onSuccess: (c) => {
        const name = c.name || draft.contactName;
        draft.setContact({
          ...(c.name ? { contactName: c.name } : {}),
          contactPhone: c.phone,
        });
        // Số do Zalo xác nhận: dùng thay OTP khi nhà xe bật chế độ cao điểm.
        draft.setPhoneToken({
          phone: c.phone,
          token: c.phoneToken,
          expiresAt: c.expiresAt,
        });
        if (name.trim()) useProfile.getState().save(name, c.phone);
        openSnackbar({ text: copy.checkout.zaloFilled, type: "success" });
      },
      onError: (e) =>
        openSnackbar({
          text:
            e instanceof ZaloPermissionDenied
              ? copy.checkout.zaloDenied
              : errorMessage(e),
          type: "warning",
        }),
    });
  };

  const submit = () => {
    setTouched(true);
    if (
      !draft.contactName.trim() ||
      !isValidVnMobile(draft.contactPhone) ||
      needsOtp
    )
      return;
    const idempotencyKey = draft.ensureIdempotencyKey();
    createHold.mutate(
      {
        request: {
          tripId,
          contactName: draft.contactName.trim(),
          contactPhone: draft.contactPhone.trim(),
          ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
          items: toHoldItems(selection),
          ...(inbound
            ? {
                returnLeg: {
                  tripId: inbound.id,
                  items: toHoldItems(returnSelection),
                },
              }
            : {}),
        },
        idempotencyKey,
        phoneToken: tokenValid ? draft.phoneToken!.token : undefined,
      },
      {
        onSuccess: (result, { request }) => {
          useProfile.getState().save(request.contactName, request.contactPhone);
          saveBooking({
            code: result.booking.code,
            accessToken: result.accessToken,
            tripId,
            tripName: map.trip.name,
            departAt: map.trip.departAt,
            ...(inbound
              ? {
                  inbound: {
                    tripId: inbound.id,
                    route:
                      inbound.route.origin + " → " + inbound.route.destination,
                    departAt: inbound.departAt,
                    seatCodes: selectedCodes(returnSelection),
                  },
                }
              : {}),
            route: first
              ? `${first.route.origin} → ${first.route.destination}`
              : "",
            seatCodes: codes,
            createdAt: new Date().toISOString(),
          });
          finished.current = true;
          navigate(`/booking/${result.booking.code}`, { replace: true });
          draft.completed();
        },
        onError: (error) => {
          openSnackbar({ text: errorMessage(error), type: "error" });
          if (!(error instanceof APIError)) return;
          if (error.code === "SEAT_UNAVAILABLE")
            navigate(
              "/trip/" +
                ((error.details as { tripId?: string })?.tripId ===
                  inbound?.id && inbound
                  ? inbound.id
                  : tripId) +
                (inbound ? "?roundTrip=1" : ""),
              { replace: true },
            );
          if (error.code === "PHONE_VERIFICATION_REQUIRED")
            setOtpRequested(true);
        },
      },
    );
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col gap-3 px-4 pb-32 pt-2">
        <section className="flex flex-col gap-2 rounded-xl bg-elevation-01 p-4">
          <div className="text-normal-sb">
            {inbound && "Lượt đi · "}
            {map.trip.name}
          </div>
          <div className="text-xxsmall text-text-secondary">
            {formatVnTime(map.trip.departAt)} ·{" "}
            {formatVnDate(map.trip.departAt)} · {map.vehicle.name}
          </div>
          <div className="mt-2 text-small-m">{copy.checkout.summary}</div>
          {codes.map((code) => {
            const unitSel = selection[code];
            const deposit = unitDeposit(map, code, unitSel);
            return (
              <div key={code} className="flex justify-between text-xxsmall">
                <span className="capitalize">
                  {map.layout.unit} {code}
                  {unitSel.occupancy > 1 ? ` · ${unitSel.occupancy} người` : ""}
                  {unitSel.infantCount > 0
                    ? ` · ${unitSel.infantCount} trẻ em`
                    : ""}
                </span>
                {deposit !== null && (
                  <span>{copy.seats.deposit} {formatCurrency(deposit)}</span>
                )}
              </div>
            );
          })}
          {inbound && (
            <div className="mt-2">
              <strong>
                Lượt về · {inbound.route.origin} → {inbound.route.destination}
              </strong>
              <p>
                {formatVnDate(inbound.departAt)} ·{" "}
                {formatVnTime(inbound.departAt)}
              </p>
              <p>
                Chỗ {selectedCodes(returnSelection).join(", ")}
              </p>
            </div>
          )}
          {estimate !== null && (
            <div className="mt-1 flex justify-between border-divider01 border-t pt-2 text-small-m">
              <span>{copy.seats.totalDeposit}</span>
              <span className="text-primary">{formatCurrency(estimate)}</span>
            </div>
          )}
          <div className="text-xxxsmall text-text-secondary">
            {copy.seats.estimateHint}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Button
            variant="secondary"
            size="medium"
            loading={zaloContact.isPending}
            disabled={zaloContact.isPending}
            onClick={fillFromZalo}
          >
            {zaloContact.isPending
              ? copy.checkout.usingZalo
              : copy.checkout.useZalo}
          </Button>
          {passengers.length > 0 && (
            <label className="pn-field">
              <span>{copy.passengers.choose}</span>
              <select
                value=""
                onChange={(e) => {
                  const person = passengers.find(
                    (p) => p.id === e.target.value,
                  );
                  if (person)
                    draft.setContact({
                      contactName: person.name,
                      contactPhone: person.phone,
                    });
                }}
              >
                <option value="">{copy.passengers.choose}</option>
                {passengers.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.phone}
                  </option>
                ))}
              </select>
            </label>
          )}
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
          <label className="pn-field">
            <span>Ghi chú cho nhà xe (không bắt buộc)</span>
            <textarea
              maxLength={500}
              rows={3}
              value={draft.note}
              placeholder="Ví dụ: Đăng ký hỗ trợ vé khám bệnh hiểm nghèo hoặc điểm đón trên lộ trình nhà xe"
              onChange={(event) => draft.setNote(event.target.value)}
            />
          </label>
        </section>

        {needsOtp && <OtpSection phone={draft.contactPhone} />}
        {tokenValid && (
          <div className="text-xxsmall text-green500">
            ✓ {copy.checkout.otpVerified}
          </div>
        )}

        <div className="text-xxsmall text-text-secondary">
          {copy.checkout.holdNotice(map.booking.holdMinutes)}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-divider01 border-t bg-white px-4 pb-5 pt-3">
        <Button
          fullWidth
          loading={createHold.isPending}
          disabled={createHold.isPending || needsOtp}
          onClick={submit}
        >
          {createHold.isPending
            ? copy.checkout.submitting
            : copy.checkout.submit}
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
        onSuccess: (r) =>
          setPhoneToken({ phone, token: r.phoneToken, expiresAt: r.expiresAt }),
        onError: (e) => openSnackbar({ text: errorMessage(e), type: "error" }),
      },
    );
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-primary/30 p-4">
      <div className="text-small-m">{copy.checkout.otpTitle}</div>
      <div className="text-xxsmall text-text-secondary">
        {copy.checkout.otpHint}
      </div>
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
          <Button
            size="medium"
            loading={verify.isPending}
            disabled={code.length !== 6}
            onClick={confirm}
          >
            {copy.checkout.otpVerify}
          </Button>
        ) : (
          <Button
            size="medium"
            variant="secondary"
            loading={start.isPending}
            onClick={send}
          >
            {copy.checkout.otpSend}
          </Button>
        )}
      </div>
      {verificationId && (
        <button
          type="button"
          className="self-start text-xxsmall text-primary"
          onClick={send}
          disabled={start.isPending}
        >
          {copy.checkout.otpSend}
        </button>
      )}
    </section>
  );
}
