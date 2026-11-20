import { AlertTriangle, CheckCircle2, Info, Lock, LockOpen, Shield, ShieldOff, Video, VideoOff } from 'lucide-react';
import { useState } from 'react';
import { cameras, securityEvents } from '../data/mock';
import { useHome } from '../lib/home-store';
import { useToast } from '../lib/toast';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Toggle } from '../components/ui/Toggle';

const initialLocks = [
  { id: 'l1', name: 'Cửa chính', locked: true, battery: 86, online: true },
  { id: 'l2', name: 'Cửa sau', locked: true, battery: 64, online: true },
  { id: 'l3', name: 'Cổng ngoài', locked: true, battery: 8, online: false },
  { id: 'l4', name: 'Cửa gara', locked: false, battery: 91, online: true },
];

export function Security() {
  const { armed, setArmed } = useHome();
  const toast = useToast();
  const [locks, setLocks] = useState(initialLocks);
  const unlocked = locks.filter((l) => !l.locked).length;
  const levelIcon = { ok: CheckCircle2, warn: AlertTriangle, info: Info } as const;
  const levelTone = { ok: 'text-ok bg-ok/12', warn: 'text-warn bg-warn/15', info: 'text-info bg-info/12' } as const;

  return (
    <>
      <section className={cn('glass flex flex-col gap-5 rounded-[24px] p-6 sm:flex-row sm:items-center sm:p-8', armed && 'border-ok/40')}>
        <span className={cn('grid size-16 shrink-0 place-items-center rounded-[20px]', armed ? 'bg-ok/15 text-ok' : 'bg-line-strong text-muted')}>
          {armed ? <Shield className="size-8" aria-hidden /> : <ShieldOff className="size-8" aria-hidden />}
        </span>
        <div className="flex-1">
          <h2 className="text-3xl font-semibold tracking-tight">{armed ? 'Đang bảo vệ' : 'Chưa bật bảo vệ'}</h2>
          <p className="mt-1 text-muted">{unlocked ? `${unlocked} cửa chưa khóa · ` : 'Mọi cửa đã khóa · '}{cameras.filter((c) => c.live).length}/{cameras.length} camera đang ghi</p>
        </div>
        <Button variant={armed ? 'ghost' : 'primary'} onClick={() => { setArmed(!armed); toast(armed ? 'Đã tắt chế độ bảo vệ' : 'Đã bật chế độ bảo vệ'); }}>
          {armed ? 'Tắt bảo vệ' : 'Bật bảo vệ'}
        </Button>
      </section>

      <Card>
        <CardHeader title="Camera" subtitle="Hình ảnh minh họa, kết nối luồng camera thật ở bản triển khai" />
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {cameras.map((c) => (
            <div key={c.id} className={cn('relative aspect-video overflow-hidden rounded-[18px] bg-gradient-to-br text-white', c.tone)}>
              <div className="absolute inset-0 grid place-items-center opacity-25">{c.live ? <Video className="size-14" aria-hidden /> : <VideoOff className="size-14" aria-hidden />}</div>
              <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-lg bg-black/40 px-2 py-1 text-[11px]">
                <span className={cn('size-1.5 rounded-full', c.live ? 'bg-red-500' : 'bg-white/50')} />{c.live ? 'TRỰC TIẾP' : 'TẮT'}
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3">
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-white/70">{c.status}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Khóa cửa" subtitle={`${locks.length} khóa thông minh`} />
          <ul>
            {locks.map((l) => (
              <li key={l.id} className="flex items-center gap-3 border-t border-line py-3 first:border-t-0">
                <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', !l.online ? 'bg-danger/15 text-danger' : l.locked ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn')}>
                  {l.locked ? <Lock className="size-4" aria-hidden /> : <LockOpen className="size-4" aria-hidden />}
                </span>
                <div className="flex-1">
                  <div className="font-semibold">{l.name}</div>
                  <div className={cn('text-xs', l.online ? 'text-muted' : 'text-danger')}>{l.online ? `${l.locked ? 'Đã khóa' : 'Đang mở'} · pin ${l.battery}%` : `Mất kết nối · pin ${l.battery}%`}</div>
                </div>
                <Toggle
                  on={l.locked}
                  disabled={!l.online}
                  label={`${l.locked ? 'Mở khóa' : 'Khóa'} ${l.name}`}
                  onChange={() => setLocks((ls) => ls.map((x) => (x.id === l.id ? { ...x, locked: !x.locked } : x)))}
                />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Nhật ký hôm nay" subtitle="Sự kiện an ninh mới nhất" />
          <ol>
            {securityEvents.map((e) => {
              const Icon = levelIcon[e.level];
              return (
                <li key={e.time + e.title} className="flex gap-3 border-t border-line py-3 first:border-t-0">
                  <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', levelTone[e.level])}><Icon className="size-4" aria-hidden /></span>
                  <div className="flex-1">
                    <div className="font-semibold">{e.title}</div>
                    <div className="text-xs text-muted">{e.detail}</div>
                  </div>
                  <time className="text-xs text-muted tabular-nums">{e.time}</time>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </>
  );
}
