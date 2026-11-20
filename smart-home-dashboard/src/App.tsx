import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { HomeProvider } from './lib/home-store';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import { Automations } from './pages/Automations';
import { Climate } from './pages/Climate';
import { Devices } from './pages/Devices';
import { Energy } from './pages/Energy';
import { Help, NotFound, Notifications, Settings } from './pages/Misc';
import { Overview } from './pages/Overview';
import { RoomDetail, Rooms } from './pages/Rooms';
import { Security } from './pages/Security';

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <HomeProvider>
          <HashRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Overview />} />
                <Route path="rooms" element={<Rooms />} />
                <Route path="rooms/:id" element={<RoomDetail />} />
                <Route path="devices" element={<Devices />} />
                <Route path="climate" element={<Climate />} />
                <Route path="energy" element={<Energy />} />
                <Route path="security" element={<Security />} />
                <Route path="automations" element={<Automations />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="settings" element={<Settings />} />
                <Route path="help" element={<Help />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </HashRouter>
        </HomeProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
