export type DeviceCategory = 'light' | 'climate' | 'media' | 'plug' | 'security';

export interface Room {
  id: string;
  name: string;
  floor: string;
  temp: number;
  humidity: number;
  cover: string;
  icon: 'sofa' | 'chef' | 'bed' | 'laptop' | 'baby' | 'trees';
}

export interface Device {
  id: string;
  name: string;
  roomId: string;
  category: DeviceCategory;
  on: boolean;
  level?: number;
  levelLabel?: string;
  watts: number;
  online: boolean;
}

export interface Scene {
  id: string;
  name: string;
  description: string;
  icon: 'sunrise' | 'focus' | 'film' | 'utensils' | 'door' | 'moon';
  tone: 'amber' | 'blue' | 'violet' | 'rose' | 'slate' | 'teal';
}

export interface Automation {
  id: string;
  name: string;
  trigger: string;
  action: string;
  enabled: boolean;
  lastRun: string;
  kind: 'time' | 'sensor' | 'presence';
}

export interface SecurityEvent {
  time: string;
  title: string;
  detail: string;
  level: 'info' | 'warn' | 'ok';
}

export const home = {
  name: 'Nhà Ven Sông',
  owner: 'Minh An',
  outsideTemp: 27,
  members: [
    { initials: 'MA', name: 'Minh An', home: true, color: 'from-amber-200 to-orange-300' },
    { initials: 'TH', name: 'Thu Hà', home: true, color: 'from-sky-200 to-indigo-300' },
    { initials: 'BO', name: 'Bống', home: false, color: 'from-rose-200 to-pink-300' },
  ],
};

export const rooms: Room[] = [
  { id: 'living', name: 'Phòng khách', floor: 'Tầng 1', temp: 26, humidity: 58, cover: 'from-[#8a5a34] via-[#5b3a22] to-[#2a1c12]', icon: 'sofa' },
  { id: 'kitchen', name: 'Bếp', floor: 'Tầng 1', temp: 27.5, humidity: 62, cover: 'from-[#6f7a4a] via-[#454d2c] to-[#1f2414]', icon: 'chef' },
  { id: 'bedroom', name: 'Phòng ngủ chính', floor: 'Tầng 2', temp: 25, humidity: 55, cover: 'from-[#4b5a86] via-[#2f3858] to-[#161a2a]', icon: 'bed' },
  { id: 'study', name: 'Phòng làm việc', floor: 'Tầng 2', temp: 25.5, humidity: 52, cover: 'from-[#7a5072] via-[#4c3147] to-[#22151f]', icon: 'laptop' },
  { id: 'kids', name: 'Phòng bé', floor: 'Tầng 2', temp: 26, humidity: 57, cover: 'from-[#3f7a78] via-[#284d4c] to-[#122322]', icon: 'baby' },
  { id: 'garden', name: 'Sân vườn', floor: 'Ngoài trời', temp: 27, humidity: 71, cover: 'from-[#4f7a3c] via-[#304b25] to-[#142010]', icon: 'trees' },
];

