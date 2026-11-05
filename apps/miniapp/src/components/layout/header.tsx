import { useNavigate } from "react-router-dom";
import { BackIcon } from "../common/vectors";
import { copy } from "@/constants/copy";

interface HeaderProps {
  title?: string;
  back?: boolean;
  position?: "fixed" | "sticky" | "static" | "relative";
}

export default function Header({ title, back }: HeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="pn-header">
      <div className="pn-header-inner">
        {back && (
          <button
            type="button"
            className="pn-back"
            aria-label={copy.common.back}
            onClick={() =>
              window.history.state?.idx > 0
                ? navigate(-1)
                : navigate("/my-bookings")
            }
          >
            <BackIcon className="size-6" />
          </button>
        )}
        <div>
          <h1>{title || copy.brand.name}</h1>
          {!title && <small>{copy.nav.book}</small>}
        </div>
      </div>
    </header>
  );
}
