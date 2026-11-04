import { useNavigate } from "react-router-dom";
import { Button } from "zmp-ui";
import { BackIcon } from "../common/vectors";
import { BusIcon } from "../common/bus-icon";
import { copy, theme } from "@/constants/copy";

interface HeaderProps {
  title?: string;
  back?: boolean;
  position?: "fixed" | "sticky" | "static" | "relative";
}

export default function Header({ title, back, position = "sticky" }: HeaderProps) {
  const navigate = useNavigate();

  if (title) {
    return (
      <div
        className={`${position} header-margin left-0 top-0 z-10 flex h-12 w-full items-center gap-2 bg-background px-4 py-2`}
        style={{ color: theme.colors.text.primary }}
      >
        {back && (
          <Button
            className="w-fit bg-transparent p-1 active:bg-transparent"
            type="neutral"
            size="small"
            fullWidth
            onClick={() => navigate(-1)}
          >
            <BackIcon className="text-header_title text-text-primary" />
          </Button>
        )}
        <div className="truncate text-header_title">{title}</div>
      </div>
    );
  }

  return (
    <div className={`${position} header-margin left-0 top-0 z-10 flex h-12 w-full items-center gap-2 px-4 py-2`}>
      <BusIcon className="size-6 text-primary" />
      <div className="truncate text-header_title text-primary">{copy.brand.name}</div>
    </div>
  );
}
