import { Clock, MapPin, Plus, Radar } from 'lucide-react';
import { useState } from 'react';
import type { Automation } from '../data/mock';
import { useHome } from '../lib/home-store';
import { useToast } from '../lib/toast';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { Segmented } from '../components/ui/Segmented';
import { Toggle } from '../components/ui/Toggle';

const kindMeta: Record<Automation['kind'], { label: string; icon: typeof Clock; tone: string }> = {
  time: { label: 'Theo giờ', icon: Clock, tone: 'bg-accent/15 text-accent' },
  sensor: { label: 'Cảm biến', icon: Radar, tone: 'bg-info/15 text-info' },
  presence: { label: 'Có người', icon: MapPin, tone: 'bg-ok/15 text-ok' },
};

export function Automations() {
  const { automations, toggleAutomation } = useHome();
  const toast = useToast();
  const [kind, setKind] = useState<'all' | Automation['kind']>('all');
  const list = automations.filter((a) => kind === 'all' || a.kind === kind);
  return (
    <>
      <PageHeader
        title="Tự động hóa"
        subtitle={`${automations.filter((a) => a.enabled).length}/${automations.length} quy tắc đang bật`}
        actions={<Button variant="primary" onClick={() => toast('Mở trình tạo quy tắc')}><Plus className="size-4" aria-hidden />Tạo quy tắc</Button>}
      />
      <div>
        <Segmented accent label="Loại quy tắc" value={kind} onChange={setKind} options={[
          { value: 'all', label: 'Tất cả', count: automations.length },
          ...(['time', 'sensor', 'presence'] as const).map((k) => ({ value: k, label: kindMeta[k].label, count: automations.filter((a) => a.kind === k).length })),
        ]} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {list.map((a) => {
          const meta = kindMeta[a.kind];
          return (
            <section key={a.id} className={cn('glass rounded-[22px] p-5 transition', !a.enabled && 'opacity-60')}>
              <div className="flex items-start gap-4">
                <span className={cn('grid size-12 shrink-0 place-items-center rounded-[14px]', meta.tone)}><meta.icon className="size-5" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-semibold">{a.name}</h3>
                    <span className="rounded-md bg-line-strong px-1.5 py-0.5 text-[11px] text-muted">{meta.label}</span>
                  </div>
                  <dl className="mt-3 grid gap-1.5 text-sm">
                    <div className="flex gap-2"><dt className="w-12 shrink-0 text-faint">Khi</dt><dd>{a.trigger}</dd></div>
                    <div className="flex gap-2"><dt className="w-12 shrink-0 text-faint">Thì</dt><dd>{a.action}</dd></div>
                  </dl>
                  <div className="mt-3 text-xs text-muted">Lần chạy gần nhất: {a.lastRun}</div>
                </div>
                <Toggle on={a.enabled} onChange={() => toggleAutomation(a.id)} label={`${a.enabled ? 'Tắt' : 'Bật'} quy tắc ${a.name}`} />
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
