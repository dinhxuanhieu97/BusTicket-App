ALTER TABLE booking_items DROP CONSTRAINT booking_items_booking_id_seat_code_key,
  ADD UNIQUE (booking_id, trip_id, seat_code);
CREATE INDEX booking_items_trip_booking ON booking_items(trip_id, booking_id);
