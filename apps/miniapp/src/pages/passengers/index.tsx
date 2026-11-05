import { useState, type FormEvent } from "react";
import { copy } from "@/constants/copy";
import { usePassengers, type Passenger } from "@/stores/passengers.store";
import { isValidVnMobile } from "@/utils/phone";

export default function PassengersPage() {
  const { passengers, save, remove } = usePassengers();
  const [editing, setEditing] = useState<Passenger | null>(null);
  const [touched, setTouched] = useState(false);
  const edit = (person: Passenger) => {
    setEditing(person);
    setTouched(false);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (editing && save(editing.name, editing.phone, editing.id || undefined))
      setEditing(null);
  };
  return (
    <div className="pn-page">
      <p className="pn-meta mb-4">{copy.profile.localNotice}</p>
      {editing ? (
        <form
          className="pn-card pn-profile-fields"
          onSubmit={submit}
          noValidate
        >
          <h2 className="pn-section-title">
            {editing.id ? copy.passengers.edit : copy.passengers.add}
          </h2>
          <label className="pn-field">
            <span>{copy.profile.name}</span>
            <input
              autoFocus
              required
              maxLength={120}
              value={editing.name}
              aria-invalid={touched && !editing.name.trim()}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            {touched && !editing.name.trim() && (
              <p className="pn-field-error">{copy.checkout.nameRequired}</p>
            )}
          </label>
          <label className="pn-field">
            <span>{copy.profile.phone}</span>
            <input
              type="tel"
              required
              maxLength={30}
              value={editing.phone}
              aria-invalid={touched && !isValidVnMobile(editing.phone)}
              onChange={(e) =>
                setEditing({ ...editing, phone: e.target.value })
              }
            />
            {touched && !isValidVnMobile(editing.phone) && (
              <p className="pn-field-error">{copy.checkout.phoneInvalid}</p>
            )}
          </label>
          <button className="pn-button pn-button-primary" type="submit">
            {copy.profile.save}
          </button>
          <button
            className="pn-link"
            type="button"
            onClick={() => setEditing(null)}
          >
            {copy.passengers.cancel}
          </button>
        </form>
      ) : (
        <button
          className="pn-button pn-button-primary mb-4"
          type="button"
          onClick={() => edit({ id: "", name: "", phone: "" })}
        >
          {copy.passengers.add}
        </button>
      )}
      {passengers.length === 0 && !editing && (
        <p className="pn-meta">{copy.passengers.empty}</p>
      )}
      {passengers.map((person) => (
        <article className="pn-card" key={person.id}>
          <h2 className="pn-section-title">{person.name}</h2>
          <p className="pn-meta">{person.phone}</p>
          <div className="pn-row">
            <button
              type="button"
              className="pn-link"
              onClick={() => edit(person)}
            >
              {copy.passengers.edit}
            </button>
            <button
              type="button"
              className="pn-link pn-delete"
              onClick={() => {
                if (window.confirm(copy.passengers.confirmDelete(person.name)))
                  remove(person.id);
              }}
            >
              {copy.passengers.remove}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
