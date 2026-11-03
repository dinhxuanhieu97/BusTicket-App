-- T5: tài khoản nội bộ, phân quyền, 2FA, nhật ký thao tác.

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id           uuid REFERENCES operators(id),          -- NULL = quản trị nền tảng
  full_name             text NOT NULL CHECK (length(btrim(full_name)) > 0),
  phone                 text NOT NULL UNIQUE CHECK (phone ~ '^\+84[35789][0-9]{8}$'),
  password_hash         text NOT NULL,
  role                  text NOT NULL CHECK (role IN ('PLATFORM_ADMIN', 'OWNER', 'ACCOUNTANT', 'DISPATCHER', 'SELLER', 'ASSISTANT')),
  status                text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  token_version         int  NOT NULL DEFAULT 1,
  failed_login_count    int  NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  mfa_secret_enc        text,                                     -- bí mật TOTP đã mã hóa
  mfa_pending_enc       text,                                     -- bí mật đang chờ xác nhận
  mfa_enabled           boolean NOT NULL DEFAULT false,
  mfa_last_step         bigint,                                   -- chống dùng lại mã OTP
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'PLATFORM_ADMIN') = (operator_id IS NULL)),
  CHECK (NOT mfa_enabled OR mfa_secret_enc IS NOT NULL)
);
CREATE INDEX users_operator_idx ON users (operator_id);

CREATE TABLE audit_logs (
  id             bigserial PRIMARY KEY,
  operator_id    uuid REFERENCES operators(id),
  actor_user_id  uuid REFERENCES users(id),
  action         text NOT NULL,
  entity         text NOT NULL,
  entity_id      text,
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_operator_at_idx ON audit_logs (operator_id, at DESC);

-- Tên xe duy nhất trong nhà xe, không phân biệt hoa/thường ("Xe 03" = "xe 03").
ALTER TABLE vehicles DROP CONSTRAINT vehicles_operator_id_name_key;
CREATE UNIQUE INDEX vehicles_operator_lower_name_key ON vehicles (operator_id, lower(btrim(name)));
