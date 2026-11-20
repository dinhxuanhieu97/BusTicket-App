import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { mobileNav } from './nav';

export function MobileNav() {
  return (
    <nav className="glass fixed inset-x-3 bottom-3 z-30 flex gap-1 rounded-[24px] p-2 lg:hidden" aria-label="Điều hướng nhanh">
      {mobileNav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-1 rounded-[16px] py-2 text-[11px]', isActive ? 'bg-accent text-accent-fg' : 'text-muted')}
        >
          <item.icon className="size-5" aria-hidden />
          <span className="truncate">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
