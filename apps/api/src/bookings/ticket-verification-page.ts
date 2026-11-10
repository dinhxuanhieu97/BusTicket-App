import type { TicketVerification } from './bookings.service';

const statusLabels: Record<string, string> = {
  HOLDING: 'Đang giữ chỗ', CONFIRMED: 'Đã xác nhận', COMPLETED: 'Đã hoàn tất',
  EXPIRED: 'Hết hạn giữ chỗ', CANCELLED: 'Đã hủy',
};
const paymentLabels: Record<string, string> = {
  UNPAID: 'Chưa thanh toán', PARTIAL: 'Đã thanh toán một phần',
  DEPOSIT_PAID: 'Đã thanh toán cọc', PAID: 'Đã thanh toán đủ',
};
const vnDateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short',
});
const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (char) => entities[char]!);
}

export function renderTicketVerification(ticket: TicketVerification | null): string {
  const trips = ticket?.trips.map((trip) => `
    <section class="leg">
      <h2>${escapeHtml(trip.origin)} → ${escapeHtml(trip.destination)}</h2>
      ${trip.cancelled ? '<p class="warning">Chuyến đã hủy</p>' : ''}
      <p>${escapeHtml(trip.name)} · ${vnDateTime.format(trip.departAt)}</p>
      <p><strong>Chỗ</strong> ${trip.seats.map((seat) => `${escapeHtml(seat.code)} (${seat.occupancy} người)`).join(', ')}</p>
    </section>`).join('');
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Đối chiếu phiếu đặt vé</title>
  <style>
    body{margin:0;background:#eff3f8;color:#14243b;font:16px/1.55 system-ui,sans-serif}
    main{max-width:640px;margin:24px auto;padding:0 16px}
    header{padding:20px;background:#102641;color:white;border-radius:16px 16px 0 0;border-bottom:3px solid #caa66c}
    header p,h1,h2{margin:0} h1{font-size:24px} h2{font-size:17px}
    article{padding:20px;background:white;border-radius:0 0 16px 16px;overflow-wrap:anywhere}
    dl{display:grid;grid-template-columns:1fr auto;gap:8px 12px} dd{margin:0;font-weight:650;text-align:right}
    .leg{border-top:1px dashed #bac6d6;padding:14px 0 0;margin-top:14px}
    .leg p{margin:5px 0}.warning{color:#a21f27;font-weight:650}
  </style>
</head>
<body><main>
  <header><p>PNTicket</p><h1>Đối chiếu phiếu đặt vé</h1></header>
  <article>${ticket ? `
    <h2>${escapeHtml(ticket.operatorName)}</h2>
    <dl>
      <dt>Mã đơn</dt><dd>${escapeHtml(ticket.code)}</dd>
      <dt>Trạng thái đơn</dt><dd>${escapeHtml(statusLabels[ticket.status] ?? ticket.status)}</dd>
      <dt>Thanh toán</dt><dd>${escapeHtml(paymentLabels[ticket.paymentStatus] ?? ticket.paymentStatus)}</dd>
      <dt>Tổng tiền cọc</dt><dd>${vnd.format(ticket.depositAmount)}</dd>
      ${ticket.paymentDeadline ? `<dt>Hạn chuyển khoản</dt><dd>${vnDateTime.format(ticket.paymentDeadline)}</dd>` : ''}
    </dl>
    ${trips}
    <p>Đối chiếu mã đơn, chuyến, giờ khởi hành và chỗ với phiếu khách xuất trình.</p>
  ` : '<p class="warning">Không xác minh được phiếu đặt vé.</p><p>Vui lòng quét lại QR từ phiếu gốc.</p>'}</article>
</main></body></html>`;
}
