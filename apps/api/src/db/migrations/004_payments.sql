-- T6: thanh toán chuyển khoản qua SePay, phân bổ tiền vào đơn, xác nhận thủ công, outbox.
-- Tiền: integer VND. Giao dịch gốc không sửa/xóa; điều chỉnh bằng bản ghi mới (PNTicketDocs mục 6.4).

-- Tỷ lệ cọc (%) để xác nhận vé; 100 = trả đủ. Chụp vào đơn lúc giữ chỗ.
ALTER TABLE operator_policies
  ADD COLUMN deposit_percent int NOT NULL DEFAULT 100 CHECK (deposit_percent BETWEEN 1 AND 100);

ALTER TABLE bookings
  ADD COLUMN deposit_amount int NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  ADD COLUMN paid_amount    int NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  ADD COLUMN payment_status text NOT NULL DEFAULT 'UNPAID'
    CHECK (payment_status IN ('UNPAID', 'PARTIAL', 'DEPOSIT_PAID', 'PAID')),
  ADD COLUMN confirmed_at   timestamptz,
  ADD CONSTRAINT bookings_paid_le_total CHECK (paid_amount <= total_amount),
  ADD CONSTRAINT bookings_deposit_le_total CHECK (deposit_amount <= total_amount);
UPDATE bookings SET deposit_amount = total_amount WHERE deposit_amount = 0;

-- Tài khoản ngân hàng nhận tiền của nhà xe, kết nối SePay. Tiền đi thẳng vào tài khoản nhà xe.
CREATE TABLE operator_payment_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id           uuid NOT NULL REFERENCES operators(id),
  provider              text NOT NULL CHECK (provider IN ('SEPAY')),
  bank_code             text NOT NULL CHECK (bank_code ~ '^[A-Za-z0-9]{2,20}$'),
  account_number        text NOT NULL CHECK (account_number ~ '^[0-9A-Za-z]{4,30}$'),
  account_name          text NOT NULL CHECK (length(btrim(account_name)) > 0),
  webhook_key_hash      text NOT NULL,            -- SHA-256 của API Key webhook; không lưu khóa gốc
  api_token_enc         text,                     -- token API SePay (đối soát), đã mã hóa
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, account_number)
);
CREATE UNIQUE INDEX operator_payment_accounts_one_active ON operator_payment_accounts (operator_id) WHERE active;

-- Mọi sự kiện nhà cung cấp gửi tới (kể cả tiền ra, trùng lặp) — lưu bền vững để đối chiếu.
CREATE TABLE provider_events (
  id                 bigserial PRIMARY KEY,
  provider           text NOT NULL,
  account_number     text NOT NULL,
  provider_txn_id    text NOT NULL,
  payload            jsonb NOT NULL,
  source             text NOT NULL CHECK (source IN ('WEBHOOK', 'RECONCILE')),
  received_at        timestamptz NOT NULL,
  UNIQUE (provider, account_number, provider_txn_id)
);

-- Khoản thu gốc (chuyển khoản qua nhà cung cấp, chuyển khoản/tiền mặt nhân viên ghi nhận).
CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id        uuid NOT NULL REFERENCES operators(id),
  method             text NOT NULL CHECK (method IN ('BANK_TRANSFER', 'MANUAL_BANK', 'CASH')),
  provider           text,
  provider_txn_id    text,
  account_number     text,
  amount             int  NOT NULL CHECK (amount > 0),
  fee_amount         int  NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  content            text,
  reference_code     text,
  transaction_at     timestamptz NOT NULL,
  received_at        timestamptz NOT NULL,
  allocated_amount   int  NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  matched_booking_id uuid REFERENCES bookings(id),      -- đơn nhận diện được từ nội dung (kể cả khi chưa phân bổ)
  review_status      text NOT NULL DEFAULT 'NONE' CHECK (review_status IN ('NONE', 'NEEDS_REVIEW', 'RESOLVED')),
  review_reason      text CHECK (review_reason IN ('UNMATCHED', 'AMBIGUOUS', 'LATE', 'OVERPAID', 'BOOKING_CLOSED')),
  review_note        text,
  recorded_by        uuid REFERENCES users(id),
  idempotency_key    text,
  request_hash       text,                              -- băm yêu cầu ghi tay (chống dùng lại Idempotency-Key cho yêu cầu khác)
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (allocated_amount <= amount),
  CHECK ((method = 'BANK_TRANSFER') = (provider IS NOT NULL AND provider_txn_id IS NOT NULL)),
  CHECK (review_status = 'NONE' OR review_reason IS NOT NULL),
  UNIQUE (provider, account_number, provider_txn_id),
  UNIQUE (operator_id, idempotency_key)
);
CREATE INDEX payments_operator_review_idx ON payments (operator_id, review_status, received_at DESC);

-- Phân bổ từng khoản thu vào đơn. Không sửa/xóa; mỗi dòng là một lần phân bổ.
CREATE TABLE payment_allocations (
  id           bigserial PRIMARY KEY,
  payment_id   uuid NOT NULL REFERENCES payments(id),
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  amount       int  NOT NULL CHECK (amount > 0),
  allocated_by uuid REFERENCES users(id),               -- NULL = hệ thống tự phân bổ
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_allocations_booking_idx ON payment_allocations (booking_id);

-- Sự kiện cần gửi đi (vé, thông báo) ghi trong cùng transaction với nghiệp vụ; worker gửi ở T7.
CREATE TABLE outbox_events (
  id            bigserial PRIMARY KEY,
  operator_id   uuid NOT NULL REFERENCES operators(id),
  type          text NOT NULL,
  aggregate_id  uuid NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key    text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);
CREATE INDEX outbox_events_pending_idx ON outbox_events (created_at) WHERE processed_at IS NULL;
