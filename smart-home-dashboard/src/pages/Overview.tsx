import { ArrowRight, Droplets, Lightbulb, Lock, Sun, Users, Zap, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import { home, rooms, scenes, energyToday, solarToday, fmt } from '../data/mock';
import { useHome, useHomeStats } from '../lib/home-store';
import { useToast } from '../lib/toast';
import { cn } from '../lib/cn';
import { roomIcons, sceneIcons, sceneTones } from '../components/icons';
import { Card, CardHeader } from '../components/ui/Card';
import { Dial } from '../components/ui/Dial';
import { Segmented } from '../components/ui/Segmented';
import { Delta, LiveDot, StatCard } from '../components/ui/StatCard';
import type { ClimateMode } from '../lib/home-store';

export const modeOptions: { value: ClimateMode; label: string }[] = [
  { value: 'cool', label: 'Mát' },
  { value: 'dry', label: 'Khô' },
  { value: 'fan', label: 'Quạt' },
  { value: 'auto', label: 'Tự động' },
];
export const modeTag: Record<ClimateMode, string> = { cool: 'LÀM MÁT', dry: 'HÚT ẨM', fan: 'QUẠT', auto: 'TỰ ĐỘNG' };

function greeting(h: number) {
  if (h < 11) return 'Chào buổi sáng';
  if (h < 14) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

export function Overview() {
  const { devices, setpoint, setSetpoint, mode, setMode, activeScene, runScene, armed } = useHome();
  const { onCount, watts } = useHomeStats();
  const toast = useToast();
  const atHome = home.members.filter((m) => m.home);
  const now = new Date();

  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted">{home.name} · {now.toLocaleDateString('vi-VN', { weekday: 'long' })}</p>
              <h2 className="mt-1 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-tight">{greeting(now.getHours())}, {home.owner.split(' ').pop()}</h2>
            </div>
            <div className="flex -space-x-2" aria-label={`${atHome.length} người đang ở nhà`}>
              {home.members.map((m) => (
                <span key={m.initials} title={`${m.name}${m.home ? ' · ở nhà' : ' · đang vắng'}`} className={cn('relative grid size-10 place-items-center rounded-full border-2 border-bg bg-gradient-to-br text-xs font-bold text-stone-800', m.color, !m.home && 'opacity-50 grayscale')}>
                  {m.initials}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 text-sm">
            <span className="inline-flex items-center gap-2 rounded-[12px] border border-line-strong px-3 py-2"><Users className="size-4" aria-hidden />{atHome.length}/{home.members.length} người ở nhà</span>
            <span className="inline-flex items-center gap-2 rounded-[12px] border border-line-strong px-3 py-2"><Lightbulb className="size-4" aria-hidden />{onCount} thiết bị đang bật</span>
            <span className="inline-flex items-center gap-2 rounded-[12px] border border-line-strong px-3 py-2"><Zap className="size-4" aria-hidden />{fmt(watts / 1000, 2)} kW</span>
            <span className={cn('inline-flex items-center gap-2 rounded-[12px] px-3 py-2', armed ? 'bg-ok/15 text-ok' : 'bg-accent/15 text-accent')}><Lock className="size-4" aria-hidden />{armed ? 'Đang bảo vệ' : 'Cửa chính đã khóa'}</span>
          </div>
          <p className="mt-5 max-w-3xl text-[16px] leading-relaxed text-fg/85">
            Điều hòa phòng khách giữ {setpoint.toLocaleString('vi-VN')}° đến 23:00 rồi chuyển chế độ ngủ. Máy rửa bát xong lúc 20:20, pin mặt trời đã phủ 61% điện hôm nay.
          </p>

          <div className="mt-6 mb-3 text-[11px] font-semibold tracking-[0.14em] text-faint uppercase">Ngữ cảnh</div>
          <div className="scrollbar-none -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible 2xl:grid-cols-3">
            {scenes.map((s) => {
              const Icon = sceneIcons[s.icon];
              const on = activeScene === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { runScene(on ? null : s.id); toast(on ? `Đã dừng "${s.name}"` : `Đang chạy ngữ cảnh "${s.name}"`); }}
                  aria-pressed={on}
                  className={cn('flex min-w-[78%] snap-start items-center gap-3.5 rounded-[18px] border p-3.5 text-left transition hover:-translate-y-0.5 sm:min-w-0', on ? 'border-accent/60 bg-accent/10' : 'border-line bg-fg/[0.03] hover:border-line-strong')}
                >
                  <span className={cn('grid size-12 shrink-0 place-items-center rounded-[14px]', sceneTones[s.tone])}><Icon className="size-5" aria-hidden /></span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{s.name}</span>
                    <span className="block truncate text-sm text-muted">{s.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Khí hậu" subtitle={`Cả nhà · ngoài trời ${home.outsideTemp}°`} action={<Link to="/climate" className="rounded-[12px] border border-line-strong px-3 py-1.5 text-sm hover:bg-fg/5">Lịch</Link>} />
          <Dial value={setpoint} onChange={setSetpoint} mode={modeTag[mode]} caption="Trong nhà 26°" />
          <Segmented className="mt-5 w-full flex-nowrap" label="Chế độ điều hòa" options={modeOptions} value={mode} onChange={setMode} />
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Zap} label="Đang tiêu thụ" value={watts.toLocaleString('vi-VN')} unit="W" foot={<><LiveDot />trực tiếp</>} spark={energyToday.slice(4)} sparkColor="var(--warn)" />
        <StatCard icon={Activity} label="Đã dùng hôm nay" value="15,8" unit="kWh" foot={<><Delta value="↑ 12%" good={false} />so với hôm qua</>} spark={[0.8, 1.2, 0.9, 1.6, 1.1, 1.9, 1.4, 2]} sparkColor="var(--info)" />
        <StatCard icon={Sun} label="Điện mặt trời" value="9,6" unit="kWh" foot="Pin lưu trữ 72%" spark={solarToday} sparkColor="var(--ok)" />
        <StatCard icon={Droplets} label="Độ ẩm" value="57" unit="%" foot="Dễ chịu trong khoảng 45–60%" spark={[55, 56, 58, 57, 59, 58, 57, 57]} sparkColor="var(--cool)" fillSpark={false} />
      </div>

      <Card>
        <CardHeader title="Phòng" subtitle={`${rooms.length} khu vực · 2 tầng và sân vườn`} action={<Link to="/rooms" className="inline-flex items-center gap-1 text-sm text-accent">Tất cả phòng <ArrowRight className="size-4" /></Link>} />
        <div className="scrollbar-none -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
          {rooms.map((r) => {
            const Icon = roomIcons[r.icon];
            const ds = devices.filter((d) => d.roomId === r.id);
            const on = ds.filter((d) => d.on && d.online).length;
            return (
              <Link key={r.id} to={`/rooms/${r.id}`} className="group w-[230px] shrink-0 snap-start overflow-hidden rounded-[20px] border border-line">
                <div className={cn('relative h-36 bg-gradient-to-br p-4 text-white', r.cover)}>
                  <Icon className="absolute right-4 bottom-3 size-16 opacity-20 transition group-hover:scale-110" aria-hidden />
                  <span className="rounded-lg bg-black/30 px-2 py-1 text-[11px]">{r.floor}</span>
                </div>
                <div className="bg-fg/[0.03] p-4">
                  <div className="font-semibold">{r.name}</div>
                  <div className="mt-1 flex gap-3 text-xs text-muted">
                    <span>{r.temp.toLocaleString('vi-VN')}°</span><span>{r.humidity}%</span><span>{on ? `${on} đang bật` : 'Tắt hết'}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </>
  );
}
