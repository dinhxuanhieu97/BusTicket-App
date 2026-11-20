'use strict';

// ---------- Icons (simple stroke icons, 24x24 viewBox) ----------
const ICONS = {
  bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 18v2M16 18v2"/><circle cx="8" cy="14.5" r=".8"/><circle cx="16" cy="14.5" r=".8"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  ticket: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2"/>',
  seat: '<path d="M6 4v9a2 2 0 0 0 2 2h8"/><path d="M6 15l-1 5M17 15l1 5M9 15h9a2 2 0 0 1 0 4H8"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8"/>',
  van: '<path d="M3 7h11l4 4h3v6H3z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  chart: '<path d="M3 20h18"/><path d="M5 16l4-5 4 3 6-8"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 15h2"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6v2M12 16v2"/>',
  percent: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.01"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  log: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  bed: '<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="2"/>',
};
const icon = (name, extra = '') => `<svg class="i ${extra}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const hydrateIcons = (root = document) => root.querySelectorAll('[data-icon]').forEach((el) => {
  el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  el.removeAttribute('data-icon');
});

// ---------- Mock data ----------
const vnd = (n) => n.toLocaleString('vi-VN') + ' ₫';
const short = (n) => n >= 1e9 ? (n / 1e9).toFixed(2).replace('.', ',') + ' tỷ' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' tr' : n.toLocaleString('vi-VN');

const ROUTES = [
  { code: 'HCM-HA', name: 'TP.HCM → Hoài Ân' },
  { code: 'HA-HCM', name: 'Hoài Ân → TP.HCM' },
  { code: 'HCM-BS', name: 'TP.HCM → Bồng Sơn' },
  { code: 'HCM-TQ', name: 'TP.HCM → Tam Quan' },
];
const TRIPS = [
  { id: 't1', time: '07:00', route: 'HCM-HA', vehicle: 'Limousine 22 phòng', plate: '77B-012.34', sold: 22, total: 22, revenue: 12_850_000, status: 'CLOSED', state: 'Đang chạy', cover: 1 },
  { id: 't2', time: '09:30', route: 'HA-HCM', vehicle: 'Giường nằm 40 chỗ', plate: '77B-045.67', sold: 36, total: 40, revenue: 13_320_000, status: 'CLOSED', state: 'Đang chạy', cover: 2 },
  { id: 't3', time: '13:00', route: 'HCM-BS', vehicle: 'Limousine 22 phòng', plate: '77B-088.10', sold: 17, total: 22, revenue: 9_610_000, status: 'OPEN', state: 'Đang bán', cover: 3 },
  { id: 't4', time: '18:00', route: 'HCM-HA', vehicle: 'Limousine 22 phòng', plate: '77B-012.99', sold: 19, total: 22, revenue: 10_970_000, status: 'OPEN', state: 'Đang bán', cover: 4 },
  { id: 't5', time: '19:30', route: 'HCM-HA', vehicle: 'Giường nằm 40 chỗ', plate: '77B-045.11', sold: 28, total: 40, revenue: 10_220_000, status: 'OPEN', state: 'Đang bán', cover: 5 },
  { id: 't6', time: '20:00', route: 'HCM-TQ', vehicle: 'Giường nằm 40 chỗ', plate: '77B-061.25', sold: 14, total: 40, revenue: 5_110_000, status: 'OPEN', state: 'Đang bán', cover: 1 },
  { id: 't7', time: '20:30', route: 'HA-HCM', vehicle: 'Limousine 22 phòng', plate: '77B-012.34', sold: 21, total: 22, revenue: 12_160_000, status: 'OPEN', state: 'Sắp đóng bán', cover: 2 },
  { id: 't8', time: '21:30', route: 'HA-HCM', vehicle: 'Giường nằm 40 chỗ', plate: '77B-045.67', sold: 9, total: 40, revenue: 3_330_000, status: 'OPEN', state: 'Đang bán', cover: 3 },
];
const routeName = (code) => ROUTES.find((r) => r.code === code)?.name ?? code;

const PAYMENTS = [
  { at: '19:38', ref: 'FT2632409911', content: 'PN7KQ2M thanh toan ve', amount: 1_400_000, booking: 'PN7KQ2M', status: 'ok' },
  { at: '19:31', ref: 'FT2632409874', content: 'PNX4TR8', amount: 450_000, booking: 'PNX4TR8', status: 'ok' },
  { at: '19:12', ref: 'FT2632409702', content: 'chuyen khoan ve xe', amount: 700_000, booking: '—', status: 'bad' },
  { at: '18:57', ref: 'FT2632409655', content: 'PN2HB9C', amount: 650_000, booking: 'PN2HB9C', status: 'warn' },
  { at: '18:40', ref: 'FT2632409510', content: 'PNM3ZQ1 ve 2 nguoi', amount: 760_000, booking: 'PNM3ZQ1', status: 'ok' },
  { at: '18:22', ref: 'TIEN-MAT', content: 'Thu tại quầy Hoài Ân', amount: 380_000, booking: 'PNR8YV4', status: 'ok' },
  { at: '17:59', ref: 'FT2632409301', content: 'PNC6WD2', amount: 420_000, booking: 'PNC6WD2', status: 'ok' },
];
const PAY_STATUS = {
  ok: ['st-ok', 'Đã khớp đơn'],
  warn: ['st-warn', 'Thiếu tiền'],
  bad: ['st-bad', 'Chưa khớp đơn'],
};

const STAFF = [
  { name: 'Xuân Hiếu', role: 'Chủ nhà xe', phone: '09•• ••• 128', mfa: true, status: 'ok' },
  { name: 'Ngọc Lan', role: 'Điều hành', phone: '09•• ••• 553', mfa: true, status: 'ok' },
  { name: 'Văn Toàn', role: 'Bán vé quầy', phone: '03•• ••• 907', mfa: false, status: 'ok' },
  { name: 'Minh Đức', role: 'Kế toán', phone: '08•• ••• 411', mfa: true, status: 'grey' },
];

const HOURS = ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'];
const SALES_TODAY = [0.4, 0.2, 0.1, 0.6, 2.8, 4.1, 3.2, 3.6, 5.4, 7.9, 6.2, 3.0];
const SALES_YDAY = [0.5, 0.2, 0.2, 0.9, 2.1, 3.4, 3.9, 3.1, 4.6, 6.1, 5.0, 2.6];

const state = {
  tripFilter: 'all',
  routeFilter: 'all',
  tripQuery: '',
  seatTrip: 't4',
  selectedSeat: null,
  revenueRange: 'day',
  payFilter: 'all',
};

// ---------- Helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const toast = (msg) => {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
};

function spark(values, color = 'var(--accent)', fill = true) {
  const w = 120, h = 40, max = Math.max(...values), min = Math.min(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / (max - min || 1)) * (h - 10)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${fill ? `<path d="${d} L${w} ${h} L0 ${h}Z" fill="url(#${id})"/>` : ''}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

function smoothPath(pts) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2;
    d += ` C${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`;
  }
  return d;
}

function areaChart(labels, series, unit) {
  const W = 760, H = 260, L = 48, R = 26, T = 10, B = 28;
  const max = Math.ceil(Math.max(...series.flatMap((s) => s.values)) / 2) * 2 || 1;
  const x = (i) => L + (i / (labels.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-dasharray="3 4"/>`;
    g += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(v % 1 ? 1 : 0).replace('.', ',')}${unit}</text>`;
  }
  labels.forEach((lb, i) => { if (i % Math.ceil(labels.length / 8) === 0 || i === labels.length - 1) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${lb}</text>`; });
  const paths = series.map((s, si) => {
    const pts = s.values.map((v, i) => [x(i), y(v)]);
    const d = smoothPath(pts);
    const gid = 'ac' + si;
    return `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".32"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>
      ${s.dashed ? '' : `<path d="${d} L${x(labels.length - 1)} ${y(0)} L${x(0)} ${y(0)}Z" fill="url(#${gid})"/>`}
      <path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.4" ${s.dashed ? 'stroke-dasharray="5 5"' : ''}/>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Biểu đồ doanh thu">${g}${paths}</svg>`;
}

function gauge(pct) {
  const size = 260, r = 112, c = size / 2, start = 135, sweep = 270, ticks = 54;
  let lines = '';
  for (let i = 0; i <= ticks; i++) {
    const a = ((start + (sweep * i) / ticks) * Math.PI) / 180;
    const on = i / ticks <= pct;
    const r1 = r - (i % 9 === 0 ? 16 : 10), r2 = r;
    lines += `<line x1="${c + r1 * Math.cos(a)}" y1="${c + r1 * Math.sin(a)}" x2="${c + r2 * Math.cos(a)}" y2="${c + r2 * Math.sin(a)}" stroke="${on ? 'var(--accent)' : 'var(--line-strong)'}" stroke-width="2.4" stroke-linecap="round" opacity="${on ? 0.45 + 0.55 * (i / ticks) : 1}"/>`;
  }
  const ea = ((start + sweep * pct) * Math.PI) / 180;
  const knob = `<circle cx="${c + (r + 2) * Math.cos(ea)}" cy="${c + (r + 2) * Math.sin(ea)}" r="8" fill="#fff" stroke="var(--accent)" stroke-width="3"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${c}" cy="${c}" r="${r - 26}" fill="var(--panel-soft)" stroke="var(--line)"/>${lines}${knob}</svg>`;
}

const totals = () => {
  const sold = TRIPS.reduce((a, t) => a + t.sold, 0);
  const total = TRIPS.reduce((a, t) => a + t.total, 0);
  const revenue = TRIPS.reduce((a, t) => a + t.revenue, 0);
  return { sold, total, revenue, pct: sold / total };
};

function tripTile(t) {
  const pct = Math.round((t.sold / t.total) * 100);
  return `<a class="trip-tile" href="#/seats/${t.id}">
    <div class="cover cover-${t.cover}">
      <span class="pill">${t.state}</span>
      <div class="time">${t.time}</div>
    </div>
    <div class="body">
      <div class="route">${routeName(t.route)}</div>
      <div class="meta"><span>${t.vehicle}</span><span>${t.plate}</span></div>
      <div class="bar ${pct >= 90 ? 'warn' : ''}"><i style="width:${pct}%"></i></div>
      <div class="meta"><span>${t.sold}/${t.total} chỗ · ${pct}%</span><span>${short(t.revenue)}</span></div>
    </div>
  </a>`;
}

// ---------- Views ----------
const VIEWS = {};

VIEWS.overview = () => {
  const s = totals();
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const actions = [
    ['plus', 'tone-teal', 'Tạo chuyến', 'Chọn tuyến, xe, giờ chạy, giá vé'],
    ['ticket', 'tone-amber', 'Bán vé tại quầy', 'Giữ chỗ và thu tiền mặt cho khách'],
    ['download', 'tone-blue', 'Xuất danh sách khách', 'File Excel theo từng chuyến'],
    ['lock', 'tone-rose', 'Đóng bán chuyến', 'Ngừng nhận đặt chỗ ngay'],
    ['refresh', 'tone-grey', 'Đối soát thanh toán', 'Khớp chuyển khoản với đơn'],
    ['send', 'tone-green', 'Gửi nhắc giờ đi', 'Zalo OA cho khách chuyến tối'],
  ];
  return `<div class="page">
    <div class="grid g-hero">
      <section class="glass hero">
        <div class="eyebrow">Nhà xe Phong Nhung · ${new Date().toLocaleDateString('vi-VN', { weekday: 'long' })}</div>
        <h2>${greet}, Hiếu</h2>
        <div class="chips">
          <span class="chip">${icon('bus')} ${TRIPS.length} chuyến hôm nay</span>
          <span class="chip">${icon('seat')} ${s.sold}/${s.total} chỗ đã bán</span>
          <span class="chip">${icon('coin')} ${short(s.revenue)} doanh thu</span>
          <span class="chip warn">${icon('alert')} 1 khoản tiền chưa khớp</span>
        </div>
        <p>Chuyến 20:30 Hoài Ân → TP.HCM còn 1 phòng, sẽ đóng bán lúc 19:30. Có 2 khách đang giữ chỗ chờ chuyển khoản, giữ chỗ tự hủy sau 15 phút.</p>
        <div class="section-label">Thao tác nhanh</div>
        <div class="actions-grid">
          ${actions.map(([ic, tone, t, d]) => `<button class="action" data-toast="${t}"><span class="ico ${tone}">${icon(ic)}</span><div><b>${t}</b><span>${d}</span></div></button>`).join('')}
        </div>
      </section>
      <section class="glass card">
        <div class="card-head">
          <div><h3>Lấp đầy hôm nay</h3><div class="sub">Tất cả chuyến · ${TRIPS.length} xe</div></div>
          <a class="btn" href="#/trips">Chi tiết</a>
        </div>
        <div class="gauge-wrap">
          ${gauge(s.pct)}
          <div class="gauge-center">
            <div class="tag">${icon('pulse')} ĐANG BÁN</div>
            <div class="big">${Math.round(s.pct * 100)}<sup>%</sup></div>
            <div class="small">${s.total - s.sold} chỗ còn trống</div>
          </div>
        </div>
        <div class="seg" id="fillSeg">
          <button class="on">Hôm nay</button><button>Ngày mai</button><button>7 ngày</button>
        </div>
      </section>
    </div>

    <div class="grid g-4">
      <section class="glass kpi">
        <div class="label">${icon('coin')} Doanh thu hôm nay</div>
        <div class="value">${short(s.revenue)}<small>₫</small></div>
        <div class="foot"><span class="live-dot"></span> cập nhật trực tiếp</div>
        ${spark([3, 4, 3.6, 5, 4.4, 6, 7.2, 7.9], 'var(--warn)')}
      </section>
      <section class="glass kpi">
        <div class="label">${icon('ticket')} Vé đã bán</div>
        <div class="value">${s.sold}<small>vé</small></div>
        <div class="foot"><span class="delta up">↑ 18%</span> so với hôm qua</div>
        ${spark([12, 18, 15, 24, 19, 28, 26, 33], 'var(--blue)')}
      </section>
      <section class="glass kpi">
        <div class="label">${icon('wallet')} Chờ thanh toán</div>
        <div class="value">7<small>đơn</small></div>
        <div class="foot">2,9 tr đang giữ chỗ</div>
        ${spark([2, 3, 5, 4, 6, 5, 8, 7], 'var(--ok)')}
      </section>
      <section class="glass kpi">
        <div class="label">${icon('percent')} Tỷ lệ hủy</div>
        <div class="value">2,4<small>%</small></div>
        <div class="foot">Mục tiêu dưới 5%</div>
        ${spark([3.1, 2.8, 2.9, 2.6, 2.5, 2.7, 2.4, 2.4], 'var(--accent)', false)}
      </section>
    </div>

    <section class="glass card">
      <div class="card-head">
        <div><h3>Chuyến hôm nay</h3><div class="sub">${TRIPS.length} chuyến · ${ROUTES.length} tuyến</div></div>
        <a class="link" href="#/trips">Tất cả chuyến</a>
      </div>
      <div class="strip">${TRIPS.map(tripTile).join('')}</div>
    </section>
  </div>`;
};

VIEWS.trips = () => {
  const counts = {
    all: TRIPS.length,
    OPEN: TRIPS.filter((t) => t.status === 'OPEN').length,
    CLOSED: TRIPS.filter((t) => t.status === 'CLOSED').length,
  };
  const s = totals();
  const list = TRIPS.filter((t) =>
    (state.tripFilter === 'all' || t.status === state.tripFilter) &&
    (state.routeFilter === 'all' || t.route === state.routeFilter) &&
    (!state.tripQuery || (t.time + routeName(t.route) + t.plate + t.vehicle).toLowerCase().includes(state.tripQuery.toLowerCase())));
  return `<div class="page">
    <section class="glass hero page-hero">
      <div><h2>Chuyến xe</h2><div class="muted">${TRIPS.length} chuyến hôm nay trên ${ROUTES.length} tuyến · ${counts.OPEN} đang bán</div></div>
      <div class="actions">
        <button class="btn" data-toast="Đã đóng bán mọi chuyến khởi hành trong 1 giờ tới">${icon('lock')} Đóng bán sắp chạy</button>
        <button class="btn primary" data-toast="Mở form tạo chuyến mới">${icon('plus')} Tạo chuyến</button>
      </div>
    </section>

    <div><div class="tabs" id="tripTabs">
      <button data-f="all" class="${state.tripFilter === 'all' ? 'on' : ''}">Tất cả <span class="badge neutral">${counts.all}</span></button>
      <button data-f="OPEN" class="${state.tripFilter === 'OPEN' ? 'on' : ''}">Đang bán <span class="badge neutral">${counts.OPEN}</span></button>
      <button data-f="CLOSED" class="${state.tripFilter === 'CLOSED' ? 'on' : ''}">Đã đóng bán <span class="badge neutral">${counts.CLOSED}</span></button>
    </div></div>

    <div class="grid g-4">
      <section class="glass kpi"><div class="label">${icon('bus')} Đang bán</div><div class="value">${counts.OPEN}<small>/ ${counts.all} chuyến</small></div><div class="foot">Mở bán đến 1 giờ trước giờ chạy</div></section>
      <section class="glass kpi"><div class="label">${icon('seat')} Chỗ đã bán</div><div class="value">${s.sold}<small>/ ${s.total}</small></div><div class="foot"><span class="live-dot"></span> trực tiếp</div></section>
      <section class="glass kpi"><div class="label">${icon('coin')} Doanh thu</div><div class="value">${short(s.revenue)}<small>₫</small></div><div class="foot">≈ ${short(Math.round(s.revenue / s.sold))} / vé</div></section>
      <section class="glass kpi"><div class="label">${icon('alert')} Cần xử lý</div><div class="value">1<small>chuyến</small></div><div class="foot" style="color:var(--accent)">20:30 Hoài Ân → TP.HCM gần đầy</div></section>
    </div>

    <section class="glass card">
      <div class="toolbar">
        <label class="search">${icon('search')}<input id="tripSearch" placeholder="Tìm giờ, tuyến, biển số…" value="${state.tripQuery}"></label>
        <div class="grow"></div>
        <div class="seg"><button class="on">${icon('grid')}</button><button data-toast="Chế độ bảng sẽ có ở bản sau">${icon('list')}</button></div>
      </div>
      <div class="filter-chips" id="routeChips">
        <button class="fchip ${state.routeFilter === 'all' ? 'on' : ''}" data-r="all">Mọi tuyến</button>
        ${ROUTES.map((r) => `<button class="fchip ${state.routeFilter === r.code ? 'on' : ''}" data-r="${r.code}">${r.name} <span class="n">${TRIPS.filter((t) => t.route === r.code).length}</span></button>`).join('')}
      </div>
      ${list.length ? `<div class="cards">${list.map((t) => {
        const pct = Math.round((t.sold / t.total) * 100);
        const on = t.status === 'OPEN';
        return `<div class="tcard ${on ? 'on' : ''}">
          <div class="top"><a class="ico" href="#/seats/${t.id}" aria-label="Xem sơ đồ chỗ">${icon(t.vehicle.startsWith('Limo') ? 'seat' : 'bed')}</a>
            <button class="switch ${on ? 'on' : ''}" data-toggle="${t.id}" aria-label="${on ? 'Đóng bán' : 'Mở bán'} chuyến ${t.time}"></button></div>
          <div class="room">${t.time} · ${t.plate}</div>
          <div class="name">${routeName(t.route)}</div>
          <div class="row"><span>${t.sold}/${t.total}</span><div class="bar ${pct >= 90 ? 'warn' : ''}"><i style="width:${pct}%"></i></div><span>${on ? 'Mở' : 'Đóng'}</span></div>
        </div>`;
      }).join('')}</div>` : `<div class="empty"><div class="ico">${icon('search')}</div>Không có chuyến khớp bộ lọc.</div>`}
    </section>
  </div>`;
};

function seatsFor(trip) {
  const limo = trip.vehicle.startsWith('Limo');
  const perDeck = limo ? 11 : 20;
  const seats = [];
  let soldLeft = trip.sold;
  const heldIdx = new Set([3, perDeck + 5]);
  for (let d = 1; d <= 2; d++) {
    for (let i = 1; i <= perDeck; i++) {
      const code = (d === 1 ? 'A' : 'B') + String(i).padStart(2, '0');
      const idx = (d - 1) * perDeck + i;
      const pseudo = (idx * 7) % 10;
      let st = 'free';
      if (heldIdx.has(idx) && trip.status === 'OPEN') st = 'held';
      else if (soldLeft > 0 && pseudo < 8) { st = 'sold'; soldLeft--; }
      seats.push({ code, deck: d, st, price: limo ? (d === 1 ? 450_000 : 420_000) : (d === 1 ? 380_000 : 350_000) });
    }
  }
  for (const s of seats) if (soldLeft > 0 && s.st === 'free') { s.st = 'sold'; soldLeft--; }
  return seats;
}

VIEWS.seats = (id) => {
  const trip = TRIPS.find((t) => t.id === (id || state.seatTrip)) || TRIPS[3];
  state.seatTrip = trip.id;
  const seats = seatsFor(trip);
  const sel = seats.find((s) => s.code === state.selectedSeat);
  const deck = (d) => `<div class="deck"><h4>${d === 1 ? 'Tầng dưới' : 'Tầng trên'}</h4><div class="seats">
    ${seats.filter((s) => s.deck === d).map((s) => `<button class="seat ${s.st} ${sel && sel.code === s.code ? 'sel' : ''}" data-seat="${s.code}"><b>${s.code}</b><small>${s.st === 'sold' ? 'Đã bán' : s.st === 'held' ? 'Đang giữ' : short(s.price)}</small></button>`).join('')}
  </div></div>`;
  return `<div class="page">
    <section class="glass hero page-hero">
      <div><h2>Sơ đồ chỗ</h2><div class="muted">${trip.time} · ${routeName(trip.route)} · ${trip.vehicle} · ${trip.plate}</div></div>
      <div class="actions">
        <select class="input" id="tripSelect" style="width:auto">${TRIPS.map((t) => `<option value="${t.id}" ${t.id === trip.id ? 'selected' : ''}>${t.time} · ${routeName(t.route)}</option>`).join('')}</select>
        <button class="btn" data-toast="Đã xuất danh sách khách chuyến ${trip.time} (Excel)">${icon('download')} Danh sách khách</button>
      </div>
    </section>
    <div class="grid g-main-side">
      <section class="glass card">
        <div class="seat-legend">
          <span><i style="border:1px solid var(--accent)"></i>Còn trống</span>
          <span><i style="background:rgba(240,180,92,.4)"></i>Đang giữ chỗ</span>
          <span><i style="background:var(--line-strong)"></i>Đã bán</span>
          <span><i style="background:var(--accent)"></i>Đang chọn</span>
        </div>
        <div class="decks">${deck(1)}${deck(2)}</div>
      </section>
      <section class="glass card">
        <div class="card-head"><div><h3>${sel ? 'Chỗ ' + sel.code : 'Chọn một chỗ'}</h3><div class="sub">${sel ? (sel.deck === 1 ? 'Tầng dưới' : 'Tầng trên') + ' · ' + vnd(sel.price) : 'Bấm vào sơ đồ để xem chi tiết'}</div></div></div>
        ${sel ? (sel.st === 'free'
          ? `<p class="muted">Chỗ còn trống. Có thể giữ chỗ cho khách gọi điện hoặc bán tại quầy.</p>
             <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" data-toast="Đã giữ chỗ ${sel.code} trong 15 phút">${icon('lock')} Giữ chỗ</button><button class="btn" data-toast="Mở form bán tại quầy cho ${sel.code}">${icon('ticket')} Bán tại quầy</button></div>`
          : sel.st === 'held'
            ? `<p class="muted">Khách đang giữ chỗ, chờ chuyển khoản. Tự hủy sau <b style="color:var(--warn)">11 phút</b>.</p><button class="btn" data-toast="Đã ghi nhận thu tiền mặt cho ${sel.code}">${icon('wallet')} Ghi nhận đã thu tiền</button>`
            : `<p class="muted">Đã thanh toán. Thông tin khách chỉ hiện với nhân viên được phân quyền.</p><div class="list-row"><span class="ico">${icon('phone')}</span><div class="t"><b>Khách ••• 482</b><span>Mã vé PN${sel.code}7Q · đón tại Bến xe Miền Đông</span></div></div>`)
          : `<div class="empty" style="padding:30px 0"><div class="ico">${icon('seat')}</div>${seats.filter((s) => s.st === 'free').length} chỗ trống · ${seats.filter((s) => s.st === 'held').length} đang giữ</div>`}
        <div class="stats-row" style="grid-template-columns:repeat(2,1fr)">
          <div class="stat"><span>Đã bán</span><b>${trip.sold}/${trip.total}</b></div>
          <div class="stat"><span>Doanh thu</span><b>${short(trip.revenue)}</b></div>
        </div>
      </section>
    </div>
  </div>`;
};

VIEWS.revenue = () => {
  const ranges = {
    day: { labels: HOURS.map((h) => h + ':00'), series: [{ values: SALES_TODAY, color: 'var(--accent)' }, { values: SALES_YDAY, color: 'var(--warn)', dashed: true }], unit: 'tr', title: 'Hôm nay', sub: 'Doanh thu theo giờ (triệu ₫), nét đứt là hôm qua' },
    week: { labels: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'], series: [{ values: [61, 58, 64, 70, 92, 118, 104], color: 'var(--accent)' }, { values: [55, 60, 59, 66, 85, 109, 98], color: 'var(--warn)', dashed: true }], unit: 'tr', title: 'Tuần này', sub: 'Doanh thu theo ngày (triệu ₫), nét đứt là tuần trước' },
    month: { labels: Array.from({ length: 30 }, (_, i) => String(i + 1)), series: [{ values: Array.from({ length: 30 }, (_, i) => 60 + 30 * Math.sin(i / 3) + (i % 7 >= 5 ? 35 : 0)), color: 'var(--accent)' }], unit: 'tr', title: 'Tháng 11', sub: 'Doanh thu theo ngày (triệu ₫)' },
  };
  const r = ranges[state.revenueRange];
  const byRoute = ROUTES.map((ro) => ({ ...ro, rev: TRIPS.filter((t) => t.route === ro.code).reduce((a, t) => a + t.revenue, 0), sold: TRIPS.filter((t) => t.route === ro.code).reduce((a, t) => a + t.sold, 0) })).sort((a, b) => b.rev - a.rev);
  const maxRev = byRoute[0].rev;
  const s = totals();
  return `<div class="page">
    <section class="glass hero"><h2 style="font-size:34px;margin:0 0 6px">Doanh thu</h2><div class="muted">${short(s.revenue)} ₫ hôm nay · ${s.sold} vé · tiền về tài khoản nhà xe qua SePay</div></section>
    <div><div class="tabs"><button class="on">Tổng quan</button><button data-toast="Tab Theo tuyến sẽ có ở bản sau">Theo tuyến</button><button data-toast="Tab Phí nền tảng sẽ có ở bản sau">Phí nền tảng <span class="badge neutral">1</span></button></div></div>
    <div class="grid g-4">
      <section class="glass kpi"><div class="label">${icon('coin')} Hôm nay</div><div class="value">${short(s.revenue)}<small>₫</small></div><div class="foot"><span class="live-dot"></span> trực tiếp</div>${spark(SALES_TODAY, 'var(--warn)')}</section>
      <section class="glass kpi"><div class="label">${icon('pulse')} Tuần này</div><div class="value">567<small>tr ₫</small></div><div class="foot"><span class="delta up">↑ 6%</span> so với tuần trước</div>${spark([61, 58, 64, 70, 92, 118, 104], 'var(--blue)')}</section>
      <section class="glass kpi"><div class="label">${icon('log')} Tháng 11</div><div class="value">1,94<small>tỷ ₫</small></div><div class="foot">5.212 vé · 20 ngày</div>${spark([40, 52, 48, 61, 58, 70, 66], 'var(--ok)')}</section>
      <section class="glass kpi"><div class="label">${icon('ticket')} Giá vé TB</div><div class="value">386<small>k ₫</small></div><div class="foot"><span class="delta down">↓ 2%</span> so với tháng 10</div>${spark([400, 395, 392, 390, 388, 386], 'var(--accent)', false)}</section>
    </div>
    <div class="grid g-main-side">
      <section class="glass card">
        <div class="card-head"><div><h3>${r.title}</h3><div class="sub">${r.sub}</div></div>
          <div class="seg" id="rangeSeg">${[['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng']].map(([k, l]) => `<button data-range="${k}" class="${state.revenueRange === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        ${areaChart(r.labels, r.series, r.unit)}
        <div class="legend"><span><i style="background:var(--accent)"></i>Kỳ này</span>${r.series[1] ? '<span><i style="background:var(--warn)"></i>Kỳ trước</span>' : ''}</div>
        <div class="stats-row">
          <div class="stat"><span>Chuyển khoản</span><b>91%</b></div>
          <div class="stat"><span>Tiền mặt tại quầy</span><b>9%</b></div>
          <div class="stat"><span>Giờ cao điểm</span><b>18:00–20:00</b></div>
          <div class="stat"><span>Hoàn tiền</span><b>${vnd(760_000)}</b></div>
        </div>
      </section>
      <section class="glass card">
        <div class="card-head"><div><h3>Theo tuyến</h3><div class="sub">Hôm nay, xếp theo doanh thu</div></div><a class="link" href="#/routes">Tuyến</a></div>
        ${byRoute.map((ro) => `<div class="list-row"><span class="ico">${icon('route')}</span><div class="t"><b>${ro.name}</b><span>${ro.sold} vé · ${short(ro.rev)} ₫</span></div><div class="mini-bar"><i style="width:${Math.round((ro.rev / maxRev) * 100)}%"></i></div></div>`).join('')}
      </section>
    </div>
  </div>`;
};

VIEWS.payments = () => {
  const list = PAYMENTS.filter((p) => state.payFilter === 'all' || p.status === state.payFilter);
  const n = (k) => PAYMENTS.filter((p) => p.status === k).length;
  return `<div class="page">
    <section class="glass hero page-hero">
      <div><h2>Thanh toán</h2><div class="muted">Giao dịch SePay và tiền mặt hôm nay · ${n('bad') + n('warn')} khoản cần xử lý</div></div>
      <div class="actions"><button class="btn" data-toast="Đã đối soát lại 7 giao dịch, không có thay đổi">${icon('refresh')} Đối soát lại</button><button class="btn primary" data-toast="Mở form ghi nhận tiền mặt">${icon('plus')} Ghi nhận tiền mặt</button></div>
    </section>
    <div><div class="tabs" id="payTabs">
      ${[['all', 'Tất cả', PAYMENTS.length], ['ok', 'Đã khớp', n('ok')], ['warn', 'Thiếu tiền', n('warn')], ['bad', 'Chưa khớp', n('bad')]].map(([k, l, c]) => `<button data-p="${k}" class="${state.payFilter === k ? 'on' : ''}">${l} <span class="badge ${k === 'bad' || k === 'warn' ? '' : 'neutral'}">${c}</span></button>`).join('')}
    </div></div>
    <section class="glass card">
      <div class="table-wrap"><table>
        <thead><tr><th>Giờ</th><th>Mã giao dịch</th><th>Nội dung chuyển khoản</th><th>Mã đơn</th><th class="num">Số tiền</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>${list.map((p) => `<tr><td>${p.at}</td><td class="mono">${p.ref}</td><td class="muted">${p.content}</td><td class="mono">${p.booking}</td><td class="num">${vnd(p.amount)}</td>
          <td><span class="status ${PAY_STATUS[p.status][0]}">${PAY_STATUS[p.status][1]}</span></td>
          <td>${p.status === 'ok' ? '' : `<button class="btn" style="padding:6px 12px" data-toast="Mở hộp thoại gán giao dịch ${p.ref} vào đơn">Gán vào đơn</button>`}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>
  </div>`;
};

VIEWS.routes = () => `<div class="page">
  <section class="glass hero page-hero"><div><h2>Tuyến & điểm đón</h2><div class="muted">${ROUTES.length} tuyến đang khai thác</div></div><div class="actions"><button class="btn primary" data-toast="Mở form thêm tuyến">${icon('plus')} Thêm tuyến</button></div></section>
  <div class="cards">${ROUTES.map((r, i) => `<div class="tcard on"><div class="top"><span class="ico">${icon('route')}</span><span class="badge neutral">${r.code}</span></div>
    <div class="name">${r.name}</div><div class="room">${[6, 4, 5, 3][i]} điểm đón · ${[4, 3, 2, 2][i]} điểm trả</div>
    <div class="row"><span>${TRIPS.filter((t) => t.route === r.code).length} chuyến hôm nay</span></div></div>`).join('')}</div>
</div>`;

VIEWS.vehicles = () => {
  const vs = [...new Map(TRIPS.map((t) => [t.plate, t])).values()];
  return `<div class="page">
    <section class="glass hero page-hero"><div><h2>Xe & sơ đồ chỗ</h2><div class="muted">${vs.length} xe · 2 mẫu sơ đồ (Limousine 22 phòng, Giường nằm 40 chỗ)</div></div><div class="actions"><button class="btn primary" data-toast="Mở form thêm xe">${icon('plus')} Thêm xe</button></div></section>
    <section class="glass card"><div class="table-wrap"><table><thead><tr><th>Biển số</th><th>Loại xe</th><th class="num">Số chỗ</th><th>Chuyến tiếp theo</th><th>Trạng thái</th></tr></thead>
    <tbody>${vs.map((t) => `<tr><td class="mono">${t.plate}</td><td>${t.vehicle}</td><td class="num">${t.total}</td><td>${t.time} · ${routeName(t.route)}</td><td><span class="status ${t.state === 'Đang chạy' ? 'st-warn' : 'st-ok'}">${t.state === 'Đang chạy' ? 'Đang chạy' : 'Sẵn sàng'}</span></td></tr>`).join('')}</tbody></table></div></section>
  </div>`;
};

VIEWS.staff = () => `<div class="page">
  <section class="glass hero page-hero"><div><h2>Nhân viên</h2><div class="muted">${STAFF.length} tài khoản · bắt buộc xác thực 2 lớp với vai trò quản lý</div></div><div class="actions"><button class="btn primary" data-toast="Mở form thêm nhân viên">${icon('plus')} Thêm nhân viên</button></div></section>
  <section class="glass card"><div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>Vai trò</th><th>Số điện thoại</th><th>Xác thực 2 lớp</th><th>Trạng thái</th></tr></thead>
  <tbody>${STAFF.map((u) => `<tr><td>${u.name}</td><td>${u.role}</td><td class="mono">${u.phone}</td><td>${u.mfa ? `<span class="status st-ok">Đã bật</span>` : `<span class="status st-warn">Chưa bật</span>`}</td><td><span class="status ${u.status === 'ok' ? 'st-ok' : 'st-grey'}">${u.status === 'ok' ? 'Hoạt động' : 'Tạm khóa'}</span></td></tr>`).join('')}</tbody></table></div></section>
</div>`;

VIEWS.audit = () => `<div class="page">
  <section class="glass hero"><h2 style="font-size:34px;margin:0 0 6px">Nhật ký thao tác</h2><div class="muted">Mọi thao tác ghi của nhân viên đều được lưu lại</div></section>
  <section class="glass card">${[
    ['19:40', 'Ngọc Lan', 'Đóng bán chuyến 07:00 TP.HCM → Hoài Ân', 'lock'],
    ['19:12', 'Hệ thống', 'Nhận giao dịch FT2632409702 nhưng không khớp đơn nào', 'alert'],
    ['18:22', 'Văn Toàn', 'Ghi nhận tiền mặt 380.000 ₫ cho đơn PNR8YV4', 'wallet'],
    ['17:05', 'Xuân Hiếu', 'Đổi giá tầng 2 chuyến 19:30 từ 360.000 ₫ thành 350.000 ₫', 'coin'],
    ['16:48', 'Ngọc Lan', 'Tạo chuyến 21:30 Hoài Ân → TP.HCM', 'plus'],
  ].map(([t, who, what, ic]) => `<div class="list-row"><span class="ico">${icon(ic)}</span><div class="t"><b>${what}</b><span>${who} · ${t}</span></div></div>`).join('')}</section>
</div>`;

VIEWS.settings = () => `<div class="page">
  <section class="glass hero"><h2 style="font-size:34px;margin:0 0 6px">Cài đặt</h2><div class="muted">Chính sách bán vé và tài khoản nhận tiền của nhà xe</div></section>
  <section class="glass card">
    <div class="card-head"><h3>Chính sách bán vé</h3></div>
    <div class="form-row"><div><b>Thời gian giữ chỗ chờ thanh toán</b><span>Hết hạn thì chỗ tự trả lại</span></div><input class="input" value="15 phút"></div>
    <div class="form-row"><div><b>Đóng bán trước giờ chạy</b><span>Áp dụng mặc định cho chuyến mới</span></div><input class="input" value="60 phút"></div>
    <div class="form-row"><div><b>Trẻ em dưới 5 tuổi</b><span>Ngồi cùng người lớn, không tính chỗ</span></div><button class="switch on" data-switch aria-label="Bật miễn phí trẻ em"></button></div>
    <div class="form-row"><div><b>Gửi nhắc giờ đi qua Zalo</b><span>2 giờ trước giờ khởi hành</span></div><button class="switch on" data-switch aria-label="Bật nhắc giờ đi"></button></div>
  </section>
  <section class="glass card">
    <div class="card-head"><h3>Tài khoản nhận tiền</h3></div>
    <div class="form-row"><div><b>Ngân hàng</b><span>Tiền về thẳng tài khoản nhà xe</span></div><input class="input" value="Vietcombank"></div>
    <div class="form-row"><div><b>Số tài khoản</b><span>Hiển thị trên mã QR cho khách</span></div><input class="input" value="•••• •••• 6789"></div>
    <div class="form-row"><div><b>Webhook SePay</b><span>Đường dẫn nhận thông báo chuyển khoản</span></div><span class="status st-ok">Đang hoạt động</span></div>
  </section>
</div>`;

VIEWS.help = () => `<div class="page"><section class="glass card"><div class="empty"><div class="ico">${icon('help')}</div><b>Trung tâm trợ giúp</b><p>Hướng dẫn sử dụng cho nhân viên nhà xe sẽ có ở bản sau.</p></div></section></div>`;

// ---------- Navigation ----------
const NAV = [
  ['VẬN HÀNH'],
  ['overview', 'Tổng quan', 'grid'],
  ['trips', 'Chuyến xe', 'bus', TRIPS.filter((t) => t.state === 'Sắp đóng bán').length],
  ['seats', 'Sơ đồ chỗ', 'seat'],
  ['routes', 'Tuyến & điểm đón', 'route'],
  ['vehicles', 'Xe', 'van'],
  ['TÀI CHÍNH'],
  ['revenue', 'Doanh thu', 'chart'],
  ['payments', 'Thanh toán', 'wallet', PAYMENTS.filter((p) => p.status !== 'ok').length],
  ['QUẢN LÝ'],
  ['staff', 'Nhân viên', 'users'],
  ['audit', 'Nhật ký', 'shield'],
  ['settings', 'Cài đặt', 'settings'],
  ['help', 'Trợ giúp', 'help'],
];
const TITLES = Object.fromEntries(NAV.filter((n) => n[1]).map((n) => [n[0], n[1]]));

function renderNav(active) {
  $('#nav').innerHTML = NAV.map((n) => n.length === 1
    ? `<div class="nav-group">${n[0]}</div>`
    : `<a href="#/${n[0]}" class="${active === n[0] ? 'active' : ''}" title="${n[1]}">${icon(n[2])}<span class="nav-label">${n[1]}</span>${n[3] ? `<span class="badge">${n[3]}</span>` : ''}</a>`).join('');
  $('#bottomNav').innerHTML = [['overview', 'Tổng quan', 'grid'], ['trips', 'Chuyến', 'bus'], ['seats', 'Sơ đồ', 'seat'], ['revenue', 'Doanh thu', 'chart'], ['payments', 'Tiền', 'wallet']]
    .map(([k, l, ic]) => `<a href="#/${k}" class="${active === k ? 'active' : ''}">${icon(ic)}<span>${l}</span></a>`).join('');
}

function render() {
  const [, page = 'overview', arg] = location.hash.split('/');
  const key = VIEWS[page] ? page : 'overview';
  $('#view').innerHTML = VIEWS[key](arg);
  $('#pageTitle').textContent = TITLES[key];
  renderNav(key);
  $('#app').classList.remove('nav-open');
}

// ---------- Events ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a, [data-close-nav]');
  if (!t) return;
  if (t.matches('[data-toast]')) toast(t.dataset.toast);
  if (t.matches('[data-open-nav]')) $('#app').classList.add('nav-open');
  if (t.matches('[data-close-nav]')) $('#app').classList.remove('nav-open');
  if (t.matches('[data-switch]')) t.classList.toggle('on');
  if (t.dataset.toggle) {
    const trip = TRIPS.find((x) => x.id === t.dataset.toggle);
    trip.status = trip.status === 'OPEN' ? 'CLOSED' : 'OPEN';
    trip.state = trip.status === 'OPEN' ? 'Đang bán' : 'Đã đóng bán';
    toast(`${trip.status === 'OPEN' ? 'Đã mở bán' : 'Đã đóng bán'} chuyến ${trip.time} ${routeName(trip.route)}`);
    render();
  }
  if (t.dataset.f) { state.tripFilter = t.dataset.f; render(); }
  if (t.dataset.r) { state.routeFilter = t.dataset.r; render(); }
  if (t.dataset.p) { state.payFilter = t.dataset.p; render(); }
  if (t.dataset.range) { state.revenueRange = t.dataset.range; render(); }
  if (t.dataset.seat) { state.selectedSeat = state.selectedSeat === t.dataset.seat ? null : t.dataset.seat; render(); }
  if (t.closest('#fillSeg')) { t.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === t)); }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'tripSearch') {
    state.tripQuery = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const el = $('#tripSearch');
    el.focus();
    el.setSelectionRange(pos, pos);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'tripSelect') { state.selectedSeat = null; location.hash = '#/seats/' + e.target.value; }
});

$('#globalSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    state.tripQuery = e.target.value;
    location.hash = '#/trips';
    render();
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#globalSearch').focus(); }
  if (e.key === 'Escape') $('#app').classList.remove('nav-open');
});

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#themeBtn');
  btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
}
$('#themeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  store.set('pn-theme', next);
});

$('#collapseBtn').addEventListener('click', () => {
  $('#app').classList.toggle('collapsed');
  store.set('pn-collapsed', $('#app').classList.contains('collapsed') ? '1' : '0');
});

function tickClock() {
  const d = new Date();
  const date = d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  $('#nowText').textContent = `${date[0].toUpperCase()}${date.slice(1)} · ${time}`;
}

hydrateIcons();
applyTheme(store.get('pn-theme') || 'dark');
if (store.get('pn-collapsed') === '1') $('#app').classList.add('collapsed');
tickClock();
setInterval(tickClock, 30_000);
window.addEventListener('hashchange', render);
render();
