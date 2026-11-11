import { Button, Icon, Sheet } from "zmp-ui";
import { copy } from "@/constants/copy";

const text = copy.checkout.zaloConsent;

/**
 * Giải thích vì sao cần tên và số điện thoại Zalo trước khi Zalo hiện hộp xin quyền
 * (Thỏa thuận Zalo Mini App 5.3.3: nêu rõ mục đích, chỉ gọi API số điện thoại sau khi khách đồng ý).
 * Luôn có lựa chọn tự nhập vì đặt vé không bắt buộc dùng số Zalo.
 */
export function ZaloConsentSheet({
  visible,
  onAccept,
  onManual,
}: {
  visible: boolean;
  onAccept: () => void;
  onManual: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onManual} autoHeight title={text.title}>
      <div className="flex flex-col gap-4 px-4 pb-6">
        <ul className="flex flex-col gap-3">
          {[
            { icon: "zi-user", label: text.nameLabel, reason: text.nameReason },
            { icon: "zi-call", label: text.phoneLabel, reason: text.phoneReason },
          ].map((row) => (
            <li key={row.label} className="flex items-start gap-3">
              <Icon icon={row.icon as "zi-user"} className="text-primary" />
              <div>
                <div className="text-small-m">{row.label}</div>
                <div className="text-xsmall text-text-secondary">
                  {row.reason}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xxsmall text-text-secondary">{text.note}</p>
        <Button fullWidth onClick={onAccept}>
          {text.accept}
        </Button>
        <Button fullWidth variant="tertiary" onClick={onManual}>
          {text.manual}
        </Button>
      </div>
    </Sheet>
  );
}
