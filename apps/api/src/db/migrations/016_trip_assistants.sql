-- Phân công phụ xe theo chuyến. Khóa ngoại kép (id, operator_id) để DB tự chặn gán chuyến/người của nhà xe khác.
ALTER TABLE trips ADD CONSTRAINT trips_id_operator_key UNIQUE (id, operator_id);
ALTER TABLE users ADD CONSTRAINT users_id_operator_key UNIQUE (id, operator_id);

CREATE TABLE trip_assistants (
  operator_id  uuid NOT NULL REFERENCES operators(id),
  trip_id      uuid NOT NULL,
  user_id      uuid NOT NULL,
  assigned_by  uuid REFERENCES users(id),
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id),
  FOREIGN KEY (trip_id, operator_id) REFERENCES trips (id, operator_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, operator_id) REFERENCES users (id, operator_id)
);
-- Phụ xe xem "chuyến của tôi": tra theo người được giao.
CREATE INDEX trip_assistants_user_idx ON trip_assistants (user_id, trip_id);
