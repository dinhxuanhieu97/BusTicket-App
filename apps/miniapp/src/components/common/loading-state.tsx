import { Spinner } from "zmp-ui";
import { copy } from "@/constants/copy";

export function LoadingState({
  label = copy.common.loading,
}: {
  label?: string;
}) {
  return (
    <div className="pn-loading" role="status">
      <Spinner aria-hidden="true" />
      {label}
    </div>
  );
}
