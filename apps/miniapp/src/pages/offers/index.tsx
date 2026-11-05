import { Link, useParams } from "react-router-dom";
import { config } from "@/config";
import { copy } from "@/constants/copy";
import { EmptyState } from "@/components/booking/empty-state";

const offers = [
  {
    id: "tet",
    image: "tet-travel.jpg",
    title: copy.banners.tetTitle,
    description: copy.banners.tetDescription,
  },
  {
    id: "care",
    image: "care-travel.jpg",
    title: copy.banners.careTitle,
    description: copy.banners.careDescription,
  },
];
export default function OffersPage() {
  const { slug } = useParams();
  const visible = slug ? offers.filter((offer) => offer.id === slug) : offers;
  if (!visible.length) return <EmptyState title={copy.offers.notFound} />;
  return (
    <div className="pn-page">
      {visible.map((offer) => (
        <article key={offer.id} className="pn-card pn-offer">
          <img
            src={`${import.meta.env.BASE_URL}images/${offer.image}`}
            alt=""
            width="1200"
            height="800"
          />
          <div className="pn-offer-content">
            <h2 className="pn-section-title">{offer.title}</h2>
            <p>{offer.description}</p>
            {slug ? (
              <>
                {offer.id === "care" && (
                  <ol className="pn-care-steps">
                    <li>
                      Liên hệ trước với nhà xe hoặc ghi “Đăng ký hỗ trợ vé khám
                      bệnh” trong mục ghi chú khi đặt vé trên app.
                    </li>
                    <li>
                      Đặt vé và thanh toán theo số tiền hiển thị trên đơn.
                    </li>
                    <li>
                      Khi lên xe, xuất trình giấy khám bệnh, giấy chỉ định của
                      bác sĩ hoặc giấy tờ chứng minh. Phụ xe kiểm tra giấy tờ để
                      nhà xe hoàn tiền vé.
                    </li>
                  </ol>
                )}
                {config.supportPhone && (
                  <a className="pn-link" href={`tel:${config.supportPhone}`}>
                    Gọi {config.supportPhone}
                  </a>
                )}
                <Link className="pn-link" to="/support">
                  {copy.support.title} →
                </Link>
                {
                  <Link className="pn-button pn-button-primary mt-3" to="/">
                    {copy.search.submit}
                  </Link>
                }
              </>
            ) : (
              <Link className="pn-link mt-3" to={`/offers/${offer.id}`}>
                {copy.offers.details} →
              </Link>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
