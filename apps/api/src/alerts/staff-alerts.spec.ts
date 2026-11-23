import { isPrivateAddress, smtpErrorMessage } from './mail-sender';
import { alertMessage, alertSettingsSchema, AlertBooking, maskPhone, StaffAlertConfig, vnDateTime } from './staff-alerts.service';

const valid = {
  enabled: true, smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpUser: 'NhaXe@Gmail.com', smtpPassword: 'abcd efgh ijkl mnop',
  fromName: 'Nhà xe PN', recipients: ['a@x.vn'], onBookingHeld: false, onPaymentProof: true,
};
const issues = (v: unknown) => alertSettingsSchema.safeParse(v).error?.issues.map((i) => i.path.join('.')) ?? [];

describe('QS03 — alert settings validation', () => {
  it('accepts a Gmail config and normalises emails to lower case', () => {
    const r = alertSettingsSchema.parse(valid);
    expect(r.smtpUser).toBe('nhaxe@gmail.com');
  });

  it.each(['127.0.0.1', 'localhost', 'smtp', 'mail.railway.internal', 'smtp.corp', 'a b.com', '[::1]', 'x.local'])(
    'rejects SMTP host %s (IP literals and internal names are not dialled)', (smtpHost) => {
      expect(issues({ ...valid, smtpHost })).toEqual(['smtpHost']);
    },
  );

  it('only allows ports 465 and 587', () => {
    expect(issues({ ...valid, smtpPort: 25 })).toEqual(['smtpPort']);
    expect(issues({ ...valid, smtpPort: 587 })).toEqual([]);
  });

  it('requires 1 to 5 distinct recipients', () => {
    expect(issues({ ...valid, recipients: [] })).toEqual(['recipients']);
    expect(issues({ ...valid, recipients: ['a@x.vn', 'b@x.vn', 'c@x.vn', 'd@x.vn', 'e@x.vn', 'f@x.vn'] })).toEqual(['recipients']);
    expect(issues({ ...valid, recipients: ['a@x.vn', 'A@x.vn'] })).toEqual(['recipients']);
    expect(issues({ ...valid, recipients: ['not-an-email'] })).toEqual(['recipients.0']);
  });

  it('rejects header injection in the sender name and unknown fields', () => {
    expect(issues({ ...valid, fromName: 'PN\r\nBcc: x@y.z' })).toEqual(['fromName']);
    expect(alertSettingsSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});

describe('QS03 — private address guard', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1'])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(['142.250.4.108', '172.32.0.1', '100.128.0.1', '2607:f8b0:4023::6c'])('allows public %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('QS03 — SMTP error messages', () => {
  it('explains a rejected login without echoing the server reply', () => {
    expect(smtpErrorMessage({ code: 'EAUTH', response: '535 secret stuff' })).toMatch(/mật khẩu ứng dụng/);
    expect(smtpErrorMessage({ code: 'ETIMEDOUT' })).toMatch(/Không kết nối/);
    expect(smtpErrorMessage({ responseCode: 550 })).toBe('Gửi email thất bại (mã 550).');
    expect(smtpErrorMessage(new Error('boom'))).toBe('Gửi email thất bại.');
  });
});

describe('QS03 — alert email content', () => {
  const b: AlertBooking = {
    operatorCode: 'PN', code: 'PNAB12', status: 'HOLDING', contactName: 'Nguyễn Văn A', contactPhone: '0912345678',
    tripId: '11111111-1111-4111-8111-111111111111', tripName: 'TP.HCM → Hoài Ân', departAt: new Date('2027-02-01T13:30:00Z'),
    seats: ['A1', 'A2'], totalAmount: 840000, depositAmount: 200000, paidAmount: 0, releaseAt: new Date('2027-02-01T05:00:00Z'), proofCount: 2,
  };

  it('masks the phone, shows VN times and links to the booking in the dashboard', () => {
    const m = alertMessage('staff.payment_proof', b, 'https://dash.example.vn/');
    expect(m.subject).toBe('[PN] Khách gửi ảnh chuyển khoản — vé PNAB12');
    expect(m.text).toContain('0912***678');
    expect(m.text).not.toContain('0912345678');
    expect(m.text).toContain('Khởi hành: 20:30 01/02/2027');
    expect(m.text).toContain('Giữ chỗ đến: 12:00 01/02/2027');
    expect(m.text).toContain('(2 ảnh)');
    expect(m.text).toContain(`https://dash.example.vn/admin/passengers?date=2027-02-01&trip=${b.tripId}&booking=PNAB12`);
  });

  it('uses the VN calendar date for the link (late-evening departures)', () => {
    expect(vnDateTime(new Date('2027-02-01T17:30:00Z'))).toBe('00:30 02/02/2027');
  });

  it('new-booking mail names the seat count; no link without a dashboard URL', () => {
    const m = alertMessage('staff.booking_held', { ...b, status: 'CONFIRMED' }, null);
    expect(m.subject).toBe('[PN] Đơn mới PNAB12 — 2 chỗ, 20:30 01/02/2027');
    expect(m.text).toContain('Trạng thái hiện tại: CONFIRMED');
    expect(m.text).not.toContain('Dashboard:');
  });

  it('says contact details were erased instead of printing empty values', () => {
    const m = alertMessage('staff.booking_held', { ...b, contactName: null, contactPhone: null }, null);
    expect(m.text).toContain('Khách: Đã xóa thông tin liên hệ');
  });

  it('masks short or odd phone values entirely and shows +84 numbers in local form', () => {
    expect(maskPhone('123')).toBe('***');
    expect(maskPhone('+84912345678')).toBe('0912***678');
  });
});

describe('QS03 — StaffAlertConfig', () => {
  it('disables the worker for bad intervals and ignores a malformed dashboard URL', () => {
    expect(new StaffAlertConfig(NaN).intervalMs).toBe(0);
    expect(new StaffAlertConfig(10).intervalMs).toBe(0);
    expect(new StaffAlertConfig(30_000, 'https://d.vn').dashboardUrl).toBe('https://d.vn');
    expect(new StaffAlertConfig(30_000, 'javascript:alert(1)').dashboardUrl).toBeNull();
  });
});
