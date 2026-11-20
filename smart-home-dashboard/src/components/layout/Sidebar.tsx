import { ChevronLeft, House, Thermometer } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { home } from '../../data/mock';
import { useHome, useHomeStats } from '../../lib/home-store';
import { cn } from '../../lib/cn';
import { navGroups } from './nav';

export function Sidebar({ collapsed, onCollapse, mobileOpen, onNavigate }: { collapsed: boolean; onCollapse: () => void; mobileOpen: boolean; onNavigate: () => void }) {
  const { offline } = useHomeStats();
  const { setpoint } = useHome();
  return (
    <aside
      className={cn(
        'glass fixed inset-y-3 left-3 z-40 flex w-[270px] flex-col rounded-[26px] px-3 py-5 transition-transform lg:sticky lg:top-4 lg:z-auto lg:h-[calc(100vh-32px)] lg:translate-x-0',
        collapsed ? 'lg:w-[84px]' : 'lg:w-[260px]',
        mobileOpen ? 'translate-x-0' : '-translate-x-[115%]',
      )}
      aria-label="Điều hướng chính"
    >
      <div className={cn('relative mb-4 flex items-center gap-3 px-2', collapsed && 'lg:justify-center lg:px-0')}>
        <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-accent text-accent-fg"><House className="size-5" aria-hidden /></span>
        <div className={cn('min-w-0', collapsed && 'lg:hidden')}>
          <div className="text-lg leading-tight font-bold">Hearth</div>
          <div className="truncate text-xs text-muted">{home.name}</div>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
          className="absolute top-2 -right-7 hidden size-8 place-items-center rounded-full border border-line-strong bg-surface-2 lg:grid"
        >
          <ChevronLeft className={cn('size-4 transition-transform', collapsed && 'rotate-180')} />
        </button>
      </div>

      <nav className="scrollbar-none flex-1 overflow-y-auto">
        {navGroups.map((g) => (
          <div key={g.title} className="mb-2">
            <div className={cn('mx-3 mt-4 mb-2 text-[11px] font-semibold tracking-[0.14em] text-faint uppercase', collapsed && 'lg:hidden')}>{g.title}</div>
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={onNavigate}
                title={item.label}
                className={({ isActive }) => cn(
                  'mb-0.5 flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-[15px] transition',
                  isActive ? 'bg-line-strong text-fg' : 'text-muted hover:bg-fg/[0.05] hover:text-fg',
                  collapsed && 'lg:justify-center',
                )}
              >
                <item.icon className="size-[19px] shrink-0" aria-hidden />
                <span className={cn('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
                {item.badge === 'offline' && offline.length > 0 && (
                  <span className={cn('ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-warn/20 px-1.5 text-[11px] font-bold text-warn', collapsed && 'lg:hidden')}>{offline.length}</span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className={cn('flex items-center gap-3 rounded-[18px] border border-line bg-fg/[0.03] p-3', collapsed && 'lg:justify-center')}>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cool/15 text-cool"><Thermometer className="size-4" aria-hidden /></span>
        <div className={cn('min-w-0', collapsed && 'lg:hidden')}>
          <div className="text-sm font-semibold">26° trong nhà</div>
          <div className="truncate text-xs text-muted">Làm mát về {setpoint.toLocaleString('vi-VN')}°</div>
        </div>
      </div>
    </aside>
  );
}
