import { Link } from "react-router-dom";
import { config } from "@/config";
import { copy } from "@/constants/copy";

export default function SupportPage() {
  const phone = config.supportPhone.replace(/[^\d+]/g, "");
  return (
    <div className="pn-page">
      <section className="pn-card">
        <h2 className="pn-section-title">{copy.brand.name}</h2>
        {phone ? (
          <>
            <p className="pn-meta">{copy.support.hint}</p>
            <a
              className="pn-button pn-button-primary mt-4"
              href={`tel:${phone}`}
            >
              {copy.support.call} {config.supportPhone}
            </a>
          </>
        ) : (
          <p className="pn-meta">{copy.support.unavailable}</p>
        )}
        <Link className="pn-link mt-4" to="/my-bookings">
          {copy.myBookings.title} →
        </Link>
      </section>
    </div>
  );
}
