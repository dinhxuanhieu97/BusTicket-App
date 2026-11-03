-- PNTicket: nhà xe, mẫu sơ đồ, xe, tuyến, chuyến, kho chỗ, giữ chỗ.
-- Tiền: integer VND. Thời gian: timestamptz (UTC).

CREATE TABLE operators (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2,4}$'),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Chính sách có phiên bản; bản mới nhất là bản đang áp dụng, đơn chụp lại bản đã dùng.
CREATE TABLE operator_policies (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id            uuid NOT NULL REFERENCES operators(id),
  version                int  NOT NULL CHECK (version > 0),
  hold_minutes           int  NOT NULL CHECK (hold_minutes BETWEEN 1 AND 120),
  max_units_per_booking  int  NOT NULL CHECK (max_units_per_booking BETWEEN 1 AND 20),
  child_policy           jsonb NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, version)
);

-- operator_id NULL = mẫu dùng chung trong thư viện.
CREATE TABLE seat_layouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid REFERENCES operators(id),
  code         text NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,32}$'),
  version      int  NOT NULL CHECK (version > 0),
  name         text NOT NULL,
  unit         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('room', 'bed', 'seat')),
  definition   jsonb NOT NULL,
  capacity     int  NOT NULL CHECK (capacity > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (operator_id, code, version)
);

CREATE TABLE seats (
  seat_layout_id  uuid NOT NULL REFERENCES seat_layouts(id) ON DELETE CASCADE,
  code            text NOT NULL,
  floor           text NOT NULL,
  row_idx         int  NOT NULL,
  col_idx         int  NOT NULL,
  max_occupancy   int  NOT NULL CHECK (max_occupancy BETWEEN 1 AND 2),
  sellable        boolean NOT NULL DEFAULT true,
  PRIMARY KEY (seat_layout_id, code)
);

CREATE TABLE vehicles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES operators(id),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  type            text NOT NULL CHECK (type IN ('LIMOUSINE', 'SLEEPER', 'SEATER')),
  plate_number    text,
  seat_layout_id  uuid NOT NULL REFERENCES seat_layouts(id),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'MAINTENANCE', 'RETIRED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, name)
);

CREATE TABLE routes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid NOT NULL REFERENCES operators(id),
  code         text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,32}$'),
  origin       text NOT NULL CHECK (length(btrim(origin)) > 0),
  destination  text NOT NULL CHECK (length(btrim(destination)) > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, code)
);

CREATE TABLE trips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES operators(id),
  route_id        uuid NOT NULL REFERENCES routes(id),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  seat_layout_id  uuid NOT NULL REFERENCES seat_layouts(id),  -- phiên bản sơ đồ đã chụp
  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  contact_phone   text,
  depart_at       timestamptz NOT NULL,
  sales_open_at   timestamptz NOT NULL,
  sales_close_at  timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (sales_open_at < sales_close_at AND sales_close_at <= depart_at)
);
CREATE INDEX trips_operator_depart_idx ON trips (operator_id, depart_at);

-- Giá theo tầng × số người (phòng đơn = 1, phòng đôi = 2; giường/ghế luôn 1).
CREATE TABLE trip_fares (
  trip_id    uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  floor      text NOT NULL,
  occupancy  int  NOT NULL CHECK (occupancy BETWEEN 1 AND 2),
  price      int  NOT NULL CHECK (price >= 0),
  PRIMARY KEY (trip_id, floor, occupancy)
);

CREATE TABLE bookings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id           uuid NOT NULL REFERENCES operators(id),
  trip_id               uuid NOT NULL REFERENCES trips(id),
  code                  text NOT NULL UNIQUE,
  status                text NOT NULL CHECK (status IN ('HOLDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'COMPLETED')),
  hold_expires_at       timestamptz,
  contact_name          text NOT NULL,
  contact_phone         text NOT NULL,
  total_amount          int  NOT NULL CHECK (total_amount >= 0),
  policy_snapshot       jsonb NOT NULL,
  channel               text NOT NULL DEFAULT 'ONLINE' CHECK (channel IN ('ONLINE', 'STAFF')),
  idempotency_key       text,
  request_hash          text,
  access_token_version  int  NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, idempotency_key),
  CHECK (status <> 'HOLDING' OR hold_expires_at IS NOT NULL)
);
CREATE INDEX bookings_trip_holding_idx ON bookings (trip_id, hold_expires_at) WHERE status = 'HOLDING';

-- Kho chỗ của chuyến. booking_id là quyền chiếm duy nhất (NULL = trống).
CREATE TABLE trip_seats (
  trip_id        uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seat_code      text NOT NULL,
  floor          text NOT NULL,
  max_occupancy  int  NOT NULL CHECK (max_occupancy BETWEEN 1 AND 2),
  sellable       boolean NOT NULL,
  booking_id     uuid REFERENCES bookings(id),
  PRIMARY KEY (trip_id, seat_code),
  CHECK (sellable OR booking_id IS NULL)
);
CREATE INDEX trip_seats_booking_idx ON trip_seats (booking_id) WHERE booking_id IS NOT NULL;

-- Dòng đơn: giữ lại cả khi đơn hết hạn (lịch sử).
CREATE TABLE booking_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id),
  trip_id       uuid NOT NULL,
  seat_code     text NOT NULL,
  occupancy     int  NOT NULL CHECK (occupancy BETWEEN 1 AND 2),
  infant_count  int  NOT NULL DEFAULT 0 CHECK (infant_count >= 0),
  unit_price    int  NOT NULL CHECK (unit_price >= 0),
  infant_price  int  NOT NULL DEFAULT 0 CHECK (infant_price >= 0),
  line_total    int  NOT NULL CHECK (line_total >= 0),
  FOREIGN KEY (trip_id, seat_code) REFERENCES trip_seats (trip_id, seat_code),
  UNIQUE (booking_id, seat_code)
);
