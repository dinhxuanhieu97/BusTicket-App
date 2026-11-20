import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { automations as initialAutomations, initialDevices, type Automation, type Device } from '../data/mock';

export type ClimateMode = 'cool' | 'dry' | 'fan' | 'auto';

interface HomeState {
  devices: Device[];
  automations: Automation[];
  setpoint: number;
  mode: ClimateMode;
  activeScene: string | null;
  armed: boolean;
  toggleDevice: (id: string) => void;
  setLevel: (id: string, level: number) => void;
  setRoomPower: (roomId: string, on: boolean) => void;
  allOff: () => void;
  toggleAutomation: (id: string) => void;
  setSetpoint: (value: number) => void;
  setMode: (mode: ClimateMode) => void;
  runScene: (id: string | null) => void;
  setArmed: (armed: boolean) => void;
}

const HomeContext = createContext<HomeState | null>(null);

const restingWatts = (d: Device) => {
  const base: Record<Device['category'], number> = { light: 24, climate: 820, media: 140, plug: 60, security: 4 };
  return Math.round(base[d.category] * ((d.level ?? 100) / 100)) || 1;
};

export function HomeProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState(initialDevices);
  const [automations, setAutomations] = useState(initialAutomations);
  const [setpoint, setSetpoint] = useState(26);
  const [mode, setMode] = useState<ClimateMode>('cool');
  const [activeScene, setActiveScene] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  const toggleDevice = useCallback((id: string) => {
    setDevices((ds) => ds.map((d) => (d.id === id && d.online ? { ...d, on: !d.on, watts: d.on ? 0 : restingWatts(d) } : d)));
  }, []);
  const setLevel = useCallback((id: string, level: number) => {
    setDevices((ds) => ds.map((d) => (d.id === id ? { ...d, level, on: level > 0, watts: level > 0 ? restingWatts({ ...d, level }) : 0 } : d)));
  }, []);
  const setRoomPower = useCallback((roomId: string, on: boolean) => {
    setDevices((ds) => ds.map((d) => (d.roomId === roomId && d.online && d.category !== 'security' ? { ...d, on, watts: on ? restingWatts(d) : 0 } : d)));
  }, []);
  const allOff = useCallback(() => {
    setDevices((ds) => ds.map((d) => (d.category === 'security' ? d : { ...d, on: false, watts: 0 })));
  }, []);
  const toggleAutomation = useCallback((id: string) => {
    setAutomations((as) => as.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)));
  }, []);

  const value = useMemo<HomeState>(() => ({
    devices, automations, setpoint, mode, activeScene, armed,
    toggleDevice, setLevel, setRoomPower, allOff, toggleAutomation,
    setSetpoint: (v) => setSetpoint(Math.min(30, Math.max(16, Math.round(v * 2) / 2))),
    setMode, runScene: setActiveScene, setArmed,
  }), [devices, automations, setpoint, mode, activeScene, armed, toggleDevice, setLevel, setRoomPower, allOff, toggleAutomation]);

  return <HomeContext.Provider value={value}>{children}</HomeContext.Provider>;
}

export function useHome() {
  const ctx = useContext(HomeContext);
  if (!ctx) throw new Error('useHome must be used inside HomeProvider');
  return ctx;
}

export function useHomeStats() {
  const { devices } = useHome();
  return useMemo(() => {
    const on = devices.filter((d) => d.on && d.online);
    return {
      onCount: on.length,
      total: devices.length,
      offline: devices.filter((d) => !d.online),
      watts: on.reduce((sum, d) => sum + d.watts, 0),
    };
  }, [devices]);
}
