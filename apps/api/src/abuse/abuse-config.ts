/** Ngưỡng chống lạm dụng. Giá trị mặc định cho vận hành; test truyền giá trị nhỏ hơn. */
export class AbuseConfig {
  /** Tạo đơn giữ chỗ: tối đa theo IP mỗi phút. */
  bookingsPerIpPerMinute = 20;
  /** Tạo đơn giữ chỗ: tối đa theo SĐT (trong một nhà xe) mỗi giờ. */
  bookingsPerPhonePerHour = 10;
  /** Gửi OTP: tối thiểu cách nhau (giây) cho cùng SĐT, và tối đa mỗi giờ. */
  otpResendSeconds = 60;
  otpPerPhonePerHour = 5;
  /** Gửi OTP: tối đa theo IP mỗi giờ. */
  otpPerIpPerHour = 20;
  /** OTP: hiệu lực (giây) và số lần nhập sai tối đa. */
  otpTtlSeconds = 300;
  otpMaxAttempts = 5;
  /** Token "đã xác thực SĐT": hiệu lực (giây). */
  phoneTokenTtlSeconds = 30 * 60;
  /** Đổi token Zalo lấy SĐT: tối đa theo IP mỗi giờ (nới rộng vì nhà mạng di động dùng chung IP cho nhiều khách). */
  zaloPhonePerIpPerHour = 120;
  /** Đăng nhập nội bộ: tối đa theo IP trong 15 phút (mọi tài khoản cộng lại). */
  loginsPerIpPer15Min = 30;

  constructor(overrides: Partial<AbuseConfig> = {}) {
    Object.assign(this, overrides);
  }
}
