import { useEffect, useId, useRef, useState } from "react";
import type { PlaceOption } from "@/utils/search-places";

/**
 * Small, keyboard-accessible listbox. Long destination names wrap instead of clipping.
 * Options with a `stop` are pickup/drop-off points shown indented under their place.
 */
export function RouteSelect({
  label,
  value,
  options,
  placeholder,
  onChange,
  stopLabel,
  fallbackLabel,
  alignEnd = false,
}: {
  label: string;
  value: string;
  options: PlaceOption[];
  placeholder: string;
  onChange: (option: PlaceOption | null) => void;
  /** "Điểm đón" / "Điểm trả": đọc kèm tên điểm cho trình đọc màn hình. */
  stopLabel: string;
  /** Tên hiển thị khi `value` chưa có trong `options`. */
  fallbackLabel?: string;
  alignEnd?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const values: (PlaceOption | null)[] = [null, ...options];
  const selected = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  return (
    <div
      className="pn-field pn-route-select"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      <span id={`${id}-label`}>{label}</span>
      <button
        type="button"
        ref={trigger}
        className="pn-select-trigger"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span id={`${id}-value`}>
          {selected ? (
            <>
              {selected.label}
              {selected.stop && (
                <small className="pn-select-place">{selected.place}</small>
              )}
            </>
          ) : (
            // Danh sách chưa tải xong hoặc điểm không còn bán: vẫn hiện tên đã chọn.
            fallbackLabel || placeholder
          )}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          stroke="currentColor"
          fill="none"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          id={id}
          className={`pn-select-options ${alignEnd ? "pn-select-end" : ""}`}
          role="listbox"
          aria-labelledby={`${id}-label`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            }
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
            );
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "ArrowDown"
                ? (index + 1) % buttons.length
                : event.key === "ArrowUp"
                  ? (index - 1 + buttons.length) % buttons.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : -1;
            if (next >= 0) {
              event.preventDefault();
              buttons[next].focus();
            }
          }}
        >
          {values.map((option) => {
            const current = (option?.value ?? "") === (selected?.value ?? "");
            return (
              <button
                role="option"
                type="button"
                tabIndex={current ? 0 : -1}
                aria-selected={current}
                aria-label={
                  option?.stop
                    ? `${stopLabel} ${option.label}, ${option.place}`
                    : undefined
                }
                className={option?.stop ? "pn-select-stop" : undefined}
                key={option?.value ?? ""}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                {option?.label ?? placeholder}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
