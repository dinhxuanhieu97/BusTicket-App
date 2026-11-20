import { CalendarClock, Droplets, Thermometer, Wind } from 'lucide-react';
import { home, rooms } from '../data/mock';
import { useHome } from '../lib/home-store';
import { Card, CardHeader } from '../components/ui/Card';
import { Dial } from '../components/ui/Dial';
import { PageHeader } from '../components/ui/PageHeader';
import { Segmented } from '../components/ui/Segmented';
import { StatCard } from '../components/ui/StatCard';
import { modeOptions, modeTag } from './Overview';

const schedule = [
  { time: '06:30', label: 'Thức dậy', temp: 27 },
  { time: '08:00', label: 'Vắng nhà', temp: 29 },
  { time: '17:30', label: 'Về nhà', temp: 26 },
  { time: '23:00', label: 'Ngủ', temp: 26.5 },
];

export function Climate() {
  const { setpoint, setSetpoint, mode, setMode } = useHome();
  return (
    <>
      <PageHeader title="Khí hậu" subtitle={`Trong nhà 26° · ngoài trời ${home.outsideTemp}° · độ ẩm trung bình 59%`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Thermometer} label="Trung bình trong nhà" value="26" unit="°C" foot="Thấp hơn ngoài trời 1°" spark={[27, 26.8, 26.5, 26.2, 26, 26]} sparkColor="var(--cool)" />
        <StatCard icon={Droplets} label="Độ ẩm" value="59" unit="%" foot="Phòng ngủ cao nhất · 55%" spark={[62, 61, 60, 59, 59, 59]} sparkColor="var(--info)" fillSpark={false} />
        <StatCard icon={Wind} label="Chất lượng không khí" value="Tốt" foot="PM2.5 · 12 µg/m³" spark={[18, 16, 15, 14, 12, 12]} sparkColor="var(--ok)" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Điều hòa chính" subtitle="Áp dụng cho các phòng đang bật" />
          <Dial value={setpoint} onChange={setSetpoint} mode={modeTag[mode]} caption="Trong nhà 26°" />
          <Segmented className="mt-5 w-full flex-nowrap" label="Chế độ điều hòa" options={modeOptions} value={mode} onChange={setMode} accent />
        </Card>
        <div className="grid gap-4">
          <Card>
            <CardHeader title="Theo phòng" subtitle="Nhiệt độ và độ ẩm hiện tại" />
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {rooms.map((r) => {
                const pct = Math.round(((r.temp - 20) / 12) * 100);
                return (
                  <div key={r.id} className="rounded-[18px] border border-line bg-fg/[0.03] p-4">
                    <div className="flex justify-between text-sm"><span className="font-semibold">{r.name}</span><span className="text-muted">{r.humidity}%</span></div>
                    <div className="mt-2 text-3xl font-semibold tracking-tight">{r.temp.toLocaleString('vi-VN')}°</div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line-strong"><div className="h-full rounded-full bg-gradient-to-r from-cool to-warn" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card>
            <CardHeader title="Lịch trong ngày" subtitle="Ngày thường · Thứ Hai đến Thứ Sáu" action={<CalendarClock className="size-5 text-muted" aria-hidden />} />
            <ol className="relative grid gap-0 sm:grid-cols-4">
              {schedule.map((s) => (
                <li key={s.time} className="border-t border-line py-3 sm:border-t-0 sm:border-l sm:px-4 sm:py-0 first:sm:border-l-0 first:sm:pl-0">
                  <div className="text-sm text-muted">{s.time}</div>
                  <div className="font-semibold">{s.label}</div>
                  <div className="text-2xl font-semibold text-cool">{s.temp.toLocaleString('vi-VN')}°</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
