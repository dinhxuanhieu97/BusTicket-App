-- Phiên đăng nhập quản trị có refresh token xoay vòng (đăng nhập 30 ngày, thu hồi từng thiết bị).
-- Chỉ lưu SHA-256 của refresh token; token thô chỉ tồn tại trong cookie HttpOnly của dashboard.
CREATE TABLE auth_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_version      int  NOT NULL,                 -- users.token_version lúc tạo; lệch = phiên bị thu hồi
  remember           boolean NOT NULL,
  refresh_hash       text NOT NULL,
  prev_refresh_hash  text,                          -- token ngay trước đó, để chịu được refresh song song trong ân hạn
  rotated_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,          -- hạn tuyệt đối, không kéo dài khi refresh
  revoked_at         timestamptz,
  revoke_reason      text CHECK (revoke_reason IN ('LOGOUT', 'REUSE', 'CREDENTIALS_CHANGED')),
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id, expires_at);

-- Refresh token đã bị thay (cũ hơn token liền trước): xuất trình lại = token bị đánh cắp → thu hồi cả phiên.
-- Chỉ lưu SHA-256; phải khớp hash nên người chỉ biết session id không thể thu hồi phiên của người khác.
CREATE TABLE auth_session_retired_tokens (
  session_id    uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  refresh_hash  text NOT NULL,
  retired_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, refresh_hash)
);
