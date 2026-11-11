import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, useSnackbar } from "zmp-ui";
import { copy, errorMessage } from "@/constants/copy";
import { LoadingState } from "@/components/common/loading-state";
import { Notice } from "@/components/common/notice";
import { ZaloConsentSheet } from "@/components/booking/zalo-consent-sheet";
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
import {
  useZaloContact,
  ZaloPermissionDenied,
} from "@/services/zalo/zalo-contact";
import { formatCurrency } from "@/utils/format";
import type { BookingAttempt } from "@/utils/ids";
import { isValidVnMobile, normalizeVnMobile } from "@/utils/phone";
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
  const [outbound, inbound] = draft.pair ?? [];
  const first = outbound ?? draft.trip;
  const firstId = first?.id ?? draft.tripId;
  const selection = outbound
    ? (draft.selections[outbound.id] ?? {})
    : draft.selection;
  const returnSelection = inbound ? (draft.selections[inbound.id] ?? {}) : {};
  const outboundMap = useSeatMap(firstId ?? "");
  const map = outboundMap.data;
  const returnMap = useSeatMap(inbound?.id ?? "");
  const createHold = useCreateHold();
  const zaloContact = useZaloContact();
  const [consentOpen, setConsentOpen] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [holdError, setHoldError] = useState("");
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
  const failedLeg =
    !map && outboundMap.isError
      ? outboundMap
      : inbound && !returnMap.data && returnMap.isError
        ? returnMap
        : null;
  if (failedLeg)
    return (
      <div className="pn-page">
        <Notice
          tone="error"
          action={{
            label: copy.common.retry,
            onClick: () => void failedLeg.refetch(),
            disabled: failedLeg.isFetching,
          }}
        >
          <p className="font-semibold">
            {failedLeg === outboundMap
              ? copy.checkout.loadOutboundError
              : copy.checkout.loadInboundError}
          </p>
          <p>{errorMessage(failedLeg.error)}</p>
        </Notice>
      </div>
    );
  if (!map || (inbound && !returnMap.data))
    return <LoadingState label="Đang tải thông tin chuyến…" />;

  const tripId = firstId;
  const codes = selectedCodes(selection);
  const secondLeg =
    inbound && returnMap.data
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
    normalizeVnMobile(draft.phoneToken.phone) === normalizeVnMobile(draft.contactPhone) &&
    new Date(draft.phoneToken.expiresAt).getTime() > Date.now();
  const needsOtp =
    !tokenValid && (otpRequested || (map.booking.requiresPhoneOtp && !draft.holdAttempt));

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
        useProfile.getState().markZaloShared();
        if (name.trim()) useProfile.getState().save(name, c.phone);
        openSnackbar({
          text: c.name ? copy.checkout.zaloFilled : copy.checkout.zaloPhoneFilled,
          type: "success",
        });
      },
      onError: (e) => {
        // Từ chối số điện thoại nhưng vẫn cho tên: điền tên, khách nhập thêm số.
        if (e instanceof ZaloPermissionDenied && e.zaloName)
          draft.setContact({ contactName: e.zaloName });
      },
    });
  };

  /** Lần đầu: giải thích mục đích trước khi Zalo hiện hộp xin quyền. Đã từng chia sẻ: hỏi Zalo luôn. */
  const startZalo = () => {
    if (useProfile.getState().zaloShared) fillFromZalo();
    else setConsentOpen(true);
  };

  const submit = () => {
    setTouched(true);
    setHoldError("");
    if (
      !draft.contactName.trim() ||
      !isValidVnMobile(draft.contactPhone) ||
      needsOtp
    )
      return;
    let attempt: BookingAttempt;
    try {
      attempt = draft.ensureHoldAttempt();
    } catch {
      setHoldError("Thiết bị chưa hỗ trợ giữ chỗ an toàn. Vui lòng cập nhật Zalo hoặc dùng trình duyệt mới hơn.");
      return;
    }
    setOtpRequested(false);
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
        attempt,
        phoneToken: tokenValid ? draft.phoneToken!.token : undefined,
        receipt: {
          tripId,
          tripName: map.trip.name,
          departAt: map.trip.departAt,
          ...(inbound
            ? {
                inbound: {
                  tripId: inbound.id,
                  route: `${inbound.route.origin} → ${inbound.route.destination}`,
                  departAt: inbound.departAt,
                  seatCodes: selectedCodes(returnSelection),
                },
              }
            : {}),
          route: first ? `${first.route.origin} → ${first.route.destination}` : "",
          seatCodes: codes,
        },
      },
      {
        onSuccess: (result) => {
          finished.current = true;
          navigate(`/booking/${result.booking.code}`, { replace: true });
          draft.completed();
        },
        onError: (error, submission) => {
          if (error instanceof APIError && error.code === "SEAT_UNAVAILABLE") {
            openSnackbar({ text: errorMessage(error), type: "warning" });
            navigate(
              "/trip/" +
                ((error.details as { tripId?: string })?.tripId ===
                  inbound?.id && inbound
                  ? inbound.id
                  : tripId) +
                (inbound ? "?roundTrip=1" : ""),
              { replace: true },
            );
            return;
          }
          if (
            error instanceof APIError &&
            error.code === "PHONE_VERIFICATION_REQUIRED"
          ) {
            const current = useBookingDraft.getState();
            if (current.phoneToken?.token === submission.phoneToken) current.setPhoneToken(null);
            setOtpRequested(true);
            return;
          }
          setHoldError(errorMessage(error));
        },
      },
    );
  };

  return (
    <div className="pn-action-layout">
      <div className="pn-page pn-stack">
        <section className="pn-card flex flex-col gap-2">
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
                  <span>
                    {copy.seats.deposit} {formatCurrency(deposit)}
                  </span>
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
              <p>Chỗ {selectedCodes(returnSelection).join(", ")}</p>
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

        <section className="pn-card pn-fields">
          <Button
            variant="secondary"
            size="medium"
            loading={zaloContact.isPending}
            disabled={zaloContact.isPending}
            onClick={startZalo}
          >
            {zaloContact.isPending
              ? copy.checkout.usingZalo
              : copy.checkout.useZalo}
          </Button>
          {zaloContact.isError && (
            <Notice tone="warning">
              {zaloContact.error instanceof ZaloPermissionDenied
                ? zaloContact.error.zaloName
                  ? copy.checkout.zaloNameOnly
                  : copy.checkout.zaloDenied
                : copy.checkout.zaloError}
            </Notice>
          )}
          <ZaloConsentSheet
            visible={consentOpen}
            onAccept={() => {
              setConsentOpen(false);
              fillFromZalo();
            }}
            onManual={() => {
              setConsentOpen(false);
              nameInput.current?.focus();
            }}
          />
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
          <label className="pn-field">
            <span>{copy.checkout.contactName}</span>
            <input
              ref={nameInput}
              autoComplete="name"
              placeholder={copy.checkout.namePlaceholder}
              value={draft.contactName}
              maxLength={120}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? "checkout-name-error" : undefined}
              onChange={(e) =>
                draft.setContact({ contactName: e.target.value })
              }
            />
            {nameError && (
              <p className="pn-field-error" id="checkout-name-error">
                {nameError}
              </p>
            )}
          </label>
          <label className="pn-field">
            <span>{copy.checkout.contactPhone}</span>
            <input
              type="tel"
              autoComplete="tel"
              placeholder={copy.checkout.phonePlaceholder}
              value={draft.contactPhone}
              maxLength={20}
              aria-invalid={!!phoneError}
              aria-describedby={phoneError ? "checkout-phone-error" : undefined}
              onChange={(e) =>
                draft.setContact({ contactPhone: e.target.value })
              }
            />
            {phoneError && (
              <p className="pn-field-error" id="checkout-phone-error">
                {phoneError}
              </p>
            )}
          </label>
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

        {needsOtp && (
          <OtpSection key={draft.contactPhone} phone={draft.contactPhone} />
        )}
        {tokenValid && (
          <Notice tone="success">{copy.checkout.otpVerified}</Notice>
        )}

        <div className="text-xxsmall text-text-secondary">
          {copy.checkout.holdNotice(map.booking.holdMinutes)}
        </div>
      </div>

      <div className="pn-action-bar">
        <div className="pn-action-inner">
          {holdError && <Notice tone="error">{holdError}</Notice>}
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
    </div>
  );
}