export const initialDevices: Device[] = [
  { id: 'd1', name: 'Đèn trần', roomId: 'living', category: 'light', on: true, level: 70, levelLabel: 'Độ sáng', watts: 24, online: true },
  { id: 'd2', name: 'Đèn cây góc sofa', roomId: 'living', category: 'light', on: true, level: 40, levelLabel: 'Độ sáng', watts: 9, online: true },
  { id: 'd3', name: 'Điều hòa', roomId: 'living', category: 'climate', on: true, level: 60, levelLabel: 'Quạt', watts: 820, online: true },
  { id: 'd4', name: 'TV & loa', roomId: 'living', category: 'media', on: false, level: 30, levelLabel: 'Âm lượng', watts: 0, online: true },
  { id: 'd5', name: 'Rèm cửa', roomId: 'living', category: 'plug', on: true, level: 80, levelLabel: 'Độ mở', watts: 2, online: true },
  { id: 'd6', name: 'Đèn đảo bếp', roomId: 'kitchen', category: 'light', on: true, level: 90, levelLabel: 'Độ sáng', watts: 18, online: true },
  { id: 'd7', name: 'Máy rửa bát', roomId: 'kitchen', category: 'plug', on: true, watts: 1100, online: true },
  { id: 'd8', name: 'Ấm siêu tốc', roomId: 'kitchen', category: 'plug', on: false, watts: 0, online: true },
  { id: 'd9', name: 'Máy lọc không khí', roomId: 'kitchen', category: 'climate', on: true, level: 35, levelLabel: 'Tốc độ', watts: 22, online: true },
  { id: 'd10', name: 'Đèn ngủ', roomId: 'bedroom', category: 'light', on: false, level: 20, levelLabel: 'Độ sáng', watts: 0, online: true },
  { id: 'd11', name: 'Điều hòa', roomId: 'bedroom', category: 'climate', on: false, level: 40, levelLabel: 'Quạt', watts: 0, online: true },
  { id: 'd12', name: 'Máy tạo ẩm', roomId: 'bedroom', category: 'climate', on: true, level: 45, levelLabel: 'Công suất', watts: 15, online: true },
  { id: 'd13', name: 'Đèn bàn', roomId: 'study', category: 'light', on: true, level: 85, levelLabel: 'Độ sáng', watts: 8, online: true },
  { id: 'd14', name: 'Ổ cắm màn hình', roomId: 'study', category: 'plug', on: true, watts: 64, online: true },
  { id: 'd15', name: 'Loa thông minh', roomId: 'study', category: 'media', on: true, level: 25, levelLabel: 'Âm lượng', watts: 6, online: true },
  { id: 'd16', name: 'Đèn sao', roomId: 'kids', category: 'light', on: false, level: 30, levelLabel: 'Độ sáng', watts: 0, online: true },
  { id: 'd17', name: 'Camera bé ngủ', roomId: 'kids', category: 'security', on: true, watts: 4, online: true },
  { id: 'd18', name: 'Đèn lối đi', roomId: 'garden', category: 'light', on: false, level: 100, levelLabel: 'Độ sáng', watts: 0, online: true },
  { id: 'd19', name: 'Tưới cây tự động', roomId: 'garden', category: 'plug', on: false, watts: 0, online: true },
  { id: 'd20', name: 'Khóa cổng', roomId: 'garden', category: 'security', on: true, watts: 1, online: false },
];

export const scenes: Scene[] = [
  { id: 's1', name: 'Thức dậy', description: 'Mở rèm, đèn ấm 40%, phát nhạc nhẹ', icon: 'sunrise', tone: 'amber' },
  { id: 's2', name: 'Làm việc', description: 'Đèn bàn trắng, tắt TV, lọc khí êm', icon: 'focus', tone: 'blue' },
  { id: 's3', name: 'Xem phim', description: 'Kéo rèm, đèn 10%, bật TV & loa', icon: 'film', tone: 'violet' },
  { id: 's4', name: 'Bữa tối', description: 'Đèn đảo bếp 60%, nhạc phòng khách', icon: 'utensils', tone: 'rose' },
  { id: 's5', name: 'Ra khỏi nhà', description: 'Tắt hết thiết bị, khóa cửa, bật camera', icon: 'door', tone: 'slate' },
  { id: 's6', name: 'Đi ngủ', description: 'Tắt đèn, điều hòa 26°, khóa cửa', icon: 'moon', tone: 'teal' },
];

