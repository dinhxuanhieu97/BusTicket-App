import { WifiOff } from 'lucide-react';
import type { Device } from '../data/mock';
import { rooms } from '../data/mock';
import { useHome } from '../lib/home-store';
import { cn } from '../lib/cn';
import { categoryIcons } from './icons';
import { RangeSlider } from './ui/RangeSlider';
import { Toggle } from './ui/Toggle';

export function DeviceCard({ device, showRoom = true }: { device: Device; showRoom?: boolean }) {
  const { toggleDevice, setLevel } = useHome();
  const Icon = device.online ? categoryIcons[device.category] : WifiOff;
  const active = device.on && device.online;
  const room = rooms.find((r) => r.id === device.roomId);
  return (
    <div
      className={cn(
        'flex min-h-[176px] flex-col rounded-[20px] border p-4 transition',
        active ? 'border-accent/40 bg-gradient-to-b from-accent/12 to-transparent' : 'border-line bg-fg/[0.03]',
        !device.online && 'border-danger/30',
      )}
    >
      <div className="mb-4 flex items-start justify-between">
        <span className={cn('grid size-11 place-items-center rounded-[13px]', active ? 'bg-accent text-accent-fg' : device.online ? 'bg-line-strong text-muted' : 'bg-danger/15 text-danger')}>
          <Icon className="size-5" aria-hidden />
        </span>
        <Toggle on={active} onChange={() => toggleDevice(device.id)} label={`${active ? 'Tắt' : 'Bật'} ${device.name}`} disabled={!device.online} />
      </div>
      {showRoom && <div className="text-xs text-muted">{room?.name}</div>}
      <div className="font-semibold">{device.name}</div>
      <div className="mt-auto pt-3">
        {!device.online ? (
          <div className="text-xs text-danger">Mất kết nối · kiểm tra pin</div>
        ) : device.level !== undefined ? (
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="w-16 shrink-0">{active ? `${device.level}%` : 'Tắt'}</span>
            <RangeSlider value={device.level} onChange={(v) => setLevel(device.id, v)} label={`${device.levelLabel} ${device.name}`} />
          </div>
        ) : (
          <div className="text-xs text-muted">{active ? `${device.watts.toLocaleString('vi-VN')} W` : 'Tắt'}</div>
        )}
      </div>
    </div>
  );
}