/** Chế độ cao điểm: gửi OTP qua SMS → nhập mã → nhận `phoneToken` gửi kèm khi giữ chỗ. */
function OtpSection({ phone }: { phone: string }) {
  const setPhoneToken = useBookingDraft((s) => s.setPhoneToken);
  const start = useStartPhoneVerification();
  const verify = useVerifyPhone();
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [invalidPhone, setInvalidPhone] = useState(false);
  const error = start.error ?? verify.error;

  const send = () => {
    if (!isValidVnMobile(phone)) {
      setInvalidPhone(true);
      return;
    }
    setInvalidPhone(false);
    verify.reset();
    start.mutate(phone, {
      onSuccess: (r) => {
        setVerificationId(r.verificationId);
        setCode("");
      },
    });
  };

  const confirm = () => {
    if (!verificationId) return;
    start.reset();
    verify.mutate(
      { verificationId, code: code.trim() },
      {
        onSuccess: (r) =>
          setPhoneToken({ phone, token: r.phoneToken, expiresAt: r.expiresAt }),
      },
    );
  };

  return (
    <section className="pn-card pn-fields">
      <div className="text-small-m">{copy.checkout.otpTitle}</div>
      <div className="text-xxsmall text-text-secondary">
        {copy.checkout.otpHint}
      </div>
      <div className="flex items-end gap-2">
        <label className="pn-field min-w-0 flex-1">
          <span>{copy.checkout.otpCode}</span>
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            disabled={!verificationId}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        {verificationId ? (
          <Button
            size="medium"
            loading={verify.isPending}
            disabled={code.length !== 6 || verify.isPending || start.isPending}
            onClick={confirm}
          >
            {copy.checkout.otpVerify}
          </Button>
        ) : (
          <Button
            size="medium"
            variant="secondary"
            loading={start.isPending}
            disabled={start.isPending}
            onClick={send}
          >
            {copy.checkout.otpSend}
          </Button>
        )}
      </div>
      {invalidPhone && (
        <Notice tone="warning">{copy.checkout.phoneInvalid}</Notice>
      )}
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
      {start.isSuccess && !error && <Notice>{copy.checkout.otpSent}</Notice>}
      {verificationId && (
        <button
          type="button"
          className="pn-link justify-self-start"
          onClick={send}
          disabled={start.isPending || verify.isPending}
        >
          {copy.checkout.otpResend}
        </button>
      )}
    </section>
  );
}
