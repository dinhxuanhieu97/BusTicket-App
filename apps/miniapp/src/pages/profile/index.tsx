import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon, Modal } from "zmp-ui";
import { Notice } from "@/components/common/notice";
import { clearSavedInfo, type ClearResult } from "@/stores/clear-saved-info";
import { copy } from "@/constants/copy";
import { useProfile } from "@/stores/profile.store";
import { useMyBookings } from "@/stores/my-bookings.store";
import { bookingService } from "@/services/booking/booking.api";
import { isValidVnMobile } from "@/utils/phone";

export default function ProfilePage() {
  const profile = useProfile();
  const latestBooking = useMyBookings((s) => s.bookings[0]);
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [eraseInBookings, setEraseInBookings] = useState(false);
  const [removeBookings, setRemoveBookings] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState<ClearResult | null>(null);
  const nameError = touched && !name.trim();
  const phoneError = touched && !isValidVnMobile(phone);
  useEffect(() => {
    if (
      !latestBooking ||
      !profile.bookingPrefill ||
      name ||
      phone ||
      profile.name ||
      profile.phone
    )
      return;
    let active = true;
    void bookingService.contact(latestBooking.code, latestBooking.accessToken)
      .then(({ name, phone }) => {
        const current = useProfile.getState();
        if (!active || current.name || current.phone || !current.save(name, phone)) return;
        setName(name);
        setPhone(phone);
      })
      .catch(() => {
        // Người dùng vẫn có thể nhập tay khi đơn cũ không còn truy cập được.
      });
    return () => { active = false; };
  }, [latestBooking, name, phone, profile.name, profile.phone, profile.bookingPrefill]);
  const clearText = copy.profile.clear;
  const clearAll = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      setCleared(await clearSavedInfo({ eraseInBookings, removeBookings }));
    } finally {
      setClearing(false);
    }
    setName("");
    setPhone("");
    setTouched(false);
    setSaved(false);
    setConfirmClear(false);
    setEraseInBookings(false);
    setRemoveBookings(false);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (profile.save(name, phone)) {
      setName(name.trim());
      setPhone(phone.trim());
      setSaved(true);
    }
  };
  return (
    <div className="pn-page">
      <div className="pn-card pn-profile-menu">
        <Link className="pn-menu-link" to="/passengers">
          {copy.passengers.title}
          <span aria-hidden="true">→</span>
        </Link>
        <Link className="pn-menu-link" to="/support">
          {copy.support.title}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="pn-profile-intro">
        <h2>{copy.profile.heading}</h2>
        <p className="pn-meta">{copy.profile.hint}</p>
      </div>
      <form className="pn-card pn-profile-fields" onSubmit={submit} noValidate>
        <label className="pn-field">
          <span>{copy.profile.name}</span>
          <input
            name="name"
            autoComplete="name"
            maxLength={120}
            required
            value={name}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? "profile-name-error" : undefined}
            placeholder={copy.checkout.namePlaceholder}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
          {nameError && (
            <p className="pn-field-error" id="profile-name-error">
              {copy.checkout.nameRequired}
            </p>
          )}
        </label>
        <label className="pn-field">
          <span>{copy.profile.phone}</span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={30}
            required
            value={phone}
            aria-invalid={!!phoneError}
            aria-describedby={phoneError ? "profile-phone-error" : undefined}
            placeholder={copy.checkout.phonePlaceholder}
            onChange={(e) => {
              setPhone(e.target.value);
              setSaved(false);
            }}
          />
          {phoneError && (
            <p className="pn-field-error" id="profile-phone-error">
              {copy.checkout.phoneInvalid}
            </p>
          )}
        </label>
        <button className="pn-button pn-button-primary pn-button-form" type="submit">
          {copy.profile.save}
        </button>
        {saved && (
          <p className="pn-available" role="status">
            {copy.profile.saved}
          </p>
        )}
      </form>
      <p className="pn-meta">{copy.profile.localNotice}</p>
      <section className="pn-card pn-profile-clear" aria-labelledby="profile-clear-heading">
        <h3 id="profile-clear-heading">{clearText.heading}</h3>
        <p className="pn-meta">{clearText.intro}</p>
        <button
          type="button"
          className="pn-button pn-button-danger"
          onClick={() => {
            setCleared(null);
            setConfirmClear(true);
          }}
        >
          <Icon icon="zi-delete" aria-hidden="true" />
          {clearText.open}
        </button>
        {cleared && <ClearOutcome result={cleared} />}
      </section>
      <Modal
        visible={confirmClear}
        title={clearText.title}
        onClose={() => !clearing && setConfirmClear(false)}
        actions={[
          { text: clearText.cancel, close: true, disabled: clearing },
          {
            // Nút trong modal chia đôi bề ngang nên đổi chữ lúc đang xóa không làm xô hàng nút.
            text: clearing ? clearText.clearing : clearText.confirm,
            danger: true,
            disabled: clearing,
            onClick: () => void clearAll(),
          },
        ]}
      >
        <p className="pn-meta">{clearText.body}</p>
        <label className="pn-check">
          <input
            type="checkbox"
            checked={eraseInBookings}
            disabled={clearing}
            onChange={(e) => setEraseInBookings(e.target.checked)}
          />
          <span>
            {clearText.eraseInBookings}
            <small className="pn-meta">{clearText.eraseInBookingsHint}</small>
          </span>
        </label>
        <label className="pn-check">
          <input
            type="checkbox"
            checked={removeBookings}
            disabled={clearing}
            onChange={(e) => setRemoveBookings(e.target.checked)}
          />
          <span>
            {clearText.removeBookings}
            <small className="pn-meta">{clearText.removeBookingsHint}</small>
          </span>
        </label>
      </Modal>
    </div>
  );
}

function ClearOutcome({ result }: { result: ClearResult }) {
  const navigate = useNavigate();
  const text = copy.profile.clear;
  return (
    <>
      <Notice tone="success">
        {result.erased > 0 ? text.doneWithBookings(result.erased) : text.done}
      </Notice>
      {result.kept.length > 0 && (
        <Notice
          tone="warning"
          action={{ label: text.contact, onClick: () => navigate("/support") }}
        >
          {text.kept(result.kept.length)}
        </Notice>
      )}
      {result.failed > 0 && <Notice tone="error">{text.failed(result.failed)}</Notice>}
    </>
  );
}