export const automations: Automation[] = [
  { id: 'a1', name: 'Chào buổi sáng', trigger: '06:30 các ngày trong tuần', action: 'Chạy ngữ cảnh "Thức dậy"', enabled: true, lastRun: 'Hôm nay 06:30', kind: 'time' },
  { id: 'a2', name: 'Về nhà', trigger: 'Thành viên đầu tiên về trong bán kính 200 m', action: 'Mở khóa cổng, bật đèn lối đi', enabled: true, lastRun: 'Hôm qua 18:42', kind: 'presence' },
  { id: 'a3', name: 'Chống ẩm', trigger: 'Độ ẩm phòng ngủ > 65%', action: 'Bật chế độ khô điều hòa 30 phút', enabled: true, lastRun: '3 ngày trước', kind: 'sensor' },
  { id: 'a4', name: 'Tưới vườn', trigger: '17:30 nếu không mưa trong 24 giờ', action: 'Tưới 12 phút', enabled: false, lastRun: '1 tuần trước', kind: 'time' },
  { id: 'a5', name: 'Cảnh báo cửa mở', trigger: 'Cửa chính mở quá 5 phút', action: 'Gửi thông báo cho cả nhà', enabled: true, lastRun: 'Chưa chạy', kind: 'sensor' },
  { id: 'a6', name: 'Tắt đèn khi vắng', trigger: 'Không có ai ở nhà 15 phút', action: 'Tắt mọi đèn và ổ cắm không cần thiết', enabled: true, lastRun: 'Hôm nay 08:05', kind: 'presence' },
];

export const securityEvents: SecurityEvent[] = [
  { time: '19:41', title: 'Cổng chính đã khóa', detail: 'Bởi Thu Hà qua ứng dụng', level: 'ok' },
  { time: '19:12', title: 'Phát hiện chuyển động', detail: 'Camera sân trước · người giao hàng', level: 'info' },
  { time: '18:40', title: 'Khóa cổng mất kết nối', detail: 'Pin còn 8%, cần thay pin', level: 'warn' },
  { time: '18:38', title: 'Minh An về nhà', detail: 'Mở khóa bằng vân tay', level: 'ok' },
  { time: '08:05', title: 'Chế độ vắng nhà bật', detail: 'Tự động khi cả nhà ra ngoài', level: 'info' },
];

export const cameras = [
  { id: 'c1', name: 'Sân trước', status: 'Đang ghi', live: true, tone: 'from-[#3c4a3a] to-[#1a2119]' },
  { id: 'c2', name: 'Cổng sau', status: 'Đang ghi', live: true, tone: 'from-[#3a4250] to-[#171b22]' },
  { id: 'c3', name: 'Phòng bé', status: 'Riêng tư', live: false, tone: 'from-[#4a3a46] to-[#1f171d]' },
  { id: 'c4', name: 'Gara', status: 'Đang ghi', live: true, tone: 'from-[#4a4236] to-[#1f1b15]' },
];

export const hours = ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'];
export const energyToday = [0.35, 0.3, 0.28, 0.5, 0.9, 0.7, 0.65, 0.8, 1.1, 1.6, 1.9, 1.2];
export const solarToday = [0, 0, 0, 0.1, 0.9, 1.8, 2.3, 2.0, 1.1, 0.2, 0, 0];
export const energyWeek = { labels: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'], used: [14.2, 13.1, 15.8, 14.9, 16.4, 19.8, 18.2], solar: [9.1, 10.4, 7.2, 11.0, 10.2, 11.7, 9.8] };
export const energyMonth = {
  labels: Array.from({ length: 30 }, (_, i) => String(i + 1)),
  used: Array.from({ length: 30 }, (_, i) => +(14 + 3 * Math.sin(i / 2.5) + (i % 7 >= 5 ? 4 : 0)).toFixed(1)),
  solar: Array.from({ length: 30 }, (_, i) => +(9 + 2.5 * Math.cos(i / 3)).toFixed(1)),
};
export const tariffVndPerKwh = 2_870;

export const vnd = (n: number) => n.toLocaleString('vi-VN') + ' ₫';
export const fmt = (n: number, digits = 1) => n.toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
