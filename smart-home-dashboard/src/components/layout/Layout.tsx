import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { rooms } from '../../data/mock';
import { storage } from '../../lib/storage';
import { useToast } from '../../lib/toast';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { titles } from './nav';

export function Layout() {
  const [collapsed, setCollapsed] = useState(() => storage.get('hearth-collapsed') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const { pathname } = useLocation();
  const toast = useToast();
  const title = titles[pathname] ?? (pathname.startsWith('/rooms/') ? 'Phòng' : 'Hearth');

  useEffect(() => { storage.set('hearth-collapsed', collapsed ? '1' : '0'); }, [collapsed]);
  useEffect(() => { setMobileOpen(false); window.scrollTo({ top: 0 }); }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-screen gap-4 p-3 pb-28 sm:p-4 lg:pb-4">
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />}
      <Sidebar collapsed={collapsed} onCollapse={() => setCollapsed((c) => !c)} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Topbar title={title} onMenu={() => setMobileOpen(true)} onNew={() => setNewOpen(true)} />
        <main key={pathname} className="animate-rise flex flex-col gap-4">
          <Outlet />
        </main>
      </div>
      <MobileNav />
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Thêm thiết bị"
        footer={<>
          <Button onClick={() => setNewOpen(false)}>Hủy</Button>
          <Button variant="primary" onClick={() => { setNewOpen(false); toast('Đang tìm thiết bị gần đây…'); }}>Bắt đầu ghép nối</Button>
        </>}
      >
        <div className="grid gap-4 text-sm">
          <label className="grid gap-1.5">
            <span className="text-muted">Tên thiết bị</span>
            <input defaultValue="Đèn hành lang" className="rounded-[12px] border border-line-strong bg-fg/[0.03] px-3 py-2.5 outline-none focus:border-accent" />
          </label>
          <label className="grid gap-1.5">
            <span className="text-muted">Phòng</span>
            <select className="rounded-[12px] border border-line-strong bg-surface-2 px-3 py-2.5 outline-none focus:border-accent">
              {rooms.map((r) => <option key={r.id}>{r.name}</option>)}
            </select>
          </label>
          <p className="text-muted">Bật chế độ ghép nối trên thiết bị (thường là giữ nút nguồn 5 giây) trước khi bấm bắt đầu.</p>
        </div>
      </Modal>
    </div>
  );
}
