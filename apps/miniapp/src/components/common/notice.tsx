import type { ReactNode } from "react";

type NoticeTone = "info" | "warning" | "error" | "success";

export function Notice({
  tone = "info",
  children,
  action,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className="pn-notice" data-tone={tone}>
      <div role={tone === "error" ? "alert" : "status"}>{children}</div>
      {action && (
        <button
          type="button"
          className="pn-notice-action"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
