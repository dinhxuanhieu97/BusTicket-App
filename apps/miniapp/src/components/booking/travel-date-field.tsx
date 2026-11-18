import { useRef, useState } from "react";
import { Calendar, Sheet } from "zmp-ui";
import { formatVnDate } from "@/utils/time";
import {
  calendarYmd,
  monthTitle,
  ymdToCalendarDate,
} from "@/utils/travel-date";

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/**
 * Ô chọn ngày đi/về. Không dùng `<input type="date">` của điện thoại: bộ chọn gốc hiện theo lịch máy
 * (ví dụ Phật lịch "2569 BE") và có webview bỏ qua `min`. Lịch tự vẽ luôn dương lịch, khóa mọi ngày trước `min`.
 */
export function TravelDateField({
  label,
  value,
  min,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  /** Ngày sớm nhất được chọn, `YYYY-MM-DD` giờ VN. */
  min: string;
  placeholder: string;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // zmp-ui Calendar tự gọi onSelect khi vừa dựng (từ defaultValue/value); chỉ nhận lựa chọn sau khi khách chạm lịch.
  const touched = useRef(false);
  const minDate = ymdToCalendarDate(min);
  const selected = value && value >= min ? ymdToCalendarDate(value) : minDate;
  return (
    <div className="pn-field">
      <span id={`${label}-label`}>{label}</span>
      <button
        type="button"
        className="pn-date-display"
        aria-labelledby={`${label}-label`}
        aria-haspopup="dialog"
        onClick={() => {
          touched.current = false;
          setOpen(true);
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M7 3v5m10-5v5M3 11h18" />
        </svg>
        <span>
          {value ? formatVnDate(`${value}T00:00:00+07:00`) : placeholder}
        </span>
      </button>
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        autoHeight
        title={label}
      >
        <div
          className="px-4 pb-6"
          onPointerDownCapture={() => {
            touched.current = true;
          }}
        >
          {/* Dựng lịch khi mở để `defaultValue` luôn là ngày đang chọn; không truyền `value` (zmp-ui chọn lại mỗi lần đổi). */}
          {open && (
            <Calendar
              locale="vi-VN"
              startOfWeek={1}
              defaultValue={selected}
              dayOfWeekNameRender={(day) => WEEKDAYS[day]}
              disabledDate={(d) => calendarYmd(d) < min}
              headerRender={(_origin, { value: shown, onPrev, onNext }) => {
                const atMin =
                  shown.getFullYear() === minDate.getFullYear() &&
                  shown.getMonth() <= minDate.getMonth();
                return (
                  <div className="pn-cal-header">
                    <button
                      type="button"
                      aria-label="Tháng trước"
                      disabled={atMin}
                      onClick={onPrev}
                    >
                      ‹
                    </button>
                    <strong>{monthTitle(shown)}</strong>
                    <button
                      type="button"
                      aria-label="Tháng sau"
                      onClick={onNext}
                    >
                      ›
                    </button>
                  </div>
                );
              }}
              onSelect={(d, info) => {
                if (!touched.current) return;
                if (info?.source && info.source !== "date") return;
                const ymd = calendarYmd(d);
                if (ymd < min) return;
                onChange(ymd);
                setOpen(false);
              }}
            />
          )}
        </div>
      </Sheet>
    </div>
  );
}
