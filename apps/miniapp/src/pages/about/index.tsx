import { config } from "@/config";
import { copy } from "@/constants/copy";
import { operatorInfoRows } from "@/utils/operator-info";

/** Thông tin nhà xe, kênh khiếu nại và chính sách quyền riêng tư (Thỏa thuận Zalo Mini App 5.3.3, 5.5). */
export default function AboutPage() {
  const rows = operatorInfoRows({
    brandName: copy.brand.name,
    phone: config.supportPhone,
    appVersion: config.appVersion,
    ...config.legal,
  });
  const contacts = rows.filter((row) => row.href);
  return (
    <div className="pn-page">
      <section className="pn-card pn-about">
        <h2 className="pn-section-title">{copy.about.operator}</h2>
        <dl className="pn-about-list">
          {rows.map((row) => (
            <div key={row.key}>
              <dt>{row.label}</dt>
              <dd>
                {row.href ? (
                  <a className="pn-link" href={row.href}>
                    {row.value}
                  </a>
                ) : (
                  row.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="pn-card pn-about">
        <h2 className="pn-section-title">{copy.about.complaint}</h2>
        <p className="pn-meta">
          {contacts.length
            ? copy.about.complaintHint
            : copy.about.complaintUnavailable}
        </p>
      </section>
      <section className="pn-card pn-about">
        <h2 className="pn-section-title">{copy.about.privacy}</h2>
        {copy.about.privacySections.map((section) => (
          <div key={section.heading} className="pn-about-block">
            <h3>{section.heading}</h3>
            <p>{section.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
