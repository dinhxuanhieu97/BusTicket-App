import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { copy } from "@/constants/copy";
import { useProfile } from "@/stores/profile.store";
import { isValidVnMobile } from "@/utils/phone";

export default function ProfilePage() {
  const profile = useProfile();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);
  const nameError = touched && !name.trim();
  const phoneError = touched && !isValidVnMobile(phone);
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
        <button className="pn-button pn-button-primary" type="submit">
          {copy.profile.save}
        </button>
        {saved && (
          <p className="pn-available" role="status">
            {copy.profile.saved}
          </p>
        )}
      </form>
      <p className="pn-meta">{copy.profile.localNotice}</p>
    </div>
  );
}
