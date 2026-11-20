import { ArrowLeft, Droplets, Power, Thermometer } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { rooms } from '../data/mock';
import { useHome } from '../lib/home-store';
import { useToast } from '../lib/toast';
import { cn } from '../lib/cn';
import { roomIcons } from '../components/icons';
import { DeviceCard } from '../components/DeviceCard';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { NotFound } from './Misc';

export function Rooms() {
  const { devices, setRoomPower } = useHome();
  const toast = useToast();
  return (
    <>
      <PageHeader title="Phòng" subtitle={`${rooms.length} khu vực · ${devices.length} thiết bị`} />
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {rooms.map((r) => {
          const Icon = roomIcons[r.icon];
          const ds = devices.filter((d) => d.roomId === r.id);
          const on = ds.filter((d) => d.on && d.online && d.category !== 'security').length;
          return (
            <section key={r.id} className="glass overflow-hidden rounded-[24px]">
              <Link to={`/rooms/${r.id}`} className={cn('relative block h-40 bg-gradient-to-br p-5 text-white', r.cover)}>
                <Icon className="absolute right-5 bottom-4 size-20 opacity-20" aria-hidden />
                <span className="rounded-lg bg-black/30 px-2 py-1 text-xs">{r.floor}</span>
                <div className="absolute bottom-5 left-5 text-2xl font-semibold">{r.name}</div>
              </Link>
              <div className="flex items-center gap-4 p-5">
                <div className="flex flex-1 flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                  <span className="inline-flex items-center gap-1.5"><Thermometer className="size-4" aria-hidden />{r.temp.toLocaleString('vi-VN')}°</span>
                  <span className="inline-flex items-center gap-1.5"><Droplets className="size-4" aria-hidden />{r.humidity}%</span>
                  <span>{on}/{ds.length} đang bật</span>
                </div>
                <Button variant={on ? 'soft' : 'ghost'} onClick={() => { setRoomPower(r.id, !on); toast(`${on ? 'Đã tắt' : 'Đã bật'} thiết bị ${r.name.toLowerCase()}`); }}>
                  <Power className="size-4" aria-hidden />{on ? 'Tắt hết' : 'Bật'}
                </Button>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

export function RoomDetail() {
  const { id } = useParams();
  const { devices, setRoomPower } = useHome();
  const room = rooms.find((r) => r.id === id);
  if (!room) return <NotFound />;
  const Icon = roomIcons[room.icon];
  const ds = devices.filter((d) => d.roomId === room.id);
  const on = ds.filter((d) => d.on && d.online);
  return (
    <>
      <section className={cn('relative overflow-hidden rounded-[24px] bg-gradient-to-br p-6 text-white shadow-panel sm:p-8', room.cover)}>
        <Icon className="absolute -right-4 -bottom-6 size-48 opacity-15" aria-hidden />
        <Link to="/rooms" className="inline-flex items-center gap-1.5 text-sm text-white/75 hover:text-white"><ArrowLeft className="size-4" />Tất cả phòng</Link>
        <h2 className="mt-3 text-4xl font-semibold tracking-tight">{room.name}</h2>
        <p className="mt-1 text-white/75">{room.floor} · {room.temp.toLocaleString('vi-VN')}° · độ ẩm {room.humidity}% · {on.length}/{ds.length} thiết bị đang bật</p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => setRoomPower(room.id, false)} className="rounded-[14px] bg-white/15 px-4 py-2.5 text-sm backdrop-blur hover:bg-white/25">Tắt hết</button>
          <button type="button" onClick={() => setRoomPower(room.id, true)} className="rounded-[14px] bg-white px-4 py-2.5 text-sm font-medium text-stone-900 hover:bg-white/90">Bật hết</button>
        </div>
      </section>
      <Card>
        <CardHeader title="Thiết bị trong phòng" subtitle={`${ds.length} thiết bị · ${on.reduce((s, d) => s + d.watts, 0).toLocaleString('vi-VN')} W đang dùng`} />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
          {ds.map((d) => <DeviceCard key={d.id} device={d} showRoom={false} />)}
        </div>
      </Card>
    </>
  );
}
