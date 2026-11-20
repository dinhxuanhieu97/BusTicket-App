import { AlertTriangle, BatteryLow, BookOpen, Compass, Info, LifeBuoy, MessageCircle, Sun } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { home } from '../data/mock';
import { useTheme } from '../lib/theme';
import { useToast } from '../lib/toast';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { Toggle } from '../components/ui/Toggle';

const notifications = [
  { id: 1, icon: BatteryLow, tone: 'bg-danger/15 text-danger', title: 'Khóa cổng ngoài sắp hết pin', body: 'Pin còn 8%, khóa đã mất kết nối lúc 18:40.', time: '1 giờ trước', unread: true },
  { id: 2, icon: AlertTriangle, tone: 'bg-warn/15 text-warn', title: 'Điện hôm nay cao hơn 12%', body: 'Điều hòa phòng khách chạy lâu hơn bình thường 2 giờ.', time: '2 giờ trước', unread: true },
  { id: 3, icon: Sun, tone: 'bg-ok/15 text-ok', title: 'Pin mặt trời đầy 100%', body: 'Lúc 13:20, điện dư được đẩy lên lưới.', time: '6 giờ trước', unread: true },
  { id: 4, icon: Info, tone: 'bg-info/15 text-info', title: 'Có bản cập nhật cho bộ điều khiển', body: 'Phiên bản 2.4 cải thiện tốc độ phản hồi đèn.', time: 'Hôm qua', unread: false },
];

export function Notifications() {
  const [items, setItems] = useState(notifications);
  return (
    <>
      <PageHeader title="Thông báo" subtitle={`${items.filter((n) => n.unread).length} chưa đọc`} actions={<Button onClick={() => setItems((xs) => xs.map((x) => ({ ...x, unread: false })))}>Đánh dấu đã đọc</Button>} />
      <Card>
        <ul>
          {items.map((n) => (
            <li key={n.id} className="flex gap-4 border-t border-line py-4 first:border-t-0">
              <span className={cn('grid size-11 shrink-0 place-items-center rounded-[13px]', n.tone)}><n.icon className="size-5" aria-hidden /></span>
              <div className="flex-1">
                <div className="flex items-center gap-2 font-semibold">{n.title}{n.unread && <span className="size-2 rounded-full bg-accent" aria-label="chưa đọc" />}</div>
                <p className="text-sm text-muted">{n.body}</p>
              </div>
              <span className="shrink-0 text-xs text-muted">{n.time}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function SettingRow({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="font-semibold">{title}</div><div className="text-sm text-muted">{hint}</div></div>
      {children}
    </div>
  );
}

const inputCls = 'w-full rounded-[12px] border border-line-strong bg-fg/[0.03] px-3 py-2.5 text-sm outline-none focus:border-accent sm:w-64';

export function Settings() {
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const [prefs, setPrefs] = useState({ push: true, email: false, away: true, guest: false });
  const flip = (k: keyof typeof prefs) => setPrefs((p) => ({ ...p, [k]: !p[k] }));
  return (
    <>
      <PageHeader title="Cài đặt" subtitle="Thông tin ngôi nhà, thông báo và giao diện" actions={<Button variant="primary" onClick={() => toast('Đã lưu cài đặt')}>Lưu thay đổi</Button>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Ngôi nhà" />
          <SettingRow title="Tên nhà" hint="Hiển thị trên ứng dụng và thông báo"><input className={inputCls} defaultValue={home.name} /></SettingRow>
          <SettingRow title="Địa chỉ" hint="Dùng cho thời tiết và tự động hóa theo vị trí"><input className={inputCls} defaultValue="Quận 2, TP.HCM" /></SettingRow>
          <SettingRow title="Giá điện" hint="Tính chi phí ước tính trên trang Năng lượng"><input className={inputCls} defaultValue="2.870 ₫/kWh" /></SettingRow>
        </Card>
        <Card>
          <CardHeader title="Thông báo & giao diện" />
          <SettingRow title="Thông báo đẩy" hint="Cảnh báo an ninh và thiết bị mất kết nối"><Toggle on={prefs.push} onChange={() => flip('push')} label="Thông báo đẩy" /></SettingRow>
          <SettingRow title="Báo cáo qua email" hint="Tóm tắt năng lượng mỗi tuần"><Toggle on={prefs.email} onChange={() => flip('email')} label="Báo cáo qua email" /></SettingRow>
          <SettingRow title="Tự bật chế độ vắng nhà" hint="Khi tất cả thành viên rời khỏi nhà"><Toggle on={prefs.away} onChange={() => flip('away')} label="Tự bật chế độ vắng nhà" /></SettingRow>
          <SettingRow title="Giao diện tối" hint="Áp dụng trên trình duyệt này"><Toggle on={theme === 'dark'} onChange={toggle} label="Giao diện tối" /></SettingRow>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Thành viên" subtitle="Người có quyền điều khiển ngôi nhà" action={<Button onClick={() => toast('Đã tạo lời mời')}>Mời thành viên</Button>} />
          <div className="grid gap-3 sm:grid-cols-3">
            {home.members.map((m) => (
              <div key={m.initials} className="flex items-center gap-3 rounded-[18px] border border-line bg-fg/[0.03] p-4">
                <span className={`grid size-11 place-items-center rounded-full bg-gradient-to-br ${m.color} font-bold text-stone-800`}>{m.initials}</span>
                <div><div className="font-semibold">{m.name}</div><div className="text-xs text-muted">{m.home ? 'Đang ở nhà' : 'Đang vắng'}</div></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

export function Help() {
  const topics = [
    { icon: Compass, title: 'Bắt đầu', body: 'Thêm phòng, ghép nối thiết bị đầu tiên và mời thành viên.' },
    { icon: BookOpen, title: 'Ngữ cảnh & tự động hóa', body: 'Gom nhiều thao tác thành một nút bấm hoặc chạy theo lịch.' },
    { icon: LifeBuoy, title: 'Xử lý sự cố', body: 'Thiết bị mất kết nối, khóa hết pin, camera không lên hình.' },
    { icon: MessageCircle, title: 'Liên hệ hỗ trợ', body: 'Gửi yêu cầu và nhận phản hồi trong giờ làm việc.' },
  ];
  return (
    <>
      <PageHeader title="Trợ giúp" subtitle="Hướng dẫn nhanh cho các tác vụ thường gặp" />
      <div className="grid gap-4 sm:grid-cols-2">
        {topics.map((t) => (
          <Card key={t.title}>
            <span className="mb-4 grid size-12 place-items-center rounded-[14px] bg-accent/15 text-accent"><t.icon className="size-5" aria-hidden /></span>
            <h3 className="text-lg font-semibold">{t.title}</h3>
            <p className="mt-1 text-muted">{t.body}</p>
          </Card>
        ))}
      </div>
    </>
  );
}

export function NotFound() {
  return (
    <Card className="py-16 text-center">
      <div className="text-5xl font-semibold">404</div>
      <p className="mt-2 text-muted">Không tìm thấy trang này.</p>
      <Link to="/" className="mt-6 inline-flex rounded-[14px] bg-accent px-4 py-2.5 font-medium text-accent-fg">Về Tổng quan</Link>
    </Card>
  );
}
