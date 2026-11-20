import { Bell, Menu, Moon, Plus, Search, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { home } from '../../data/mock';
import { useTheme } from '../../lib/theme';
import { useToast } from '../../lib/toast';
import { IconButton } from '../ui/Button';

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export function Topbar({ title, onMenu, onNew }: { title: string; onMenu: () => void; onNew: () => void }) {
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const now = useNow();
  const search = useRef<HTMLInputElement>(null);
  const date = now.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });
  const time = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="glass sticky top-3 z-30 flex items-center gap-3 rounded-[24px] py-3 pr-3 pl-3 sm:pl-6 lg:top-4">
      <IconButton className="lg:hidden" onClick={onMenu} aria-label="Mở menu"><Menu className="size-5" /></IconButton>
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        <p className="hidden truncate text-xs text-muted sm:block">{date.charAt(0).toUpperCase() + date.slice(1)} · {time}</p>
      </div>
      <div className="flex-1" />
      <form
        className="hidden w-72 items-center gap-2.5 rounded-[14px] border border-line-strong bg-fg/[0.03] px-3 py-2.5 text-muted md:flex"
        onSubmit={(e) => { e.preventDefault(); const q = search.current?.value.trim(); if (q) navigate(`/devices?q=${encodeURIComponent(q)}`); }}
        role="search"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <input ref={search} placeholder="Tìm thiết bị, phòng…" aria-label="Tìm thiết bị, phòng" className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-faint" />
        <kbd className="rounded-md border border-line-strong px-1.5 text-[11px] text-faint">⌘K</kbd>
      </form>
      <IconButton className="hidden sm:grid" onClick={toggle} aria-label={theme === 'dark' ? 'Chuyển giao diện sáng' : 'Chuyển giao diện tối'}>
        {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </IconButton>
      <IconButton onClick={() => { navigate('/notifications'); toast('3 thông báo chưa đọc'); }} aria-label="Thông báo, 3 chưa đọc">
        <Bell className="size-5" />
        <span className="absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-accent-fg">3</span>
      </IconButton>
      <button type="button" onClick={onNew} className="inline-flex size-11 items-center justify-center gap-2 rounded-[14px] bg-accent font-medium text-accent-fg hover:brightness-105 sm:w-auto sm:px-4">
        <Plus className="size-5" aria-hidden /><span className="hidden sm:inline">Thêm mới</span><span className="sr-only sm:hidden">Thêm mới</span>
      </button>
      <span className={`relative grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br ${home.members[0].color} font-bold text-stone-800`} aria-label={home.owner}>
        {home.members[0].initials}
        <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-bg bg-ok" />
      </span>
    </header>
  );
}
