import { Activity, Receipt, Sun, TrendingUp, Zap } from 'lucide-react';
import { useState } from 'react';
import { energyMonth, energyToday, energyWeek, fmt, hours, rooms, solarToday, tariffVndPerKwh, vnd } from '../data/mock';
import { useHome, useHomeStats } from '../lib/home-store';
import { categoryIcons } from '../components/icons';
import { AreaChart } from '../components/ui/AreaChart';
import { Card, CardHeader } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { Segmented } from '../components/ui/Segmented';
import { Delta, LiveDot, StatCard } from '../components/ui/StatCard';
import { Toggle } from '../components/ui/Toggle';

type Range = 'day' | 'week' | 'month';

export function Energy() {
  const { devices, toggleDevice } = useHome();
  const { watts } = useHomeStats();
  const [range, setRange] = useState<Range>('day');
  const data = {
    day: { labels: hours.map((h) => `${h}:00`), used: energyToday, solar: solarToday, title: 'Hôm nay', sub: 'kWh mỗi 2 giờ, nét đứt là điện mặt trời' },
    week: { labels: energyWeek.labels, used: energyWeek.used, solar: energyWeek.solar, title: 'Tuần này', sub: 'kWh mỗi ngày' },
    month: { labels: energyMonth.labels, used: energyMonth.used, solar: energyMonth.solar, title: 'Tháng này', sub: 'kWh mỗi ngày' },
  }[range];
  const totalUsed = data.used.reduce((a, b) => a + b, 0);
  const totalSolar = data.solar.reduce((a, b) => a + b, 0);
  const peakIdx = data.used.indexOf(Math.max(...data.used));
  const top = [...devices].filter((d) => d.online).sort((a, b) => b.watts - a.watts).slice(0, 6);
  const maxW = Math.max(1, ...top.map((d) => d.watts));

  return (
    <>
      <PageHeader title="Năng lượng" subtitle={`${watts.toLocaleString('vi-VN')} W đang dùng · 15,8 kWh từ đầu ngày`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Zap} label="Đang tiêu thụ" value={watts.toLocaleString('vi-VN')} unit="W" foot={<><LiveDot />trực tiếp</>} spark={energyToday.slice(5)} sparkColor="var(--warn)" />
        <StatCard icon={Activity} label="Đã dùng hôm nay" value="15,8" unit="kWh" foot={<><Delta value="↑ 12%" good={false} />so với hôm qua</>} spark={energyToday} sparkColor="var(--info)" />
        <StatCard icon={Receipt} label="Tiền điện tháng này" value="1,28" unit="tr ₫" foot="446 kWh · 20 ngày" spark={[30, 42, 38, 51, 47, 58, 62]} sparkColor="var(--ok)" />
        <StatCard icon={TrendingUp} label="Trung bình mỗi ngày" value="15,3" unit="kWh" foot={<><Delta value="↓ 6%" />so với tháng trước</>} spark={[16.4, 16, 15.8, 15.6, 15.3]} sparkColor="var(--accent)" fillSpark={false} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title={data.title}
            subtitle={data.sub}
            action={<Segmented label="Khoảng thời gian" value={range} onChange={setRange} options={[{ value: 'day', label: 'Ngày' }, { value: 'week', label: 'Tuần' }, { value: 'month', label: 'Tháng' }]} />}
          />
          <AreaChart labels={data.labels} unit="kWh" series={[{ name: 'Đã dùng', values: data.used, color: 'var(--accent)' }, { name: 'Mặt trời', values: data.solar, color: 'var(--ok)', dashed: true }]} />
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Đã dùng', `${fmt(totalUsed)} kWh`],
              ['Từ mái nhà', `${Math.round((totalSolar / totalUsed) * 100)}%`],
              ['Cao điểm', `${data.labels[peakIdx]}`],
              ['Chi phí ước tính', vnd(Math.round(Math.max(0, totalUsed - totalSolar) * tariffVndPerKwh / 100) * 100)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[16px] border border-line bg-fg/[0.03] px-4 py-3">
                <div className="text-xs text-muted">{k}</div>
                <div className="mt-1 font-semibold">{v}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Đang tiêu thụ nhiều nhất" subtitle="Bấm công tắc để tắt nhanh" />
          <ul>
            {top.map((d) => {
              const Icon = categoryIcons[d.category];
              return (
                <li key={d.id} className="flex items-center gap-3 border-t border-line py-3 first:border-t-0">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-fg/[0.03] text-accent"><Icon className="size-4" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{d.name}</div>
                    <div className="text-xs text-muted">{rooms.find((r) => r.id === d.roomId)?.name} · {d.watts.toLocaleString('vi-VN')} W</div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line-strong"><div className="h-full rounded-full bg-accent" style={{ width: `${(d.watts / maxW) * 100}%` }} /></div>
                  </div>
                  <Toggle on={d.on} onChange={() => toggleDevice(d.id)} label={`Bật tắt ${d.name}`} />
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex items-center gap-3 rounded-[16px] bg-ok/10 p-4 text-sm text-ok">
            <Sun className="size-5 shrink-0" aria-hidden />Pin mặt trời đang sạc 72%, đủ chạy điều hòa phòng ngủ khoảng 4 giờ.
          </div>
        </Card>
      </div>
    </>
  );
}
