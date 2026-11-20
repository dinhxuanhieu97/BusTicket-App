import { Bell, Cpu, Gauge, HelpCircle, Home, LayoutGrid, Settings, ShieldCheck, Thermometer, Workflow, Zap, type LucideIcon } from 'lucide-react';

export interface NavItem { to: string; label: string; icon: LucideIcon; badge?: 'offline' }
export interface NavGroup { title: string; items: NavItem[] }

export const navGroups: NavGroup[] = [
  { title: 'Ngôi nhà', items: [
    { to: '/', label: 'Tổng quan', icon: LayoutGrid },
    { to: '/rooms', label: 'Phòng', icon: Home },
    { to: '/devices', label: 'Thiết bị', icon: Cpu, badge: 'offline' },
  ] },
  { title: 'Điều khiển', items: [
    { to: '/climate', label: 'Khí hậu', icon: Thermometer },
    { to: '/energy', label: 'Năng lượng', icon: Zap },
    { to: '/security', label: 'An ninh', icon: ShieldCheck },
    { to: '/automations', label: 'Tự động hóa', icon: Workflow },
  ] },
  { title: 'Hệ thống', items: [
    { to: '/notifications', label: 'Thông báo', icon: Bell },
    { to: '/settings', label: 'Cài đặt', icon: Settings },
    { to: '/help', label: 'Trợ giúp', icon: HelpCircle },
  ] },
];

export const mobileNav: NavItem[] = [
  { to: '/', label: 'Tổng quan', icon: LayoutGrid },
  { to: '/rooms', label: 'Phòng', icon: Home },
  { to: '/climate', label: 'Khí hậu', icon: Thermometer },
  { to: '/energy', label: 'Năng lượng', icon: Gauge },
  { to: '/security', label: 'An ninh', icon: ShieldCheck },
];

export const titles: Record<string, string> = Object.fromEntries(navGroups.flatMap((g) => g.items.map((i) => [i.to, i.label])));
