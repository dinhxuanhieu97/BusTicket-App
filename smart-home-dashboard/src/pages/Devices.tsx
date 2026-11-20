import { LayoutGrid, List, Power, Search, WifiOff, Zap, Activity, Lightbulb } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { rooms, type DeviceCategory } from '../data/mock';
import { useHome, useHomeStats } from '../lib/home-store';
import { useToast } from '../lib/toast';
import { cn } from '../lib/cn';
import { categoryIcons, categoryLabels } from '../components/icons';
import { DeviceCard } from '../components/DeviceCard';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { Segmented } from '../components/ui/Segmented';
import { LiveDot, StatCard } from '../components/ui/StatCard';
import { Toggle } from '../components/ui/Toggle';

type Cat = 'all' | DeviceCategory;
type StateFilter = 'all' | 'on' | 'off' | 'offline';

export function Devices() {
  const { devices, allOff, toggleDevice } = useHome();
  const { onCount, watts, offline } = useHomeStats();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [cat, setCat] = useState<Cat>('all');
  const [room, setRoom] = useState('all');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const q = params.get('q') ?? '';

  const cats: Cat[] = ['all', 'light', 'climate', 'media', 'plug', 'security'];
  const list = useMemo(() => devices.filter((d) =>
    (cat === 'all' || d.category === cat) &&
    (room === 'all' || d.roomId === room) &&
    (stateFilter === 'all' || (stateFilter === 'offline' ? !d.online : stateFilter === 'on' ? d.on && d.online : !d.on && d.online)) &&
    (!q || `${d.name} ${rooms.find((r) => r.id === d.roomId)?.name}`.toLowerCase().includes(q.toLowerCase()))), [devices, cat, room, stateFilter, q]);

  return (
    <>
      <PageHeader
        title="Thiết bị"
        subtitle={`${devices.length} thiết bị trong nhà · ${offline.length} mất kết nối`}
        actions={<Button onClick={() => { allOff(); toast('Đã tắt mọi thiết bị (trừ an ninh)'); }}><Power className="size-4" aria-hidden />Tắt tất cả</Button>}
      />
      <div>
        <Segmented
          accent
          label="Loại thiết bị"
          value={cat}
          onChange={setCat}
          options={cats.map((c) => ({ value: c, label: c === 'all' ? 'Tất cả' : categoryLabels[c], count: c === 'all' ? devices.length : devices.filter((d) => d.category === c).length }))}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Lightbulb} label="Đang bật" value={onCount} unit={`/ ${devices.length}`} foot="Khắp các phòng" />
        <StatCard icon={Zap} label="Công suất" value={watts.toLocaleString('vi-VN')} unit="W" foot={<><LiveDot />trực tiếp</>} />
        <StatCard icon={Activity} label="Đã dùng hôm nay" value="3,1" unit="kWh" foot="≈ 8.900 ₫" />
        <StatCard icon={WifiOff} label="Mất kết nối" value={offline.length} unit="thiết bị" foot={offline[0] ? <span className="text-accent">{offline[0].name} · cần kiểm tra</span> : 'Tất cả đều trực tuyến'} />
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="flex w-full items-center gap-2.5 rounded-[14px] border border-line-strong bg-fg/[0.03] px-3 py-2.5 text-muted sm:w-72">
            <Search className="size-4" aria-hidden />
            <input
              value={q}
              onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
              placeholder="Tìm thiết bị…"
              aria-label="Tìm thiết bị"
              className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-faint"
            />
          </label>
          <div className="flex-1" />
          <Segmented label="Trạng thái" value={stateFilter} onChange={setStateFilter} options={[{ value: 'all', label: 'Tất cả' }, { value: 'on', label: 'Bật' }, { value: 'off', label: 'Tắt' }, { value: 'offline', label: 'Mất kết nối' }]} />
          <Segmented label="Kiểu hiển thị" value={view} onChange={setView} options={[{ value: 'grid', label: <LayoutGrid className="size-4" aria-label="Lưới" /> }, { value: 'list', label: <List className="size-4" aria-label="Danh sách" /> }]} />
        </div>
        <div className="mb-5 flex flex-wrap gap-2">
          {[{ id: 'all', name: 'Mọi phòng' }, ...rooms].map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRoom(r.id)}
              aria-pressed={room === r.id}
              className={cn('inline-flex items-center gap-2 rounded-[12px] border px-3 py-1.5 text-sm', room === r.id ? 'border-transparent bg-accent text-accent-fg' : 'border-line-strong bg-fg/[0.03]')}
            >
              {r.name}
              {r.id !== 'all' && <span className="text-xs opacity-60">{devices.filter((d) => d.roomId === r.id).length}</span>}
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <div className="py-14 text-center text-muted">Không có thiết bị khớp bộ lọc.</div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
            {list.map((d) => <DeviceCard key={d.id} device={d} />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line-strong text-left text-xs text-muted">
                <th className="px-3 py-2.5 font-medium">Thiết bị</th><th className="px-3 py-2.5 font-medium">Phòng</th><th className="px-3 py-2.5 font-medium">Loại</th><th className="px-3 py-2.5 text-right font-medium">Công suất</th><th className="px-3 py-2.5 font-medium">Bật/Tắt</th>
              </tr></thead>
              <tbody>
                {list.map((d) => {
                  const Icon = categoryIcons[d.category];
                  return (
                    <tr key={d.id} className="border-b border-line hover:bg-fg/[0.03]">
                      <td className="px-3 py-3"><span className="inline-flex items-center gap-2.5"><Icon className="size-4 text-muted" aria-hidden />{d.name}</span></td>
                      <td className="px-3 py-3 text-muted">{rooms.find((r) => r.id === d.roomId)?.name}</td>
                      <td className="px-3 py-3 text-muted">{categoryLabels[d.category]}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{d.online ? `${d.watts.toLocaleString('vi-VN')} W` : <span className="text-danger">Mất kết nối</span>}</td>
                      <td className="px-3 py-3"><Toggle on={d.on && d.online} onChange={() => toggleDevice(d.id)} label={`Bật tắt ${d.name}`} disabled={!d.online} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
